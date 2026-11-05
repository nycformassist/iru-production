/**
 * src/components/PathwayGuidance.tsx — DTC Pathway Assistant guidance panel.
 *
 * Shows BEFORE the customer starts a questionnaire (on form selection)
 * and AGAIN at the end of the questionnaire (before Generate).
 *
 * What it does:
 * - Explains the process the selected form belongs to
 * - Lists related forms with neutral explanations (never "you need this")
 * - Shows discounted price for each related form (regular − $50)
 * - Customer can add to cart or decline and continue
 *
 * What it does NOT do:
 * - Does NOT say the customer needs the additional form
 * - Does NOT recommend I-360 (not built)
 * - Does NOT recommend unreleased forms
 * - Does NOT recommend forms the customer already owns
 *
 * Pricing: additional-form discount is $50 OFF the regular price,
 * applied inside checkout. This panel shows the discounted price
 * (regular − $50) so the customer sees what they would pay.
 */

import { getRecommendations, getFormInfo, getReasonCopy } from '../../api/_lib/pathway.js';
import { pricePurchase } from '../../api/_lib/checkout-pricing.js';

// ─── Pricing (authoritative, owner-set) ───
// Level prices: L1 $149, L2 $199, L3 $249. I-765 $149 (L1), I-589 $249 (L3).
// Other forms: level null until owner assigns — price shown as "TBD" until then.
// Additional-form discount: $50 off regular price.
const LEVEL_PRICES = { 1: 149, 2: 199, 3: 249 };
const ADDITIONAL_FORM_DISCOUNT = 50;

