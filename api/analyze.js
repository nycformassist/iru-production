// api/analyze.js — Vercel Serverless Function
//
// Privacy architecture:
//  - The client NEVER sends direct identifiers (no name, no A-number, no zip).
//  - sanitizeAnswers() allowlists exactly the fields the analysis consumes.
//  - minimizeForModel() generalizes dates (year + recency band) before any
//    model submission. The model never sees a name.
//  - Applicant text is delimited data, never instructions (see lib/prompt.js).
//  - Model output is schema-validated; legal-certainty language is rejected.
//
// The Gemini API key lives here only. Never reaches the client bundle.

// Vercel Fluid Compute — grants 60s on Hobby, 800s on Pro.
export const maxDuration = 60;

import { GoogleGenAI } from "@google/genai";
import { sanitizeAnswers, minimizeForModel, droppedFieldNames, MAX_BODY_BYTES } from "./_lib/privacy.js";
import { buildPrompt, validateModelOutput, fallbackAssessment } from "./_lib/prompt.js";
import { buildGapRecords } from "./_lib/evidence.js";
import { validateImageReviews } from "./_lib/vision.js";
import { sanitizeFactRecord } from "./_lib/facts.js";
import { createLimiter, clientIp } from "./_lib/ratelimit.js";
import { buildLimitedEvaluation } from "./_lib/evaluation.js";
import { entitlementStore } from "./_lib/entitlement.js";

const limiter = createLimiter({ capacity: 10, windowMs: 10 * 60 * 1000 });
// The limited evaluation is a paid, one-shot deliverable: a stricter
// quota applies on top of the general limiter, whether or not the
// paywall is enabled, so the endpoint cannot be strip-mined.
const evaluationLimiter = createLimiter({ capacity: 3, windowMs: 10 * 60 * 1000 });

/**
 * Test hook: globalThis.__IRU_AI_CLIENT__ may provide { generateContentStream(prompt) }
 * yielding { text } chunks. Production always uses the real Gemini client.
 */
function getAiClient(apiKey) {
  if (globalThis.__IRU_AI_CLIENT__) return globalThis.__IRU_AI_CLIENT__;
  const ai = new GoogleGenAI({ apiKey });
  // Model is configurable: gemini-2.5-flash was retired for new API users
  // (live test 2026-10-11 returned 404). Default to a verified-working model;
  // override via GEMINI_MODEL without a code change if it is retired again.
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  return {
    async *generateContentStream(prompt) {
      const stream = await ai.models.generateContentStream({
        model,
        contents: prompt,
      });
      for await (const chunk of stream) {
        yield { text: chunk.text || "" };
      }
    },
  };
}

