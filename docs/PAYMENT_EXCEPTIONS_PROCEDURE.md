# Payment Exception Procedure (IRU)

**Status:** Operational procedure for exceptions created by the payment-hardening
build (2026-10-24). No refund, grant, or charge is authorized by this document
itself — every resolution step below that moves money requires explicit owner
authorization at the time.

## What a payment exception is

When a verified Stripe payment event cannot safely be fulfilled, the webhook
does NOT grant the entitlement and does NOT silently drop the event. It records
a durable, observable exception (in the entitlement store's exception list)
and burns the event id so redelivery cannot double-apply. Exception types:

- `duplicate-upgrade` — a second upgrade payment in one upgrade family
  (e.g. bundle paid after one-form, or a second add-on). The family rule:
  valid paid sets are {one-form}, {one-form, second-form}, or {bundle} alone.
- `amount-mismatch` / `currency-mismatch` / `session-identity-mismatch` —
  the Stripe session's amount, currency, or entitlement identity does not
  match the persisted entitlement record.
- `unfulfillable-payment` — any other verified event the store refused to
  apply as a grant.

Each exception carries: id, type, entitlement id, Stripe session id, Stripe
event id, amount, currency, reason, creation time, and resolution fields
(resolved flag, resolution note, resolved time). Server logs carry the
exception id, type, reason, entitlement id, and session id — never tokens
or buyer data.

## Identifying exceptions

1. **Server logs:** search for `[iru] payment exception` lines. Each line
   carries the exception id and the reason.
2. **Store inspection:** the entitlement store's `listExceptions()` returns
   all exceptions, unresolved first by creation order. (There is deliberately
   no public API endpoint for this: exception review is an operator task,
   not a buyer-facing feature.)
3. **Stripe dashboard cross-check:** for each exception, find the Checkout
   Session by session id and confirm: payment status, amount total,
   currency, and whether a refund already exists. The session is the source
   of truth for money movement; the IRU record is the source of truth for
   what was granted (nothing, in the exception case).

## Reconciling one exception (operator steps)

1. Confirm the Stripe session is genuinely paid (`payment_status: paid`)
   and identify the buyer only through Stripe's own records (IRU holds no
   buyer identity for anonymous checkouts).
2. Determine which outcome applies:
   - **(a) The buyer should receive what they paid for.** Grant it ONLY if
     a safe fulfillment exists: the session identity matches a persisted
     entitlement, the amount matches the server pricing table, and no
     conflicting paid grant exists in the family. Fulfillment is a manual
     operator action (there is no automatic late-grant path beyond the
     webhook's own late-fulfillment rule); record the grant against the
     exception id.
   - **(b) The buyer should be refunded.** Issue the refund in the Stripe
     dashboard (full amount of the session, unless the owner directs a
     partial refund in writing) and record the Stripe refund id against
     the exception id.
   - **(c) The event was not a real payment** (test event, forged payload
     that somehow passed verification — treat as a security incident,
     not a refund case). Escalate to the owner; do not grant, do not refund.
3. Mark the exception resolved with `resolveException(id, resolution)`,
   where the resolution note states the outcome (granted / refunded with
   Stripe refund id / escalated) and the authorizing owner decision.
   Resolving records the decision; it never itself moves money or grants.
4. If the same session or event id produces further exceptions, treat the
   cluster as one incident: one refund or one grant, never one per event.

## What never happens automatically

- No automatic refund is ever issued by the application.
- No entitlement is ever granted from an exception record by code.
- An exception is never deleted. Resolution is a status + note, not removal.
- A duplicate-upgrade exception never converts into a grant of the second
  purchase: the buyer already owns the conflicting grant (or is owed a
  refund of the duplicate payment).

## Prevention notes (why exceptions should be rare)

- The checkout intent key + Stripe idempotency key prevent duplicate
  sessions for one logical purchase.
- The Stripe session `expires_at` matches the local unpaid TTL, so
  ordinary late payments should not occur; late fulfillment covers the
  residual race.
- The upgrade-family re-check at payment time (not just checkout creation)
  is the backstop for concurrent checkouts. A `duplicate-upgrade`
  exception means two sessions were genuinely both paid — that is a
  refund case (b), not a system error to retry.
