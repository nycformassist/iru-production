/**
 * lib/draftIntegrity.js — Draft↔fact-snapshot binding (defect-closure
 * directive 2026-10-23, Priority 1).
 *
 * THE PROBLEM: form generation is stateless. The server keeps no record
 * of the applicant or their facts, so there is no authoritative
 * server-side "current version" a draft can be checked against. The
 * client invalidates drafts on fact mutations, but nothing bound a
 * generated draft to the exact facts it was generated from: a draft
 * artifact (or a manipulated client state) could be re-presented as
 * current after the underlying facts changed.
 *
 * THE STRONGEST HONEST SAFEGUARD THIS ARCHITECTURE SUPPORTS:
 * every generated draft is cryptographically bound to an exact,
 * per-form snapshot of the canonical fact record — the values,
 * statuses, sources and conflict candidates of exactly the facts that
 * determine that form's draft and completion summary, plus the form
 * id, the official edition, and the narrative-gate state. The binding
 * is a SHA-256 content hash computed by THIS module, shared verbatim
 * by the server (api/generate-form.js) and the client (src/App.tsx),
 * so both sides compute the identical hash over the identical
 * canonical snapshot:
 *
 * - At generation, the server computes the hash over the SANITIZED
 *   record it actually used and returns it with the draft (and stamps
 *   it into the PDF). A client may present `expectedSnapshotHash` —
 *   its own computation over the record it is submitting — and the
 *   server rejects the request (409, localized) when the two disagree:
 *   the record transmitted is not the record the interface holds.
 * - On every re-presentation path (the form panel, the packet's
 *   package enumeration, the PDF download), the client recomputes the
 *   hash over the CURRENT record and compares it to the hash stored
 *   with the draft. A mismatch means the facts changed after
 *   generation: the draft is stale, is labeled stale, and is not
 *   offered as a current download — even if some mutation path failed
 *   to withdraw it.
 * - The snapshot is PER-FORM: a correction to a fact that does not
 *   feed a form leaves that form's snapshot (and draft) untouched.
 *
 * WHAT THIS DOES NOT DO (stated plainly, per the directive): it does
 * not create server-side persistence, accounts, or revocation. A
 * direct API caller holding a fact record can always request a FRESH
 * draft generated from exactly those facts — that is the product's
 * stateless design, not a bypass of this binding, because the fresh
 * draft is bound to the facts submitted. What a caller CANNOT do is
 * make the product present a draft as current when the facts it was
 * bound to have changed, or bind a draft to facts it was not
 * generated from. A PDF already downloaded cannot be recalled; every
 * page is stamped DRAFT and the draft's binding (draft id + snapshot)
 * is printed on it so a stale copy is identifiable as such.
 *
 * Pure functions, no I/O. The SHA-256 below is a self-contained
 * implementation (FIPS 180-4) so the browser bundle and the server
 * produce byte-identical digests without platform crypto APIs; the
 * test-suite cross-checks it against node:crypto.
 */

import { sanitizeFactRecord } from './facts.js';
import { isNarrativeApproved } from './narrative.js';

/* ── SHA-256 (FIPS 180-4), string → lowercase hex ─────────────────── */

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

