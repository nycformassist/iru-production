# Privacy Review — Temporary Document Image Review (`api/review-image.js`)

Written 2026-10-16. This document states what was **verified** about the
image-review data flow and what **cannot be proven** — per the directive,
claims must match demonstrated behavior.

## What the endpoint does (verified by code inspection + tests)

1. The client POSTs `{ imageBase64, mimeType, relatedEvidenceKey }` to
   `/api/review-image`. Transport is HTTPS (Vercel-managed TLS).
2. The server validates type (JPEG/PNG/WebP/GIF allowlist), size (≤ 4 MB
   decoded), and the optional evidence-key allowlist. Rejects otherwise.
3. The image is decoded **in function memory only** to check size; the buffer
   reference is dropped immediately. **No filesystem writes, no database
   writes, no cache writes** — verified by inspection: the module contains no
   `fs`, storage SDK, or cache calls.
4. The base64 image is forwarded to the Gemini API in the same request, with a
   constrained prompt that instructs the model to list field *labels* only and
   never transcribe values.
5. The model response is schema-validated server-side; authenticity/sufficiency
   language is stripped; an authenticity disclaimer is enforced.
6. Application logs record **status and document category only**
   (`[iru] image review complete: category=...`). No image bytes, no extracted
   personal details, no field values are logged — verified by inspection of
   every `console.*` call in the module.
7. On success, failure, timeout, or validation failure the request ends and
   the image exists nowhere in IRU-controlled storage.

## What cannot be proven (documented limitations)

1. **Provider-side retention.** The image is sent to Google's Gemini API.
   Per Google's published terms (https://ai.google.dev/gemini-api/terms and
   https://ai.google.dev/gemini-api/docs/abuse-monitoring, reviewed
   2026-10-16): on **paid** API tiers Google states it does not use prompts or
   responses to train models, but retains API inputs/outputs for a limited
   abuse-monitoring window (reported as up to ~55 days; human review of flagged
   content is possible). On **unpaid/free** tiers, content may be used for
   product improvement and human review. IRU therefore **cannot claim** the
   image is "never saved, never shared, or immediately flushed" — Google's
   abuse-monitoring retention applies regardless of what IRU does. The UI must
   not make those absolute claims.
2. **Function-memory ephemerality.** Vercel serverless function memory is
   reclaimed after the invocation, but IRU cannot *prove* deletion of a memory
   region — it can only show that no retention mechanism exists in its code.
   Stated as: "IRU retains no copy" (verified by code), not "the image is
   cryptographically destroyed" (unverifiable).
3. **Client-side copies.** The applicant's own device/browser holds the image
   they chose to upload (camera roll, file picker). IRU cannot delete the
   applicant's own files and does not claim to.
4. **Network intermediaries.** TLS protects content in transit to Vercel and to
   Google; IRU cannot audit intermediary infrastructure beyond that.

## Resulting product claims (the only ones permitted)

- ✅ "IRU does not save your photo — it is reviewed once, in memory, and IRU keeps no copy."
- ✅ "The review cannot determine whether a document is authentic or legally sufficient."
- ❌ Never claim: "your photo is never saved anywhere," "immediately deleted from all systems," or "never shared" — the provider's abuse-monitoring retention contradicts absolute versions of these claims.