export default async function handler(req, res) {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).slice(2, 8);
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Abuse protection (per-instance, best-effort — see lib/ratelimit.js).
  const rl = limiter.check(clientIp(req));
  if (!rl.allowed) {
    res.setHeader("Retry-After", Math.ceil(rl.retryAfterMs / 1000));
    return res.status(429).json({ error: "Too many requests. Please try again later." });
  }

  // Body-size cap before parsing trust.
  const rawBody = req.body;
  // The limited evaluation (mode: 'limited') is deterministic — it makes
  // no model call — so it does not require the AI service to be configured.
  const wantsLimited = !!(rawBody && typeof rawBody === 'object' && rawBody.mode === 'limited');
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey && !globalThis.__IRU_AI_CLIENT__ && !wantsLimited) {
    return res.status(500).json({ error: "Analysis service is not configured." });
  }

  const bodySize = typeof rawBody === 'string' ? Buffer.byteLength(rawBody) : JSON.stringify(rawBody || {}).length;
  if (bodySize > MAX_BODY_BYTES) {
    return res.status(413).json({ error: "Request too large." });
  }

  const { answers, lang, narrativeStarters, imageReviews, factRecord } = rawBody || {};
  const sanitized = sanitizeAnswers(answers);
  if (!sanitized.ok) {
    return res.status(400).json({ error: "Invalid submission.", details: sanitized.errors });
  }
  // Optional image-review findings: strictly re-validated server-side.
  // Client-supplied reviews are treated as unverified observations only —
  // they can refine guidance, never establish facts or verification.
  const validatedReviews = validateImageReviews(imageReviews, lang);
  if (!validatedReviews.ok) {
    return res.status(400).json({ error: "Invalid submission.", details: [validatedReviews.error] });
  }
  const dropped = droppedFieldNames(sanitized.answers);
  if (dropped.length > 0) {
    // Audit the boundary: field NAMES only, never values. No PII in logs.
    console.log(`[iru] dropped non-allowlisted fields: ${dropped.join(',')}`);
  }
  if (validatedReviews.reviews.length > 0) {
    console.log(`[iru] analyze with ${validatedReviews.reviews.length} validated image observation(s)`);
  }

  // Canonical fact record (directive §4/§5): strictly re-validated here.
  const cleanRecord = sanitizeFactRecord(factRecord);

  // Correction precedence (defect-closure directive 2026-10-23,
  // Priority 2): a consumer correction recorded in the canonical fact
  // record OUTRANKS the original questionnaire answer for the same
  // field. Without this overlay, re-running the analysis rebuilt gaps
  // and findings from the pre-correction answers, so corrected values
  // silently reverted server-side even when the client record was
  // right. The overlay applies to exactly the allowlisted analysis
  // fields; narrative text is excluded (narrative corrections flow
  // through the narrative module, not the fact-correction path).
  if (cleanRecord) {
    const OVERLAY_FIELDS = new Set([
      'country_of_origin', 'residence_country', 'country_of_birth', 'citizenship',
      'entry_date', 'case_type',
      'has_passport', 'has_i94', 'has_lease', 'has_persecution_proof',
      'has_green_card', 'has_tax_transcripts', 'has_marriage_cert',
      'has_proof_of_relationship', 'has_arrests',
    ]);
    for (const fact of Object.values(cleanRecord.facts)) {
      if (fact && fact.source === 'correction' && OVERLAY_FIELDS.has(fact.id)
        && typeof fact.value === 'string' && fact.value !== '' && fact.value.length <= 200) {
        sanitized.answers[fact.id] = fact.value;
      }
    }
  }

  const min = minimizeForModel(sanitized.answers, narrativeStarters);
  // Only document-extracted facts are passed to the model — as document
  // CONTENTS to cross-check against the applicant's answers, never as
  // established facts. Client-claimed 'verified' facts are dropped by the
  // sanitizer. Identifier-class facts (names, A-numbers, passport numbers)
  // are excluded: the model never needs their values.
  const IDENTIFIER_FACTS = new Set(['full_name', 'a_number', 'passport_number', 'ssn', 'usci_number', 'spouse_name']);
  const documentFacts = cleanRecord
    ? Object.values(cleanRecord.facts)
        .filter(f => f && f.source === 'document' && f.value && !IDENTIFIER_FACTS.has(f.id))
        .slice(0, 20)
        .map(f => ({ id: f.id, value: f.value, status: f.status, sourceRef: f.sourceRef }))
    : [];
  // Evidence-gap engine: server-side KB records for every missing/unknown
  // item. The model tailors these; it never invents alternatives.
  // The LIVE path keeps the EN records: the prompt instructs the model to
  // answer in the target language, so it localizes KB-derived content
  // itself. The DETERMINISTIC fallback paths consume localized records
  // (buildGapRecords with lang) so a non-EN fallback never mixes English
  // KB text into a localized summary.
  const gaps = buildGapRecords(min, validatedReviews.reviews);
  const gapsForFallback = (lang && lang !== 'EN')
    ? buildGapRecords(min, validatedReviews.reviews, lang)
    : gaps;

  // ── Limited evaluation (B2C §3/§4): the $1 deliverable. Deterministic
  // category-level result ONLY — it never reaches the model, the prompt,
  // or any paid deliverable. When the paywall is enabled, a paid
  // evaluation-scoped entitlement is required and is consumed exactly
  // once on delivery; the authorization check lives here on the server,
  // independent of anything the client shows or hides.
  if (wantsLimited) {
    const eq = evaluationLimiter.check(clientIp(req));
    if (!eq.allowed) {
      res.setHeader("Retry-After", Math.ceil(eq.retryAfterMs / 1000));
      return res.status(429).json({ error: "Too many requests. Please try again later." });
    }
    const paywallOn = process.env.PAYWALL_ENABLED === 'true';
    let entitlementToken = '';
    if (paywallOn) {
      entitlementToken = (req.headers && req.headers['x-entitlement-token']) || rawBody.entitlementToken || '';
      const peek = entitlementStore.peekForEvaluation(entitlementToken);
      if (!peek.ok) {
        return res.status(402).json({
          error: 'A paid limited-evaluation entitlement is required, or it has already been used.',
          reason: peek.reason,
        });
      }
    }
    const evaluation = buildLimitedEvaluation(min, lang);
    if (paywallOn) {
      const consumed = entitlementStore.consumeByToken(entitlementToken);
      if (!consumed.ok) {
        console.error(`[iru] evaluation entitlement consume failed: ${consumed.reason}`);
        return res.status(409).json({ error: 'This entitlement could not be completed. Please contact support with your entitlement reference.' });
      }
    }
    console.log(`[iru] limited evaluation delivered (paywall=${paywallOn})`);
    return res.status(200).json({ ok: true, mode: 'limited', evaluation });
  }

  const prompt = buildPrompt(min, lang, gaps, validatedReviews.reviews, documentFacts);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    const client = getAiClient(apiKey);
    let fullText = "";
    // Timeout the AI stream: if Vercel kills the function mid-stream, the client
    // gets a truncated response with no 'done' event. Abort early and use fallback.
    const AI_TIMEOUT_MS = 45000; // Leave headroom under Vercel's 60s maxDuration
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('AI generation timeout')), AI_TIMEOUT_MS);
    });
    const streamPromise = (async () => {
      for await (const chunk of client.generateContentStream(prompt)) {
        const text = chunk.text || "";
        if (text) {
          fullText += text;
          send({ type: "chunk", text });
        }
      }
      return fullText;
    })();
    await Promise.race([streamPromise, timeoutPromise]);

    const validated = validateModelOutput(fullText);
    const assessment = validated.ok ? validated.data : fallbackAssessment(min, gapsForFallback, validatedReviews.reviews, lang);
    if (validated.sanitized) {
      // Privacy-safe observability only: no model text, no intake data.
      // A verification claim was rewritten to neutral language instead
      // of discarding the assessment (2026-10-24 fix).
      console.log(JSON.stringify({ event: 'iru_analyze_verification_sanitized', requestId }));
    }
    if (!validated.ok) {
      const durationMs = Date.now() - startTime;
      console.error(JSON.stringify({
        event: 'iru_analyze_validation_failure',
        requestId,
        stage: 'output_validation',
        errorClass: 'validation',
        durationMs,
        message: String(validated.error).slice(0, 200),
        responseEmpty: !fullText || fullText.length === 0,
        responseLength: fullText ? fullText.length : 0,
      }));
    }
    // Include ai_unavailable status when validation fails (fallback used)
    const status = validated.ok ? undefined : "ai_unavailable";
    send({ type: "done", status, assessment });
    res.end();
  } catch (err) {
    // Structured, privacy-safe logging. Never log intake answers, PII, or prompt content.
    const durationMs = Date.now() - startTime;
    const errMsg = err && err.message ? String(err.message).slice(0, 200) : String(err).slice(0, 200);
    const errName = err && err.name ? String(err.name).slice(0, 50) : 'unknown';
    // Extract provider HTTP status if available (without exposing details)
    let providerStatus = 'unknown';
    if (err && typeof err === 'object') {
      const e = err;
      if (e.status) providerStatus = String(e.status).slice(0, 10);
      else if (e.code) providerStatus = String(e.code).slice(0, 20);
    }
    console.error(JSON.stringify({
      event: 'iru_analyze_failure',
      requestId,
      stage: 'ai_stream',
      errorClass: errName,
      providerStatus,
      durationMs,
      message: errMsg,
      // Never include: answers, imageReviews content, prompt, apiKey
    }));
    // Return explicit ai_unavailable status instead of fake assessment
    send({ 
      type: "error", 
      status: "ai_unavailable",
      assessment: fallbackAssessment(min, gapsForFallback, validatedReviews.reviews, lang) 
    });
    res.end();
  }
}
