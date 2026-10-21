# IRU Nationwide Resource Coverage — Implementation Plan
**Date:** 2026-10-19
**Status:** DRAFT FOR OWNER REVIEW — no code changes made yet
**Directive:** IRU Nationwide Local + Regional + National Resource Coverage (2026-10-19)

---

## 1. What exists today (Phase 1 audit)

- `src/constants.tsx`: `NYC_RESOURCES` — 5 hardcoded NYC entries keyed by 3-digit ZIP prefix (100/Manhattan, 104/Bronx, 111/Queens, 112/Brooklyn, 103/Staten Island). Each has name, address, phone, mapUrl, transit/exit directions.
- `src/App.tsx` `handleInterviewComplete` (~line 207): matches ZIP 3-digit prefix → single resource. Non-NYC ZIP → shows Manhattan + Bronx resources with `isNycCoverage=false`, which triggers an amber notice in the Safe-Landing Hub: "IRU's curated resource directory currently covers New York City... For legal aid in your area (ZIP {zip}), visit LawHelp.org..."
- `api/zip-coverage.test.js`: 6 tests enforcing the honest-labeling contract.
- Resource selection is **client-side only**; no server involvement, no external calls. Zero-storage posture preserved.

**What must be preserved:** the honest-labeling correction — NYC orgs must never be presented as local to non-NYC users.

---

## 2. Data sources investigated (Phase 2)

| Source | Coverage | Permitted access | Verdict |
|---|---|---|---|
| **ImmigrationLawHelp.org** (Justicia Lab / Scale Justice) | ~1,000 immigration nonprofits, all 50 states; ZIP/county/state search; BIA-recognized or staff-attorney bar | **Link only.** No public API/export/terms found. Scraping or ingesting needs operator permission + legal review. | ✅ Link to ZIP search results (`immigrationlawhelp.org/search?zip=...`). ❌ Do not copy listings without permission. |
| **DOJ EOIR R&A rosters** | ~850 recognized orgs, ~2,290 accredited reps; PDFs by state | **Public domain.** DOJ policy: "may be reproduced, published or otherwise used without the Department's permission." Attribution appreciated. | ✅ Ingest roster facts with DOJ attribution; display EOIR non-endorsement disclaimer. ⚠️ Verify program status (unverified Mar 2026 report of curtailment). |
| **LSC "I Need Legal Help"** | 129 civil legal-aid programs, all states | CC0 data license (free reuse) | ⚠️ **Deprioritize** — LSC grantees generally cannot represent undocumented immigrants. Wrong fit for IRU's core use. |
| **LawHelp.org** | 56 state/territory portals; immigration portal serves "all immigrants, regardless of status" | **Link only.** No API/export/terms found. | ✅ Link to state portals. ❌ Do not ingest without Pro Bono Net permission. |

**Bottom line:** No directory offers an authorized API or bulk feed. The viable architecture is **hybrid**: a curated, verified local dataset (maintained by SMRG) + direct links to authoritative directory searches + public-domain DOJ roster data.

---

## 3. Verified local organizations (7 test locations)

Full details in `docs/RESOURCE_DIRECTORY_RESEARCH_2026-10-19.md`. Summary:

| Location | Verified orgs |
|---|---|
| Bronx, NY 10451 | The Bronx Defenders (immigration defense, NYIFUP); Bronx Legal Services / Legal Services NYC (U/T visas, VAWA, SIJS, asylum, removal defense) |
| Los Angeles, CA 90012 | Legal Aid Foundation of LA (full immigration incl. court/BIA); Asian Americans Advancing Justice–LA (adjustment, DACA, removal defense, T/U/VAWA) |
| Columbus, OH 43215 | CRIS — Community Refugee & Immigration Services (asylum, family, naturalization, removal defense); Legal Aid of Southeast & Central Ohio (immigration-related civil help) |
| Houston, TX 77002 | Catholic Charities Galveston-Houston, St. Frances Cabrini Center (full immigration incl. court rep.); **Tahirih Justice Center — survivors of gender-based violence ONLY** |
| Miami, FL 33130 | Americans for Immigrant Justice (free, low-income; asylum, UAC, trafficking/DV); Catholic Legal Services Miami (pro bono/low-cost, USCIS/courts/BIA) |
| Chicago, IL 60601 | National Immigrant Justice Center (free/low-cost, full rep.; IL + IN); The Resurrection Project (family, DACA, TPS, removal defense, U/T/VAWA/SIJS) |
| Atlanta, GA 30303 | Latin American Association (affordable; family, DACA, TPS, naturalization; **excludes detained cases**); **GAIN — Georgia Asylum & Immigration Network — asylum seekers & survivors ONLY** |

**Critical:** Eligibility restrictions must be surfaced in the UI. Tahirih (Houston) and GAIN (Atlanta) serve only survivors — listing them as general providers would mislead. Two fields are provisional pending re-verification: NIJC street address, GAIN phone number.

---

## 4. Proposed layered selection logic

Replace the single-prefix match in `handleInterviewComplete` with a `resolveResources(zip)` function (new module, e.g. `src/resources.ts`):

```
1. LOCAL — verified orgs whose service area includes the user's ZIP/city/county
2. STATEWIDE/REGIONAL — verified orgs serving the user's state or multi-county region
3. NATIONAL — ImmigrationLawHelp.org ZIP-search link (always shown as "Search nationwide directory"),
   DOJ EOIR roster link; national orgs with multi-state service (e.g., CLINIC Legal network affiliates)
4. FALLBACK — when no verified local/state match: honest "no verified local provider found" message
   + ImmigrationLawHelp.org ZIP search link + LawHelp.org link
```

