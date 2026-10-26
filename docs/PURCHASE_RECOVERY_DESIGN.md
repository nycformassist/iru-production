# Purchase Recovery Design — Email-Based Recovery (PROPOSED, NOT BUILT)

**Status:** Design only, for a single owner decision (payment-hardening
directive 2026-10-24, §7). No email provider, account system, or recovery
UI has been built or activated. Until the owner approves this design, the
existing behavior stands exactly: a 192-bit bearer token in sessionStorage,
server stores only its SHA-256 hash, never displayed or emailed, and a
buyer who loses it has no in-product recovery path.

## Problem

Today the token is the only credential. Closing the tab, switching devices
or browsers, or losing the checkout response loses the purchase, and —
because the store is in-memory — there is no durable record for support to
look up either. The durable store (a precondition for live payments) fixes
the second half; this design fixes the first.

## Design (smallest safe implementation)

1. **Capture the purchase email at checkout.** Stripe Checkout already
   collects the buyer's email for receipts. The webhook (signed, verified)
   reads `session.customer_details.email` and stores it — hashed for
   lookup plus encrypted-at-rest in the durable store — alongside the
   entitlement record. No new form field, no account creation, no
   password. If the session carries no email, that entitlement is
   unrecoverable by email (falls back to today's token behavior).
2. **Recovery request (no new endpoint needed — extend
   `/api/entitlement-status`).** The buyer enters their purchase email.
   The server looks up paid, unexpired entitlements for that email hash.
   The response is IDENTICAL whether or not a match exists ("If a purchase
   exists for this email, a recovery link has been sent") — recovery must
   never confirm or deny that an email has purchases.
3. **Recovery token.** On a match, the server mints a single-use,
   signed, expiring token: 192-bit random, stored only as a SHA-256 hash
   (same discipline as entitlement tokens), bound to ONE entitlement id,
   expiring in 60 minutes, invalidated on first use. The recovery link
   (containing the token) is emailed to the purchase email via the
   provisioned email provider. The email contains no entitlement details
   beyond "a purchase recovery was requested" — details are shown only
   after the token is redeemed.
4. **Redemption (extend `/api/entitlement-status`).** Presenting a valid,
   unexpired, unused recovery token returns the entitlement's public
   view plus a fresh entitlement token (the original credential, delivered
   once over the redemption response, then invalidating the recovery
   token). An invalid, expired, or reused token returns the same generic
   error as an unknown token — no information leak.
5. **Rate limiting + abuse controls.** Recovery requests are rate-limited
   per IP and per email hash (strict: a handful per hour); repeated
   failures do not reveal match status. Recovery emails are sent only to
   the purchase email, never to a requester-supplied alternate address.

## How the buyer proves control

Control of the purchase email IS the proof: whoever can open the recovery
link in that mailbox controls the purchase. No password, no security
questions, no support-mediated identity check. This matches the product's
anonymous, no-account model and is strictly stronger than today's
bearer-token-in-sessionStorage (which anyone with the browser can use).

## How unauthorized parties are kept out

- Match status is never revealed (identical responses, identical timing
  as far as practical).
- Recovery tokens are single-use, 60-minute, bound to one entitlement,
  hash-stored, and invalidated on use; a leaked link is useful once, briefly.
- The recovery email itself carries no entitlement details, no token
  value beyond the link, and no purchase amounts.
- Redemption does not reveal other entitlements for the same email — one
  token, one entitlement. (A buyer with two purchases requests recovery
  per purchase; the email lists no inventory.)

## The 30-day paid-claim window: necessary?

Yes, keep it — as POLICY, confirmed by the owner (today it is only a code
default). Rationale: a paid entitlement is a claim on delivery, not an
open-ended account. After 30 days from payment, the entitlement expires:
recovery links for it stop working, and the buyer must contact support.
What happens after expiry is a support decision (re-issue at owner
discretion), not an automatic extension — automatic extension would make
the window meaningless. The window must be stated in the purchase
confirmation and the recovery email.

## Minimum data and operational costs

- **Data:** one email hash (+ encrypted email for sending) per paid
  entitlement, stored in the durable store; one recovery-token hash per
  outstanding request (deleted on use/expiry). No passwords, no accounts,
  no buyer profiles.
- **Provider:** one transactional-email provider (e.g. Resend, already
  used elsewhere in SMRG for a contact form in test mode) with a verified
  sending domain; one secret (API key) in server env only.
- **Build:** email capture in the webhook, recovery request + redeem
  paths on the existing entitlement-status endpoint, one email template,
  rate limits, tests (match/no-match indistinguishability, token expiry,
  single-use, rate limiting). No new endpoint, no account system.
- **Support burden:** near-zero for the common case (self-serve); the
  residual is buyers whose purchase email is inaccessible (support case,
  owner-discretion re-issue).

## Single owner decision requested

Approve (a) the durable store + email-recovery build as a precondition of
live payments, including the 30-day paid-claim window as policy — or (b)
retain bearer-token-only recovery, accepting that a lost token means a
lost purchase, plus the mitigations (surface a saveable purchase
reference at checkout completion and in the package summary, and publish
a lost-reference support policy). Until (a) is approved, nothing in this
design is built.
