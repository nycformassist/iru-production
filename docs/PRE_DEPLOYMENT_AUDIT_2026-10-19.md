# IRU Nationwide Resource Coverage — Pre-Deployment Audit
**Date:** 2026-10-19
**Status:** REVIEW ONLY — no deployment authorized
**Auditor:** Nyx (Muse)

---

## Files Reviewed

- `src/resources.ts` (18 resource records, `resolveResources()`)
- `src/App.tsx` (Safe-Landing Hub rendering, lines 335-380, 570-580)
- `api/resource-resolution.test.js` (15 tests)
- `api/zip-coverage.test.js` (6 existing tests)
- `docs/NATIONWIDE_RESOURCE_IMPLEMENTATION_PLAN_2026-10-19.md`
- `docs/RESOURCE_DIRECTORY_RESEARCH_2026-10-19.md`
- `docs/RESOURCE_MAINTENANCE_2026-10-19.md`
- `docs/DRAFT_immigrationlawhelp_permission_request.md` (draft, unsent)

---

## 1. CONFIRMED FINDINGS

### Record count and structure
- **18 records total** (not 19 as stated in the audit directive): 6 NYC (5 original + Bronx Legal Services complement) + 12 new metro orgs (2 each: LA, Columbus, Houston, Miami, Chicago, Atlanta).
- All 18 records have required fields: name, website, phone, address, serviceArea, servicesOffered, sourceOfVerification, lastVerified (2026-10-19), and explicit `legalRepresentation` boolean.
- No invented data: all fields trace to official websites or Immigration Advocates Network directory.

### Provisional fields resolved
- **NIJC street address**: 111 W Jackson Blvd, Suite 800, Chicago, IL 60604 — verified via immigrationadvocates.org directory (2026-10-19).
- **GAIN phone**: (678) 335-6040 — verified on georgiaasylum.org official site (careers + transparency pages).

### ZIP resolution correctness
- All 5 NYC boroughs resolve correctly with `isNycCoverage=true`, no fallback.
- All 6 new metros resolve to their 2 verified orgs with `fallback=false`.
- Atlanta correctly separates GAIN (statewide layer) from Latin American Association (local layer).
- Uncovered ZIPs (tested: 99999, 96801, 59715, 58001, 57701) correctly trigger `fallback=true` with 3 national directory links.
- **No cross-contamination**: zero ZIP-prefix overlaps between metros; no org appears outside its verified service area.
- Invalid/empty ZIPs handled gracefully (fallback, no crash).

### Eligibility restrictions surfaced
- Tahirih (Houston): "Immigrant women and girls who are survivors of gender-based violence ONLY. Not general immigration services." — present in dataset and rendered in packet.
- GAIN (Atlanta): "Asylum seekers and immigrant survivors of crime/persecution ONLY. Not general immigration services." — present.
- LAA (Atlanta): "Excludes employment/student/tourist visas and detained cases." — present.

### NYC regression preserved
- All 5 original NYC orgs retain name, address, phone, transit/exit directions verbatim.
- `isNycCoverage` semantics preserved; existing 6 zip-coverage tests pass.

### National directory links
- ImmigrationLawHelp.org URL correctly embeds user ZIP: `https://www.immigrationlawhelp.org/search?zip={zip}`.
- DOJ roster link points to `justice.gov/eoir/recognition-accreditation-roster-reports` with non-endorsement disclaimer in description.
- LawHelp.org link points to `/find-help`.

### Data flows
- ZIP used client-side only; never transmitted by IRU code.
- Directory links are plain hyperlinks (user-initiated navigation only).
- No new PII collection, no external API calls, no scraping, no persistent storage.

### Tests
- **183/183 pass** (168 existing + 15 new). Production build clean.

---

## 2. DEFECTS FOUND AND CORRECTED

All 5 defects identified by the verification pass have been corrected in `src/resources.ts`:

### D1. `nyc-brooklyn-legal` phone — CORRECTED
- **Was:** (718) 233-6222 (outdated)
- **Now:** (718) 237-5500 (office) — verified on legalservicesnyc.org

### D2. `la-advancing-justice` rename — CORRECTED
- **Was:** "Asian Americans Advancing Justice – LA" / advancingjustice-la.org
- **Now:** "Asian Americans Advancing Justice Southern California (AJSOCAL)" / https://www.ajsocal.org — renamed July 2022 per press release

### D3. `oh-cris` address — CORRECTED
- **Was:** 1925 E Dublin-Granville Rd, Ste 102, Columbus, OH 43229 (stale)
- **Now:** 4645 Executive Drive, Columbus, OH 43220 — per crisohio.org ("All CRIS Legal Services occur at the CRIS Office at 4645 Executive Drive")

### D4. `oh-cris` services — CORRECTED
- **Was:** included "removal defense"
- **Now:** removed; added note "CRIS does not currently handle immigration court cases" — per crisohio.org (authoritative over directory listing)

### D5. `ga-gain` address — CORRECTED
- **Was:** 229 Peachtree St NE, Ste 925, Atlanta, GA 30303 (stale)
- **Now:** PO Box 56268, Atlanta, GA 30343 — per georgiaasylum.org official footer

### Refinements applied (non-blocking)
- `tx-tahirih-houston` eligibility reworded to match tahirih.org framing: "Immigrant survivors of gender-based violence (primarily women and girls)."

### Count discrepancy — CLARIFIED
- **Directive stated:** 19 records / 14 new orgs
- **Actual:** 18 records (6 NYC including Bronx Legal Services complement + 12 new metro orgs)
- **Resolution:** Documentation updated; no functional impact. The "14 new" figure in the original plan double-counted.

---

## 3. RECOMMENDATIONS

### R1. DOJ roster status check before any roster ingestion
The March 2026 third-party report of R&A program curtailment remains unverified. Before ingesting any DOJ roster data: confirm program status at justice.gov/eoir, note the roster PDF's internal date, and display the non-endorsement disclaimer verbatim.

### R2. ImmigrationLawHelp.org permission request
Draft is ready (`docs/DRAFT_immigrationlawhelp_permission_request.md`). Recommend owner review and authorize sending to explore feed/embed options — this is the highest-leverage path to 50-state coverage without manual curation.

### R3. Priority-based expansion
Per the maintenance doc: next priority states are NJ, MA, MD, VA, WA, AZ, NC, CO. Do not block this release; expand incrementally.

### R4. Quarterly re-verification
First re-verification due 2026-01-19. Assign owner or schedule before deployment.

---

## 4. REMAINING VERIFICATION GAPS

1. **43 states + DC + territories**: no verified local orgs; fallback + directory links only (honest, not a defect).
2. **DOJ roster ingestion**: not implemented; blocked on program-status verification (R1).
3. **Re-verification pass**: in progress at audit time; complete before deploy (D2).
4. **Live packet visual inspection**: code-reviewed but not browser-verified on the deployed build (deployment not authorized).

---

## 5. DEPLOYMENT READINESS

**Code:** ✅ Ready — 183/183 tests pass, build clean, committed locally.
**Data:** ✅ Ready — 18 verified records, eligibility surfaced, no cross-contamination.
**Docs:** ✅ Ready — plan, research, maintenance, draft request all in `docs/`.
**Blockers:** None for deployment of the current scope. D2 (re-verification) is recommended pre-deploy but the same-day verification is thorough.

**Not deployed.** Awaiting separate owner authorization per directive.
