# Legal Sources for IRU Evidence Handling

Researched and verified 2026-10-16 against primary sources. IRU is an
information-readiness assistant — these authorities shape **how the system
talks about evidence**, not legal conclusions about any applicant's case.
Anything interpretive is flagged `needsLegalValidation` in `api/lib/legal.js`
rather than invented as a rule.

## 1. INA § 208(b)(1)(B)(ii)–(iii) — REAL ID Act burden/corroboration/credibility
- **Citation:** 8 U.S.C. § 1158(b)(1)(B)(ii)–(iii)
- **URL:** http://uscode.house.gov/view.xhtml?edition=prelim&f=&fq=&hl=false&num=0&path=&req=(title:8+section:1158+edition:prelim)
- **Verified:** 2026-10-16 (official uscode.house.gov text)
- **Supports workflow:** asylum
- **Key rules:**
  - (ii) Applicant testimony *may* sustain the burden without corroboration,
    but only if the trier of fact finds it credible, persuasive, and referring
    to specific facts sufficient to demonstrate refugee status.
  - (ii) Where the trier of fact determines corroboration should be provided,
    it must be provided **unless the applicant does not have it and cannot
    reasonably obtain it**.
  - (iii) Credibility assessed on totality of the circumstances; no presumption
    of credibility, but no adverse credibility finding → rebuttable presumption
    of credibility on appeal.
- **IRU application:** never tell an applicant corroboration is optional *or*
  required in their specific case — that determination belongs to the adjudicator.

## 2. 8 CFR § 1208.13(a) — establishing asylum eligibility
- **Citation:** 8 CFR § 1208.13(a)
- **URL:** https://www.govinfo.gov/content/pkg/CFR-2014-title8-vol1/pdf/CFR-2014-title8-vol1-sec1208-13.pdf
- **Verified:** 2026-10-16 (govinfo.gov)
- **Supports workflow:** asylum
- **Key rules:** burden of proof is on the applicant; credible testimony may be
  sufficient without corroboration.
- **IRU application:** same as INA 208 — regulatory restatement.

## 3. 8 CFR § 103.2(b)(2) — secondary evidence and affidavits
- **Citation:** 8 CFR § 103.2(b)(2)(i)–(ii)
- **URL:** https://www.law.cornell.edu/cfr/text/8/103.2 (mirror of eCFR text)
- **Verified:** 2026-10-16 (cornell.edu / ecfr.io text)
- **Supports workflows:** family, citizenship, asylum (general USCIS rule)
- **Key rules:**
  - (i) Non-existence/unavailability of required evidence creates a presumption
    of ineligibility — it must be addressed, not ignored.
  - (i) If a required document does not exist or cannot be obtained: demonstrate
    this + submit secondary evidence pertinent to the facts at issue.
  - (i) If secondary evidence also unavailable: demonstrate unavailability of
    both + submit two or more affidavits from non-parties with direct personal
    knowledge.
  - (ii) Demonstrating unavailability generally requires an original written
    statement on government letterhead from the relevant authority (or evidence
    of repeated good-faith attempts).
- **IRU application:** the evidence-gap engine's "document the unavailability"
  next actions flow from this rule. Note: asylum corroboration has its own
  standard (INA 208); where they overlap, counsel reconciles.

## 4. USCIS Policy Manual, Vol. 1, Part E, Chapter 6 — Evidence
- **Citation:** 1 USCIS-PM E.6
- **URL:** https://www.uscis.gov/policy-manual/volume-1-part-e-chapter-6
- **Verified:** 2026-10-16 (uscis.gov; chapter last updated ~52 days prior per site)
- **Supports workflows:** family, citizenship, asylum
- **Key rules:** secondary evidence and affidavits meet the burden only after
  primary-evidence unavailability is addressed (8 CFR 103.2(b)(2)(i));
  affidavits generally treated as tertiary evidence.
- **⚠️ needsLegalValidation:** the "tertiary evidence" framing and 2026
  RFE-policy changes (reported 2026 via secondary legal press) should be
  confirmed with counsel before relying on affidavit strategy. The chapter
  itself is primary; the 2026 posture gloss is not.

## 5. USCIS Policy Manual, Vol. 4, Part C, Chapter 4 — family-based documentation
- **Citation:** 4 USCIS-PM C.4
- **URL:** https://WWW.USCIS.GOV/policy-manual/volume-4-part-c-chapter-4
- **Verified:** 2026-10-16 (uscis.gov)
- **Supports workflow:** family
- **Key rules:** if primary documentation (e.g. civil marriage/birth
  certificate) cannot be obtained, secondary evidence may support the
  qualifying relationship; two+ sworn third-party statements if both primary
  and secondary are unavailable.
- **IRU application:** benefit-specific instance of the 103.2(b)(2) framework.

## 6. EOIR Immigration Court Practice Manual — procedure
- **Citation:** EOIR Practice Manual (2020 version, Ch. 3)
- **URL:** https://www.justice.gov/eoir/file/1052736/dl?inline=
- **Verified:** 2026-10-16 (justice.gov)
- **Supports workflow:** asylum (procedure only)
- **Key rules:** evidence in removal proceedings follows the manual's filing
  rules (form, pagination, service, deadlines).
- **⚠️ needsLegalValidation:** cited for procedure only. Substantive
  corroboration standards come from INA 208 / 8 CFR 1208.13 — do not treat
  the Practice Manual as the source of corroboration rules.

## Cross-cutting principles encoded in `api/lib/legal.js`
1. Credible, persuasive, specific testimony can sustain the burden without corroboration.
2. Corroboration required only where the adjudicator says so AND the evidence is reasonably obtainable.
3. Unavailable primary evidence → secondary evidence + documented explanation of unavailability.
4. **No automatic adverse inference:** missing documents are gaps to address, not findings against the applicant.
5. Nexus (protected ground ↔ persecutor) and criminal-disposition questions → qualified legal review, never resolved by the tool.
6. IRU is not the adjudicator and predicts nothing about acceptance of any specific evidence.