export function sha256Hex(input) {
  const bytes = new TextEncoder().encode(String(input));
  const bitLen = bytes.length * 8;
  const paddedLen = (((bytes.length + 8) >> 6) + 1) << 6;
  const buf = new Uint8Array(paddedLen);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(paddedLen - 4, bitLen >>> 0);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 4294967296));

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Int32Array(64);

  for (let block = 0; block < paddedLen; block += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getInt32(block + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((x) => (x >>> 0).toString(16).padStart(8, '0'))
    .join('');
}

/* ── Canonical per-form snapshot ──────────────────────────────────── */

/** JSON with recursively sorted object keys — one canonical encoding. */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/**
 * Facts outside a form's field list that its completion summary reads:
 * the conditional-applicability triggers (formmap.buildConditionalNotes)
 * — I-589 reads marital_status; I-765 reads application_reason.
 */
const SUMMARY_FACT_IDS = {
  'I-589': ['marital_status'],
  'I-765': ['application_reason'],
};

function factState(fact) {
  if (!fact) return { value: null, status: 'unknown', source: null, alternatives: [] };
  return {
    value: fact.value === undefined ? null : fact.value,
    status: fact.status,
    source: fact.source,
    alternatives: (fact.alternatives || []).map((a) => (a ? a.value : null)),
  };
}

/**
 * The canonical snapshot of everything that determines one form's
 * draft + completion summary, computed over the SANITIZED record (the
 * same normalization the server applies), so a client-side computation
 * over the raw record and the server's over the sanitized record agree.
 * Returns null for an invalid record or form entry.
 */
export function canonicalDraftSnapshot(record, entry) {
  if (!entry || !entry.id) return null;
  const clean = sanitizeFactRecord(record);
  if (!clean) return null;
  const fields = (entry.fields || []).map((field) => ({
    pdfField: field.pdfField,
    factId: field.factId,
    ...factState(clean.facts[field.factId]),
  }));
  const summaryFacts = (SUMMARY_FACT_IDS[entry.id] || []).map((id) => ({
    id,
    ...factState(clean.facts[id]),
  }));
  // The summary lists document sources; a change there changes the
  // summary, so it is part of the binding.
  const documentSources = [...new Set(Object.values(clean.facts).flatMap((f) => {
    const out = [];
    if (f && f.source === 'document' && f.sourceRef && f.sourceRef.documentType) out.push(f.sourceRef.documentType);
    for (const a of (f && f.alternatives) || []) {
      if (a && a.sourceRef && a.sourceRef.documentType) out.push(a.sourceRef.documentType);
    }
    return out;
  }))].sort();
  return {
    formId: entry.id,
    editionDate: entry.editionDate || null,
    fields,
    summaryFacts,
    documentSources,
    narrative: {
      present: !!clean.narrative,
      approved: isNarrativeApproved(clean.narrative),
    },
  };
}

/** The draft binding: SHA-256 over the canonical per-form snapshot. */
export function computeDraftSnapshotHash(record, entry) {
  const snap = canonicalDraftSnapshot(record, entry);
  if (!snap) return null;
  return sha256Hex(stableStringify(snap));
}

/** Short display form of a snapshot hash (identification, not proof). */
export function snapshotShort(hash) {
  return typeof hash === 'string' && hash.length >= 12 ? hash.slice(0, 12) : '';
}

/**
 * Freshness verdict for a retained draft against the CURRENT record:
 * 'current' (bound snapshot matches), 'stale' (facts changed since
 * generation), or 'unbound' (the draft carries no binding — e.g. it
 * predates this mechanism; it is NOT treated as current).
 */
export function draftFreshness(draftMeta, record, entry) {
  if (!draftMeta || typeof draftMeta.snapshotHash !== 'string' || !draftMeta.snapshotHash) {
    return 'unbound';
  }
  const current = computeDraftSnapshotHash(record, entry);
  if (!current) return 'stale';
  return current === draftMeta.snapshotHash ? 'current' : 'stale';
}

/**
 * Which forms' drafts a record mutation affects: the forms whose
 * bound snapshot hash differs between the before and after records.
 * A correction to a fact that feeds no form (e.g. an evidence flag)
 * affects NO form's draft; a correction to a shared form fact can
 * affect both. Returns null when the comparison cannot be made
 * (invalid record) — callers must treat null as "withdraw everything"
 * (the safe default), never as "withdraw nothing".
 *
 * @param {object} beforeRecord
 * @param {object} afterRecord
 * @param {Array} entries registry entries ({ id, editionDate, fields })
 */
export function affectedFormsForMutation(beforeRecord, afterRecord, entries) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const affected = [];
  for (const entry of entries) {
    const before = computeDraftSnapshotHash(beforeRecord, entry);
    const after = computeDraftSnapshotHash(afterRecord, entry);
    if (!before || !after) return null;
    if (before !== after) affected.push(entry.id);
  }
  return affected;
}
