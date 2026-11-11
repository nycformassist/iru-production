/**
 * src/components/StaffDashboard.tsx — Institutional staff dashboard.
 *
 * STAFF MODE entry point. The institutional app opens here, not on the
 * consumer entry screen and never on a paywall. There is no pricing, no
 * checkout, and no per-transaction purchase anywhere in this view.
 *
 * What staff can do here:
 * - Start a new case: name the participant (optional), pick a form.
 *   The participant's questionnaire is the same Tier 1 flow the DTC
 *   app uses, with the same intelligence — staff mode only changes
 *   who pays (nobody: organization access) and what the report does
 *   (it goes to staff for review before filing).
 * - Manage intake: the case list shows every case started on this
 *   device, with a staff-set status (Intake / In review / Ready /
 *   Filed) and when a report was last sent to staff. "Continue /
 *   Review" resumes that form's questionnaire (answers autosave per
 *   form) and its report.
 * - Full readiness assessment (I-589 / I-765): the deeper original
 *   flow, including document/photo upload, for asylum + work permit.
 *
 * Boundary: IRU works alongside the organization's existing systems
 * and never replaces them. The organization's system stays the source
 * of truth for the case; IRU is the intelligence layer that sits after
 * collection and before/during professional review. This tool provides
 * procedural information, not legal advice, and does not determine
 * eligibility.
 */
import { useState } from 'react';
import { LanguageSelector } from '../paywall';
import {
  STAFF_FORM_KEYS,
  STAFF_FORM_LABELS,
  listStaffCases,
  createStaffCase,
  updateStaffCase,
  getOrgConfig,
  saveOrgConfig,
  TEST_STAFF_EMAIL,
  type StaffCase,
  type StaffCaseStatus,
} from '../institutional';

const STATUS_LABELS: Record<StaffCaseStatus, string> = {
  intake: 'Intake',
  'in-review': 'In review',
  ready: 'Ready',
  filed: 'Filed',
};

