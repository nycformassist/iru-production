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
 *      the recipient. There is NO fallback to a client-provided
 *      staffEmail (Pass 1 #1 removed it; Carbon Pass 2, finding C-2).
 *      An omitted or unlisted org is rejected with 400.
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
  const entry = resolveOrgStaff(orgSlug);
  return entry ? entry.staffEmail : null;
}

/**
 * Full registry entry for an org slug: { orgName, staffEmail }.
 * The ONLY source of delivery destinations — the response to a send
 * reports these server-side values, never client-supplied ones, so
 * staff always see where the report actually went (Carbon Pass 2,
 * finding C-2).
 */
export function resolveOrgStaff(orgSlug) {
  if (!orgSlug || typeof orgSlug !== 'string') return null;
  const entry = ORG_STAFF[orgSlug.trim().toLowerCase()];
  if (!entry || typeof entry.staffEmail !== 'string') return null;
  return { orgName: entry.name, staffEmail: entry.staffEmail };
}
