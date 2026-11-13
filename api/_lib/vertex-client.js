// api/_lib/vertex-client.js — Vertex AI client (Google Cloud) for IRU.
//
// PROVIDER: Vertex AI, NOT the Gemini Developer API / AI Studio.
// Switched 2026-11-13 (owner direction 2026-11-11: everything goes
// through Google Cloud) because the full-assessment AI review fails on
// AI Studio billing (402/403, outstanding balance, Prepay pool $0.00).
// Ported from the RRU Vertex switch (rru-rental-utility
// lib/gemini-client.ts, commit ee41da6) and Inner Temple Live Ask
// (inner-temple app/api/_gemini.ts), adapted to IRU's plain-JS api/
// directory. Shared by /api/analyze and /api/review-image so retry /
// failover behavior exists in exactly one place.
//
// AUTH: a Google Cloud service account, via OAuth 2.0. The service
// account JSON lives ONLY in the server environment variable
// VERTEX_SERVICE_ACCOUNT_JSON (set in the Vercel dashboard by the
// owner, on the IRU project, Preview + Production). It is read here,
// on the server, and nowhere else. The access token is obtained by
// signing a JWT with the service account's private key (node:crypto,
// no extra dependency) and exchanging it at oauth2.googleapis.com/token.
// The token is cached in module memory until near expiry. NOTHING in
// this file ever logs, returns, or embeds the credential value. There
// is NO API-key fallback: if the service account is missing, the
// module fails closed with a clear "not configured" error.
//
// The service account needs the Vertex AI User role
// (roles/aiplatform.user) on the project (default inner-temple-514402).
//
// MODELS (verified against Vertex AI's published model list 2026-11-11):
//  * Primary: gemini-3.8-flash. Fallback: gemini-3.5-flash.
//  * gemini-2.5-flash is NOT usable: retired on Vertex 2026-10-20.
//  * gemini-3.6-flash is NOT usable: retires on Vertex 2026-11-19.
//  * Override with GEMINI_MODEL / GEMINI_FALLBACK_MODEL env vars.
//
// ENDPOINT: the global v1beta1 endpoint. Do NOT use v1 (it hangs for
// some models). gemini-3.8-flash and gemini-3.5-flash are served only at
// the Global endpoint, so the default location is 'global'.
//
// ERROR SEMANTICS (same as the RRU / Inner Temple pattern):
//  * 403 (PERMISSION_DENIED — billing or a service account lacking the
//    Vertex AI User role) surfaces immediately: never retried, never
//    failed over. Retrying a permission error cannot succeed.
//  * 401 clears the cached token (the next request re-authenticates)
//    and surfaces immediately, without retry or failover.
//  * 404 (NOT_FOUND — a model ID that does not exist on Vertex) is NOT
//    retried, but DOES trigger the one-time fallback to the secondary
//    model. If the fallback also 404s, that is a configuration error
//    and is thrown as-is, not masked as a capacity problem.
//  * 429 / 503 are retried once on the same model with a short delay.
//    If still unavailable, an UpstreamUnavailableError is thrown so
//    the handler can return a retry-worthy error instead of a generic
//    500. Fallback to the secondary model happens ONLY on 404.
//  * Exact upstream error bodies are logged server-side only (never
//    returned to the client, and they never contain the credential or
//    the access token).

import { sign as cryptoSign } from "node:crypto";

export const VERTEX_DEFAULT_PROJECT = "inner-temple-514402";
export const VERTEX_DEFAULT_LOCATION = "global";
export const PRIMARY_MODEL_DEFAULT = "gemini-3.8-flash";
export const FALLBACK_MODEL_DEFAULT = "gemini-3.5-flash";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TOKEN_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
// Vercel functions run with maxDuration 60s: 25s per attempt leaves the
// handler room to return a clean error instead of being killed mid-flight.
const VERTEX_TIMEOUT_MS = 25_000;
const MAX_ATTEMPTS_PER_MODEL = 2;
const BASE_RETRY_DELAY_MS = 500;
const RETRYABLE_STATUS_CODES = [429, 503];

/** Thrown when the Vertex service account is absent or cannot be authenticated. */
export class VertexNotConfiguredError extends Error {
  constructor(message) {
    super(message);
    this.name = "VertexNotConfiguredError";
  }
}

/** A Vertex AI HTTP error, carrying the upstream status code so the
 *  retry/failover logic can tell "busy, worth retrying" apart from
 *  "bad request" or "permission denied" without parsing messages. */
export class VertexError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "VertexError";
    this.status = status;
  }
}