export function formatPrice(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function getFormPrepPriceCents(formCode, formsCatalog) {
  const form = formsCatalog?.[formCode];
  if (!form || form.level == null) return null;
  const dollars = LEVEL_PRICES[form.level];
  if (dollars == null) return null;
  return dollars * 100;
}

export function getDiscountedPriceCents(formCode, formsCatalog) {
  const regular = getFormPrepPriceCents(formCode, formsCatalog);
  if (regular == null) return null;
  return regular - ADDITIONAL_FORM_DISCOUNT * 100;
}

export default function PathwayGuidance({
  currentForm,
  ownedForms = [],
  activeCatalog,
  formsCatalog,
  onAddForm,
  onDismiss,
  placement = 'selection', // 'selection' | 'completion'
  lang = 'EN',
}: {
  currentForm: string;
  ownedForms?: string[];
  activeCatalog: any;
  formsCatalog: any;
  onAddForm?: (form: string, discountedCents: number | null) => void;
  onDismiss?: () => void;
  placement?: string;
  lang?: string;
}) {
  const recommendations = getRecommendations({
    currentForm,
    ownedForms,
    activeCatalog,
    context: 'dtc',
  });

  if (!recommendations || recommendations.length === 0) return null;

  const current = getFormInfo(currentForm);

  return (
    <div
      data-testid="pathway-guidance"
      style={{
        border: '1px solid #bfd3f2',
        background: '#f2f7ff',
        borderRadius: 10,
        padding: '1rem 1.1rem',
        margin: '1rem 0',
      }}
    >
      <h3 style={{ margin: '0 0 0.35rem', fontSize: '1.05rem' }}>
        Pathway Assistant
      </h3>
      <p style={{ margin: '0 0 0.75rem', lineHeight: 1.5 }}>
        {placement === 'selection' ? (
          <>
            You&rsquo;re starting <strong>{currentForm} — {current.name}</strong>.
            This is commonly part of the <strong>{current.process}</strong> process.
          </>
        ) : (
          <>
            You&rsquo;re finishing <strong>{currentForm} — {current.name}</strong>.
            Other forms are commonly associated with this process.
          </>
        )}
      </p>

      <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>
        Other forms commonly associated with this process:
      </p>

      <ul style={{ margin: '0 0 0.75rem', paddingLeft: '1.2rem', lineHeight: 1.5 }}>
        {recommendations.map((rec) => {
          const info = getFormInfo(rec.form);
          const reason = getReasonCopy(rec.reason_key);
          const regular = getFormPrepPriceCents(rec.form, formsCatalog);
          const discounted = getDiscountedPriceCents(rec.form, formsCatalog);
          // The price the customer would actually pay for this pair comes
          // from the SAME pricing function the server uses at checkout —
          // never from the $50-off shortcut alone. For the I-589+I-765
          // pair the $349 bundle governs (not $348), so the panel shows
          // the bundle total instead of a $199 add-on price that the
          // summary would then contradict by $1.
          const priced = pricePurchase({
            ownedForms,
            selectedForm: currentForm,
            addedForm: rec.form,
          });
          const bundleTotal = priced.ok && priced.bundleApplied ? priced.totalCents : null;
          // When the case already owns one form of the pair, the bundle
          // amount due now is the remainder of the $349 pair total
          // (e.g. $200 for I-589 when I-765 is owned) — not $349.
          const ownsPairForm = bundleTotal != null
            && (ownedForms || []).some((f) => f === 'I-589' || f === 'I-765');
          const pairTotalCents = (getFormPrepPriceCents('I-589', formsCatalog) || 0)
            + (getFormPrepPriceCents('I-765', formsCatalog) || 0);
          return (
            <li key={rec.form} style={{ marginBottom: '0.6rem' }}>
              <strong>{rec.form} — {info.name}</strong>
              <br />
              <span style={{ color: '#374151' }}>{reason.explanation}</span>
              <br />
              {bundleTotal != null ? (
                <span>
                  {ownsPairForm ? (
                    <>
                      Add this form at the special bundle price:{' '}
                      <strong>{formatPrice(bundleTotal)}</strong> due now — the{' '}
                      I-589 + I-765 bundle totals {formatPrice(34900)}{' '}
                      <span style={{ color: '#15803d' }}>— save {formatPrice(priced.bundleSavingCents)} versus regular prices</span>
                    </>
                  ) : (
                    <>
                      Add this form at the special bundle price:{' '}
                      <strong>{formatPrice(bundleTotal)}</strong> total for {currentForm} + {rec.form}{' '}
                      <span style={{ textDecoration: 'line-through', color: '#6b7280' }}>
                        {formatPrice(pairTotalCents)}
                      </span>{' '}
                      <span style={{ color: '#15803d' }}>— save {formatPrice(priced.bundleSavingCents)}</span>
                    </>
                  )}
                </span>
              ) : regular != null && discounted != null ? (
                <span>
                  Add this form at the discounted additional-form price:{' '}
                  <strong>{formatPrice(discounted)}</strong>{' '}
                  <span style={{ textDecoration: 'line-through', color: '#6b7280' }}>
                    {formatPrice(regular)}
                  </span>{' '}
                  <span style={{ color: '#15803d' }}>— save $50</span>
                </span>
              ) : (
                <span style={{ color: '#6b7280' }}>Pricing to be confirmed.</span>
              )}
              {onAddForm && priced.ok && (
                <div style={{ marginTop: '0.35rem' }}>
                  <button
                    data-testid={`pathway-add-${rec.form}`}
                    onClick={() => onAddForm(rec.form, bundleTotal != null ? bundleTotal : discounted)}
                    style={{
                      background: '#1a56db',
                      color: '#fff',
                      border: '1px solid #1a56db',
                      borderRadius: 6,
                      padding: '0.4rem 0.8rem',
                      cursor: 'pointer',
                    }}
                  >
                    {bundleTotal != null
                      ? `Add ${rec.form} — ${formatPrice(bundleTotal)}${ownsPairForm ? '' : ' total'}`
                      : `Add ${rec.form} — ${formatPrice(discounted)}`}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p style={{ margin: 0, color: '#374151', lineHeight: 1.5 }}>
        You can add any of these now at the discounted price, or continue with
        just {currentForm}. Whether another form applies depends on your
        circumstances — this is a suggestion, not a determination that you need
        it.
      </p>

      {onDismiss && (
        <div style={{ marginTop: '0.75rem' }}>
          <button
            data-testid="pathway-dismiss"
            onClick={onDismiss}
            style={{
              background: 'transparent',
              border: '1px solid #9ca3af',
              borderRadius: 6,
              padding: '0.4rem 0.8rem',
              cursor: 'pointer',
            }}
          >
            Continue with just {currentForm}
          </button>
        </div>
      )}
    </div>
  );
}
