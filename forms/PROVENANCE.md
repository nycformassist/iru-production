# Official Form Templates — Provenance

Templates in this directory are the official USCIS fillable PDFs, used
solely to generate consumer-review DRAFTS. IRU never signs, certifies, or
submits them.

| Form | File | Edition (printed on form) | Source (official) | Retrieved | Original SHA-256 |
|---|---|---|---|---|---|
| I-589 | templates/i-589.pdf | 07/28/26 | https://www.uscis.gov/sites/default/files/document/forms/i-589.pdf | 2026-10-21 | 0972de7bf892d7bd15d6f790b85b51c8c26da36ff02a8b15c050563060491eff |
| I-765 | templates/i-765.pdf | 08/21/25 | https://www.uscis.gov/sites/default/files/document/forms/i-765.pdf | 2026-10-21 | 9ac0eae287749d4c2dfa0a591f464cc2124c18647c10e999b59484f090e0dc7d |

Notes:
- The I-589 web page lists edition 01/20/25 as the current edition (checked
  2026-10-21); the PDF USCIS actually serves carries Edition 07/28/26
  (USCIS pre-posts announced editions). IRU generates from the served PDF
  and records its printed edition in the registry. Older I-589 editions
  01/20/25 and 09/03/24 remain accepted by USCIS per the form page.
- USCIS serves these PDFs encrypted with an EMPTY user password. The
  stored templates are the identical documents with that encryption
  wrapper removed (decrypted with the empty user password) so standard
  PDF tooling can populate the AcroForm fields. No content, layout, or
  field was added, removed, or altered: field counts after decryption —
  I-589: 489 fields / 12 pages; I-765: 180 fields / 7 pages (verified
  2026-10-21 with pypdf).
- Field mappings in `api/lib/forms/registry.js` were verified against
  these exact files, including widget-position checks for checkbox
  indices (the two forms order checkbox field indices differently).
- Re-verify editions and re-run the form tests before any release, and
  at least quarterly. USCIS retires editions without notice to IRU.