/** Thrown when the primary and fallback models are both unavailable after retries. */
export class UpstreamUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "UpstreamUnavailableError";
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Project / location are read LAZILY at request time (not module-level
// constants): in Node ESM, static imports evaluate before dotenv runs
// in local dev, so module-level env reads silently ignore .env values.
export function getVertexConfig() {
  const projectId = process.env.VERTEX_PROJECT_ID?.trim() || VERTEX_DEFAULT_PROJECT;
  const location = process.env.VERTEX_LOCATION?.trim() || VERTEX_DEFAULT_LOCATION;
  const base =
    location === "global"
      ? "https://aiplatform.googleapis.com/v1beta1"
      : `https://${location}-aiplatform.googleapis.com/v1beta1`;
  return { projectId, location, base };
}

/** Model IDs, read lazily at request time (same reason as getVertexConfig). */
export function getVertexModelNames() {
  return {
    primary: process.env.GEMINI_MODEL?.trim() || PRIMARY_MODEL_DEFAULT,
    fallback: process.env.GEMINI_FALLBACK_MODEL?.trim() || FALLBACK_MODEL_DEFAULT,
  };
}

export function getVertexGenerateUrl(model) {
  const { projectId, location, base } = getVertexConfig();
  return `${base}/projects/${projectId}/locations/${location}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
}

// --- Vertex AI auth (service account, OAuth 2.0) ---------------------------
// No google-auth-library dependency: the JWT -> access-token exchange is
// a short, standard flow implemented here with node:crypto (RS256).

/** Parse the service account JSON from the environment. Returns null
 *  when the env var is absent, malformed, or missing the fields the
 *  JWT exchange needs. Never logs the credential. */
export function getVertexServiceAccount() {
  const raw = process.env.VERTEX_SERVICE_ACCOUNT_JSON || "";
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.client_email !== "string" || !parsed.client_email) return null;
    if (typeof parsed.private_key !== "string" || !parsed.private_key) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** True when a usable service account is configured. This is NOT proof
 *  of authorization — only a live request proves that (401/403 = the
 *  service account lacks the Vertex AI User role, or the key is bad).
 *  Handlers fail closed on this check. */
export function isVertexConfigured() {
  return getVertexServiceAccount() !== null;
}

function base64urlEncode(input) {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  return buf.toString("base64url");
}

let tokenCache = null;

/** Test-only reset for the module-level token cache. */
export function _resetVertexTokenCache() {
  tokenCache = null;
}

/** Obtain an OAuth 2.0 access token for the Vertex AI API by signing a
 *  JWT with the service account's private key and exchanging it at
 *  oauth2.googleapis.com/token. Returns null when no service account
 *  is configured or the exchange fails. The token is cached in module
 *  memory until shortly before expiry.
 *  `fetchImpl` defaults to the global fetch; tests inject a mock. */
export async function getVertexAccessToken(account, fetchImpl = globalThis.fetch) {
  const sa = account ?? getVertexServiceAccount();
  if (!sa) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.email === sa.client_email && tokenCache.expiresAt > nowSec + 60) {
    return tokenCache.token;
  }
  const header = { alg: "RS256", typ: "JWT", ...(sa.private_key_id ? { kid: sa.private_key_id } : {}) };
  const payload = {
    iss: sa.client_email,
    sub: sa.client_email,
    aud: TOKEN_URL,
    scope: TOKEN_SCOPE,
    iat: nowSec,
    exp: nowSec + 3600,
  };
  const unsigned = `${base64urlEncode(JSON.stringify(header))}.${base64urlEncode(JSON.stringify(payload))}`;
  let signature;
  try {
    signature = cryptoSign("sha256", Buffer.from(unsigned, "utf8"), sa.private_key);
  } catch {
    return null;
  }
  const jwt = `${unsigned}.${base64urlEncode(signature)}`;
  let res;
  try {
    res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${encodeURIComponent(jwt)}`,
    });
  } catch {
    return null;
  }
  if (!res.ok) {
    tokenCache = null;
    return null;
  }
  const data = await res.json().catch(() => ({}));
  if (typeof data.access_token !== "string" || !data.access_token) return null;
  const expiresIn = typeof data.expires_in === "number" && data.expires_in > 0 ? data.expires_in : 3600;
  tokenCache = { token: data.access_token, expiresAt: nowSec + expiresIn, email: sa.client_email };
  return data.access_token;
}

// --- Vertex AI generateContent (Bearer token, never an API key) ------------

/**
 * One generateContent call against Vertex AI. Returns the concatenated
 * response text. Throws VertexError carrying the upstream HTTP status
 * on any non-200.
 *
 * `request` is { contents, systemInstruction?, generationConfig?, responseSchema? }.
 * Callers supply `contents` entries with an explicit `role: "user"`:
 * Vertex AI rejects a role-less content with 400 INVALID_ARGUMENT.
 * `systemInstruction`, when given, is sent camelCase (never
 * snake_case — Vertex AI's REST frontend rejects the snake_case name
 * with a 400 "Invalid JSON payload received. Unknown name").
 */