Rules:
- Layers are complementary: show local + national together.
- A resource is never labeled "local" unless its verified service area covers the user's location.
- The existing NYC honest-labeling behavior becomes the general fallback path (no silent substitution).
- Eligibility notes (e.g., "serves survivors of violence only") render inline with the listing.
- No ZIP or immigration data leaves the client — directory links are plain hyperlinks; the user's ZIP is never transmitted to a third party by IRU code.

**Data format** (per org): name, website, phone, address, serviceArea (verified), servicesOffered (verified, no assumptions), languages (if verified), eligibility (if any), legalVsNonlegal, sourceOfVerification, lastVerified date. Missing fields are omitted, never invented.

---

## 5. Implementation approach (revised per 2026-10-19 product principle)

Per the user's revised IRU principle, architecture is evaluated on business value, reliability, cost, effort, and actual risk — not on a doctrinal client-side-only rule.

**Phase 1 (this plan): client-side.** With 14 curated orgs, a client-side `src/resources.ts` module is the simplest effective implementation: no new infrastructure, no latency, no new data flows to document. This is a simplicity choice, not a privacy mandate.

**When server-side becomes the right call:** as coverage grows toward 50 states (hundreds of records), a server-side resource API enables: larger datasets without bundle bloat, DOJ roster ingestion pipelines, cached directory lookups, and updates without client redeploys. The `resolveResources()` interface is designed to allow this migration without changing the UI contract.

1. **New `src/resources.ts`**: typed resource records + `resolveResources(zip)` implementing the layered logic. NYC entries migrate from `constants.tsx` unchanged (preserving transit/exit fields).
2. **Seed dataset**: the 14 verified orgs from §3 (7 locations × 2), each with `lastVerified: "2026-10-19"` and source citations. This immediately gives real local coverage for the 7 validation locations; all other ZIPs use the honest fallback + directory links (strictly better than today's NYC-only default).
3. **`src/App.tsx`**: replace the prefix-match block with `resolveResources`; extend Safe-Landing Hub rendering to show layer labels (Local / Statewide / National directory / Fallback) and eligibility notes. Keep `isNycCoverage` semantics for the NYC regression tests.
4. **Tests**: extend `api/zip-coverage.test.js` (or add `api/resource-resolution.test.js`) covering: local match per test ZIP, regional fallback, national fallback, missing/invalid ZIP, unverified-org exclusion, eligibility-note presence, NYC regression (10451 → Bronx Defenders, no notice).
5. **Documentation**: accurately document what data the resource feature collects, processes, and transmits (currently: ZIP used client-side only; directory links are plain hyperlinks). No privacy claims beyond what the implementation substantiates.

**Estimated effort:** 1 focused implementation session (dataset entry is the bulk of the work; logic is a small refactor of an existing ~15-line block).

---

## 6. Geographic gaps (honest accounting)

- After this phase: **verified local coverage in 7 metro areas** (NYC ×5 boroughs already; + LA, Columbus, Houston, Miami, Chicago, Atlanta). The remaining ~43 states + DC + territories get the honest fallback + ImmigrationLawHelp.org ZIP-search link — useful and truthful, but not verified local listings.
- Closing the gap requires either (a) ongoing curation (research sprints per state, same method as Phase 2), or (b) operator permission from ImmigrationLawHelp.org for a feed/embed. (a) is under our control; (b) needs outreach + legal review.

---

## 7. Maintenance & verification procedure

- Each record carries `lastVerified` and `sourceOfVerification`.
- **Quarterly re-verification**: spot-check website/phone/address for each record; update `lastVerified`.
- **Change triggers**: user reports, directory delisting notices, returned-mail/phone-disconnect signals.
- **DOJ roster cross-check**: annually verify DOJ-recognized status for listed orgs against the EOIR roster PDFs.
- New orgs are added only after the same verification method used in Phase 2 (official site + reputable directory); provisional fields are never published.
- Records live in version control (`src/resources.ts`); changes are reviewed diffs, not silent edits.

---

## 8. Decisions requiring owner approval

1. **Approve this plan** (or request changes) before any code is written.
2. **Outreach to ImmigrationLawHelp.org** (Justicia Lab / Scale Justice) requesting permission for a directory feed or embed — authorizes me to draft (not send) the request.
3. **Curation cadence**: is quarterly re-verification + per-state research sprints an acceptable ongoing commitment, or should coverage stay at the 7 metros + honest fallback?
4. **LSC deprioritization**: confirm we exclude LSC finder links given the undocumented-immigrant representation restriction (or include with a clear scope flag).
5. **DOJ roster ingestion**: confirm ingesting public-domain roster facts with attribution + non-endorsement disclaimer is acceptable (no permission needed, but owner should be aware).

---

## 9. What is NOT in this phase

- No new API routes or external network calls in this phase (simplicity choice for 14 records, not a doctrinal ban — server-side is available when scale justifies it).
- No scraping, no bulk copying from ImmigrationLawHelp.org or LawHelp.org.
- No paid services, no licensing commitments, no charges.
- No contact with any organization (research was web-only; all data from official sites/directories).
- The two provisional fields (NIJC address, GAIN phone) will be re-verified before the dataset ships; if unresolvable, those fields ship as "see website."
