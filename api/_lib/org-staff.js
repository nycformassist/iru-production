/**
 * lib/org-staff.js — Server-side per-organization staff receiving setup.
 *
 * CORRECTED MODEL (owner, 2026-11-11): the staff version connects with
 * the consumer module. A completed case routes to THAT organization's
 * staff email — pre-configured per org, never a single hardcoded
 * address, and the consumer never enters an address.
 *
 * Resolution order in /api/send-report:
 *   1. This registry (authoritative): if the request names an org slug
 *      that is listed here, its staff email is used and the
 *      client-provided address is ignored — the client cannot choose
 *      the recipient.
 *   2. The client-provided staffEmail (the device-side org config staff
 *      set in the Staff Dashboard, or the test default).
 *
 * TESTING (now): only the "test" org is listed, routing to the owner's
 * healthcarebyvalentine@gmail.com. That also matches Resend's test-mode
 * constraint (it only delivers to that address anyway).
 *
 * AT SALE/INSTALL (later, NOT now): when an organization buys and the
 * app is installed for them, the owner creates an account for that org
 * — that is when their real staff email is added here (one entry per
 * org). Do NOT configure a real org staff address during testing.
 */
export const ORG_STAFF = {
  test: {
    name: 'Test organization',
    staffEmail: 'healthcarebyvalentine@gmail.com',
  },
};

export function resolveOrgStaffEmail(orgSlug) {
  if (!orgSlug || typeof orgSlug !== 'string') return null;
  const entry = ORG_STAFF[orgSlug.trim().toLowerCase()];
  return entry && typeof entry.staffEmail === 'string' ? entry.staffEmail : null;
}