async function callVertexOnce(model, request, accessToken, { fetchImpl, timeoutMs }) {
  const url = getVertexGenerateUrl(model);
  const body = {
    ...(request.systemInstruction
      ? { systemInstruction: { parts: [{ text: request.systemInstruction }] } }
      : {}),
    contents: request.contents,
    generationConfig: {
      ...(request.generationConfig || {}),
      ...(request.responseSchema ? { responseSchema: request.responseSchema } : {}),
    },
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
      body: JSON.stringify(body),
    });
    // Read the raw text first so a non-200 upstream error body is
    // captured verbatim for the server log — the exact message is what
    // diagnoses a 400/403, and parsing alone would hide it when the
    // body is not JSON. Server-side log only: never returned to the
    // client, and it never contains the credential or access token.
    const raw = await res.text().catch(() => "");
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = {};
    }
    if (!res.ok) {
      const upstreamMessage =
        data?.error?.message ?? (typeof data.message === "string" ? data.message : "");
      const message =
        typeof upstreamMessage === "string" && upstreamMessage.length > 0
          ? String(upstreamMessage)
          : `Vertex AI returned HTTP ${res.status}`;
      console.error("[vertex] generateContent failed", { model, status: res.status, body: raw.slice(0, 4000) });
      // A 401 here means the cached token was rejected; drop it so the
      // next request re-authenticates instead of reusing a bad token.
      if (res.status === 401) _resetVertexTokenCache();
      throw new VertexError(res.status, message);
    }
    const candidates = data.candidates;
    const parts = candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts)
      ? parts.map((p) => (typeof p.text === "string" ? p.text : "")).join("")
      : "";
    if (!text) {
      console.warn("[vertex] generateContent returned 200 with no text content", { model });
    }
    return text;
  } catch (err) {
    // The AbortController fires on timeout: surface it as a 503-style
    // upstream failure so the retry logic can treat it as transient.
    if (err instanceof Error && err.name === "AbortError") {
      throw new VertexError(503, `Vertex AI request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One generateContent call with bounded retry and the one-time
 * fallback to the secondary model on 404 only. Returns the
 * concatenated response text.
 *
 * `opts` (all optional, for tests): `fetchImpl` (defaults to the
 * global fetch), `getAccessToken` (defaults to getVertexAccessToken —
 * inject a stub to bypass JWT signing), `retryDelayMs` (default 500),
 * `timeoutMs` (default 25000).
 *
 * Fails closed when no service account is configured: throws
 * VertexNotConfiguredError before any provider call. There is no
 * AI Studio fallback path.
 */
export async function generateVertexText(request, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const retryDelayMs = opts.retryDelayMs ?? BASE_RETRY_DELAY_MS;
  const timeoutMs = opts.timeoutMs ?? VERTEX_TIMEOUT_MS;
  const getToken = opts.getAccessToken || ((account) => getVertexAccessToken(account, fetchImpl));
  const { primary, fallback } = getVertexModelNames();
  let lastStatus = 0;

  for (const model of [primary, fallback]) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODEL; attempt++) {
      const accessToken = await getToken();
      if (!accessToken) {
        // Fail closed: no usable service account (missing env var,
        // malformed JSON, or a failed token exchange). Never fall back
        // to an API key — there is no API-key path anymore.
        throw new VertexNotConfiguredError(
          "VERTEX_SERVICE_ACCOUNT_JSON is not configured or the service account could not be authenticated"
        );
      }
      try {
        return await callVertexOnce(model, request, accessToken, { fetchImpl, timeoutMs });
      } catch (err) {
        const status = err instanceof VertexError ? err.status : null;
        if (status !== null) lastStatus = status;
        // 404: a bad model ID must not take the whole endpoint down —
        // break to the fallback model (once). Never retried.
        if (status === 404) break;
        // 429/503: one bounded retry on the same model.
        if (status !== null && RETRYABLE_STATUS_CODES.includes(status)) {
          if (attempt < MAX_ATTEMPTS_PER_MODEL) {
            await sleep(retryDelayMs * attempt);
            continue;
          }
          throw new UpstreamUnavailableError(
            `Vertex AI model ${model} is currently unavailable (HTTP ${status}). Please try again shortly.`
          );
        }
        // Anything else (400/401/403, or a network error with no
        // status) surfaces immediately: never retried, never failed
        // over. A 403 in particular must not burn a second call on
        // the same blocked account. (A timeout surfaces as a 503
        // VertexError from callVertexOnce, so it takes the retry
        // branch above instead of landing here.)
        throw err;
      }
    }
    // The inner loop only exits without returning (or throwing) on a
    // 404 break — the outer loop then tries the fallback model.
  }
  // Both models 404'd: a configuration problem, not a capacity
  // problem — surface it, don't mask as 503.
  throw new VertexError(
    lastStatus || 404,
    `Vertex AI model ${primary} is not available (HTTP ${lastStatus || 404})`
  );
}

/**
 * Streaming-shaped wrapper for /api/analyze: Vertex AI's REST
 * generateContent is a single non-streaming call, so the full text is
 * yielded as one `{ text }` chunk. The endpoint's SSE shape (chunk
 * events, then a done event) and its bounded retry loop are unchanged.
 */
export async function* generateVertexContentStream(prompt, opts = {}) {
  const text = await generateVertexText(
    {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" },
    },
    opts
  );
  yield { text };
}
