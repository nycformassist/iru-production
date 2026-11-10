/**
 * src/components/PathwayCheckoutSummary.tsx — DTC Pathway purchase review.
 *
 * Shown AFTER the customer clicks "Add <form>" on the Pathway panel and
 * BEFORE any payment. The customer sees each form, its regular price, the
 * discount (or the special bundle price), and the final total — then
 * chooses to proceed to secure checkout or go back with no purchase.
 *
 * Pricing comes from api/_lib/checkout-pricing.js (pricePurchase), the
 * same function the server uses at session creation, so the amount shown
 * here is the amount the server charges. The client never invents prices.
 *
 * Copy stays neutral: this is a suggestion, never a statement that the
 * customer needs the additional form. Declining is always available with
 * no checkout detour.
 */

import { getFormInfo } from '../../api/_lib/pathway.js';
import { BUNDLE_589_765_CENTS } from '../../api/_lib/checkout-pricing.js';

export function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function PathwayCheckoutSummary({
  pricing,
  selectedForm,
  addedForm,
  onConfirm,
  onBack,
  busy = false,
  error = null,
}: {
  pricing: {
    lines: { form: string; regularCents: number; discountCents: number; finalCents: number; kind: string }[];
    totalCents: number;
    bundleApplied: boolean;
    bundleSavingCents: number;
  };
  selectedForm: string;
  addedForm: string;
  onConfirm: () => void;
  onBack: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  const selected = getFormInfo(selectedForm);
  const added = getFormInfo(addedForm);

  return (
    <div
      data-testid="pathway-checkout-summary"
      style={{
        border: '1px solid #bfd3f2',
        background: '#f2f7ff',
        borderRadius: 10,
        padding: '1rem 1.1rem',
        margin: '1rem 0',
      }}
    >
      <h3 style={{ margin: '0 0 0.35rem', fontSize: '1.05rem' }}>
        Review your purchase
      </h3>
      <p style={{ margin: '0 0 0.75rem', lineHeight: 1.5 }}>
        You&rsquo;re preparing <strong>{selectedForm} — {selected.name}</strong>.
        You&rsquo;ve chosen to also prepare{' '}
        <strong>{addedForm} — {added.name}</strong>, which is commonly
        associated with this process. Whether it applies depends on your
        circumstances.
      </p>

      <table
        style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '0.75rem', lineHeight: 1.5 }}
      >
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #bfd3f2' }}>
            <th style={{ padding: '0.35rem 0.25rem' }}>Form</th>
            <th style={{ padding: '0.35rem 0.25rem' }}>Regular price</th>
            <th style={{ padding: '0.35rem 0.25rem' }}>Discount</th>
            <th style={{ padding: '0.35rem 0.25rem' }}>Price</th>
          </tr>
        </thead>
        <tbody>
          {pricing.lines.map((line) => {
            const info = getFormInfo(line.form);
            return (
              <tr key={line.form} style={{ borderBottom: '1px solid #dbe7f7' }}>
                <td style={{ padding: '0.35rem 0.25rem' }}>
                  <strong>{line.form}</strong> — {info.name}
                </td>
                <td style={{ padding: '0.35rem 0.25rem' }}>{formatPrice(line.regularCents)}</td>
                <td style={{ padding: '0.35rem 0.25rem' }}>
                  {line.kind === 'bundle' ? (
                    <span style={{ color: '#15803d' }}>Special bundle price</span>
                  ) : line.discountCents > 0 ? (
                    <span style={{ color: '#15803d' }}>−{formatPrice(line.discountCents)}</span>
                  ) : (
                    <span style={{ color: '#6b7280' }}>—</span>
                  )}
                </td>
                <td style={{ padding: '0.35rem 0.25rem' }}>
                  <strong>{formatPrice(line.finalCents)}</strong>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {pricing.bundleApplied && (
        <p style={{ margin: '0 0 0.5rem', color: '#15803d', lineHeight: 1.5 }}>
          Special bundle price for I-589 + I-765: {formatPrice(BUNDLE_589_765_CENTS)} — a
          saving of {formatPrice(pricing.bundleSavingCents)} versus the regular
          prices. This bundle price applies instead of the usual additional-form
          discount for this combination.
          {pricing.totalCents !== BUNDLE_589_765_CENTS && (
            <> You are charged {formatPrice(pricing.totalCents)} now for the form above; the rest of the {formatPrice(BUNDLE_589_765_CENTS)} bundle total is already covered by a form you own.</>
          )}
        </p>
      )}

      <p style={{ margin: '0 0 0.75rem', fontSize: '1.1rem' }}>
        Total due now:{' '}
        <strong data-testid="pathway-summary-total">{formatPrice(pricing.totalCents)}</strong>
      </p>

      <p style={{ margin: '0 0 0.75rem', color: '#374151', lineHeight: 1.5 }}>
        Both forms will be prepared under the same case. Information you have
        already provided will be reused where it applies, and each form keeps
        its own outstanding-information and review requirements. You can
        continue with just {selectedForm} instead — no purchase is required
        to start.
      </p>

      {error && (
        <p data-testid="pathway-checkout-error" style={{ color: '#dc2626', margin: '0 0 0.75rem' }}>
          {error}
        </p>
      )}

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <button
          data-testid="pathway-proceed-checkout"
          onClick={onConfirm}
          disabled={busy}
          style={{
            background: '#1a56db', color: '#fff', border: '1px solid #1a56db',
            borderRadius: 8, padding: '0.6rem 1.2rem', cursor: busy ? 'wait' : 'pointer',
            fontWeight: 600, opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? 'Starting secure checkout…' : `Proceed to secure checkout — ${formatPrice(pricing.totalCents)}`}
        </button>
        <button
          data-testid="pathway-summary-back"
          onClick={onBack}
          disabled={busy}
          style={{
            background: 'transparent', border: '1px solid #9ca3af', borderRadius: 8,
            padding: '0.6rem 1.2rem', cursor: 'pointer',
          }}
        >
          Back
        </button>
      </div>
    </div>
  );
}
