/**
 * lib/recoveryDelivery.js — Provider-independent token-delivery interface
 * for email recovery (Phase 1, D3(b)).
 *
 * The entitlement store reissues tokens; THIS module delivers them to the
 * buyer. Delivery is stubbed until an email provider (e.g. Resend) is
 * wired — the interface is stable so wiring later needs no redesign.
 *
 * Contract: deliverRecoveryToken({ email, token }) returns
 * { ok: true, provider } on success, or
 * { ok: false, reason: 'not-configured' } when no provider is wired.
 * Implementations MUST NOT log the token.
 */

export async function deliverRecoveryToken({ email, token }) {
  void email;
  void token;
  // No provider wired (D3(b): logic now, delivery later).
  return { ok: false, reason: 'not-configured' };
}
