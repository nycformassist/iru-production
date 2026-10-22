/**
 * lib/stripewebhook.js — Stripe webhook signature verification.
 *
 * Implements Stripe's documented v1 scheme directly (HMAC-SHA256 over
 * `${timestamp}.${rawBody}`, `t=...,v1=...` header, 5-minute tolerance)
 * so the webhook endpoint stays dependency-free and unit-testable.
 * A browser redirect is NEVER treated as proof of payment — only a
 * signature-valid webhook marks an entitlement paid.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export const WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;

export function verifyStripeSignature(rawBody, signatureHeader, secret, nowMs = Date.now()) {
  if (!rawBody || !signatureHeader || !secret) {
    return { ok: false, error: 'missing body, signature header, or webhook secret' };
  }
  const parts = {};
  for (const piece of String(signatureHeader).split(',')) {
    const idx = piece.indexOf('=');
    if (idx > 0) {
      const k = piece.slice(0, idx).trim();
      const v = piece.slice(idx + 1).trim();
      (parts[k] = parts[k] || []).push(v);
    }
  }
  const timestamp = parts.t && parts.t[0];
  const signatures = parts.v1 || [];
  if (!timestamp || signatures.length === 0) {
    return { ok: false, error: 'malformed signature header' };
  }
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs - ts * 1000) > WEBHOOK_TOLERANCE_MS) {
    return { ok: false, error: 'timestamp outside tolerance (possible replay)' };
  }
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');
  const expectedBuf = Buffer.from(expected);
  const matched = signatures.some((sig) => {
    const buf = Buffer.from(sig);
    return buf.length === expectedBuf.length && timingSafeEqual(buf, expectedBuf);
  });
  if (!matched) return { ok: false, error: 'signature mismatch' };
  return { ok: true, timestamp: ts };
}

/** Build a signature header (used by tests; mirrors Stripe's scheme). */
export function signStripePayload(rawBody, secret, tsSeconds) {
  const sig = createHmac('sha256', secret).update(`${tsSeconds}.${rawBody}`, 'utf8').digest('hex');
  return `t=${tsSeconds},v1=${sig}`;
}
