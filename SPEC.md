# IRU Evidence Intelligence Upgrade — Implementation Spec

## Baseline
- Working tree: `~/workspace/iru-upgrade/` (git repo, HEAD `642d3eb`)
- Source provenance: `nycformassist/iru-production@main @ 828a530a`, itself from `nycformassist/utility-for-immigrants@51386d1` ("GLOW UP" commit)
- Production: Vercel project `iru-production`, deployment READY, Gemini key live and verified end-to-end 2026-10-16
- Existing tests: 48/48 green (`node:test`), `vite build` clean

## Audit findings (verified from source)

### Architecture
- `api/analyze.js`: Vercel serverless fn. POST only, rate-limited (10/10min), 32KB body cap. Flow: `sanitizeAnswers` → `minimizeForModel` → `buildPrompt` → Gemini stream → `validateModelOutput` → SSE to client. Falls back to `fallbackAssessment` on model failure. Key server-side only.
- `api/lib/privacy.js`: allowlist of 13 fields; drops name/A-number/zip; scrubs A-numbers/SSN/email/phone from narrative; generalizes entry date to year + recency band.
- `api/lib/prompt.js`: fixed 8-key JSON schema; hard rules (not a lawyer, untrusted data delimiters, no invented facts, banned legal-certainty phrases).
- `api/lib/ratelimit.js`: token bucket, per-instance best-effort.
- `src/App.tsx` (738 lines): React SPA, state-based navigation (no URL router). Stages: LANG → PHASE1 (7 Qs) → TRIAGE → PHASE2 → PHASE3 → PHASE4 (narrative) → ANALYZING → PACKET. Generates printable HTML packet client-side. Proxy questions asked when primary answered "no".
- `src/constants.tsx` (346 lines): questions, PROXIES map (alt docs per primary), UI labels x5 languages, resources, consulates, forms.

### THE DEFECT — root cause
`src/App.tsx` `addRow()` (~line 254): when applicant answers "no" to a primary document but "yes" to ANY proxy item in `PROXIES[key]`, the packet renders a green-tinted badge **"Ready via Secondary Verification"** (`src/constants.tsx:48` `ui.readyViaSecondary`). Nothing was reviewed or verified — it is pure applicant self-report. The word "Ready" implies the requirement is satisfied; "Verification" implies verification occurred. Both false. The privacy allowlist does NOT include proxy fields, so proxies never reach the API/model — the badge is frontend-only fiction.

### What's missing
- No evidence-gap engine, no alternative-evidence analysis, no evidence states (only yes/no/unknown + the bad badge)
- No legal-standards grounding in code
- No document upload/review of any kind
- No email vault / form module (design only per directive)

## Implementation requirements

### 1. Evidence states (replaces the defect) — `api/lib/evidence.js` (new)
Implement `EVIDENCE_STATES` enum with exactly these states and a `resolveState(primaryAnswer, proxyAnswers)` pure function:
- `reported-not-verified`: applicant says they have the primary; IRU has not seen it
- `suggested-not-obtained`: alternative suggested; not yet obtained
- `alternative-identified`: applicant reports having an alternative; not obtained/reviewed — **never rendered as ready**
- `action-required`: primary missing, no alternative identified
- `unknown`: applicant doesn't know / not applicable
- `legal-review-required`: item needs qualified human/legal review
- `independently-verified`: reserved; only settable where an actual verification process ran (no current flow sets this — document that)
- `reviewed-supports-limited`: reserved for the upload-review flow (Phase 6): reviewed content supports a stated fact to a stated limited extent; authenticity NOT established

Rules:
- "yes" to primary → `reported-not-verified` (NOT "verified", NOT "ready")
- "no" to primary + ≥1 proxy "yes" → primary stays `action-required`; each proxy item → `alternative-identified`
- "no" + no proxies → `action-required`
- "unknown" → `unknown`
- Persecution/arrest items additionally flag `legal-review-required` where the directive requires (religious-identity/persecutor nexus, court disposition questions)