export default function StaffDashboard({
  lang,
  onLanguageChange,
  onStartForm,
  onOpenCase,
  onFullAssessment,
}: {
  lang: 'EN' | 'ES' | 'ZH' | 'HT' | 'AR';
  onLanguageChange: (code: 'EN' | 'ES' | 'ZH' | 'HT' | 'AR') => void;
  onStartForm: (formKey: string, staffCase: StaffCase) => void;
  onOpenCase: (staffCase: StaffCase) => void;
  onFullAssessment: () => void;
}) {
  const [participantName, setParticipantName] = useState('');
  const [selectedForm, setSelectedForm] = useState<string>('i589');
  const [cases, setCases] = useState<StaffCase[]>(() => listStaffCases());
  // Staff receiving setup — per-organization, configured by staff.
  // TESTING: until an org account is created at sale/install time, all
  // completed cases route to the owner's test address below. At install
  // the owner creates the org's account with their real staff email.
  const [orgConfig, setOrgConfig] = useState(() => getOrgConfig());
  const [orgName, setOrgName] = useState(() => getOrgConfig()?.orgName || '');
  const [orgEmail, setOrgEmail] = useState(() => getOrgConfig()?.staffEmail || '');
  const [orgSaved, setOrgSaved] = useState(false);

  const saveReceivingSetup = () => {
    const saved = saveOrgConfig(orgName, orgEmail);
    if (saved) {
      setOrgConfig(saved);
      setOrgSaved(true);
      setTimeout(() => setOrgSaved(false), 4000);
    }
  };

  const startCase = () => {
    const c = createStaffCase(participantName, selectedForm);
    setCases(listStaffCases());
    setParticipantName('');
    onStartForm(selectedForm, c);
  };

  const setStatus = (id: string, status: StaffCaseStatus) => {
    updateStaffCase(id, { status });
    setCases(listStaffCases());
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <img src="/iru-logo.svg" alt="IRU — Immigration Readiness Utility" className="h-16 w-auto mx-auto mb-4 object-contain" />
          <h1 className="text-2xl font-bold mb-2">IRU — Staff Mode</h1>
          <p className="text-slate-600">
            BronxWorks — prepare immigration forms with the participant, review the
            intelligence, and send the completed report to staff before filing.
          </p>
          <p className="text-slate-500 text-sm mt-2">
            Organization access — no consumer checkout. This tool provides procedural
            information, not legal advice. It does not determine eligibility.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
          <LanguageSelector lang={lang} onLanguageChange={onLanguageChange} />
        </div>

        {/* Staff receiving setup — per-organization staff email */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
          <h2 className="font-bold text-lg mb-1">Staff receiving setup</h2>
          <p className="text-slate-600 text-sm mb-3">
            When a participant completes a case and confirms, the report is
            sent to your organization&apos;s staff email — automatically routed,
            no mail app, no address for the participant to enter. Each
            organization has its own receiving setup.
          </p>
          {orgConfig ? (
            <p data-testid="staff-receiving-current" className="text-sm mb-3">
              Currently sending to <strong>{orgConfig.orgName}</strong> staff —{' '}
              <strong>{orgConfig.staffEmail}</strong>
            </p>
          ) : (
            <p data-testid="staff-receiving-current" className="text-sm mb-3">
              No organization receiving email configured on this device. Until
              one is set, test sends go to the owner&apos;s test address{' '}
              <strong>{TEST_STAFF_EMAIL}</strong>. At sale/install time the
              owner creates the organization&apos;s account with its real staff email.
            </p>
          )}
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="staff-org-name">
            Organization name
          </label>
          <input
            id="staff-org-name"
            data-testid="staff-org-name"
            type="text"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            placeholder="e.g. BronxWorks"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3"
          />
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="staff-org-email">
            Staff receiving email
          </label>
          <input
            id="staff-org-email"
            data-testid="staff-org-email"
            type="email"
            value={orgEmail}
            onChange={(e) => setOrgEmail(e.target.value)}
            placeholder={TEST_STAFF_EMAIL}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3"
          />
          <button
            data-testid="staff-save-receiving"
            onClick={saveReceivingSetup}
            disabled={!orgEmail.includes('@')}
            className="bg-blue-600 text-white font-semibold rounded-lg px-4 py-2 hover:bg-blue-700 disabled:opacity-50"
          >
            Save receiving setup
          </button>
          {orgSaved && (
            <span data-testid="staff-receiving-saved" className="text-green-700 text-sm ml-3">
              ✓ Saved — completed cases on this device now route to {orgConfig?.staffEmail}.
            </span>
          )}
        </div>

        {/* Start a new case */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
          <h2 className="font-bold text-lg mb-3">Start a new case</h2>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="staff-participant-name">
            Participant name (optional)
          </label>
          <input
            id="staff-participant-name"
            data-testid="staff-participant-name"
            type="text"
            value={participantName}
            onChange={(e) => setParticipantName(e.target.value)}
            placeholder="e.g. Maria G."
            className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-4"
          />
          <div className="text-sm font-medium text-slate-700 mb-2">Which form?</div>
          <div className="space-y-2 mb-4">
            {STAFF_FORM_KEYS.map((key) => (
              <label key={key} className="flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-2 cursor-pointer hover:border-blue-500">
                <input
                  type="radio"
                  name="staff-form"
                  value={key}
                  checked={selectedForm === key}
                  onChange={() => setSelectedForm(key)}
                />
                <span className="font-medium">{STAFF_FORM_LABELS[key]}</span>
              </label>
            ))}
          </div>
          <button
            data-testid="staff-start-case"
            onClick={startCase}
            className="w-full bg-blue-600 text-white font-semibold rounded-lg px-4 py-3 hover:bg-blue-700"
          >
            Start questionnaire
          </button>
        </div>

        {/* Full readiness assessment (original flow, incl. document upload) */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6">
          <h2 className="font-bold text-lg mb-1">Full readiness assessment — I-589 / I-765</h2>
          <p className="text-slate-600 text-sm mb-3">
            The deeper asylum and work-permit assessment, including document and photo
            upload. Use this when the participant needs the full readiness packet.
          </p>
          <button
            data-testid="staff-full-assessment"
            onClick={onFullAssessment}
            className="w-full border-2 border-slate-300 text-slate-700 font-semibold rounded-lg px-4 py-3 hover:border-blue-500"
          >
            Open full assessment
          </button>
        </div>

        {/* Case list / intake management */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h2 className="font-bold text-lg mb-3">Cases on this device</h2>
          {cases.length === 0 ? (
            <p className="text-slate-600 text-sm">
              No cases yet. Start a case above — it will appear here so staff can
              continue it, review it, and track its status.
            </p>
          ) : (
            <ul className="space-y-3">
              {cases.map((c) => (
                <li key={c.id} data-testid={`staff-case-${c.id}`} className="border border-slate-200 rounded-lg p-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <div className="font-semibold">{c.participantName || 'Unnamed participant'}</div>
                      <div className="text-slate-600 text-sm">
                        {STAFF_FORM_LABELS[c.formKey] || c.formKey} · Started{' '}
                        {new Date(c.createdAt).toLocaleDateString()}
                        {c.lastSentAt ? ` · Report sent ${new Date(c.lastSentAt).toLocaleDateString()}${c.lastSentTo ? ` to ${c.lastSentTo}` : ''}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-slate-600" htmlFor={`staff-status-${c.id}`}>
                        Status
                      </label>
                      <select
                        id={`staff-status-${c.id}`}
                        data-testid={`staff-status-${c.id}`}
                        value={c.status}
                        onChange={(e) => setStatus(c.id, e.target.value as StaffCaseStatus)}
                        className="border border-slate-300 rounded-lg px-2 py-1 text-sm"
                      >
                        {(Object.keys(STATUS_LABELS) as StaffCaseStatus[]).map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>
                      <button
                        data-testid={`staff-open-${c.id}`}
                        onClick={() => onOpenCase(c)}
                        className="bg-blue-600 text-white text-sm font-semibold rounded-lg px-3 py-2 hover:bg-blue-700"
                      >
                        Continue / Review
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-slate-500 text-xs mt-4">
            Cases are tracked on this device only. The organization&apos;s own system
            remains the source of truth for the case — IRU sits after collection and
            before staff review.
          </p>
        </div>
      </div>
    </div>
  );
}
