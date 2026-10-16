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
import { sanitizeAnswers, minimizeForModel, droppedFieldNames, MAX_BODY_BYTES } from "./lib/privacy.js";
import { buildPrompt, validateModelOutput, fallbackAssessment } from "./lib/prompt.js";
import { buildGapRecords } from "./lib/evidence.js";
import { createLimiter, clientIp } from "./lib/ratelimit.js";

const limiter = createLimiter({ capacity: 10, windowMs: 10 * 60 * 1000 });

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
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Abuse protection (per-instance, best-effort — see lib/ratelimit.js).
  const rl = limiter.check(clientIp(req));
  if (!rl.allowed) {
    res.setHeader("Retry-After", Math.ceil(rl.retryAfterMs / 1000));
    return res.status(429).json({ error: "Too many requests. Please try again later." });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey && !globalThis.__IRU_AI_CLIENT__) {
    return res.status(500).json({ error: "Analysis service is not configured." });
  }

  // Body-size cap before parsing trust.
  const rawBody = req.body;
  const bodySize = typeof rawBody === 'string' ? Buffer.byteLength(rawBody) : JSON.stringify(rawBody || {}).length;
  if (bodySize > MAX_BODY_BYTES) {
    return res.status(413).json({ error: "Request too large." });
  }

  const { answers, lang, narrativeStarters } = rawBody || {};
  const sanitized = sanitizeAnswers(answers);
  if (!sanitized.ok) {
    return res.status(400).json({ error: "Invalid submission.", details: sanitized.errors });
  }
  const dropped = droppedFieldNames(sanitized.answers);
  if (dropped.length > 0) {
    // Audit the boundary: field NAMES only, never values. No PII in logs.
    console.log(`[iru] dropped non-allowlisted fields: ${dropped.join(',')}`);
  }

  const min = minimizeForModel(sanitized.answers, narrativeStarters);
  // Evidence-gap engine: server-side KB records for every missing/unknown
  // item. The model tailors these; it never invents alternatives.
  const gaps = buildGapRecords(min);
  const prompt = buildPrompt(min, lang, gaps);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    const client = getAiClient(apiKey);
    let fullText = "";
    for await (const chunk of client.generateContentStream(prompt)) {
      const text = chunk.text || "";
      if (text) {
        fullText += text;
        send({ type: "chunk", text });
      }
    }

    const validated = validateModelOutput(fullText);
    const assessment = validated.ok ? validated.data : fallbackAssessment(min, gaps);
    if (!validated.ok) {
      console.log(`[iru] model output failed validation: ${validated.error}`);
    }
    send({ type: "done", assessment });
    res.end();
  } catch (err) {
    // Never leak provider internals or prompt content to the client.
    console.error("[iru] analysis provider error:", err && err.message ? err.message : err);
    send({ type: "error", assessment: fallbackAssessment(min, gaps) });
    res.end();
  }
}