**Frontend:** rewrite `addRow()` in `src/App.tsx` to render the new states with honest badges. DELETE the "Ready via Secondary Verification" string and logic entirely. Each alternative gets its own row showing what it may support and its limitation (from the KB below). No green "ready" styling for anything the system has not reviewed.

### 2. Evidence-gap engine — `api/lib/evidence.js` (same new module)
`EVIDENCE_KB`: for each of the 9 evidence keys (`has_passport`, `has_i94`, `has_lease`, `has_persecution_proof`, `has_green_card`, `has_tax_transcripts`, `has_marriage_cert`, `has_proof_of_relationship`, `has_arrests`), define:
- `targetFact`: what fact/requirement is at issue
- `primaryEvidence`: what would ordinarily address it
- `alternatives`: array of { id, label, supports (what it CAN establish), limitations (what it CANNOT establish), availability, acquisition (how to obtain), safety (risks/cautions), reviewNeeded }

Encode these MANDATORY evidentiary distinctions (also as tests):
- Birth certificate → supports identity/biographical facts; does NOT establish a passport exists
- Dated US photo / clinic receipt → supports timeline presence; does NOT establish exact entry date or manner
- Notarized landlord/roommate letter → supports residence facts; does NOT establish a formal lease
- Court appearance notice → does NOT establish final disposition (certificate of disposition is separate)
- Country-condition evidence → provides context; does NOT prove the applicant experienced the event
- Witness statements / contemporaneous messages / medical records → may corroborate harm; do not by themselves prove legal eligibility
- Absence of corroboration → does NOT disprove the account (must be stated, never inverted)

`buildGapRecords(min)`: for each evidence key where value is 'no' or 'unknown', emit a gap record with the 10 directive fields: targetFact, currentState, primaryEvidence, alternatives[], evidentiaryConnection (per alternative), availability, acquisitionSteps, safetyConsiderations, reviewRequirements, nextAction {step, responsible, priority, status}.

