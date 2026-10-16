# Vault + Form Module Architecture (DESIGN ONLY — not implemented)

Written 2026-10-16 as part of the IRU Evidence Intelligence Upgrade (directive
Phase 7). This is an architecture design to guide future work. **Nothing here
is implemented.** It must not derail the reliability work in Phases 1–6, 8–9.

## Design principles

1. **Applicant-controlled retention.** IRU never becomes a permanent document
   repository. The applicant decides what is kept, where, and who may see it.
2. **Explicit consent and recipient authorization.** Every share action names
   the recipient, the items shared, and the applicant's explicit consent.
   Nothing is sent automatically — no auto-email, no auto-forward.
3. **Audit trail without document retention.** Workflow events (shared X with
   Y at time T, consent granted/revoked) are logged as metadata; the
   underlying sensitive documents are not retained by IRU.
4. **Provenance for every value.** Every field in the structured record carries
   provenance: `applicant-reported` | `extracted-from-document` |
   `independently-verified` | `model-inference`. The form module never
   presents an inference as a reported fact.
5. **One structured record, many consumers.** The evidence-gap engine, the
   (future) vault, and the (future) form module all read the same applicant
   record shape produced by the intake + `buildGapRecords()`.

## A. Evidence inventory and handoff

### Record shape (future)
```ts
type EvidenceItem = {
  key: string;                    // e.g. 'has_passport'
  state: EvidenceState;           // from api/lib/evidence.js EVIDENCE_STATES
  provenance: 'applicant-reported' | 'extracted-from-document' | 'independently-verified';
  alternatives: AlternativeRef[]; // KB ids the applicant reports having
  reviewResult?: ImageReview;     // one-time review output, if the applicant ran it
  sharedWith: ShareEvent[];       // audit trail
};
type ShareEvent = {
  at: string;                     // ISO timestamp
  recipient: string;              // authorized recipient identifier (not free text)
  items: string[];                // evidence keys shared
  consent: 'explicit-applicant-action';
};
```

### Applicant tracking views
- Reported as possessed → `reported-not-verified`
- Still needed → `action-required` with next action from the gap engine
- Temporarily reviewed → `reviewed-supports-limited` (with the review's stated limitations)
- Requiring follow-up / qualified review → flagged per `requiresLegalReview()`
- Forwarded to an authorized caseworker/interviewer → `ShareEvent` appended

### Consent model
- Sharing is a discrete, deliberate action: select items → select an
  authorized recipient (from a vetted directory, not free-text email) →
  confirm. Each step is explicit.
- Consent is per-share, not blanket. Revocation removes future access; it
  cannot un-send what was already transmitted (stated honestly in the UI).

## B. Future form-preparation module

### Architecture
- **Form definitions** are versioned data (not code): `{ formId: 'I-589',
  revision: '2026-03-01', fields: [{ id, label, mapsTo, required }] }`.
- **Field mapping** maps structured-record paths to form fields, preserving
  provenance. Unmapped or conflicting fields are surfaced, never silently
  dropped or fabricated.
- **Draft-for-review flow:** the module produces a *draft* — pre-filled where
  provenance is `applicant-reported` or better, blank where unknown, flagged
  where uncertain or conflicting. The applicant and a qualified human reviewer
  approve the draft. **Nothing is submitted automatically, ever.**
- Start with **one defined workflow** (e.g. I-589 for the asylum path) only
  after the readiness and evidence foundations are reliable and the pilot
  verdict supports it.

### Provenance rules
- `applicant-reported` values flow into drafts labeled as such.
- `extracted-from-document` values (from a future OCR step, not the current
  image review) are labeled and require applicant confirmation.
- `model-inference` values NEVER flow into a form draft.
- Uncertain answers are flagged, not fabricated.

## Open questions (for qualified review before building)
1. Authorized-recipient directory: who vets caseworkers/organizations?
2. Data-residency and retention policy for the audit trail itself.
3. Whether any document bytes ever need server-side staging (e.g. for a
   caseworker handoff) — and if so, the encryption, TTL, and deletion proofs.
4. Accessibility and language coverage for consent flows.

## Non-goals
- No automatic form submission. No broad multi-form implementation in the
  near term. No permanent SMRG document repository.
