# IRU Resource Directory — Maintenance & Data Flow Documentation
**Date:** 2026-10-19
**Applies to:** `src/resources.ts` layered resource model

---

## Data flows (actual implementation)

| Data | Collected | Processed | Transmitted | Stored |
|---|---|---|---|---|
| User ZIP code | Yes (intake form) | Yes — client-side prefix match in `resolveResources()` | **No** — never sent to any server or third party by resource code | No — in-memory React state only, cleared on Start Over |
| Resource dataset | N/A (bundled) | Yes — filtered client-side by ZIP prefix | No | Bundled in client JS; no server storage |
| Directory links | N/A | URL constructed client-side with user's ZIP embedded | **User-initiated only** — clicking a link navigates the user's browser to the directory; IRU sends nothing | No |

**Key point:** The ImmigrationLawHelp.org ZIP-search URL embeds the user's ZIP (e.g., `.../search?zip=90012`), but this is a plain hyperlink. The ZIP is transmitted to immigrationlawhelp.org **only if the user clicks the link**, as a normal browser navigation — identical to typing the URL themselves. IRU performs no background lookup, no API call, no analytics ping.

**No new data collection** was introduced by this phase. No document storage, no PII retention, no external lookup calls, no scraping.

---

## Quarterly re-verification procedure

Each record in `src/resources.ts` carries `lastVerified` (YYYY-MM-DD) and `sourceOfVerification`.

**Every quarter:**
1. For each org: open official website → confirm name, address, phone, services still accurate.
2. Cross-check against Immigration Advocates Network directory listing.
3. For DOJ-recognized orgs: verify against current EOIR roster PDFs.
4. Update `lastVerified` to the check date; update any changed fields with new source citation.
5. If an org's website is dead, phone disconnected, or services discontinued: remove the record (do not leave stale data).

**Change triggers (immediate review):**
- User reports incorrect information
- Directory delisting notice
- Bounced contact / disconnected phone discovered

---

## State research cadence (priority-based expansion)

Do not delay releases to cover all 50 states. Expand in priority order:

**Priority 1 (done):** NY, CA, OH, TX, FL, IL, GA — 7 metros, 19 orgs (5 NYC + 14 new).

**Priority 2 (next):** States with largest immigrant populations lacking coverage: NJ, MA, MD, VA, WA, AZ, NC, CO.

**Priority 3:** Remaining states + DC, ordered by immigrant population.

**Method per state:** Same verification protocol as Phase 2 (official site + Immigration Advocates Network directory; 2+ orgs per metro; eligibility restrictions flagged; provisional fields never published).

**Alternative path:** If ImmigrationLawHelp.org grants feed/embed permission (see DRAFT request), curated expansion may become unnecessary for broad coverage — re-evaluate at that point.

---

## DOJ roster verification (before publication)

Per owner authorization §9: public-domain DOJ roster facts may be used with attribution + non-endorsement disclaimer, subject to current-status verification.

**Before ingesting any roster data:**
1. Confirm the R&A program's current operational status (unverified March 2026 report of curtailment — check justice.gov/eoir for current program page).
2. Note the roster PDF's internal "last updated" date at ingest time.
3. Display verbatim: "Source: U.S. Department of Justice, Executive Office for Immigration Review. EOIR does not endorse listed organizations."
4. Never imply DOJ endorsement of IRU.

**Status as of 2026-10-19:** Roster ingestion NOT yet implemented. No roster data in the current dataset.