Wire into `api/analyze.js`: after `minimizeForModel`, compute `gaps = buildGapRecords(min)`, pass into `buildPrompt` (extend prompt with a `<evidence_gaps>` section instructing the model to tailor — not replace — the KB alternatives to the applicant's facts, and to respect the evidentiary distinctions), extend `OUTPUT_SCHEMA_KEYS` with `evidenceGaps`, validate in `validateModelOutput`, include in `fallbackAssessment`.

### 3. Legal grounding — `api/lib/legal.js` (new) + `LEGAL_SOURCES.md` (new)
Research (use web search; verify against primary sources) and document:
- INA § 208(b)(1)(B)(ii)–(iii) (REAL ID Act): testimony may be sufficient if credible/persuasive/specific; corroboration required only when reasonably obtainable; no presumption either way
- 8 CFR § 208.13(a) / 8 CFR § 1208.13(a): credible testimony standard
- 8 CFR § 103.2(b)(2): secondary evidence when primary unavailable + required explanation of unavailability
- USCIS Policy Manual guidance on secondary evidence (cite volume/chapter)
- EOIR Practice Manual / Immigration Court guidance on corroboration (cite)
For each: source URL, date/version, which IRU workflow it supports, and a `needsLegalValidation` flag where the application to a workflow is interpretive. If a standard is uncertain, encode a `legal-review-required` flag rather than inventing a rule.
Wire the key principles into the prompt's HARD RULES (testimony/corroboration, secondary-evidence-with-explanation, no automatic adverse inference from missing docs).

### 4. Temporary document review — `api/review-image.js` (new endpoint)
POST-only, rate-limited (reuse limiter, stricter: 5/10min), 4MB cap. Accepts `{ imageBase64, mimeType, relatedEvidenceKey }`. Server-side only:
- Validate size/type; reject non-images
- Send to Gemini with a constrained prompt: return JSON { documentCategory, legibility, fieldsVisible, appearsComplete, inconsistencies[], relatedReadinessItem, limitations } — MUST NOT claim authenticity or legal sufficiency
- Validate output schema server-side; strip any authenticity/sufficiency language
- NEVER persist the image: process in memory, no filesystem writes, no logging of image bytes or extracted PII (log field names/status only, like the existing dropped-fields audit)
- On success, failure, timeout, or validation failure: ensure no retention (document that Vercel function memory is ephemeral; document Gemini API data-retention per Google's current API terms — research and cite)
- Return the structured result; the frontend may offer this as an optional step (wire a minimal UI affordance in the packet flow OR document as API-ready — prefer minimal UI: one optional "review a photo" step after Phase 4)
Document limitations honestly in `PRIVACY_REVIEW.md`: what was verified vs. what cannot be proven (provider-side retention).

### 5. Report (packet) improvements — `src/App.tsx`, `src/constants.tsx`
- Priority Action Table uses the new evidence states
- Each gap shows: what's missing, alternative options with per-alternative supports/limitations, next action + responsible person + priority
- Keep the tone supportive; add the Phase 8 sections if not present: uncertainties distinguished from facts, safety considerations, qualified-review flags
- Preserve all 5 languages for new UI strings (EN/ES/HT/AR/ZH) — use the existing label pattern; keep translations simple and consistent

### 6. Email vault + form module — `docs/VAULT_FORM_ARCHITECTURE.md` (new, design only)
Architecture design: shared structured applicant record, consent/recipient authorization model, audit trail without document retention, form-field mapping with provenance (reported vs extracted vs verified), draft-for-review flow. NO implementation. Must not derail the reliability work.

## Tests (extend existing `node:test` suites; all synthetic data)
- `api/lib/evidence.test.js` (new): state resolution matrix; KB distinction assertions (birth cert ≠ passport, photo ≠ entry date/manner, landlord letter ≠ lease, court notice ≠ disposition, country conditions ≠ individual proof); gap record shape (10 fields); no invented facts
- Cuban synthetic regression (`api/cuban-regression.test.js` or extend `analyze.test.js`): full handler test with the directive's scenario (Cuban, Muslim, kidnapping/family harm, home/land loss, 2026 entry date unknown/manner unknown, missing primaries); assert: no "ready" statuses, alternatives listed with limitations, religious-identity/persecutor nexus flagged for legal review, timeline shows uncertainties, no unsafe acquisition advice, absence of corroboration not treated as disproof
- `api/review-image.test.js` (new): stub vision client; assert schema validation, authenticity-language rejection, no image bytes in logs, error paths return safe fallback
- Prompt tests: new schema keys validated; banned-phrase list extended (e.g. "verified", "authenticated", "legally sufficient" as model claims about documents)
- Privacy tests: proxy fields still excluded from model payload; new endpoint scrubs identifiers
- ALL existing 48 tests must keep passing. Run `npm test` (or the repo's test command — check package.json) and `vite build` green before finishing.

## Constraints (hard)
- Synthetic data only in tests and any manual verification. No real applicant data.
- No outreach, no emails, no third-party contact. No pricing/payment changes. No unrelated features.
- Do not break existing working features (language selector, 4 phases, packet generation, SSE streaming, rate limiting, privacy boundary).
- Server-side secrets stay server-side. No secrets in code, tests, or logs.
- If a requirement cannot be honestly implemented (e.g. provable deletion), document the limitation instead of claiming it.

## Definition of done
- `npm test`: all tests green (existing 48 + new), `vite build` clean
- No "Ready via Secondary Verification" string or logic anywhere
- Cuban regression passes; evidence states render honestly in the packet
- Working tree committed in `~/workspace/iru-upgrade/` with clear commit messages
- Report back: files changed, test counts, build status, any documented limitations/blockers
