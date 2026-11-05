/**
 * src/components/PathwayStaffPanel.tsx — BronxWorks Pathway Assistant staff panel.
 *
 * SAME Pathway intelligence as DTC, DIFFERENT experience:
 * - NO paywall, NO pricing, NO sales prompt, NO "Add to cart"
 * - Staff sees the suggestion; staff decides whether to suggest it to the participant
 * - Participant sees it as a staff suggestion, not a purchase prompt
 *
 * What it does:
 * - Explains the process the participant's selected form belongs to
 * - Lists related forms with neutral explanations of why they may be relevant
 * - Staff clicks "Suggest to participant" → participant sees suggestion in their portal
 * - Participant can start the form (no payment)
 *
 * What it does NOT do:
 * - Does NOT show prices
 * - Does NOT use "buy" / "purchase" / "add to cart" language
 * - Does NOT say the participant needs the form
 * - Does NOT recommend I-360 (not built)
 * - Does NOT recommend unreleased forms
 */

import { getRecommendations, getFormInfo, getReasonCopy } from '../../api/_lib/pathway.js';

export default function PathwayStaffPanel({
  currentForm,
  ownedForms = [],
  activeCatalog,
  participantName,
  onSuggest,
  onDismiss,
}: {
  currentForm: string;
  ownedForms?: string[];
  activeCatalog: any;
  participantName?: string;
  onSuggest?: (form: string) => void;
  onDismiss?: () => void;
}) {
  const recommendations = getRecommendations({
    currentForm,
    ownedForms,
    activeCatalog,
    context: 'bronxworks',
  });

  if (!recommendations || recommendations.length === 0) return null;

  const current = getFormInfo(currentForm);

  return (
    <div
      data-testid="pathway-staff-panel"
      style={{
        border: '1px solid #a7f3d0',
        background: '#f0fdf4',
        borderRadius: 10,
        padding: '1rem 1.1rem',
        margin: '1rem 0',
      }}
    >
      <h3 style={{ margin: '0 0 0.35rem', fontSize: '1.05rem' }}>
        Pathway Assistant — Staff Guidance
      </h3>
      <p style={{ margin: '0 0 0.75rem', lineHeight: 1.5 }}>
        {participantName ? (
          <>
            <strong>{participantName}</strong> is starting{' '}
            <strong>{currentForm} — {current.name}</strong>. This is commonly
            part of the <strong>{current.process}</strong> process.
          </>
        ) : (
          <>
            Participant is starting{' '}
            <strong>{currentForm} — {current.name}</strong>. This is commonly
            part of the <strong>{current.process}</strong> process.
          </>
        )}
      </p>

      <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>
        Related forms that may be relevant:
      </p>

      <ul style={{ margin: '0 0 0.75rem', paddingLeft: '1.2rem', lineHeight: 1.5 }}>
        {recommendations.map((rec) => {
          const info = getFormInfo(rec.form);
          const reason = getReasonCopy(rec.reason_key);
          return (
            <li key={rec.form} style={{ marginBottom: '0.6rem' }}>
              <strong>{rec.form} — {info.name}</strong>
              <br />
              <span style={{ color: '#374151' }}>{reason.explanation}</span>
              <br />
              <span style={{ color: '#374151' }}>
                Recommended staff action: review the participant&rsquo;s
                circumstances and determine whether assistance with this
                additional form should be considered.
              </span>
              {onSuggest && (
                <div style={{ marginTop: '0.35rem' }}>
                  <button
                    data-testid={`pathway-suggest-${rec.form}`}
                    onClick={() => onSuggest(rec.form)}
                    style={{
                      background: '#047857',
                      color: '#fff',
                      border: '1px solid #047857',
                      borderRadius: 6,
                      padding: '0.4rem 0.8rem',
                      cursor: 'pointer',
                    }}
                  >
                    Suggest {rec.form} to participant
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p style={{ margin: 0, color: '#374151', lineHeight: 1.5 }}>
        Staff can review and suggest these to the participant as appropriate.
        There is no consumer paywall or purchase step in the institutional
        experience. Whether another form applies depends on the
        participant&rsquo;s circumstances — this is a suggestion, not a
        determination that it is needed.
      </p>

      {onDismiss && (
        <div style={{ marginTop: '0.75rem' }}>
          <button
            data-testid="pathway-staff-dismiss"
            onClick={onDismiss}
            style={{
              background: 'transparent',
              border: '1px solid #9ca3af',
              borderRadius: 6,
              padding: '0.4rem 0.8rem',
              cursor: 'pointer',
            }}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
