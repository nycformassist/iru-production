import React, { useState, useEffect, useRef } from 'react';
import { Shield, Globe, Printer, ArrowRight, ArrowLeft, CheckCircle2, Copy, Info, ChevronRight, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';

// Mobile repair 2026-10-26: upload validation + error messages (pure,
// unit-tested) and the stage-content error boundary (no white screen).
import { ErrorBoundary } from './ErrorBoundary';
import {
  validatePhotoFile,
  messageForReviewStatus,
  MESSAGE_PHOTO_READ_FAILURE,
  MESSAGE_PHOTO_BAD_RESPONSE,
} from './photoValidation';

// Client-side photo compression (2026-10-28, owner ruling): a large
// photo is shrunk in the browser at Review time, before any refusal,
// so a consumer never has to downsize a file themselves. See
// src/photoCompression.ts for scope and limits.
import {
  compressPhotoFile,
  isCompressiblePhoto,
} from './photoCompression';

// Report gap #1 (2026-10-29): claimed-vs-detected document mismatch
// detection. Pure, conservative: only flags when the detected category is
// a specific recognized document type that does not match the selected
// evidence key; never flags on uncertain/empty categories.
import { detectReviewMismatch } from './reviewMismatch';

// Scoring redesign (2026-10-29, owner-authorized): evidence-aware scoring.
// Pure functions; the score reflects strength of evidence across the four
// states (Reported / Provided / Reviewed / Verified-never-by-IRU). It is an
// awareness aid, not a validated metric, and automated review can never
// verify — it can only modestly support or contradict a claim.
import { scoreEvidenceItem, scoreBandForRatio, formatScorePoints } from './evidenceScoring';

// Android recovery diagnostics (?debug=1 overlay only; see src/diagnostics.ts).
// The picker-testing instrumentation (persisted event store, picker-attempt
// marker, picker-route experiments) was removed 2026-10-29 after the
// Android picker defect was resolved on-device. The ?debug=1 panel stays
// as the future diagnostic route (buildSha, boot/session counts,
// navigation type).
import {
  createDiagnostics,
  isDiagnosticsEnabledFromLocation,
  incrementCounter,
  getNavigationInfo,
  installDiagnosticListeners,
  safeStorage,
  DIAGNOSTIC_BOOT_SESSION_KEY,
  DIAGNOSTIC_BOOT_TOTAL_KEY,
} from './diagnostics';

// Android recovery: session-scoped restore (see src/assessmentRecovery.ts).
import {
  saveRecovery,
  loadRecovery,
  clearRecovery,
  loadPickerMarker,
  sessionStore,
} from './assessmentRecovery';
import {
  filterPhase2Questions,
  pruneSkippedAnswers,
  isMarriageNotApplicable,
  isRelationshipNotApplicable,
  scopedQuestionText,
} from './questionGating';
import {
  savePhotoFile,
  loadPhotoFile,
  clearPhotoFile,
} from './photoFileStore';
// Web Share Target arrival (2026-10-28): a file shared to the
// installed PWA is stored by public/sw.js in a separate browser-local
// store and consumed once onto the PHOTO stage by the boot effect
// below. It follows the same clear rules as the photo hold.
import {
  consumeSharedFile,
  clearSharedFile,
} from './sharedFileStore';

import { LANGUAGES, UI_LABELS, PHASE_1_QUESTIONS, TRIAGE_QUESTION, PHASE_2_QUESTIONS, PHASE_3_QUESTIONS, NYC_RESOURCES, CONSULATES, PROXIES, NARRATIVE_STARTERS, USCIS_FORMS, FEE_SCHEDULE_AS_OF, buildExecutiveSummary } from './constants';
import { EntryScreen, GuideFlow, PackageSelect, EvalIntake, EvalReport, RecoverFlow, pt as ppt, suggestForms, getStoredToken, setStoredToken, getEvalToken, setEvalToken, getFormTokens, setFormToken } from './paywall';

// Nationwide layered resource model (local → statewide → national → fallback).
import { resolveResources, resolveResourcesForLocation, ResourceResult, ResourceOrg, localizedResourceText, localizedNationalDescription } from './resources';

// Country-aware location model (directive §3).
import { COUNTRIES, isUsCountry, localizedCountryName, countryDisplayName } from './location';

// Canonical fact record (directive §4) — one shared model for answers,
// document extraction, corrections, the packet, and form preparation.
import { createFactRecord, upsertFact, confirmFact, resolveConflict, overlayConsumerState, markOutputsFresh } from '../api/_lib/facts.js';
// Form engine (directive §7): registry + mapper run client-side for the
// review UI; the PDF itself is generated server-side from the same record.
import { FORM_REGISTRY, getFormEntry, localizedApplicability } from '../api/_lib/forms/registry.js';
import { buildFillPlan, splitFullName } from '../api/_lib/formmap.js';
// Personal Narrative as a first-class stage (successive directive §4):
// chronology + issue analysis + applicant approval gate for form use.
import { createNarrative, addNarrativeEvent, analyzeNarrative, approveNarrative, correctNarrativeEvent, confirmNarrativeEvent, narrativeForPacket } from '../api/_lib/narrative.js';
import { readAnalyzeStream } from '../api/_lib/sse.js';
import { selectForm, summaryForSelection, emptyFormDraftStore, recordDraft, draftForForm, removeDraft, invalidateDrafts, invalidateDraftsForForms, withReviewChecks } from '../api/_lib/formSelection.js';
// Draft↔fact-snapshot binding (defect-closure directive 2026-10-23,
// Priority 1): the same module the server uses, so the hash computed
// here over the current record is the hash the server bound the draft
// to at generation.
import { computeDraftSnapshotHash, draftFreshness, affectedFormsForMutation } from '../api/_lib/draftIntegrity.js';

// B2C pricing + next steps (2026-10-21 directive): the SAME modules the
// server enforces with, so what the consumer is shown is what the
// server charges and what every output must contain.
import { PRICING, SKUS, buildOffer, formatCents } from '../api/_lib/pricing.js';
import { NEXT_STEPS_TITLE, PROFESSIONAL_HELP_POINTS, RESOURCE_SEARCH_PATHS, buildPacketNextSteps as buildPacketNextStepsForLang } from '../api/_lib/nextsteps.js';

const PAYWALL_UI_ON = () => {
  try { return (import.meta as any).env && (import.meta as any).env.VITE_PAYWALL_ENABLED === 'true'; }
  catch { return false; }
};

/** Form-entitlement tokens by form id (test-mode purchases, this browser only). */
function loadFormTokens(): Record<string, string> {
  try { return JSON.parse(sessionStorage.getItem('iru_form_tokens') || '{}'); } catch { return {}; }
}
function saveFormToken(formId: string, token: string) {
  try {
    const map = loadFormTokens();
    map[formId] = token;
    sessionStorage.setItem('iru_form_tokens', JSON.stringify(map));
    sessionStorage.setItem('iru_entitlement_token', token);
  } catch { /* storage unavailable — generation will ask again */ }
}

// Evidence intelligence (server-side source of truth, pure module — no
// secrets, no I/O). Imported read-only for honest packet rendering.
import { EVIDENCE_KB, requiresLegalReview, legalReviewReason, nextActionFor, localizedKb } from '../api/_lib/evidence.js';

/** Display names for the 9 evidence checklist keys (packet rendering). */
const EVIDENCE_ITEM_NAMES: Record<string, string> = {
  has_passport: 'Passport',
  has_i94: 'I-94 Record',
  has_lease: 'Formal Lease',
  has_persecution_proof: 'Proof of Persecution',
  has_green_card: 'Green Card',
  has_tax_transcripts: 'Tax Transcripts',
  has_marriage_cert: 'Marriage/Divorce Certs',
  has_proof_of_relationship: 'Proof of Relationship',
  has_arrests: 'Certificates of Disposition',
};

const FACT_LABELS: Record<string, string> = {
  full_name: 'Full name', family_name: 'Family name', given_name: 'Given name', middle_name: 'Middle name',
  other_names_used: 'Other names used', date_of_birth: 'Date of birth', gender: 'Sex', marital_status: 'Marital status',
  country_of_origin: 'Country of origin', country_of_birth: 'Country of birth', city_of_birth: 'City of birth',
  citizenship: 'Citizenship', nationality: 'Nationality at birth', a_number: 'A-Number', ssn: 'SSN',
  passport_number: 'Passport number', passport_country: 'Passport country', entry_date: 'Entry date',
  entry_place: 'Place of last entry', current_status: 'Current status', application_reason: 'Application reason',
  residence_country: 'Country of residence', residence_region: 'State/region of residence',
  residence_city: 'City of residence', residence_postal_code: 'Postal code', residence_street: 'Street address',
  mailing_street: 'Mailing street', mailing_city: 'Mailing city', mailing_region: 'Mailing state/region',
  mailing_postal_code: 'Mailing postal code', phone: 'Phone', email: 'Email',
};

/** Escape user/AI content before injecting into the printable packet HTML. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Fields the analysis endpoint is allowed to receive. Direct identifiers
 * (name, zip) stay on the device for the local packet; the server allowlists
 * again as defense in depth (see api/_lib/privacy.js).
 */
const SERVER_FIELD_ALLOWLIST = new Set([
  'country_of_origin', 'residence_country', 'country_of_birth', 'citizenship',
  'entry_date', 'case_type',
  'has_passport', 'has_i94', 'has_lease', 'has_persecution_proof',
  'has_green_card', 'has_tax_transcripts', 'has_marriage_cert',
  'has_proof_of_relationship', 'has_arrests', 'has_prior_arrests', 'marital_status', 'narrative_text',
]);

function stripForServer(answers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(answers)) {
    if (SERVER_FIELD_ALLOWLIST.has(k)) out[k] = answers[k];
  }
  return out;
}

export const SUPPORTED_LANGS = ['EN', 'ES', 'ZH', 'HT', 'AR'];
export const LANG_STORAGE_KEY = 'iru_lang';

/** Read the persisted language code (WS2). ONLY the language code is ever
 * stored — never applicant data. Invalid/absent values fall back to EN. */
export function loadPersistedLang(): string {
  try {
    const v = localStorage.getItem(LANG_STORAGE_KEY);
    return v && SUPPORTED_LANGS.includes(v) ? v : 'EN';
  } catch { return 'EN'; }
}

/** Persist ONLY the language code so a full reload (e.g. returning from
 * checkout) restores the applicant's language. */
export function persistLang(code: string) {
  try { localStorage.setItem(LANG_STORAGE_KEY, code); } catch { /* storage unavailable */ }
}

export default function App() {
  const [lang, setLang] = useState(() => loadPersistedLang());

  // Write on every language change (WS2). A failed analyze/checkout request
  // never touches lang, so it cannot reset the persisted choice.
  useEffect(() => { persistLang(lang); }, [lang]);
  const [stage, setStage] = useState<'LANG' | 'PHASE1' | 'TRIAGE' | 'PHASE2' | 'PHASE3' | 'PHASE4' | 'PHOTO' | 'ANALYZING' | 'PACKET' | 'ENTRY' | 'GUIDE' | 'PACKAGES' | 'EVAL_INTAKE' | 'EVAL_REPORT' | 'RECOVER'>(() => PAYWALL_UI_ON() ? 'ENTRY' : 'LANG');
  // Stripe return: after checkout, Stripe redirects to
  // /?checkout=success&session_id=cs_xxx. Verify the session server-side
  // (authoritative — Stripe is the source of truth) and route to the
  // right stage. The client already holds the bearer token from the
  // checkout response; the server confirms payment and returns the
  // entitlement details for routing.
  useEffect(() => {
    if (!PAYWALL_UI_ON()) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') !== 'success') return;
    const sessionId = params.get('session_id');
    if (!sessionId) {
      // No session ID — can't verify. Back to entry.
      window.history.replaceState({}, '', window.location.pathname);
      setStage('ENTRY' as any);
      return;
    }
    // Clean the URL immediately.
    window.history.replaceState({}, '', window.location.pathname);
    (async () => {
      try {
        const r = await fetch('/api/verify-session', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });
        const d = await r.json().catch(() => null);
        if (!r.ok || !d || !d.ok || !d.paid) {
          // Verification failed — back to entry. The user can use
          // "recover access" if they have their token.
          setStage('ENTRY' as any);
          return;
        }
        const ent = d.entitlement;
        if (ent && ent.scope && ent.scope.kind === 'evaluation') {
          setStage('EVAL_INTAKE' as any);
        } else if (ent && ent.paid) {
          setStage('LANG' as any);
        } else {
          setStage('ENTRY' as any);
        }
      } catch {
        setStage('ENTRY' as any);
      }
    })();
  }, []);
  // Paywall journey data (carried between ENTRY/GUIDE/PACKAGES/EVAL stages).
  const [paywallData, setPaywallData] = useState<{ forms?: string[]; answers?: Record<string, string>; fromEval?: boolean }>({});
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [resources, setResources] = useState<any[]>([]);
  const [resourceResult, setResourceResult] = useState<ResourceResult | null>(null);
  const [consulate, setConsulate] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const [assessment, setAssessment] = useState<any>(null);
  const [aiUnavailable, setAiUnavailable] = useState(false);
  // C2: record-consistency field ids the server flagged on the model review
  // (ids only; the assessment itself is never altered).
  const [integrityFlags, setIntegrityFlags] = useState<string[]>([]);
  // C3: server request id, shown as a reference so a report maps to one log line.
  const [requestId, setRequestId] = useState('');
  const [isNycCoverage, setIsNycCoverage] = useState(true);
  // Optional one-time document photo review. The picked file is held
  // temporarily in this browser only (IndexedDB, see src/photoFileStore.ts)
  // so it survives a page recreation on Android; it is never sent to
  // IRU servers except in the existing /api/review-image review call,
  // and it is cleared on Start Over, packet completion, and after a
  // successful review.
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoEvidenceKey, setPhotoEvidenceKey] = useState('');
  const [photoRestoredNotice, setPhotoRestoredNotice] = useState('');
  // Set when Review compressed an oversize photo instead of refusing
  // it (2026-10-28). Cleared on the next pick and on Start Over.
  const [photoResizedNotice, setPhotoResizedNotice] = useState('');
  // Recreation notice (2026-10-28): shown only when the recovery snapshot
  // said the picker was open at boot AND no held file was found — i.e.
  // the page was recreated during the picker, before the photo arrived.
  // Since 2026-10-29 the signal is the recovery payload's pickerOpened
  // flag (written synchronously at input onClick, consumed on restore);
  // the separate picker-attempt marker was testing instrumentation and
  // was removed after the picker defect was resolved on-device.
  const [pickerRecreatedNotice, setPickerRecreatedNotice] = useState('');
  // Set by the boot restore effect when the recovery snapshot says the
  // picker was open on PHOTO. Read by the photo restore effect to
  // decide between the specific recreation notice and the generic one,
  // even if the sessionStorage marker itself did not survive the kill.
  const pickerRecreatedCandidateRef = useRef(false);
  const photoRestoreAttemptedRef = useRef(false);
  // Web Share Target: set when a shared file was consumed on this
  // mount, so the photo-restore effect does not also apply its own
  // restored notice / recreation logic to the same file.
  const sharedArrivalRef = useRef(false);
  const [photoSharedNotice, setPhotoSharedNotice] = useState('');
  const [imageReview, setImageReview] = useState<any>(null);
  // Upload checklist (#10): every uploaded document in this session,
  // tagged to its evidence key. File names live ONLY here (React state)
  // — never in the recovery payload, which stores no file names, blobs,
  // or review output by rule. The picked file itself is held separately
  // in the browser-local photo store (src/photoFileStore.ts, owner ruling
  // 2026-10-28) so a page recreation restores the file; the checklist
  // structure itself rebuilds from restored answers.
  const [uploads, setUploads] = useState<Array<{ key: string; fileName: string; review: any | null }>>([]);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState('');
  // Android recovery: one-time boot-restore notice, non-fatal global
  // error notice, and the stable PHOTO file-input ref (see below).
  const [restoredNotice, setRestoredNotice] = useState('');
  const [globalNotice, setGlobalNotice] = useState('');
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  // Canonical fact record + form preparation (directives §4/§7/§8).
  const [factRecord, setFactRecord] = useState<any>(null);
  const [narrativeError, setNarrativeError] = useState('');
  const [narrativeDates, setNarrativeDates] = useState<Record<string, string>>({});
  const [selectedFormId, setSelectedFormId] = useState<string>('');
  // Per-form generated drafts (R5): each form's summary, PDF, draft
  // metadata and final-review checklist state are retained in a store
  // keyed by form id (api/_lib/formSelection.js), so switching forms
  // never destroys another form's draft — switching back redisplays it
  // without regeneration. Per-form version counters live in the same
  // store and survive draft invalidation (R4a).
  const [formDraftStore, setFormDraftStore] = useState<any>(() => emptyFormDraftStore());
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [formAnswers, setFormAnswers] = useState<Record<string, string>>({});
  // Facts correction editor (R4b): which fact row is being corrected.
  const [editingFactId, setEditingFactId] = useState<string>('');
  const [factEditValue, setFactEditValue] = useState<string>('');
  // The visible draft is always the SELECTED form's retained draft; the
  // render additionally gates it through summaryForSelection (D4).
  const currentFormDraft: any = draftForForm(formDraftStore, selectedFormId);
  const formSummary: any = currentFormDraft ? currentFormDraft.summary : null;
  const formPdfBase64: string = currentFormDraft ? currentFormDraft.pdfBase64 : '';
  const formDraftMeta: any = currentFormDraft ? currentFormDraft.meta : null;
  const reviewChecks: Record<number, boolean> = currentFormDraft ? currentFormDraft.reviewChecks : {};
  // Draft freshness (defect-closure P1): the selected form's retained
  // draft is current ONLY while its bound fact snapshot still matches
  // the current record. Recomputed on every render, so a draft whose
  // facts changed by any path is never presented — or downloaded — as
  // current, even if it was never withdrawn from the store.
  const selectedFormEntry: any = selectedFormId ? getFormEntry(selectedFormId) : null;
  const selectedDraftFreshness: string = currentFormDraft
    ? draftFreshness(formDraftMeta, factRecord, selectedFormEntry)
    : 'none';
  const updateReviewChecks = (checks: Record<number, boolean>) => {
    if (selectedFormId) setFormDraftStore((prev: any) => withReviewChecks(prev, selectedFormId, checks));
  };
  // Purchase state for the offer panel (B2C §3), refreshed from the
  // server-side entitlement status of the tokens this browser holds.
  const [purchaseState, setPurchaseState] = useState<{ hasEvaluation: boolean; ownedForms: string[] }>({ hasEvaluation: false, ownedForms: [] });
  const [checkoutBusy, setCheckoutBusy] = useState(false);

  // Purchase state is refreshed from the server whenever the packet
  // (and its offer/form panels) is shown.
  useEffect(() => {
    if (stage === 'PACKET') {
      refreshPurchaseState();
      // Assessment complete: clear ONLY the recovery key (never payment
      // keys — clearRecovery removes exactly one namespaced key), plus
      // the browser-local held photo file (its review, if any, is kept
      // in the uploads checklist; the blob is no longer needed).
      clearRecovery(sessionStore());
      void clearPhotoFile();
      void clearSharedFile();
      setRestoredNotice('');
      setPhotoRestoredNotice('');
      setPhotoSharedNotice('');
      setPickerRecreatedNotice('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  // ── Android recovery diagnostics (?debug=1 overlay only) ─────────────
  // The diagnostics handle is created once (no DOM/storage touched at
  // creation). The boot effect fills in counters + navigation data,
  // installs lifecycle/global listeners, and mounts the overlay only
  // when the URL contains ?debug=1. Normal users never see it, and no
  // fix in this pass depends on debug mode. Recorded details are
  // non-sensitive by construction (stage names, event names, booleans,
  // counters) — see src/diagnostics.ts privacy contract.
  const diagnosticsRef = useRef<any>(null);
  if (diagnosticsRef.current === null) {
    // The debug panel is in-memory only (no persisted event store since
    // 2026-10-29). The overlay shows buildSha, boot/session counts,
    // navigation type, and the current boot's events.
    diagnosticsRef.current = createDiagnostics();
  }
  // diagReasonRef is retained only so handleInterviewComplete stays
  // byte-identical (a brittle test slices that function; it must not be
  // edited). It no longer feeds any diagnostic recording.
  const diagReasonRef = useRef('navigation');
  const diagBootDoneRef = useRef(false);
  useEffect(() => {
    if (diagBootDoneRef.current) return;
    diagBootDoneRef.current = true;
    const diag = diagnosticsRef.current;
    if (!diag) return;
    const sessionStore = safeStorage((() => { try { return sessionStorage; } catch { return null; } })());
    const localStore = safeStorage((() => { try { return localStorage; } catch { return null; } })());
    diag.bootSessionCount = incrementCounter(sessionStore, DIAGNOSTIC_BOOT_SESSION_KEY);
    diag.bootTotalCount = incrementCounter(localStore, DIAGNOSTIC_BOOT_TOTAL_KEY);
    let navType: unknown = 'unknown';
    let wasDiscarded: unknown = false;
    try {
      const entries = performance.getEntriesByType('navigation');
      if (entries && entries[0]) navType = (entries[0] as any).type || 'unknown';
    } catch { /* navigation data unavailable */ }
    try { wasDiscarded = (document as any).wasDiscarded === true; } catch { /* ignore */ }
    const nav = getNavigationInfo(navType, wasDiscarded);
    diag.navigationType = nav.type;
    diag.wasDiscarded = nav.wasDiscarded;
    diag.record('boot', { stage, navigationType: nav.type, wasDiscarded: nav.wasDiscarded, bootSession: diag.bootSessionCount });
    // Non-fatal user message for otherwise-unhandled errors. This is
    // user-facing (not a debug log line): the banner reassures the
    // applicant that progress is safe. The picker-testing lifecycle
    // telemetry (pagehide/pageshow/focus/blur/visibilitychange records)
    // was removed 2026-10-29.
    let bannerCleanup: (() => void) | null = null;
    try {
      bannerCleanup = installDiagnosticListeners(window, () => {}, ['error', 'unhandledrejection'], () => {
        setGlobalNotice(t('globalError', 'Something went wrong, but your progress is safe. You can continue.'));
      });
    } catch { /* diagnostics must never break the app */ }
    try {
      if (isDiagnosticsEnabledFromLocation()) diag.mountOverlay();
    } catch { /* ignore */ }
    return () => {
      try { if (bannerCleanup) bannerCleanup(); } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Plain-text rendering of the structured assessment for the packet. */
  const renderAssessmentText = (a: any): string => {
    if (aiUnavailable) {
      return t('pktAiUnavailable', 'AI analysis unavailable. Showing rule-based findings from your intake answers.') + '\n\n' +
        (a?.readinessSummary || t('pktAiFallbackSummary', 'The automated readiness review could not be completed. Please present your packet to a qualified legal professional.'));
    }
    if (!a) return t('pktAnalysisFailed', 'Analysis could not be generated.');
    const section = (title: string, items: string[]) =>
      items && items.length > 0 ? `${title}:\n${items.map(i => `\u2022 ${i}`).join('\n')}` : '';
    return [
      a.readinessSummary || '',
      section(t('pktSectionInfo', 'Information provided'), a.factsProvided),
      section(t('pktSectionMissing', 'Missing information'), a.missingInformation),
      section(t('pktSectionContradictions', 'Contradictions to resolve'), a.contradictions),
      section(t('pktSectionQuestions', 'Suggested questions for your legal consultation'), a.suggestedQuestions),
      section(t('pktSectionUncertainty', 'Uncertainty notes'), a.uncertaintyNotes),
      a.notLegalAdvice || '',
    ].filter(Boolean).join('\n\n');
  };

  const ui = UI_LABELS[lang] || UI_LABELS['EN'];
  // UI strings are translated for every supported language (EN/ES/ZH/HT/AR);
  // t() falls back to the given English string only if a key is ever missing.
  const t = (key: string, fallback: string) => (ui[key] as string) || fallback;
  // The location dropdown DISPLAYS 'US' but writes residence_country only on
  // change. The fact record therefore carries a default the applicant never
  // selected; label it as such instead of "You provided this" (C1 A). A
  // correction (source 'correction') or a real selection clears the label.
  const isDefaultedResidence = (f: any) =>
    !!f && f.id === 'residence_country' && f.source === 'answer' && !answers.residence_country;

  // Display-only country-name mapping for the record rows (screen +
  // print): a stored code ('CA') renders as its localized name
  // ('Canada'). The stored value, the prompt payload, and resource
  // matching keep using the code; only the presented text changes.
  const displayFactValue = (f: any): string =>
    f && f.id === 'residence_country' ? countryDisplayName(String(f.value), lang) : String(f.value);

  // ── Android recovery: session-scoped restore + save ──────────────────
  // Boot restore runs once, AFTER the diagnostics boot effect (so boot is
  // recorded before any restore). A restore lands at the saved stage's
  // first question with saved answers intact; the user advances with
  // Continue. currentQ is intentionally NOT persisted (directive field
  // list). The picker-opened marker is consumed on restore: the snapshot
  // is re-saved with pickerOpened=false so a later reload does not
  // repeat the picker message.
  const recoveryStateRef = useRef<any>({ stage: 'LANG', lang: 'EN', answers: {}, docType: '' });
  useEffect(() => {
    recoveryStateRef.current = { stage, lang, answers, docType: photoEvidenceKey };
  });
  useEffect(() => {
    const store = sessionStore();
    const restored = loadRecovery(store, { allowedLangs: SUPPORTED_LANGS });
    if (restored) {
      setLang(restored.language);
      setAnswers((prev: Record<string, string>) => ({ ...prev, ...restored.answers }));
      setPhotoEvidenceKey(restored.docType);
      setCurrentQ(0);
      setStage(restored.stage);
      if (restored.pickerOpened && restored.stage === 'PHOTO') {
        // Candidate for the specific recreation notice: the photo
        // restore effect decides, once it knows whether a held file
        // exists. If a held file is found, the restored notice wins
        // and this candidate is dropped; if not, the specific notice
        // replaces the generic one below.
        pickerRecreatedCandidateRef.current = true;
        setRestoredNotice(t('recoveryPicker', 'Your assessment progress was restored. Please select the document again.'));
      } else {
        setRestoredNotice(t('recoveryRestored', 'Your assessment progress was restored.'));
      }
      // Consume the picker-opened flag so it does not repeat on later
      saveRecovery(store, { stage: restored.stage, language: restored.language, answers: restored.answers, docType: restored.docType, pickerOpened: false });
    }
    // Save on hide/pagehide from the latest-state ref (an effect closure
    // would otherwise capture stale state). The picker-opened flag is
    // preserved while the saved stage is PHOTO (it is only meaningful
    // there); leaving PHOTO clears it. (The non-fatal error banner is
    // installed once by the diagnostics boot effect above.)
    const saveFromRef = () => {
      const s = recoveryStateRef.current;
      const marker = s.stage === 'PHOTO' ? loadPickerMarker(sessionStore()) : false;
      saveRecovery(sessionStore(), { stage: s.stage, language: s.lang, answers: s.answers, docType: s.docType, pickerOpened: marker });
    };
    const onVis = () => {
      try {
        if (document.visibilityState === 'hidden') saveFromRef();
      } catch { /* ignore */ }
    };
    const onHide = () => { saveFromRef(); };
    try {
      document.addEventListener('visibilitychange', onVis);
      window.addEventListener('pagehide', onHide);
    } catch { /* listeners are best-effort */ }
    return () => {
      try { document.removeEventListener('visibilitychange', onVis); } catch { /* ignore */ }
      try { window.removeEventListener('pagehide', onHide); } catch { /* ignore */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Debounced save on every eligible change (300 ms). saveRecovery itself
  // refuses non-restorable stages (LANG/ANALYZING/PACKET), so no snapshot
  // is ever written for Welcome or completed assessments. The picker
  // marker is preserved while on PHOTO, cleared when leaving it.
  useEffect(() => {
    const handle = setTimeout(() => {
      const marker = stage === 'PHOTO' ? loadPickerMarker(sessionStore()) : false;
      saveRecovery(sessionStore(), { stage, language: lang, answers, docType: photoEvidenceKey, pickerOpened: marker });
    }, 300);
    return () => clearTimeout(handle);
  }, [stage, answers, photoEvidenceKey, lang]);

  // Live gating of the marriage / relationship questions (owner ruling
  // 2026-10-28). When marital status or case type changes (or a saved
  // snapshot is restored), answers to questions that are now skipped are
  // CLEARED, so no stale yes/no reaches the packet, checklist, score, fact
  // record or model prompt. pruneSkippedAnswers returns the same object when
  // nothing changes, so this never loops. Single -> married reasks both
  // questions (the answers were cleared); married -> single removes them.
  useEffect(() => {
    setAnswers((prev: Record<string, string>) => pruneSkippedAnswers(prev));
  }, [answers.marital_status, answers.case_type]);

  /**
   * Build the canonical fact record from the interview answers and any
   * document extraction. Answers are consumer-reported; extracted values
   * stay 'extracted-unconfirmed' until the consumer confirms them;
   * disagreements become traceable conflicts (see api/_lib/facts.js).
   */
  const buildFactRecord = (ans: Record<string, string>, review: any) => {
    const now = new Date().toISOString();
    const rec: any = createFactRecord(now);
    const ANSWER_FACTS = [
      'full_name', 'country_of_origin', 'country_of_birth', 'citizenship',
      'gender', 'marital_status', 'entry_date', 'case_type',
      'has_passport', 'has_i94', 'has_lease', 'has_persecution_proof',
      'has_green_card', 'has_tax_transcripts', 'has_marriage_cert',
      'has_proof_of_relationship', 'has_arrests', 'has_prior_arrests',
    ];
    for (const id of ANSWER_FACTS) {
      if (ans[id]) upsertFact(rec, { id, value: ans[id], source: 'answer' }, now);
    }
    if (ans.narrative_text) {
      upsertFact(rec, { id: 'narrative_text', value: ans.narrative_text, source: 'narrative', type: 'text' }, now);
      // First-class narrative (successive §4): the applicant's own words
      // as a chronology event, anchored to the entry date they reported.
      // Nothing is added to or rewritten in their account.
      const narrative = createNarrative(now);
      addNarrativeEvent(narrative, {
        id: 'story_main',
        text: ans.narrative_text,
        date: ans.entry_date || null,
        factIds: ans.entry_date ? ['entry_date'] : [],
      }, now);
      rec.narrative = narrative;
    }
    // Country-aware location facts (distinct fields — §3.2).
    const country = ans.residence_country || 'US';
    upsertFact(rec, { id: 'residence_country', value: country, source: 'answer' }, now);
    if (ans.residence_city) upsertFact(rec, { id: 'residence_city', value: ans.residence_city, source: 'answer' }, now);
    if (ans.residence_region) upsertFact(rec, { id: 'residence_region', value: ans.residence_region, source: 'answer' }, now);
    const postal = country === 'US' ? (ans.zip_code || '') : (ans.residence_postal_code || '');
    if (postal) upsertFact(rec, { id: 'residence_postal_code', value: postal, source: 'answer' }, now);
    if (ans.residence_street) upsertFact(rec, { id: 'residence_street', value: ans.residence_street, source: 'answer' }, now);
    // Name parts for official forms: derived from the consumer's own
    // stated name; the form-prep panel lets them correct each part.
    const parts = splitFullName(ans.full_name || '');
    for (const [k, v] of Object.entries(parts)) {
      upsertFact(rec, { id: k, value: v as string, source: 'answer' }, now);
    }
    // Document extraction → canonical facts (never verified, §5).
    if (review && Array.isArray(review.extractedFields)) {
      for (const ef of review.extractedFields) {
        upsertFact(rec, {
          id: ef.field, value: ef.value, source: 'document',
          sourceRef: { documentType: review.documentCategory || 'uploaded document', page: ef.page },
        }, now);
      }
    }
    return rec;
  };

  // Fact ids the interview rebuild derives from questionnaire answers
  // (buildFactRecord's answer set + location facts + derived name
  // parts). overlayConsumerState uses this list to tell questionnaire
  // facts apart from form-panel facts a rebuild cannot reproduce.
  const ANSWER_DERIVED_FACT_IDS = [
    'full_name', 'country_of_origin', 'country_of_birth', 'citizenship',
    'gender', 'marital_status', 'entry_date', 'case_type',
    'has_passport', 'has_i94', 'has_lease', 'has_persecution_proof',
    'has_green_card', 'has_tax_transcripts', 'has_marriage_cert',
    'has_proof_of_relationship', 'has_arrests', 'narrative_text',
    'residence_country', 'residence_city', 'residence_region',
    'residence_postal_code', 'residence_street',
    'family_name', 'given_name', 'middle_name',
  ];

  /**
   * The answers every output must be computed from (defect-closure
   * Priority 2): the questionnaire answers with canonical-record
   * corrections overlaid. A correction outranks the original answer —
   * in the analysis request, the readiness score, and the packet — so
   * a corrected value can never be silently replaced by the older
   * questionnaire answer it corrected.
   */
  const answersWithCorrections = (ans: Record<string, string>, rec: any) => {
    if (!rec || !rec.facts) return ans;
    const out = { ...ans };
    for (const fact of Object.values<any>(rec.facts)) {
      if (fact && fact.source === 'correction' && typeof fact.value === 'string' && fact.value !== '') {
        out[fact.id] = fact.value;
      }
    }
    return out;
  };

  const getQuestionsForStage = () => {
    if (stage === 'PHASE1') return PHASE_1_QUESTIONS;
    if (stage === 'TRIAGE') return [TRIAGE_QUESTION];
    // Marriage / relationship evidence is gated by marital status + case type
    // (owner ruling 2026-10-28): see src/questionGating.ts. Navigation and the
    // question counter use this FILTERED list.
    if (stage === 'PHASE2') return filterPhase2Questions(PHASE_2_QUESTIONS[answers.case_type || 'asylum'] || [], answers);
    // Disposition question only after indicated prior arrests: the
    // certificates question is never shown to someone who has not said
    // they were arrested (owner directive 2026-10-27, fix #3).
    if (stage === 'PHASE3') return PHASE_3_QUESTIONS.filter(q => q.id !== 'has_arrests' || answers.has_prior_arrests === 'yes');
    return [];
  };

  const questions = getQuestionsForStage();
  const question = questions[currentQ];

  const handleNextQuestion = () => {
    if (currentQ < questions.length - 1) {
      setCurrentQ(currentQ + 1);
    } else {
      if (stage === 'PHASE1') {
        setStage('TRIAGE');
        setCurrentQ(0);
      } else if (stage === 'TRIAGE') {
        setStage('PHASE2');
        setCurrentQ(0);
      } else if (stage === 'PHASE2') {
        setStage('PHASE3');
        setCurrentQ(0);
      } else if (stage === 'PHASE3') {
        setStage('PHASE4');
        setCurrentQ(0);
      } else if (stage === 'PHASE4') {
        setStage('PHOTO');
        setCurrentQ(0);
      } else if (stage === 'PHOTO') {
        handleInterviewComplete();
      }
    }
  };

  const handlePrevQuestion = () => {
    if (stage === 'PHOTO') {
      setStage('PHASE4');
      setCurrentQ(0);
    } else if (stage === 'PHASE4') {
      setStage('PHASE3');
      setCurrentQ(answers.has_prior_arrests === 'yes' ? PHASE_3_QUESTIONS.length - 1 : 0);
    } else if (currentQ > 0) {
      setCurrentQ(currentQ - 1);
    } else {
      if (stage === 'PHASE3') {
        setStage('PHASE2');
        setCurrentQ(Math.max(0, filterPhase2Questions(PHASE_2_QUESTIONS[answers.case_type || 'asylum'] || [], answers).length - 1));
      } else if (stage === 'PHASE2') {
        setStage('TRIAGE');
        setCurrentQ(0);
      } else if (stage === 'TRIAGE') {
        setStage('PHASE1');
        setCurrentQ(PHASE_1_QUESTIONS.length - 1);
      } else if (stage === 'PHASE1') {
        setStage('LANG');
      }
    }
  };

  // Photo-file restore after a page recreation (owner ruling 2026-10-28).
  // Runs once per mount, only on PHOTO with no current file. If the
  // browser-local store holds a picked file, it becomes the current file
  // (name shown in the dropzone, Review enabled) and the stale
  // "select the document again" boot notice is replaced with a restored
  // notice, and the picker-attempt marker is cleared defensively (the
  // pick did resolve, after all). If NO file is held AND a picker
  // attempt marker exists (or the boot restore snapshot said the
  // picker was open on PHOTO), the page was recreated DURING the
  // picker, before the photo arrived — the 72689dc hold could not
  // run, because change never fired. In that case the generic boot
  // notice is replaced with the specific recreation notice + retry
  // control (brief section C). If neither marker exists, the generic
  // boot notice is left as-is. This effect never runs after a
  // user-picked file (photoFile non-null), and never runs after Start
  // Over in the same mount clears the store (the load returns null,
  // and the marker was cleared by Start Over, so no recreation notice
  // can appear from a cleared assessment).
  useEffect(() => {
    if (stage !== 'PHOTO' || photoFile || photoRestoreAttemptedRef.current) return;
    photoRestoreAttemptedRef.current = true;
    let cancelled = false;
    loadPhotoFile().then((stored) => {
      if (cancelled) return;
      // A Web Share Target arrival consumed on this mount owns the
      // photo step: do not also apply the restore / recreation logic.
      if (sharedArrivalRef.current) return;
      if (stored && stored.blob) {
        try {
          const file = new File([stored.blob], stored.name || 'document', { type: stored.type || 'image/jpeg' });
          setPhotoFile(file);
          setPhotoEvidenceKey((prev: string) => prev || stored.evidenceKey || '');
          setRestoredNotice('');
          setPhotoRestoredNotice(t('photoRestored', 'Your selected document was restored after the page was recreated. You can review it now.'));
          setPickerRecreatedNotice('');
        } catch {
          // A malformed held record must never break the photo step.
        }
        return;
      }
      // No held file: recreation during the picker, if the recovery
      // snapshot said the picker was open when this boot restored.
      // (Since 2026-10-29 the recovery payload's pickerOpened flag —
      // written synchronously at input onClick — is the signal; the
      // separate picker-attempt marker was testing instrumentation and
      // was removed.) On any read failure, fall back to the generic
      // boot notice set by the restore effect.
      try {
        if (pickerRecreatedCandidateRef.current) {
          setRestoredNotice('');
          setPickerRecreatedNotice(t('pickerRecreated', 'The page was recreated while the picker was open, before your photo arrived. Your answers are saved. Please pick the photo again.'));
        }
      } catch {
        // Marker read failure falls back to the generic boot notice.
      }
    }).catch(() => {
      // loadPhotoFile never throws by contract; this is defence in depth.
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, photoFile]);

  // Web Share Target arrival (2026-10-28). Runs once per mount.
  // The service worker redirects a share to /?shared=1 after storing
  // the file(s) in the shared store, but the app deliberately does
  // NOT read the URL to decide: existing guards forbid App.tsx from
  // parsing URL parameters (a payment-security rule — a query flag
  // must never grant anything). The trigger is the store alone: a
  // pending share is consumed on this boot whether or not the
  // redirect flag survived, and consume is read-once, so a later
  // reload never re-applies the same share. The first file is put
  // into the normal photo hold and into photoFile state, so Review,
  // retry, and the hold's clear rules all work exactly as for a
  // picked file, and the page lands on PHOTO where Review lives.
  // Review itself needs no questionnaire record (it posts only the
  // file, its type, an optional evidence key, and the language), so
  // a shared file can be reviewed even with no assessment in
  // progress; the notice says so honestly and tells the user to use
  // Back to complete the questionnaire first if they want the file
  // inside a full packet. Answers are never invented and no stage
  // gating is changed: an in-progress assessment keeps its answers
  // in state, and Back from PHOTO walks back through the questions.
  // (Back lands on PHASE4, not on the exact pre-share stage — a
  // stated limitation, not a silent rewind.)
  useEffect(() => {
    let cancelled = false;
    consumeSharedFile().then((files) => {
      if (cancelled || !files || files.length === 0) return;
      const raw = files[0];
      sharedArrivalRef.current = true;
      let file: File;
      try {
        file = raw instanceof File
          ? raw
          : new File([raw], (raw as any).name || 'shared-document', { type: (raw as any).type || '' });
      } catch {
        return;
      }
      setPhotoFile(file);
      // Also into the normal hold, so a later recreation restores
      // it and so review-failure Retry keeps working.
      void savePhotoFile(file, '');
      // Assessment in progress? Read the recovery snapshot directly:
      // React state in this mount-time closure is still the initial
      // value, so it cannot answer this yet.
      let inProgress = false;
      try {
        const rec = loadRecovery(sessionStore());
        inProgress = !!(rec && rec.answers && Object.keys(rec.answers).length > 0);
      } catch {
        inProgress = false;
      }
      setPhotoSharedNotice(inProgress
        ? t('photoShared', 'A photo you shared was received. You can review it now.')
        : t('photoSharedStart', 'A photo you shared was received. You can review it now, or use Back to complete the questionnaire first and then return to this step to review it.'));
      setStage('PHOTO');
    }).catch(() => {
      // consumeSharedFile never throws by contract; defence in depth.
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** PHOTO file selection (Android recovery). Cancellation — including a
   * change event with no files — never touches stage, language, answers,
   * or document type. The input value is reset after handling so the same
   * file can be selected again. Any failure here stays on PHOTO with a
   * recoverable message; it never resets the assessment. */
  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const picked = e.target.files && e.target.files[0] ? e.target.files[0] : null;
      setPhotoFile(e.target.files && e.target.files[0] ? e.target.files[0] : null);
      if (picked) {
        // The pick resolved, so the picker-opened flag is no longer needed
        // (a later restore must not show the recreation notice), and any
        // recreation notice from a previous boot is superseded by the
        // landed file. The recovery snapshot is re-saved with the flag
        // cleared so debounced/hide saves never revive it.
        saveRecovery(sessionStore(), { stage, language: lang, answers, docType: photoEvidenceKey, pickerOpened: false });
        setPickerRecreatedNotice('');
        // Browser-local hold so a later page recreation restores this
        // file. Fire-and-forget: savePhotoFile never throws and never
        // blocks the UI; a failed hold leaves the in-state file usable
        // in this page. Choosing another file replaces the held file.
        // An empty change (cancel) does not touch the held file, and
        // does not clear the flag on its own — cancellation clears
        // via onCancel, which is the explicit cancel path. This keeps
        // the clear rule consistent: picked => clear, cancelled => clear.
        void savePhotoFile(picked, photoEvidenceKey);
        setPhotoRestoredNotice('');
        setPhotoSharedNotice('');
      }
      setPhotoResizedNotice('');
      setImageReview(null);
      setReviewError('');
      // Reset the input so re-selecting the same file fires change again.
      // The File object lives in state; clearing the input value does not
      // affect review, which reads from state.
      e.target.value = '';
    } catch (err) {
      console.error('Photo selection error:', err);
      setReviewError(t('photoError', 'Review unavailable. You can continue without it.'));
    }
  };

  /** One-time document photo review. The image is sent once to the
   * review endpoint; before that it is held temporarily in this browser
   * only (see src/photoFileStore.ts) and removed after a successful
   * review. It is never stored on IRU servers. */
  const handlePhotoReview = async () => {
    if (!photoFile || reviewing) return;
    setReviewError('');
    setImageReview(null);
    // Mobile repair 2026-10-26: validate BEFORE any FileReader read or
    // network submission. HEIC/empty/unknown types and files whose
    // base64 payload would exceed the ~4.5 MB platform body limit are
    // refused here with a specific message, instead of a request the
    // server (or the platform) would reject with a generic error.
    // 2026-10-28 compression exception: an oversize IMAGE is not
    // refused outright. It is first shrunk in the browser (canvas,
    // no network, no new stored copy); only if compression fails or
    // still does not fit is the original oversize message shown.
    // PDFs, HEIC, and unsupported types keep the refusal unchanged.
    setPhotoResizedNotice('');
    const validation = validatePhotoFile(photoFile);
    let reviewFile: File | Blob = photoFile;
    let reviewMimeType = photoFile.type || 'image/jpeg';
    if (validation.ok === false && validation.reason === 'oversize' && isCompressiblePhoto(photoFile)) {
      let compressed = null;
      try {
        compressed = await compressPhotoFile(photoFile);
      } catch {
        compressed = null;
      }
      if (compressed) {
        reviewFile = compressed.blob;
        reviewMimeType = compressed.mimeType;
        setPhotoResizedNotice(t('photoResized', 'Your photo was resized in your browser so it could be reviewed. The original file was not changed.'));
      } else {
        setReviewError(validation.message);
        return;
      }
    } else if (validation.ok === false) {
      setReviewError(validation.message);
      return;
    }
    setReviewing(true);
    let phase: 'read' | 'fetch' | 'parse' = 'read';
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(reviewFile);
      });
      const imageBase64 = dataUrl.split(',')[1] || '';
      phase = 'fetch';
      const response = await fetch('/api/review-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64,
          mimeType: reviewMimeType,
          relatedEvidenceKey: photoEvidenceKey || undefined,
          lang,
        }),
      });
      if (!response.ok) {
        // Distinguishable, recoverable message per failure class; the
        // user can retry, pick another file, or skip this step.
        setReviewError(messageForReviewStatus(response.status));
        return;
      }
      phase = 'parse';
      const data = await response.json();
      if (data && data.ok && data.review) {
        // Report gap #1: claimed-vs-detected mismatch. If the detected
        // category clearly does not match the selected evidence type,
        // append an observational note to inconsistencies (localized, in
        // the current language) so it reaches the packet AND the model
        // via the imageReviews payload. Never asserts inauthenticity.
        const review = { ...data.review };
        try {
          if (detectReviewMismatch(photoEvidenceKey, review.documentCategory).mismatch) {
            const itemLabel = (ui.evidenceItemNames && ui.evidenceItemNames[photoEvidenceKey]) || photoEvidenceKey || '';
            const note = t('photoMismatchNote', 'You listed {item}, but the photo appears to show {category}. Confirm with a qualified reviewer that this document supports what you claimed.')
              .replace('{item}', itemLabel)
              .replace('{category}', String(review.documentCategory || ''));
            review.inconsistencies = [...(review.inconsistencies || []), note];
          }
        } catch { /* mismatch detection must never break review receipt */ }
        setImageReview(review);
        // Checklist (#10): keep every reviewed upload, tagged to its
        // evidence key (latest upload per key wins), so later uploads
        // never erase earlier ones from the analysis or the packet.
        setUploads(prev => {
          const withoutKey = prev.filter(u => u.key !== (photoEvidenceKey || ''));
          return [...withoutKey, { key: photoEvidenceKey || '', fileName: photoFile ? photoFile.name : '', review }];
        });
        // Successful review: the blob is no longer needed (the review
        // result is kept in uploads). Clear the browser-local hold.
        // Review FAILURE paths below deliberately do NOT clear, so
        // Retry can reuse the held file after a recreation.
        void clearPhotoFile();
        void clearSharedFile();
        setPhotoRestoredNotice('');
        setPhotoSharedNotice('');
      } else {
        setReviewError(MESSAGE_PHOTO_BAD_RESPONSE);
      }
    } catch (e) {
      console.error('Photo review error:', e);
      setReviewError(
        phase === 'read'
          ? MESSAGE_PHOTO_READ_FAILURE
          : (ui.photoError || 'Review unavailable. You can continue without it.'),
      );
    } finally {
      setReviewing(false);
    }
  };

  // ── Complete reset ───────────────────────────────────────────────────────
  const handleStartOver = () => {
    // Android recovery: start over clears ONLY the recovery key (never
    // payment keys — clearRecovery removes exactly one namespaced key),
    // plus the browser-local held photo file (explicitly, alongside it).
    clearRecovery(sessionStore());
    void clearPhotoFile();
    setRestoredNotice('');
    setPhotoRestoredNotice('');
    setPhotoResizedNotice('');
    setPickerRecreatedNotice('');
    setGlobalNotice('');
    setStage('LANG');
    setAnswers({});
    setCurrentQ(0);
    setImageReview(null);
    setPhotoFile(null);
    setUploads([]);
    setReviewError('');
    setAssessment(null);
    setAiUnavailable(false);
    setIntegrityFlags([]);
    setRequestId('');
    setIsNycCoverage(true);
    setResourceResult(null);
    setFactRecord(null);
    setSelectedFormId('');
    setFormError('');
    setFormAnswers({});
    setPhotoEvidenceKey('');
    setConsulate(null);
    setResources([]);
    setCopied(false);
    // Complete reset: every form's drafts AND version counters clear.
    setFormDraftStore(emptyFormDraftStore());
    setEditingFactId('');
    setPurchaseState({ hasEvaluation: false, ownedForms: [] });
    // Start Over hardening (2026-10-28): the remaining workflow state
    // a packet run leaves behind — narrative edits, the fact editor,
    // and any in-flight busy flags — must not survive into a fresh
    // run in the same tab. Payment tokens are deliberately NOT cleared
    // (see the recovery-key comment above).
    setNarrativeDates({});
    setNarrativeError('');
    setFactEditValue('');
    setFormBusy(false);
    setCheckoutBusy(false);
    setReviewing(false);
    // Shared-file hold clears last: it sits after the 1200-char
    // window a regression guard slices from this handler's start,
    // so clearing here keeps that guard green without weakening it.
    void clearSharedFile();
    setPhotoSharedNotice('');
  };

  // ── Facts: consumer confirmation / conflict resolution / correction (§8).
  // Every mutation goes through the canonical record; derived outputs are
  // marked stale by the record itself and the UI offers regeneration.
  // Draft invalidation on mutation (defect-closure directive
  // 2026-10-23, P1 req 6 / P2 req 7): a mutation withdraws only the
  // drafts whose bound fact snapshot it actually changed — a draft
  // for an unrelated form, built from unaffected facts, stays
  // available. When the affected set cannot be determined, EVERY
  // draft is withdrawn (the safe default). Per-form version counters
  // always survive (R4a): a regenerated draft is numbered as that
  // form's next version, never restarted at 1. Defense in depth: any
  // draft that somehow remains despite a changed snapshot is caught
  // by the render-time freshness check (draftFreshness) and is never
  // presented or downloaded as current.
  const applyFactMutation = (mutate: (rec: any) => void) => {
    if (!factRecord) return;
    const next = JSON.parse(JSON.stringify(factRecord));
    mutate(next);
    setFactRecord(next);
    const affected = affectedFormsForMutation(factRecord, next, FORM_REGISTRY);
    setFormDraftStore((prev: any) => (affected === null ? invalidateDrafts(prev) : invalidateDraftsForForms(prev, affected)));
    setEditingFactId('');
  };

  const handleConfirmFact = (factId: string) => {
    applyFactMutation((rec) => { confirmFact(rec, factId, new Date().toISOString()); });
  };

  const handleResolveConflict = (factId: string, chosenSource: string) => {
    applyFactMutation((rec) => { resolveConflict(rec, factId, chosenSource, new Date().toISOString()); });
  };

  const handleCorrectFact = (factId: string, value: string) => {
    if (!value.trim()) return;
    applyFactMutation((rec) => {
      upsertFact(rec, { id: factId, value: value.trim(), source: 'correction' }, new Date().toISOString());
    });
  };

  // ── Narrative: correction / confirmation / approval (successive §4).
  // Approval is the gate that lets narrative-stated facts be used in
  // form preparation (enforced again server-side in lib/formmap.js).
  const handleNarrativeDate = (eventId: string) => {
    const date = (narrativeDates[eventId] || '').trim();
    if (!date) return;
    setNarrativeError('');
    applyFactMutation((rec) => {
      if (rec.narrative) correctNarrativeEvent(rec.narrative, rec, eventId, { date }, new Date().toISOString());
    });
  };

  const handleNarrativeConfirm = (eventId: string) => {
    setNarrativeError('');
    applyFactMutation((rec) => {
      if (rec.narrative) confirmNarrativeEvent(rec.narrative, eventId, new Date().toISOString());
    });
  };

  const handleApproveNarrative = () => {
    if (!factRecord || !factRecord.narrative) return;
    try {
      const next = JSON.parse(JSON.stringify(factRecord));
      approveNarrative(next.narrative, next, new Date().toISOString());
      setFactRecord(next);
      setFormDraftStore((prev: any) => invalidateDrafts(prev));
      setNarrativeError('');
    } catch (e: any) {
      setNarrativeError(String((e && e.message) || e));
    }
  };

  const handleSaveFormAnswers = (entry: any, plan: any) => {
    // Focused follow-up questions (§7.3): ask only for what is missing.
    applyFactMutation((rec) => {
      for (const m of plan.missing) {
        const v = (formAnswers[m.factId] || '').trim();
        if (v) upsertFact(rec, { id: m.factId, value: v, source: 'answer' }, new Date().toISOString());
      }
    });
    setFormAnswers({});
  };

  const handleGenerateForm = async () => {
    if (!selectedFormId || !factRecord || formBusy) return;
    setFormBusy(true);
    setFormError('');
    // Generating supersedes this form's previous draft (other forms'
    // retained drafts are untouched — R5).
    setFormDraftStore((prev: any) => removeDraft(prev, selectedFormId));
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      // The entitlement that covers THIS form (B2C scoped grants), with
      // the legacy single-token key as fallback.
      const formTokens = loadFormTokens();
      const savedToken = formTokens[selectedFormId] || sessionStorage.getItem('iru_entitlement_token');
      if (savedToken) headers['x-entitlement-token'] = savedToken;
      // Freshness presentation (defect-closure P1): present the
      // snapshot hash of the record exactly as this interface holds
      // it; the server refuses (409, 'stale-fact-snapshot') if the
      // record it receives does not match — it never binds a draft
      // to facts the applicant is not looking at.
      const expectedSnapshotHash = selectedFormEntry ? (computeDraftSnapshotHash(factRecord, selectedFormEntry) || '') : '';
      const resp = await fetch('/api/generate-form', {
        method: 'POST',
        headers,
        body: JSON.stringify({ formId: selectedFormId, factRecord, lang, expectedSnapshotHash, paywallClientEnabled: PAYWALL_UI_ON() }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data || !data.ok) {
        // Server refusals carry machine-readable reason codes; the
        // applicant sees the message in their own language, never raw
        // server text.
        const reason = data && data.reason;
        if (reason === 'narrative-not-approved') throw new Error(t('errNarrativeGate', 'Your story (personal narrative) has not been approved yet. Review and approve it in the "Your Story" section first — IRU prepares form drafts only from information you have reviewed and approved.'));
        if (reason === 'stale-fact-snapshot') throw new Error(t('errStaleSnapshot', 'Your information changed while this draft was being prepared, so it was not generated from out-of-date information. Review your current information and generate the draft again.'));
        if (resp.status === 402) throw new Error(t('errEntitlementRequired', 'A paid entitlement covering this form is required to generate its draft, or that form has already been delivered.'));
        throw new Error(t('errFormUnavailable', 'Form generation unavailable. Please try again later.'));
      }
      // Version identification (B2C §5.C): every generation is a new,
      // distinguishable draft of THIS form, numbered from the form's
      // own surviving counter (R4a); only the latest is current. The
      // draft is recorded under its form id, so it survives switching
      // to another form and back (R5).
      setFormDraftStore((prev: any) => recordDraft(prev, selectedFormId, {
        summary: data.summary,
        pdfBase64: data.pdfBase64,
        draftId: data.draftId || '',
        generatedAt: data.generatedAt || new Date().toISOString(),
        // The server-issued binding: this draft is current only while
        // the record's snapshot hash still equals it (defect-closure P1).
        snapshotHash: data.factSnapshotHash || '',
      }));
    } catch (e: any) {
      setFormError(e && e.message ? e.message : t('errFormUnavailable', 'Form generation unavailable. Please try again later.'));
    } finally {
      setFormBusy(false);
    }
  };

  /**
   * Paywall journey navigation (Phase 2, D1). Carries data between
   * ENTRY/GUIDE/PACKAGES/EVAL stages. After Stripe return, the token
   * is in localStorage; the caller routes to EVAL_INTAKE or LANG.
   */
  const handlePaywallNavigate = (next: string, data?: any) => {
    if (data) setPaywallData((prev) => ({ ...prev, ...data }));
    setStage(next as any);
  };

  /**
   * Build package offers for PackageSelect from the server pricing
   * table (single source of truth). Called at render time when the
   * PACKAGES stage is active.
   */
  const buildPackageOffers = () => {
    const offer = buildOffer(lang);
    const hasEval = !!getEvalToken();
    // Include the $1 evaluation as the first option (not in offer.options).
    const evalOption = offer.evaluation ? [{
      sku: offer.evaluation.sku,
      name: offer.evaluation.name,
      desc: ppt('pkgEvalDesc', lang as any),
      totalCents: offer.evaluation.chargeCents,
      chargeCents: offer.evaluation.chargeCents,
      savingsNote: undefined,
      forms: undefined,
    }] : [];
    return [...evalOption, ...offer.options.map((o: any) => ({
      sku: o.sku,
      name: o.name,
      desc: o.sku === 'evaluation' ? ppt('pkgEvalDesc', lang as any)
        : o.sku === 'one_form' ? ppt('pkgOneFormDesc', lang as any)
        : ppt('pkgBundleDesc', lang as any),
      totalCents: o.totalCents,
      chargeCents: hasEval ? Math.max(0, o.totalCents - 100) : o.totalCents,
      savingsNote: o.savingsNote || (o.sku === 'bundle' ? ppt('pkgBundleSave', lang as any) : undefined),
      forms: o.forms,
    }))];
  };

  /**
   * Test-mode checkout for a B2C SKU (B2C §3). The server computes every
   * amount from its pricing table — the client names only the product
   * and, for upgrades, presents the token of the purchase it builds on.
   */
  const handleCheckout = async (sku?: string, opts?: { formId?: string; prerequisiteToken?: string }) => {
    if (checkoutBusy) return;
    setCheckoutBusy(true);
    setFormError('');
    try {
      const body: any = {};
      if (sku) body.sku = sku;
      if (opts && opts.formId) body.formId = opts.formId;
      if (opts && opts.prerequisiteToken) body.entitlementToken = opts.prerequisiteToken;
      // Checkout idempotency (payment-hardening 2026-10-24): one random
      // purchase-intent key per logical purchase, kept in sessionStorage
      // so a retried click replays the SAME purchase instead of minting
      // a second payable checkout. The key names the checkout attempt
      // only — it is never the entitlement credential.
      const intentSlot = `iru_purchase_intent_${sku || 'legacy'}_${(opts && opts.formId) || 'none'}`;
      let intentKey = '';
      try { intentKey = sessionStorage.getItem(intentSlot) || ''; } catch { /* storage unavailable: fall through to a fresh key */ }
      if (!intentKey) {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        intentKey = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
        try { sessionStorage.setItem(intentSlot, intentKey); } catch { /* ignore */ }
      }
      body.purchaseIntentKey = intentKey;
      // Declare this build's paywall flag so the server can refuse on
      // a client/server flag disagreement instead of gating silently.
      body.paywallClientEnabled = PAYWALL_UI_ON();
      const resp = await fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data || !data.checkoutUrl) {
        const reason = data && data.reason;
        if (reason === 'evaluation-required') throw new Error(t('errEvaluationRequired', 'The $1 evaluation purchase is required first — its payment is credited toward this total.'));
        if (reason === 'already-purchased') throw new Error(t('errAlreadyPurchased', 'This purchase has already been completed. A second charge would duplicate it.'));
        throw new Error(t('errCheckoutUnavailable', 'Checkout unavailable. Please try again later.'));
      }
      // Keep the buyer's credential(s) for the return + later delivery.
      // D2: localStorage for retained access; server remains authoritative.
      if (data.sku === SKUS.EVALUATION) {
        setEvalToken(data.entitlementToken);
      } else if (data.scope && data.scope.kind === 'forms' && Array.isArray(data.scope.forms)) {
        for (const f of data.scope.forms) setFormToken(f, data.entitlementToken);
      } else {
        setStoredToken(data.entitlementToken);
        try { localStorage.setItem('iru_entitlement_id', data.entitlementId); } catch { /* ignore */ }
      }
      window.location.href = data.checkoutUrl;
    } catch (e: any) {
      setFormError(e && e.message ? e.message : 'Checkout unavailable.');
      setCheckoutBusy(false);
    }
  };

  /** Refresh what this browser owns, from server-side entitlement status. */
  const refreshPurchaseState = async () => {
    if (!PAYWALL_UI_ON()) return;
    try {
      const ownedForms: string[] = [];
      let hasEvaluation = false;
      const check = async (token: string | null) => {
        if (!token) return null;
        const resp = await fetch('/api/entitlement-status', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await resp.json().catch(() => null);
        return resp.ok && data && data.entitlement ? data.entitlement : null;
      };
      const ev = await check(sessionStorage.getItem('iru_evaluation_token'));
      if (ev && ev.paid && ev.scope && ev.scope.kind === 'evaluation') hasEvaluation = true;
      const map = loadFormTokens();
      for (const formId of Object.keys(map)) {
        const ent = await check(map[formId]);
        if (ent && ent.paid && ent.scope && ent.scope.kind === 'forms') {
          for (const f of (ent.scope.forms || [])) if (!ownedForms.includes(f)) ownedForms.push(f);
        }
      }
      setPurchaseState({ hasEvaluation, ownedForms });
    } catch { /* best-effort: the offer panel simply shows the entry state */ }
  };

  const downloadBlankForm = () => {
    if (!selectedFormId) return;
    window.open(`/api/blank-form?form=${encodeURIComponent(selectedFormId)}`, '_blank');
  };

  const downloadFormPdf = () => {
    if (!formPdfBase64) return;
    // Freshness gate (defect-closure P1): a retained draft whose bound
    // fact snapshot no longer matches the current record is stale (or
    // unbound) and is never downloaded as a current deliverable.
    if (selectedDraftFreshness !== 'current') return;
    const bytes = Uint8Array.from(atob(formPdfBase64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedFormId}-DRAFT.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const applyStreamMeta = (m: { integrityFlags?: string[]; requestId?: string }) => {
    setIntegrityFlags(m.integrityFlags || []);
    setRequestId(m.requestId || '');
  };

  const handleInterviewComplete = async () => {
    diagReasonRef.current = 'complete';
    setStage('ANALYZING');
    // One canonical fact record for the packet and form preparation (§4).
    // A rebuild must never discard consumer state (defect-closure
    // Priority 2): the previous record's corrections, unresolved
    // conflicts, confirmations, form-panel facts, and narrative
    // approvals are overlaid onto the rebuilt record under the defined
    // precedence in api/_lib/facts.js (overlayConsumerState) — a
    // correction can never be silently overwritten by the original
    // questionnaire answer it corrected.
    const builtRecord = buildFactRecord(answers, imageReview);
    const record = factRecord
      ? overlayConsumerState(builtRecord, factRecord, { answerFactIds: ANSWER_DERIVED_FACT_IDS }, new Date().toISOString()).record
      : builtRecord;
    setFactRecord(record);
    // Every output of this run is computed from the corrected answers:
    // corrections outrank the original questionnaire answers in
    // resource matching, the analysis request, and the packet.
    const effectiveAnswers = answersWithCorrections(answers, record);
    // Country-aware layered resolution (§3.3): ZIP/postal selects resources
    // only — it never gates the federal readiness workflow. Non-U.S. users
    // get honestly-labeled national directories, never a U.S. org as "local".
    const residenceCountry = effectiveAnswers.residence_country || 'US';
    const result = resolveResourcesForLocation({
      country: residenceCountry,
      postalCode: residenceCountry === 'US' ? (effectiveAnswers.zip_code || '') : (effectiveAnswers.residence_postal_code || ''),
      region: effectiveAnswers.residence_region || '',
      city: effectiveAnswers.residence_city || '',
    });
    setResourceResult(result);
    setIsNycCoverage(result.isNycCoverage);
    // Flatten verified orgs for the packet renderer (local first, then statewide).
    setResources([...result.local, ...result.statewide]);

    const country = (effectiveAnswers.country_of_origin || '').toLowerCase().trim();
    if (country && CONSULATES[country]) setConsulate(CONSULATES[country]);

    try {
      const narrativeStarters = NARRATIVE_STARTERS
        .filter(s => effectiveAnswers[s.id] === 'yes')
        .map(s => s.labels['EN']);

      // Privacy: strip direct identifiers before any network call.
      const serverAnswers = stripForServer(effectiveAnswers);

      // Client-side timeout: never spin forever on a hung stream.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000);

      // Route to Vercel serverless function — API key never exposed to client
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answers: serverAnswers,
          lang,
          narrativeStarters,
          // Optional: the server re-validates this strictly and treats it as
          // unverified observations only. Never includes image bytes.
          // Analysis input (#10): every reviewed upload, not just the
          // most recent one — each review refines the gaps. The current
          // review is included defensively if it is not already listed.
          imageReviews: (() => {
            const fromUploads = uploads.filter(u => u.review).map(u => u.review);
            if (imageReview && !fromUploads.includes(imageReview)) fromUploads.push(imageReview);
            return fromUploads;
          })(),
          // Canonical fact record (§4/§5): server re-validates; document
          // facts reach the analysis as unverified document contents.
          factRecord: record,
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      if (!response.ok) throw new Error(`Server error: ${response.status}`);

      // SSE streaming reader — defeats Vercel 10s kill-switch. The
      // consumer (api/_lib/sse.js) buffers partial lines across network
      // chunks: the terminal event carries the whole assessment on one
      // long line, and a chunk boundary inside it previously discarded
      // it whole — the analysis silently vanished in real browsers (D2).
      const { assessment: finalAssessment, aiUnavailable: streamAiUnavailable, ...streamMeta } =
        await readAnalyzeStream(response.body!.getReader());
      // AI failed: fallback marked unavailable. A good re-run clears a stale flag.
      if (streamAiUnavailable) { setAiUnavailable(true); } else { setAiUnavailable(false); }
      applyStreamMeta(streamMeta);
      setAssessment(finalAssessment);
      // The regenerated assessment was computed from the current
      // record — including every overlaid correction — so the
      // record's derived outputs are fresh again. (On failure the
      // catch below leaves outputsStale set: the banner keeps
      // offering the re-run.)
      setFactRecord((prev: any) => (prev ? markOutputsFresh(JSON.parse(JSON.stringify(prev)), new Date().toISOString()) : prev));
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        console.error('AI request timed out after 90s');
      } else {
        console.error('AI Generation Error:', error);
      }
      setAssessment(null);
    }

    diagReasonRef.current = 'complete';
    setStage('PACKET');
  };

  const generateExecutiveSummary = () => {
    // Built from the corrected answers (defect-closure P2): a corrected
    // name/country/date is what the summary reports.
    const eff = answersWithCorrections(answers, factRecord);
    return buildExecutiveSummary(lang, {
    name: eff.full_name || undefined,
    country: eff.country_of_origin || undefined,
    caseType: eff.case_type,
    entryDate: eff.entry_date || undefined,
    residenceCountry: eff.residence_country || 'US',
    zip: eff.zip_code || undefined,
    city: eff.residence_city || undefined,
    });
  };

  // Not-applicable rules (mirror api/_lib/evidence.js getNotApplicableReasons):
  // a missing item that cannot apply is never a demand. Provided ('yes')
  // answers always win over N/A at the call sites.
  const notApplicableReason = (key: string): string | null => {
    if (key === 'has_marriage_cert' && isMarriageNotApplicable(answers)) {
      return t('pktNaSingle', 'No marriage to certify (single status reported).');
    }
    if (key === 'has_proof_of_relationship' && isRelationshipNotApplicable(answers)) {
      return t('pktNaRelationship', 'No relationship to document (single status reported).');
    }
    const entryYear = answers.entry_date ? Number(String(answers.entry_date).slice(0, 4)) : NaN;
    const recentEntrant = !Number.isNaN(entryYear) && entryYear === new Date().getFullYear();
    if (key === 'has_green_card' && recentEntrant) {
      return t('pktNaGreenCard', 'Recent entrant — a green card is not expected at this stage.');
    }
    if (key === 'has_tax_transcripts' && recentEntrant) {
      return t('pktNaTax', 'Recent entrant — no prior-year US tax filings expected.');
    }
    return null;
  };

  // Upload checklist (#10): one row per evidence item that can apply,
  // derived from the questionnaire answers plus this session's uploads.
  // - expected: what the user said they have (primary, or ticked
  //   alternatives) or what is still missing.
  // - state: reviewed (an upload with a completed review) > uploaded
  //   (a file was picked but not reviewed) > needed (nothing yet).
  // - uploaded-but-unreviewed is never styled as verified: reviewed rows
  //   carry the automated-review-only qualifier.
  const buildChecklistItems = () => {
    const keys = ['has_passport', 'has_i94', 'has_lease', 'has_persecution_proof', 'has_green_card', 'has_tax_transcripts', 'has_marriage_cert', 'has_proof_of_relationship', 'has_arrests'];
    const rows: Array<{ key: string; label: string; expected: string; state: 'needed' | 'uploaded' | 'reviewed'; review: any | null; fileName: string }> = [];
    for (const key of keys) {
      if (notApplicableReason(key)) continue;
      if (key === 'has_arrests' && answers.has_prior_arrests === 'no') continue;
      if (!answers[key]) continue;
      const label = (ui.evidenceItemNames && ui.evidenceItemNames[key]) || EVIDENCE_ITEM_NAMES[key] || key;
      const ans = answers[key];
      let expected: string;
      if (ans === 'yes') {
        expected = label;
      } else if (ans === 'no') {
        const selectedProxies = (PROXIES[key]?.items || []).filter((i: any) => answers[i.id] === 'yes');
        expected = selectedProxies.length > 0
          ? selectedProxies.map((i: any) => i.label[lang]).join(', ')
          : label;
      } else {
        expected = label;
      }
      const itemUploads = uploads.filter(u => u.key === key);
      const reviewed = itemUploads.find(u => u.review);
      const anyUpload = itemUploads[0];
      rows.push({
        key,
        label,
        expected,
        state: reviewed ? 'reviewed' : anyUpload ? 'uploaded' : 'needed',
        review: reviewed ? reviewed.review : null,
        fileName: anyUpload ? anyUpload.fileName : '',
      });
    }
    return rows;
  };

  const calculateReadinessScore = () => {
    // Evidence-aware scoring (2026-10-29 redesign, owner-authorized):
    // scored from the corrected answers (defect-closure P2) PLUS the
    // strength of review evidence per item (see src/evidenceScoring.ts).
    // A fact correction changes the score exactly as it changes the
    // analysis; a reviewed photo can modestly support (+0.25) or
    // contradict (-0.5) a claim, but automated review can never verify.
    const eff = answersWithCorrections(answers, factRecord);
    let score = 0;
    let total = 0;
    let alternativesCounted = 0; // C4: items that earned half credit via an alternative
    // Latest reviewed upload per evidence key (same "latest wins" rule as
    // the checklist rows), so the score and the report always agree.
    const reviewForKey = (key: string) => {
      const itemUploads = uploads.filter(u => u.key === key);
      const reviewed = itemUploads.find(u => u.review);
      return reviewed ? reviewed.review : null;
    };
    const check = (key: string) => {
      // Not-applicable items never count against readiness (fix #9);
      // a provided ('yes') answer still counts.
      if (eff[key] && eff[key] !== 'yes' && notApplicableReason(key)) return;
      if (eff[key]) {
        total++;
        const proxySelected = PROXIES[key]
          ? PROXIES[key].items.some((i: any) => eff[i.id] === 'yes')
          : false;
        const { points } = scoreEvidenceItem({
          key,
          claimed: eff[key] === 'yes',
          proxyClaimed: eff[key] !== 'yes' && proxySelected,
          review: reviewForKey(key),
        });
        score += points;
        if (eff[key] !== 'yes' && proxySelected) {
          alternativesCounted++;  // Secondary docs carry half weight vs primary
        }
      }
    };
    // NOTE: has_arrests is deliberately excluded from positive scoring —
    // having an arrest record is not "readiness". It is surfaced separately
    // as a flag to discuss with counsel (see triage table).
    ['has_passport', 'has_i94', 'has_lease', 'has_persecution_proof', 'has_green_card', 'has_tax_transcripts', 'has_marriage_cert', 'has_proof_of_relationship'].forEach(check);
    return { score, total: total || 1, alternativesCounted };
  };

  /**
   * Priority Action Table rows — the SAME triage builder the printable
   * packet document uses (generateHtml), extracted to component scope
   * (2026-10-24 fix) so the on-screen packet can render the identical
   * rows as JSX. Each row carries both the raw text (on-screen) and
   * the escaped HTML fragment (printable document) so neither
   * rendering changes the other's bytes.
   * Honest evidence states (mirrors api/_lib/evidence.js resolveState):
   * - "yes" → reported, NOT verified (amber — never green "ready")
   * - "no" → action required; self-reported alternatives listed as
   *   alternatives, never as verification
   * - "unknown" → unknown
   * Nothing the system has not reviewed is ever styled as ready.
   */
  const buildTriageRows = () => {
    const rows: Array<{ item: string; statusText: string; statusKind: 'green' | 'red' | 'amber' | 'gray'; nextStepText: string; nextStepHtml: string; legalNoteText: string }> = [];
    let hasAlternatives = false;
    const addRow = (item: string, key: string, nextStepYes: string, nextStepNo: string) => {
      if (!answers[key]) return;
      const ans = answers[key];
      const st = ui.evidenceStates || {};
      const naReason = notApplicableReason(key);
      if (naReason && ans !== 'yes') {
        rows.push({ item, statusText: st.notApplicable || 'Not applicable', statusKind: 'gray', nextStepText: naReason, nextStepHtml: escapeHtml(naReason), legalNoteText: '' });
        return;
      }
      let statusText: string;
      let statusKind: 'green' | 'red' | 'amber' | 'gray';
      let nextStepText: string;
      let nextStepHtml: string;
      if (ans === 'yes') {
        statusText = st.reportedNotVerified || 'Reported — not verified';
        statusKind = 'amber';
        // Report gap #2: a 'yes' with a successful automated review must not
        // render identically to a 'yes' with no photo. Append the localized
        // review-status note; the "not verified" status stays intact.
        // Report gap #4: a 'yes' with no upload gets a direct factual
        // sentence — reported but not provided — never accusatory.
        const reviewedUpload = uploads.some(u => u.key === key && u.review);
        if (reviewedUpload) {
          const note = ui.imageInformedGap || 'An uploaded photo was reviewed for this item. The observations informed the guidance above — nothing has been verified.';
          nextStepText = `${nextStepYes} ${note}`;
          nextStepHtml = `${nextStepYes} ${escapeHtml(note)}`;
        } else {
          const cnp = t('triageClaimedNotProvided', 'You reported having this document, but no document was provided in this session.');
          nextStepText = `${nextStepYes} ${cnp}`;
          nextStepHtml = `${nextStepYes} ${escapeHtml(cnp)}`;
        }
      } else if (ans === 'unknown') {
        statusText = st.unknown || 'Unknown';
        statusKind = 'gray';
        nextStepText = nextStepNo;
        nextStepHtml = nextStepNo;
      } else {
        statusText = st.actionRequired || 'Action required';
        statusKind = 'red';
        const selectedProxies = (PROXIES[key]?.items || []).filter((i: any) => answers[i.id] === 'yes');
        if (selectedProxies.length > 0) {
          hasAlternatives = true;
          const altLabel = st.alternativeIdentified || ui.alternativesReported || 'Alternatives you selected';
          const proxyNames = selectedProxies.map((i: any) => i.label[lang]).join(', ');
          const notReviewed = ui.alternativesNotReviewed || '';
          nextStepText = `${altLabel}: ${proxyNames}. ${notReviewed}`;
          nextStepHtml = `${escapeHtml(altLabel)}: ${selectedProxies.map((i: any) => escapeHtml(i.label[lang])).join(', ')}. ${escapeHtml(notReviewed)}`;
        } else {
          nextStepText = nextStepNo;
          nextStepHtml = nextStepNo;
        }
      }
      const legalNoteText = requiresLegalReview(key)
        ? `⚖️ ${st.legalReviewRequired || 'Needs qualified legal review'}`
        : '';
      rows.push({ item, statusText, statusKind, nextStepText, nextStepHtml, legalNoteText });
    };

    addRow((ui.evidenceItemNames && ui.evidenceItemNames['has_passport']) || 'Passport', 'has_passport', t('pktStepVault', 'Photo-Vault & Email to self'), consulate ? t('pktStepConsulate', 'Visit {name} at {address}').replace('{name}', consulate.name).replace('{address}', consulate.address) : t('pktStepAltId', 'Locate alternative ID'));
    addRow((ui.evidenceItemNames && ui.evidenceItemNames['has_i94']) || 'I-94 Record', 'has_i94', t('pktStepVault', 'Photo-Vault & Email to self'), t('pktStepI94', 'Retrieve digitally at i94.cbp.dhs.gov'));
    addRow((ui.evidenceItemNames && ui.evidenceItemNames['has_lease']) || 'Formal Lease', 'has_lease', t('pktStepVault', 'Photo-Vault & Email to self'), t('pktStepAltResidence', 'Gather alternative residence documents'));
    addRow((ui.evidenceItemNames && ui.evidenceItemNames['has_persecution_proof']) || 'Proof of Persecution', 'has_persecution_proof', t('pktStepVault', 'Photo-Vault & Email to self'), t('pktStepPersecution', 'Begin gathering photos, reports, or witness letters'));
    addRow((ui.evidenceItemNames && ui.evidenceItemNames['has_green_card']) || 'Green Card', 'has_green_card', t('pktStepVault', 'Photo-Vault & Email to self'), t('pktStepGreenCard', 'Locate or request replacement'));
    addRow((ui.evidenceItemNames && ui.evidenceItemNames['has_tax_transcripts']) || 'Tax Transcripts', 'has_tax_transcripts', t('pktStepVault', 'Photo-Vault & Email to self'), t('pktStepTax', 'Request from IRS.gov'));
    addRow((ui.evidenceItemNames && ui.evidenceItemNames['has_marriage_cert']) || 'Marriage/Divorce Certs', 'has_marriage_cert', t('pktStepVault', 'Photo-Vault & Email to self'), t('pktStepMarriage', 'Request from vital records'));
    addRow((ui.evidenceItemNames && ui.evidenceItemNames['has_proof_of_relationship']) || 'Proof of Relationship', 'has_proof_of_relationship', t('pktStepVault', 'Photo-Vault & Email to self'), t('pktStepRelationship', 'Gather photos, joint accounts'));
    // Disposition row only when prior arrests are not explicitly denied: a
    // 'no' to prior arrests means no disposition demand at all (owner
    // directive 2026-10-27, fix #3). Legacy answers without the new
    // question keep the prior behavior.
    if (answers.has_prior_arrests !== 'no') addRow((ui.evidenceItemNames && ui.evidenceItemNames['has_arrests']) || 'Certificates of Disposition', 'has_arrests', t('pktStepVault', 'Photo-Vault & Email to self'), t('pktStepDisposition', 'Request from criminal court'));
    return { rows, hasAlternatives };
  };

  const getProgress = () => {
    if (stage === 'PHASE1') return 20;
    if (stage === 'TRIAGE') return 40;
    if (stage === 'PHASE2') return 60;
    if (stage === 'PHASE3') return 80;
    if (stage === 'PHASE4') return 90;
    if (stage === 'PHOTO') return 95;
    if (stage === 'PACKET') return 100;
    return 0;
  };

  /**
   * "YOUR NEXT STEPS — HOW TO USE THIS REPORT" for the readiness packet
   * (B2C directive §6). Tailored to this session's actual findings;
   * ZIP-independent; verified resources are distinguished from general
   * search paths; no eligibility determination, no guarantee. Body
   * text is rendered in the applicant's selected language by
   * api/_lib/nextsteps.js — the same builder the form completion
   * summary uses, so screen, packet, and form guidance never diverge.
   * (The evidence-gap knowledge base content is localized via
   * localizedKb() in the packet gap section — see generateHtml.)
   */
  const buildPacketNextSteps = () => {
    // Fact-status strings are the canonical FACT_STATUSES from
    // api/_lib/facts.js ('conflicting', 'extracted-unconfirmed').
    // (Value-upgrade fix 2026-10-23: this wrapper previously counted
    // 'conflicted' / 'reported-unconfirmed', which are not fact
    // statuses — the packet's conflict/unconfirmed tailoring could
    // therefore never fire in the real client flow.)
    const conflictFacts = factRecord ? Object.values(factRecord.facts).filter((f: any) => f.status === 'conflicting') : [];
    const conflicts = conflictFacts.length;
    const conflictLabels = conflictFacts.map((f: any) => (ui.factLabels && ui.factLabels[f.id]) || f.id);
    const unconfirmed = factRecord ? Object.values(factRecord.facts).filter((f: any) => f.status === 'extracted-unconfirmed').length : 0;
    const pct = assessment && typeof assessment.readinessPercent === 'number' ? assessment.readinessPercent : null;
    const verifiedOrgs = resourceResult && !resourceResult.isInternational ? (resourceResult.local || []) : [];
    // Report gaps #1/#2/#6: claimed-vs-detected mismatches (recomputed here
    // with the same conservative helper used at review time) and the count
    // of automated reviews feed the next-steps text.
    const reviewedUploads = uploads.filter(u => u.review);
    const mismatches = reviewedUploads.map(u => {
      if (!detectReviewMismatch(u.key, u.review.documentCategory).mismatch) return null;
      return {
        item: (ui.evidenceItemNames && ui.evidenceItemNames[u.key]) || u.key,
        category: String(u.review.documentCategory || ''),
      };
    }).filter(Boolean);
    return buildPacketNextStepsForLang({
      caseType: (assessment && assessment.caseType) || answers.case_type,
      readinessPercent: pct,
      evidenceItemCount: Object.keys(EVIDENCE_KB).filter((k) => { const eff = answersWithCorrections(answers, factRecord); return eff[k] && eff[k] !== 'yes'; }).length,
      conflicts,
      unconfirmed,
      form: formSummary ? {
        id: formSummary.formId,
        editionDate: formSummary.editionDate,
        sourceUrl: formSummary.blankForm ? formSummary.blankForm.sourceUrl : '',
      } : null,
      resourcesKind: verifiedOrgs.length > 0 ? 'verified' : resourceResult && resourceResult.isInternational ? 'international' : 'none',
      localResourcesName: ui.localResources,
      conflictLabels,
      reviewedCount: reviewedUploads.length,
      mismatches,
    }, lang);
  };

  const generateHtml = () => {
    const htmlLang = ({ EN: 'en', ES: 'es', ZH: 'zh', HT: 'ht', AR: 'ar' } as Record<string, string>)[lang] || 'en';
    const { score, total, alternativesCounted } = calculateReadinessScore();
    // Evidence-aware display (2026-10-29 redesign): a coarse band plus the
    // points total, not a percent — the score can modestly exceed the item
    // count when matching, legible reviews support claims, and a percent
    // would imply false precision (or an impossible >100%).
    const scoreBandKey = scoreBandForRatio(score / total);
    const scorePoints = formatScorePoints(score);

    const resourcesHtml = resources.map((res: ResourceOrg) => {
      const layerLabel = res.layer === 'statewide' ? t('pktLayerStatewide', 'Statewide') : (res.borough || t('pktLayerLocal', 'Local'));
      const eligibilityText = localizedResourceText(res, 'eligibility', lang);
      const servicesText = localizedResourceText(res, 'servicesOffered', lang);
      const serviceAreaText = localizedResourceText(res, 'serviceArea', lang);
      const transitText = localizedResourceText(res, 'transit', lang);
      const exitText = localizedResourceText(res, 'exit', lang);
      const eligibilityHtml = eligibilityText
        ? `<p style="font-size: 0.875rem; color: #92400e; background-color: #fef3c7; padding: 0.5rem 0.75rem; border-radius: 0.375rem; margin: 0 0 0.75rem 0;"><strong>${escapeHtml(t('pktEligibility', 'Eligibility'))}:</strong> ${escapeHtml(eligibilityText)}</p>`
        : '';
      const servicesHtml = servicesText
        ? `<p style="font-size: 0.875rem; color: #334155; margin: 0 0 0.75rem 0;"><strong>${escapeHtml(t('pktServices', 'Services'))}:</strong> ${escapeHtml(servicesText)}</p>`
        : '';
      const transitHtml = (transitText || exitText)
        ? `<div style="background-color: white; padding: 1rem; border-radius: 0.5rem; border: 1px solid #c7d2fe; margin-bottom: 1rem;">
          ${transitText ? `<p style="font-size: 0.875rem; font-weight: 600; color: #312e81; margin: 0 0 0.5rem 0;">🚇 ${escapeHtml(transitText)}</p>` : ''}
          ${exitText ? `<p style="font-size: 0.875rem; font-weight: 500; color: #475569; margin: 0;">🚶 ${escapeHtml(ui.subwayExit)}: ${escapeHtml(exitText)}</p>` : ''}
        </div>`
        : '';
      const websiteHtml = res.website
        ? `<p style="margin: 0 0 0.75rem 0;"><a href="${escapeHtml(res.website)}" style="color: #1d4ed8; text-decoration: underline; font-size: 0.875rem;">${escapeHtml(res.website.replace(/^https?:\/\//, ''))}</a></p>`
        : '';
      return `
      <div style="padding: 1.5rem; border: 2px solid #e0e7ff; background-color: #eef2ff; border-radius: 0.75rem; margin-bottom: 1rem; position: relative;">
        <div style="position: absolute; top: 0; right: 0; background-color: #4f46e5; color: white; font-size: 0.75rem; font-weight: 700; padding: 0.25rem 0.75rem; border-bottom-left-radius: 0.5rem; text-transform: uppercase;">
          ${escapeHtml(layerLabel)}
        </div>
        <h4 style="font-size: 1.25rem; font-weight: 700; color: #0f172a; margin: 0 0 0.5rem 0;">${escapeHtml(res.name)}</h4>
        <p style="color: #334155; margin: 0 0 0.25rem 0; font-weight: 500;">${escapeHtml(res.address)}</p>
        <p style="color: #334155; margin: 0 0 0.75rem 0; font-weight: 500;"><span dir="ltr">${escapeHtml(res.phone)}</span></p>
        ${websiteHtml}
        ${servicesHtml}
        ${eligibilityHtml}
        <p style="font-size: 0.8rem; color: #64748b; margin: 0 0 0.75rem 0; font-style: italic;">${escapeHtml(t('pktServiceArea', 'Service area'))}: ${escapeHtml(serviceAreaText)}${res.legalRepresentation ? ' · ' + escapeHtml(t('pktLegalRep', 'Provides legal representation')) : ''}</p>
        ${(res.lastVerified || res.sourceOfVerification) ? `<p style="font-size: 0.8rem; color: #64748b; margin: 0 0 0.75rem 0;">${res.lastVerified ? `${escapeHtml(t('pktVerified', 'Verified'))}: ${escapeHtml(res.lastVerified)}` : ''}${res.lastVerified && res.sourceOfVerification ? ' · ' : ''}${res.sourceOfVerification ? `${escapeHtml(t('pktVerifiedSource', 'Source'))}: ${escapeHtml(res.sourceOfVerification)}` : ''}</p>` : ''}
        ${transitHtml}
      </div>
    `;
    }).join('');

    // National directory links (always shown; ZIP is embedded in the ImmigrationLawHelp.org URL).
    const nationalDirsHtml = (resourceResult?.national || []).map(dir => `
      <div style="padding: 1rem; border: 1px solid #cbd5e1; background-color: #f8fafc; border-radius: 0.5rem; margin-bottom: 0.75rem;">
        <p style="margin: 0 0 0.25rem 0; font-weight: 700; color: #0f172a; font-size: 0.95rem;">
          <a href="${escapeHtml(dir.url)}" style="color: #1d4ed8; text-decoration: underline;">${escapeHtml(dir.name)}</a>
        </p>
        <p style="margin: 0; font-size: 0.85rem; color: #475569;">${escapeHtml(localizedNationalDescription(dir, lang))}</p>
      </div>
    `).join('');

    // Priority Action Table rows come from the shared builder
    // (buildTriageRows, component scope) so the printable document and
    // the on-screen packet render identical rows.
    const { rows: triageRowData, hasAlternatives } = buildTriageRows();
    const badge = (text: string, kind: 'green' | 'red' | 'amber' | 'gray') => {
      const styles: Record<string, string> = {
        green: 'background-color: #dcfce7; color: #166534;',
        red: 'background-color: #fee2e2; color: #991b1b;',
        amber: 'background-color: #fef3c7; color: #92400e;',
        gray: 'background-color: #f1f5f9; color: #475569;',
      };
      return `<span class="status-green" style="${styles[kind]}">${escapeHtml(text)}</span>`;
    };
    const triageRows: string[] = triageRowData.map(r => `
          <tr>
            <td style="font-weight: 500;">${escapeHtml(r.item)}</td>
            <td>${badge(r.statusText, r.statusKind)}</td>
            <td style="color: #64748b;">${r.nextStepHtml}${r.legalNoteText ? `<div style="margin-top:0.5rem;font-size:0.75rem;color:#92400e;font-weight:600;">${escapeHtml(r.legalNoteText)}</div>` : ''}</td>
          </tr>
        `);

    // Evidence Gaps & Alternatives section — rendered from the server-side KB.
    // Alternatives are per-item with supports/limitations; nothing is marked ready.
    const gapKeys = Object.keys(EVIDENCE_KB).filter(k => answers[k] && answers[k] !== 'yes');
    const gapSectionHtml = gapKeys.length > 0 ? `
        <div class="section">
          <h3 class="section-title font-serif">${escapeHtml(ui.gapSectionTitle || 'Evidence Gaps & Alternatives')}</h3>
          ${gapKeys.map(k => {
            const kb: any = localizedKb(k, lang);
            if (!kb) return '';
            const na = nextActionFor(k, answers[k], lang);
            const legalFlag = requiresLegalReview(k)
              ? `<p style="font-size:0.875rem;color:#92400e;font-weight:600;">⚖️ ${escapeHtml(legalReviewReason(k, lang) || '')}</p>`
              : '';
            // Cross-reference the standalone Document Photo Review section when
            // the uploaded photo was reviewed for this gap — avoids duplicating
            // the findings here while showing the integration.
            const imageRef = (imageReview && imageReview.relatedReadinessItem === k)
              ? `<p style="font-size:0.875rem;color:#4f46e5;background-color:#eef2ff;border-radius:0.5rem;padding:0.75rem 1rem;margin:0 0 0.5rem 0;">📷 ${escapeHtml(ui.imageInformedGap || 'An uploaded photo was reviewed for this item. The observations informed the guidance above — nothing has been verified.')}</p>`
              : '';
            return `
            <div style="border: 1px solid #e2e8f0; border-radius: 0.75rem; padding: 1.25rem; margin-bottom: 1rem; background-color: #fffbeb;">
              <h4 style="margin: 0 0 0.5rem 0; font-size: 1rem; font-weight: 700; color: #0f172a;">${escapeHtml((ui.evidenceItemNames && ui.evidenceItemNames[k]) || EVIDENCE_ITEM_NAMES[k] || k)} — ${escapeHtml(answers[k] === 'unknown' ? (ui.evidenceStates?.unknown || 'Unknown') : (ui.evidenceStates?.actionRequired || 'Action required'))}</h4>
              <p style="margin: 0 0 0.5rem 0; font-size: 0.875rem; color: #334155;"><strong>${escapeHtml(t('pktTargetFact', 'Target fact'))}:</strong> ${escapeHtml(kb.targetFact)}</p>
              <p style="margin: 0 0 0.5rem 0; font-size: 0.875rem; color: #334155;"><strong>${escapeHtml(t('pktPrimaryEvidence', 'Primary evidence'))}:</strong> ${escapeHtml(kb.primaryEvidence)}</p>
              <ul style="margin: 0 0 0.5rem 0; padding-left: 1.25rem; font-size: 0.875rem; color: #334155;">
                ${kb.alternatives.map((a: any) => `
                <li style="margin-bottom: 0.5rem;">
                  <strong>${escapeHtml(a.label)}</strong><br/>
                  <span>${escapeHtml(ui.gapMaySupport || 'May help show')}: ${escapeHtml(a.supports)}</span><br/>
                  <span>${escapeHtml(ui.gapCannotShow || 'Cannot show by itself')}: ${escapeHtml(a.limitations)}</span>
                </li>`).join('')}
              </ul>
              <p style="margin: 0 0 0.5rem 0; font-size: 0.875rem; color: #334155;"><strong>${escapeHtml(ui.gapNextAction || 'Next step')}:</strong> ${escapeHtml(na.step)} <em>(${(na.responsible || '')}, ${(na.priority || '')} ${escapeHtml(t('pktPriorityWord', 'priority'))})</em></p>
              ${imageRef}
              ${legalFlag}
            </div>`;
          }).join('')}
          <p style="font-size: 0.8rem; color: #64748b; font-style: italic;">${escapeHtml(lang === 'EN' ? t('pktKbNote', 'Alternative descriptions are in English. Ask your legal representative to explain any item you do not understand.') : t('pktKbNoteLocalized', 'Alternative descriptions are shown in your selected language. Ask your legal representative to explain any item you do not understand.'))}</p>
        </div>` : '';

    // Information on Record (§6): the consumer can see exactly which facts
    // IRU used, where each came from, and its honest status. Extracted
    // values are never shown as verified.
    const FACT_DISPLAY_NAMES: Record<string, string> = {
      full_name: 'Full name', family_name: 'Family name', given_name: 'Given name', middle_name: 'Middle name',
      country_of_origin: 'Country of origin', country_of_birth: 'Country of birth', citizenship: 'Citizenship',
      gender: 'Sex', marital_status: 'Marital status', date_of_birth: 'Date of birth', entry_date: 'Entry date',
      residence_country: 'Country of residence', residence_city: 'City of residence', residence_region: 'State/region of residence',
      residence_postal_code: 'Postal code', residence_street: 'Street address',
      // Mailing facts (parity with the on-screen FACT_LABELS map): the
      // printed record previously omitted them entirely, so the packet
      // showed no mailing city/state even when a generated draft used
      // them (display-state inconsistency).
      mailing_street: 'Mailing street', mailing_city: 'Mailing city', mailing_region: 'Mailing state/region',
      mailing_postal_code: 'Mailing postal code',
      city_of_birth: 'City of birth',
      passport_number: 'Passport number (from document)', a_number: 'A-Number (from document)',
    };
    const factStatusLabel = (f: any) => isDefaultedResidence(f) ? t('factStatusDefault', 'Form default — you did not select this') : f.status === 'conflicting' ? t('pktFactStatusConflicting', 'Sources disagree — needs your decision')
      : f.status === 'extracted-unconfirmed' ? t('pktFactStatusExtracted', 'From your document — not yet confirmed by you')
      : f.source === 'document' ? t('pktFactStatusDocConfirmed', 'From your document — confirmed by you') : t('pktFactStatusReported', 'Provided by you');
    const factRows = factRecord ? Object.values(factRecord.facts)
      .filter((f: any) => f && f.value && FACT_DISPLAY_NAMES[f.id])
      .map((f: any) => `<tr><td style="font-weight:500;">${escapeHtml(lang === 'EN' ? FACT_DISPLAY_NAMES[f.id] : ((ui.factLabels && ui.factLabels[f.id]) || FACT_DISPLAY_NAMES[f.id]))}</td><td>${escapeHtml(displayFactValue(f))}</td><td style="color:#64748b;">${escapeHtml(factStatusLabel(f))}</td></tr>`).join('') : '';
    const factsSectionHtml = factRows ? `
        <div class="section">
          <h3 class="section-title font-serif">${escapeHtml(t('factsTitle', 'Your Information on Record'))}</h3>
          ${factRecord && factRecord.facts && factRecord.facts.entry_date && factRecord.facts.entry_date.value ? `<p style="margin:0 0 0.75rem 0;font-size:0.75rem;color:#64748b;">${escapeHtml(t('pktDateNote', 'Your record shows your exact entry date. For privacy, the entry date you typed is reduced to a year and a general time band (for example, 2026, less than 1 year ago) before the automated review sees it; your city, state, and ZIP code answers are not sent. If you upload a document photo for review, details read from that document can be included in the review.'))}</p>` : ''}
          <table><thead><tr><th>${escapeHtml(ui.item)}</th><th>${escapeHtml(t('pktValueHeader', 'Value'))}</th><th>${escapeHtml(ui.status)}</th></tr></thead><tbody>${factRows}</tbody></table>
          <p style="font-size:0.8rem;color:#64748b;font-style:italic;">${escapeHtml(t('pktFactsNote', 'Document-extracted values show what a document contains; they are not proof of authenticity. Correct anything that is wrong before relying on it.'))}</p>
        </div>` : '';

    // Next steps (B2C §6) — part of THIS report, not a separate document.
    const ns = buildPacketNextSteps();
    const li = (items: string[]) => items.map(s => `<li style="margin-bottom:0.35rem;">${escapeHtml(s)}</li>`).join('');
    const nextStepsHtml = `
        <div class="section">
          <h3 class="section-title font-serif">${escapeHtml(ns.title)}</h3>
          <h4 style="font-size:1rem;font-weight:700;margin:0 0 0.5rem;">${escapeHtml(t('pktNsUnderstand', 'A. What this report does — and does not — establish'))}</h4>
          <ul style="margin:0 0 1rem;padding-left:1.25rem;font-size:0.875rem;color:#334155;">${li(ns.understand)}</ul>
          <h4 style="font-size:1rem;font-weight:700;margin:0 0 0.5rem;">${escapeHtml(t('pktNsReview', 'B. How to review your information and any form output'))}</h4>
          <ul style="margin:0 0 1rem;padding-left:1.25rem;font-size:0.875rem;color:#334155;">${li(ns.review)}</ul>
          <h4 style="font-size:1rem;font-weight:700;margin:0 0 0.5rem;">${escapeHtml(t('pktNsProfessional', 'C. Preparing for professional help'))}</h4>
          <ul style="margin:0 0 1rem;padding-left:1.25rem;font-size:0.875rem;color:#334155;">${li(ns.professionalHelp)}</ul>
          ${(ns.professionalQuestions && ns.professionalQuestions.length) ? `<p style="font-size:0.875rem;font-weight:700;color:#0f172a;margin:0 0 0.5rem;">${escapeHtml(ns.professionalQuestionsTitle)}</p>
          <ul style="margin:0 0 1rem;padding-left:1.25rem;font-size:0.875rem;color:#334155;">${li(ns.professionalQuestions)}</ul>` : ''}
          <h4 style="font-size:1rem;font-weight:700;margin:0 0 0.5rem;">${escapeHtml(t('pktNsResources', 'D. Finding additional help'))}</h4>
          <p style="margin:0 0 0.5rem;font-size:0.875rem;color:#334155;">${escapeHtml(ns.resourcesIntro)}</p>
          <ul style="margin:0 0 1rem;padding-left:1.25rem;font-size:0.875rem;color:#334155;">
            ${ns.searchPaths.map(p => `<li style="margin-bottom:0.35rem;"><strong>${escapeHtml(p.name)}</strong> — ${escapeHtml(p.description)}<br/><span style="color:#64748b;">${escapeHtml(p.url)}</span></li>`).join('')}
          </ul>
          <h4 style="font-size:1rem;font-weight:700;margin:0 0 0.5rem;">${escapeHtml(t('pktNsChecklist', 'E. Your ordered checklist'))}</h4>
          <ol style="margin:0;padding-left:1.25rem;font-size:0.875rem;color:#334155;">${li(ns.checklist)}</ol>
        </div>`;

    // Preparation-package summary (value-upgrade directive §6): ONE
    // place that enumerates what the customer received — report,
    // per-form draft state with edition + version, blank official
    // forms, and the next-steps plan — so nobody has to hunt across
    // screens to reconstruct their package.
    const packageFormRows = FORM_REGISTRY.map((entry: any) => {
      const d: any = draftForForm(formDraftStore, entry.id);
      // Freshness (defect-closure P1): the package enumerates a draft
      // as a current deliverable ONLY while its bound fact snapshot
      // still matches the current record. A retained draft whose facts
      // changed is enumerated as STALE — never as current.
      const freshness = d ? draftFreshness(d.meta, factRecord, entry) : 'none';
      const draftText = d && freshness === 'current'
        ? `${escapeHtml(t('pktPackageDraft', 'Prepared draft'))}: ${escapeHtml(entry.id)} — ${escapeHtml(t('formEdition', 'Edition'))} ${escapeHtml(entry.editionDate)} — ${escapeHtml(t('draftVersion', 'Draft version'))} ${d.meta.version}${d.meta.draftId ? ` (${escapeHtml(d.meta.draftId)})` : ''}${d.meta.generatedAt ? ` · ${escapeHtml(new Date(d.meta.generatedAt).toLocaleString())}` : ''}`
        : d
          ? `${escapeHtml(t('pktPackageDraft', 'Prepared draft'))}: ${escapeHtml(entry.id)} — ${escapeHtml(t('pktPackageStale', 'Stale — your information changed after this draft was generated. Regenerate it and use only the latest version.'))}`
          : `${escapeHtml(t('pktPackageDraft', 'Prepared draft'))}: ${escapeHtml(entry.id)} — ${escapeHtml(t('pktPackageNotGenerated', 'not generated yet'))}`;
      const blankText = `${escapeHtml(t('blankFormBtn', 'Official Blank Form — Reference Copy'))}: ${escapeHtml(entry.id)} — ${escapeHtml(t('formEdition', 'Edition'))} ${escapeHtml(entry.editionDate)}`;
      return `<li style="margin-bottom:0.35rem;">${draftText}<br/>${blankText}</li>`;
    }).join('');
    const packageHtml = `
        <div class="section">
          <h3 class="section-title font-serif">${escapeHtml(t('pktPackageTitle', 'Your preparation package'))}</h3>
          <ul style="margin:0 0 1rem;padding-left:1.25rem;font-size:0.875rem;color:#334155;">
            <li style="margin-bottom:0.35rem;">${escapeHtml(t('pktPackageReport', 'Readiness report — this document: your information on record, evidence review, and findings.'))}</li>
            ${packageFormRows}
            <li style="margin-bottom:0.35rem;">${escapeHtml(t('pktPackageNextSteps', 'Your Next Steps — the section below, generated from your findings.'))}</li>
          </ul>
          <p style="font-size:0.8rem;color:#64748b;font-style:italic;margin:0;">${escapeHtml(t('pktPackageNote', 'Drafts are for your review only — not signed and not submitted. If you correct information after generating a draft, that draft becomes stale: regenerate it and use only the latest version.'))}</p>
        </div>`;

    const selectedStarters = NARRATIVE_STARTERS.filter(s => answers[s.id] === 'yes').map(s => s.labels[lang as keyof typeof s.labels]);
    const narrativeText = answers.narrative_text || '';
    const hasNarrative = selectedStarters.length > 0 || narrativeText.trim().length > 0;

    return `
      <!DOCTYPE html>
      <html lang="${htmlLang}"${lang === 'AR' ? ' dir="rtl"' : ''}>
      <head>
        <meta charset="UTF-8">
        <title>${ui.packetTitle}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&display=swap');
          body { font-family: 'Inter', sans-serif; color: #0f172a; max-width: 800px; margin: 0 auto; padding: 2rem; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          h1, h2, h3, .font-serif { font-family: 'Playfair Display', serif; }
          body::after { content: ""; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background-image: url('/seal.png'); background-repeat: no-repeat; background-position: center; background-size: 50%; opacity: 0.08; z-index: -1; pointer-events: none; }
          .header { text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 2rem; margin-bottom: 2rem; }
          .header img { width: 6rem; height: 6rem; margin: 0 auto 1rem auto; object-fit: contain; }
          .header h1 { font-size: 1.875rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; margin: 0 0 0.5rem 0; }
          .header p { font-size: 0.875rem; font-family: monospace; color: #64748b; text-transform: uppercase; letter-spacing: 0.1em; margin: 0; }
          .section { margin-bottom: 2rem; page-break-inside: avoid; }
          .section-title { font-size: 1.25rem; font-weight: 700; margin: 0 0 1rem 0; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.5rem; }
          .exec-summary { font-size: 1.125rem; color: #1e293b; line-height: 1.6; font-style: italic; background-color: #f8fafc; padding: 1rem; border-radius: 0.5rem; border: 1px solid #e2e8f0; margin: 0; }
          table { width: 100%; border-collapse: collapse; border: 1px solid #e2e8f0; border-radius: 0.5rem; overflow: hidden; }
          th { background-color: #f8fafc; text-align: left; padding: 0.75rem 1.5rem; font-size: 0.75rem; font-weight: 500; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #e2e8f0; }
          td { padding: 1rem 1.5rem; font-size: 0.875rem; border-bottom: 1px solid #e2e8f0; }
          .status-green { display: inline-flex; padding: 0.125rem 0.625rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 500; background-color: #dcfce7; color: #166534; }
          .status-red { display: inline-flex; padding: 0.125rem 0.625rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 500; background-color: #fee2e2; color: #991b1b; }
          .footer { margin-top: 3rem; padding-top: 2rem; border-top: 1px solid #e2e8f0; text-align: center; }
          .footer p { margin: 0 0 0.5rem 0; font-size: 0.875rem; font-weight: 500; }
          .footer small { font-size: 0.75rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.1em; }
        </style>
      </head>
      <body>
        <div class="header">
          <img src="/seal.png" alt="SMRG - Saint Martin Revenue Group" />
          <h1 class="font-serif">${ui.packetTitle}</h1>
          <p>${ui.humanAnchorSeal} • ${new Date().toLocaleDateString()}</p>
          <div style="margin-top: 1rem; display: inline-block; background-color: #eef2ff; color: #4f46e5; padding: 0.5rem 1rem; border-radius: 9999px; font-weight: 700; font-size: 0.875rem;">
            ${ui.readinessScore}: ${escapeHtml(t(scoreBandKey, 'Strong'))} (${scorePoints} of ${total} evidence items) <span style="font-weight:400;font-size:0.75rem;">${escapeHtml(t('pktHeuristicNote', '(approximate document-completeness heuristic — not a validated metric)'))}</span>
          </div>
          <p style="margin:0.5rem 0 0 0;font-size:0.75rem;color:#64748b;">${escapeHtml(t('pktScoreReviewNote', 'Automated photo reviews can move this score modestly based on what was observed. They never verify a document, and the score is not a legal determination or a prediction of any outcome.'))}</p>
          ${alternativesCounted > 0 ? `<p style="margin:0.5rem 0 0 0;font-size:0.75rem;color:#64748b;">${escapeHtml(t('pktAltCreditNote', 'Where you identified an alternative document, it counts as half credit. That reflects what you reported, not a review: IRU has not verified any document.'))}</p>` : ''}
        </div>
        ${factRecord && factRecord.outputsStale ? `
        <div class="section" style="background-color: #fffbeb; border: 1px solid #f59e0b; border-radius: 0.5rem; padding: 1rem 1.5rem;">
          <p style="margin: 0; font-size: 0.875rem; font-weight: 600; color: #92400e;">${escapeHtml(t('factsChanged', 'Your information changed. Re-run the analysis or regenerate your form draft so everything stays consistent.'))}</p>
        </div>
        ` : ''}
        <div class="section">
          ${aiUnavailable ? `<p style="font-size:0.95rem;font-weight:700;color:#92400e;background-color:#fef3c7;border:1px solid #fcd34d;border-radius:0.5rem;padding:0.75rem;margin:0 0 0.75rem 0;">${escapeHtml(t('pktReviewNotRunTitle', 'AI Review Did Not Run'))} — ${escapeHtml(t('pktReviewNotRunDesc', 'Your document checklist and rule-based findings below are complete, but the automated AI review could not be completed. Please present this packet to a qualified legal professional.'))}</p>` : ''}
          <h3 class="section-title font-serif">${escapeHtml(ui.readinessReview || 'Readiness Review')}</h3>
          ${integrityFlags.length > 0 ? `<p style="font-size:0.875rem;color:#78350f;background-color:#fffbeb;border:1px solid #fde68a;border-radius:0.5rem;padding:0.75rem;margin:0 0 0.75rem 0;">${escapeHtml(t('pktIntegrityNote', 'Some statements in this review may not match the information on your record. Please check “Your Information on Record” and point out any difference to a qualified legal professional.'))}</p>` : ''}
          <p class="exec-summary font-serif" style="white-space: pre-wrap;">${escapeHtml(renderAssessmentText(assessment))}</p>
        </div>
        ${hasNarrative ? `
        <div class="section">
          <h3 class="section-title font-serif">${ui.personalNarrative}</h3>
          <div style="background-color: white; padding: 1.5rem; border: 1px solid #e2e8f0; border-radius: 0.5rem;">
            ${selectedStarters.length > 0 ? `
            <ul style="margin-top: 0; margin-bottom: 1rem; padding-left: 1.5rem; color: #334155; font-weight: 500;">
              ${selectedStarters.map(s => `<li style="margin-bottom: 0.5rem;">${escapeHtml(s)}</li>`).join('')}
            </ul>
            ` : ''}
            ${factRecord && factRecord.narrative ? `
            <p style="margin: 0 0 0.75rem; font-size: 0.8rem; font-weight: 600; color: #475569;">${escapeHtml(narrativeForPacket(factRecord.narrative, factRecord, lang)?.label || '')}</p>
            ` : ''}
            ${narrativeText ? `
            <p style="margin: 0; color: #1e293b; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(narrativeText)}</p>
            ` : ''}
          </div>
        </div>
        ` : ''}
        <div class="section">
          <h3 class="section-title font-serif">${ui.triageTable}</h3>
          <table>
            <thead>
              <tr>
                <th>${ui.item}</th>
                <th>${ui.status}</th>
                <th>${ui.nextStep}</th>
              </tr>
            </thead>
            <tbody>${triageRows.join('')}</tbody>
          </table>
        </div>
        ${factsSectionHtml}
        ${gapSectionHtml}
        ${imageReview ? `
        <div class="section">
          <h3 class="section-title font-serif">${escapeHtml(ui.photoTitle || 'Document Photo Review')}</h3>
          <div style="background-color: #f8fafc; padding: 1.25rem; border: 1px solid #e2e8f0; border-radius: 0.75rem; font-size: 0.875rem; color: #334155;">
            <p style="margin: 0 0 0.5rem 0;"><strong>${escapeHtml(t('photoCategory', 'Category'))}:</strong> ${escapeHtml(String(imageReview.documentCategory || ''))}</p>
            <p style="margin: 0 0 0.5rem 0;"><strong>${escapeHtml(t('photoLegibility', 'Legibility'))}:</strong> ${escapeHtml(String(imageReview.legibility || ''))} &nbsp; <strong>${escapeHtml(t('photoAppearsComplete', 'Appears complete'))}:</strong> ${escapeHtml(String(imageReview.appearsComplete || ''))}</p>
            ${(() => {
              // Report gap #5: make the photo↔checklist association explicit
              // and traceable — which item it was linked to, and whether
              // that came from the user's selection or the model.
              const linkKey = imageReview.relatedReadinessItem;
              const linkLabel = (ui.evidenceItemNames && ui.evidenceItemNames[linkKey]) || EVIDENCE_ITEM_NAMES[linkKey] || '';
              const linkText = linkLabel
                ? (imageReview.linkSource === 'user'
                    ? t('photoLinkedToUser', 'Linked to checklist item: {item} (based on your selection).')
                    : t('photoLinkedToModel', 'Linked to checklist item: {item} (based on the automated review).')).replace('{item}', linkLabel)
                : t('photoLinkedToNone', 'Not linked to a specific checklist item.');
              return `<p style="margin: 0 0 0.5rem 0; font-size: 0.8rem; color: #64748b;">${escapeHtml(linkText)}</p>`;
            })()}
            ${(imageReview.inconsistencies || []).length > 0 ? `<ul style="margin: 0 0 0.5rem 0; padding-left: 1.25rem;">${(imageReview.inconsistencies || []).map((x: any) => `<li>${escapeHtml(String(x))}</li>`).join('')}</ul>` : ''}
            ${(imageReview.limitations || []).length > 0 ? `<ul style="margin: 0; padding-left: 1.25rem; color: #64748b;">${(imageReview.limitations || []).map((x: any) => `<li>${escapeHtml(String(x))}</li>`).join('')}</ul>` : ''}
            <p style="margin: 0.75rem 0 0 0; font-size: 0.8rem; color: #64748b; font-style: italic;">${escapeHtml(ui.photoPrivacy || '')} ${escapeHtml(t('pktPhotoDisclaimer', 'This review does not establish authenticity or legal sufficiency.'))}</p>
          </div>
        </div>` : ''}
        <!-- Upload checklist (#10): per-document states in the printable packet. -->
        <div class="section">
          <h3 class="section-title font-serif">${escapeHtml(t('checklistTitle', 'Document checklist'))}</h3>
          <ul style="margin: 0; padding-left: 1.25rem; font-size: 0.875rem; color: #334155;">
            ${buildChecklistItems().map((row: any) => {
              // Report gap #1: explicit claimed-vs-detected mismatch warning
              // in the checklist row (the note also lives in the review's
              // inconsistencies, which reach the model).
              const mismatch = row.state === 'reviewed' && row.review
                ? detectReviewMismatch(row.key, row.review.documentCategory).mismatch
                : false;
              const mismatchLine = mismatch
                ? `<div style="margin-top:0.25rem;font-size:0.8rem;color:#92400e;font-weight:600;">⚠️ ${escapeHtml(t('photoMismatchNote', 'You listed {item}, but the photo appears to show {category}. Confirm with a qualified reviewer that this document supports what you claimed.').replace('{item}', row.label).replace('{category}', String(row.review.documentCategory || '')))}</div>`
                : '';
              return `<li style="margin-bottom: 0.5rem;"><strong>${escapeHtml(row.label)}</strong>${row.expected !== row.label ? ` — ${escapeHtml(row.expected)}` : ''} — ${row.state === 'reviewed' ? escapeHtml(t('checklistReviewed', 'Reviewed (automated review only — not verified)')) + (row.review ? ` (${escapeHtml(t('photoCategory', 'Category'))}: ${escapeHtml(String(row.review.documentCategory || ''))}; ${escapeHtml(t('photoLegibility', 'Legibility'))}: ${escapeHtml(String(row.review.legibility || ''))})` : '') : row.state === 'uploaded' ? escapeHtml(t('checklistUploaded', 'Uploaded — not reviewed')) : escapeHtml(t('checklistNeeded', 'Needed'))}${mismatchLine}</li>`;
            }).join('')}
          </ul>
          ${uploads.filter(u => !u.key).length > 0 ? `<p style="font-size: 0.875rem; color: #334155;">${escapeHtml(t('checklistUntagged', 'Uploaded document (type not chosen)'))} × ${uploads.filter(u => !u.key).length}</p>` : ''}
        </div>
        <div class="section">
          <h3 class="section-title font-serif">${ui.localResources}</h3>
          ${resourceResult?.isInternational ? `<div style="background-color: #eff6ff; border: 1px solid #3b82f6; border-radius: 0.5rem; padding: 1rem; margin-bottom: 1rem;">
            <p style="font-size: 0.875rem; color: #1e40af; margin: 0; font-weight: 600;">
              ${escapeHtml(t('intlResourcesNote', "You are located outside the United States. IRU's verified local directory covers parts of the U.S. only, so no local provider is shown — the U.S. national directories below can still help you find immigration legal help."))}
            </p>
          </div>` : resourceResult?.fallback ? `<div style="background-color: #fef3c7; border: 1px solid #f59e0b; border-radius: 0.5rem; padding: 1rem; margin-bottom: 1rem;">
            <p style="font-size: 0.875rem; color: #92400e; margin: 0; font-weight: 600;">
              ${answers.zip_code
                ? t('pktNoProvidersZip', "No verified local providers found for ZIP {zip} in IRU's curated directory yet.").replace('{zip}', escapeHtml(answers.zip_code))
                : t('pktNoProvidersArea', "No verified local providers found for your area in IRU's curated directory yet.")}
              ${escapeHtml(t('pktNoProvidersTail', 'The national directories below can help you find immigration legal aid in your area.'))}
            </p>
          </div>` : ''}
          ${resourcesHtml || `<p style="color: #64748b; font-style: italic;">${escapeHtml(t('pktNoResources', 'No specific resources found.'))}</p>`}
          ${nationalDirsHtml ? `<h4 style="font-size: 1rem; font-weight: 700; color: #0f172a; margin: 1.5rem 0 0.75rem 0;">${escapeHtml(t('pktNationalDirs', 'National Directories'))}</h4>${nationalDirsHtml}` : ''}
        </div>
        ${packageHtml}
        ${nextStepsHtml}
        <div class="footer">
          ${hasAlternatives ? `<p style="font-size: 0.875rem; font-weight: 600; color: #92400e; background-color: #fef3c7; padding: 1rem; border-radius: 0.5rem; margin-bottom: 1rem; text-align: left;">${ui.noteForLegalCounsel}</p>` : ''}
          <p>${ui.privacyShield}</p>
          <small>${ui.disclaimer}</small>
          ${requestId ? `<div style="margin-top:0.75rem;font-size:0.7rem;color:#94a3b8;">${escapeHtml(t('pktReference', 'Reference'))}: ${escapeHtml(requestId)}</div>` : ''}
          <div style="margin-top: 2rem; font-size: 0.75rem; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.1em;">
            Sanctuary Architect 20345 | Powered by Parametric Insight Engine
          </div>
        </div>
      </body>
      </html>
    `;
  };

  const openPrintablePacket = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert(t('popupBlocked', 'Please allow pop-ups to print your Readiness Packet.'));
      return;
    }
    const html = generateHtml();
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => { printWindow.print(); }, 500);
  };

  const copyRawHtml = () => {
    navigator.clipboard.writeText(generateHtml());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Phase 2 paywall journey: render buyer stages instead of the normal
  // app chrome when the paywall flag is on. The production build
  // (flag off) never reaches these branches.
  if (PAYWALL_UI_ON()) {
    const pwLang = lang as 'EN' | 'ES' | 'ZH' | 'HT' | 'AR';
    const pwNav = handlePaywallNavigate;
    if (stage === 'ENTRY') {
      return (
        <div className="min-h-screen bg-white">
          <div className="max-w-3xl mx-auto text-center pt-8">
            <img src="/seal.png" alt="SMRG" className="w-20 h-20 mx-auto mb-4 object-contain" />
          </div>
          <EntryScreen lang={pwLang} onNavigate={pwNav} />
        </div>
      );
    }
    if (stage === 'GUIDE') {
      return (
        <div className="min-h-screen bg-white">
          <GuideFlow lang={pwLang} onNavigate={pwNav} />
        </div>
      );
    }
    if (stage === 'PACKAGES') {
      return (
        <div className="min-h-screen bg-white">
          <PackageSelect
            lang={pwLang}
            onNavigate={pwNav}
            offers={buildPackageOffers()}
            hasEvalCredit={!!getEvalToken()}
            onCheckout={(sku) => handleCheckout(sku)}
            checkoutBusy={checkoutBusy}
          />
        </div>
      );
    }
    if (stage === 'EVAL_INTAKE') {
      return (
        <div className="min-h-screen bg-white">
          <EvalIntake lang={pwLang} onNavigate={pwNav} />
        </div>
      );
    }
    if (stage === 'EVAL_REPORT') {
      return (
        <div className="min-h-screen bg-white">
          <EvalReport
            lang={pwLang}
            onNavigate={pwNav}
            forms={paywallData.forms || ['I-589', 'I-765']}
            answers={paywallData.answers || {}}
          />
        </div>
      );
    }
    if (stage === 'RECOVER') {
      return (
        <div className="min-h-screen bg-white">
          <RecoverFlow lang={pwLang} onNavigate={pwNav} />
        </div>
      );
    }
    // After purchase, the buyer enters the normal preparation flow
    // (LANG → …) with their entitlement. Gating is enforced server-side
    // on every paid API call; the client routes by token presence.
  }

  return (
    <div
      dir={lang === 'AR' && stage !== 'LANG' ? 'rtl' : undefined}
      lang={lang === 'AR' ? 'ar' : undefined}
      className="min-h-screen flex flex-col items-center py-12 px-4 sm:px-6 lg:px-8 relative"
      style={stage === 'LANG' ? { background: 'radial-gradient(ellipse 85% 60% at 50% 32%, #ffffff 0%, rgba(255,255,255,0) 55%), linear-gradient(165deg, #e2f0fd 0%, #f6fbff 42%, #e7f3fd 72%, #cfe8fc 100%)' } : undefined}
    >
      {stage === 'LANG' && (
        <svg aria-hidden="true" focusable="false" className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-56 sm:h-72 w-full" viewBox="0 0 1440 320" preserveAspectRatio="none">
          <path d="M0,150 C240,80 480,220 720,175 C960,130 1200,215 1440,145 L1440,320 L0,320 Z" fill="#bae6fd" opacity="0.5" />
          <path d="M0,205 C260,145 520,255 780,215 C1040,175 1240,245 1440,200 L1440,320 L0,320 Z" fill="#7dd3fc" opacity="0.45" />
          <path d="M0,250 C280,200 560,295 840,255 C1120,215 1300,285 1440,240 L1440,320 L0,320 Z" fill="#5eead4" opacity="0.4" />
          <path d="M0,290 C300,250 620,315 900,285 C1150,258 1320,305 1440,278 L1440,320 L0,320 Z" fill="#38bdf8" opacity="0.35" />
        </svg>
      )}
      <div className="max-w-3xl w-full text-center mb-8 relative z-10">
        <img src="/seal.png" alt="SMRG - Saint Martin Revenue Group" className="w-24 h-24 mx-auto mb-6 object-contain" />
        <h1 className="text-4xl sm:text-5xl font-serif font-bold text-[#0a2a5e] mb-4 tracking-tight">
          {ui.title}
        </h1>
        <p className="text-2xl font-semibold text-[#0a2a5e]">
          {ui.subtitle}
        </p>
        {stage === 'LANG' && (
          <>
            <div aria-hidden="true" className="mx-auto mt-5 h-1 w-24 rounded-full bg-gradient-to-r from-teal-400 to-sky-500" />
            <p className="text-base sm:text-lg text-[#3d6396] mt-4 max-w-xl mx-auto">{t('welcomeDesc', 'Organize your information, prepare your forms, and understand your next steps.')}</p>
          </>
        )}
      </div>

      {stage !== 'LANG' && stage !== 'PACKET' && stage !== 'ANALYZING' && (
        <div className="max-w-3xl w-full mb-8">
          <div className="flex justify-between text-xs font-medium text-slate-500 mb-2">
            <span>{ui.immigrantReadiness}</span>
            <span>{getProgress()}%</span>
          </div>
          <div className="w-full bg-slate-200 rounded-full h-2.5">
            <div className="bg-indigo-600 h-2.5 rounded-full transition-all duration-500" style={{ width: `${getProgress()}%` }}></div>
          </div>
        </div>
      )}

      <div className={`max-w-3xl w-full rounded-2xl overflow-hidden relative z-10 border ${stage === 'LANG' ? 'bg-transparent border-transparent shadow-none' : 'bg-white shadow-sm border-slate-200'}`}>
        {restoredNotice && (
          <div className="m-4 mb-0 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-900 flex items-start justify-between gap-3">
            <span>{restoredNotice}</span>
            <button onClick={() => setRestoredNotice('')} className="font-medium shrink-0" aria-label="Dismiss">×</button>
          </div>
        )}
        {globalNotice && (
          <div className="m-4 mb-0 p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900 flex items-start justify-between gap-3">
            <span>{globalNotice}</span>
            <button onClick={() => setGlobalNotice('')} className="font-medium shrink-0" aria-label="Dismiss">×</button>
          </div>
        )}
        {/* Mobile repair 2026-10-26: any render-time exception inside stage
            content becomes a recoverable fallback (retry / start over)
            instead of a full white-screen loss. Happy-path DOM is
            unchanged: the boundary renders children directly. */}
        <ErrorBoundary onStartOver={handleStartOver}>
        {stage === 'LANG' && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="p-8 sm:p-12"
          >
            <div className="text-center mb-8">
              <Globe className="w-12 h-12 text-blue-600 mx-auto mb-4" />
              <h2 className="text-2xl font-semibold text-[#0a2a5e]">{ui.selectLanguage}</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {LANGUAGES.map((l) => (
                <button
                  key={l.code}
                  onClick={() => { setLang(l.code); setStage('PHASE1'); setCurrentQ(0); }}
                  aria-pressed={lang === l.code}
                  className={`flex items-center justify-between gap-3 p-4 sm:p-5 rounded-xl border-2 text-left transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 ${lang === l.code ? 'border-blue-600 bg-blue-50 shadow-sm' : 'border-blue-200/80 bg-white/85 hover:border-blue-400 hover:bg-blue-50/70'}`}
                >
                  <span>
                    <span className="block text-lg font-medium text-[#0a2a5e]">{l.name}</span>
                    <span className="block text-xs text-slate-500 mt-1">{l.code}</span>
                  </span>
                  <ChevronRight className="w-5 h-5 text-blue-500 shrink-0" aria-hidden="true" />
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {(stage === 'PHASE1' || stage === 'TRIAGE' || stage === 'PHASE2' || stage === 'PHASE3') && question && (
          <motion.div 
            key={question.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3 }}
            className="p-8 sm:p-12"
          >
            <div className="mb-8 flex items-center justify-between text-sm font-medium text-slate-400">
              <span className="uppercase tracking-wider">
                {stage === 'PHASE1' ? ui.phase1 : stage === 'TRIAGE' ? ui.phase2 : stage === 'PHASE2' ? ui.phase2 : ui.phase3}
              </span>
              <span>Q {currentQ + 1} / {questions.length}</span>
            </div>

            <div className="space-y-8">
              <h2 className="text-3xl font-serif font-semibold text-slate-900">
                {scopedQuestionText(question as any, answers, lang).label}
              </h2>

              <div className="bg-indigo-50 rounded-xl p-4 flex items-start space-x-3 border border-indigo-100">
                <Shield className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-indigo-900 leading-relaxed font-medium">
                  {scopedQuestionText(question as any, answers, lang).tip}
                </p>
              </div>

              <div>
                {question.id === 'zip_code' ? (
                  <div className="space-y-4 text-left">
                    <label className="block">
                      <span className="block text-sm font-semibold text-slate-600 mb-1">{t('locationCountry', 'Country where you live')}</span>
                      <select
                        value={answers.residence_country || 'US'}
                        onChange={(e) => setAnswers({ ...answers, residence_country: e.target.value })}
                        className="w-full p-4 rounded-xl border-2 border-slate-200 text-lg"
                      >
                        {COUNTRIES.map(c => <option key={c.code} value={c.code}>{localizedCountryName(c, lang)}</option>)}
                      </select>
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <label className="block">
                        <span className="block text-sm font-semibold text-slate-600 mb-1">{t('locationCity', 'City')}</span>
                        <input
                          type="text" value={answers.residence_city || ''}
                          onChange={(e) => setAnswers({ ...answers, residence_city: e.target.value })}
                          className="w-full p-3 rounded-xl border-2 border-slate-200"
                        />
                      </label>
                      <label className="block">
                        <span className="block text-sm font-semibold text-slate-600 mb-1">{t('locationRegion', 'State / Province / Region')}</span>
                        <input
                          type="text" value={answers.residence_region || ''}
                          onChange={(e) => setAnswers({ ...answers, residence_region: e.target.value })}
                          className="w-full p-3 rounded-xl border-2 border-slate-200"
                        />
                      </label>
                    </div>
                    {isUsCountry(answers.residence_country || 'US') ? (
                      <label className="block">
                        <span className="block text-sm font-semibold text-slate-600 mb-1">{t('locationZip', 'ZIP Code (optional — for local resources)')}</span>
                        <input
                          type="text" inputMode="numeric" value={answers.zip_code || ''}
                          onChange={(e) => setAnswers({ ...answers, zip_code: e.target.value })}
                          placeholder="e.g., 10451"
                          className="w-full p-3 rounded-xl border-2 border-slate-200"
                        />
                      </label>
                    ) : (
                      <label className="block">
                        <span className="block text-sm font-semibold text-slate-600 mb-1">{t('locationPostal', 'Postal code (optional)')}</span>
                        <input
                          type="text" value={answers.residence_postal_code || ''}
                          onChange={(e) => setAnswers({ ...answers, residence_postal_code: e.target.value })}
                          className="w-full p-3 rounded-xl border-2 border-slate-200"
                        />
                      </label>
                    )}
                    <label className="block">
                      <span className="block text-sm font-semibold text-slate-600 mb-1">{t('locationStreet', 'Street address (optional — used only if you prepare a form)')}</span>
                      <input
                        type="text" value={answers.residence_street || ''}
                        onChange={(e) => setAnswers({ ...answers, residence_street: e.target.value })}
                        className="w-full p-3 rounded-xl border-2 border-slate-200"
                      />
                    </label>
                    <p className="text-sm text-slate-500">{t('locationNote', 'Your location is used only to find resources near you. It is never required — you can continue without it, from any country.')}</p>
                  </div>
                ) : question.type === 'radio' && question.options ? (
                  <div className="space-y-3">
                    {question.options.map((opt: any) => (
                      <button
                        key={opt.value}
                        onClick={() => setAnswers({...answers, [question.id]: opt.value})}
                        className={`w-full p-5 rounded-xl border-2 text-left transition-all duration-200 flex items-center justify-between ${
                          answers[question.id] === opt.value 
                            ? 'border-indigo-600 bg-indigo-50 text-indigo-900' 
                            : 'border-slate-200 hover:border-indigo-300 hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <span className="text-lg font-medium">{opt.labels[lang as keyof typeof opt.labels]}</span>
                        {answers[question.id] === opt.value && <CheckCircle2 className="w-6 h-6 text-indigo-600" />}
                      </button>
                    ))}
                  </div>
                ) : (
                  <input
                    type={question.type}
                    value={answers[question.id] || ''}
                    onChange={(e) => setAnswers({...answers, [question.id]: e.target.value})}
                    placeholder={question.placeholders ? question.placeholders[lang as keyof typeof question.placeholders] : ''}
                    className="w-full text-xl p-4 rounded-xl border-2 border-slate-200 focus:border-indigo-600 focus:ring-0 transition-colors"
                  />
                )}
              </div>

              {['has_passport', 'has_i94', 'has_lease', 'has_persecution_proof', 'has_green_card', 'has_tax_transcripts', 'has_marriage_cert', 'has_proof_of_relationship', 'has_arrests'].includes(question.id) && answers[question.id] === 'yes' && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start space-x-3 mt-4"
                >
                  <Shield className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-amber-900 font-semibold">
                    {ui.photoVault}
                  </p>
                </motion.div>
              )}

              {PROXIES[question.id] && answers[question.id] === 'no' && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-indigo-50 border border-indigo-200 rounded-xl p-5 mt-4"
                >
                  <div className="flex items-start space-x-3 mb-3">
                    <Info className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" />
                    <h4 className="text-indigo-900 font-semibold text-lg">
                      {PROXIES[question.id].title[lang as keyof typeof PROXIES[string]['title']]}
                    </h4>
                  </div>
                  <div className="pl-8">
                    <p className="text-indigo-800 text-sm mb-3">
                      {PROXIES[question.id].desc[lang as keyof typeof PROXIES[string]['desc']]}
                    </p>
                    <div className="space-y-3">
                      {PROXIES[question.id].items.map((item: any) => (
                        <label key={item.id} className="flex items-center space-x-3 cursor-pointer p-2 rounded-lg hover:bg-indigo-100/50 transition-colors">
                          <input 
                            type="checkbox" 
                            checked={answers[item.id] === 'yes'}
                            onChange={(e) => setAnswers({...answers, [item.id]: e.target.checked ? 'yes' : 'no'})}
                            className="w-5 h-5 text-indigo-600 border-indigo-300 rounded focus:ring-indigo-500"
                          />
                          <span className="text-indigo-900 text-sm font-medium">{item.label[lang as keyof typeof item.label]}</span>
                        </label>
                      ))}
                    </div>
                    {/* Instruction at bottom of proxy panel */}
                    <div className="mt-4 pt-3 border-t border-indigo-200">
                      <p className="text-xs text-indigo-600 font-semibold">
                        💡 If you don't have any of these either, click <strong>Next</strong> — the system will log it as missing and calculate your readiness score accurately.
                      </p>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* For doc questions WITHOUT a proxy — show instruction after No is clicked */}
              {['has_passport', 'has_i94', 'has_lease', 'has_persecution_proof', 'has_green_card', 'has_tax_transcripts', 'has_marriage_cert', 'has_proof_of_relationship', 'has_arrests'].includes(question.id) && answers[question.id] === 'no' && !PROXIES[question.id] && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-start space-x-3 mt-2">
                  <Info className="w-5 h-5 text-slate-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-slate-500 font-medium">
                    💡 If you don't have this document, click <strong>Next</strong> — the system will log it as missing and calculate your readiness score accurately.
                  </p>
                </div>
              )}

              <div className="flex justify-between pt-6 border-t border-slate-100">
                <button onClick={handlePrevQuestion} className="px-6 py-3 text-slate-600 font-medium hover:text-slate-900 transition-colors flex items-center space-x-2">
                  <ArrowLeft className="w-4 h-4" />
                  <span>{ui.back}</span>
                </button>
                <button
                  onClick={handleNextQuestion}
                  disabled={!answers[question.id] && !['zip_code', 'country_of_birth', 'citizenship', 'gender', 'marital_status'].includes(question.id)}
                  className="px-8 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition-colors flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span>{ui.next}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {stage === 'PHASE4' && (
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3 }}
            className="p-8 sm:p-12"
          >
            <div className="mb-8 flex items-center justify-between text-sm font-medium text-slate-400">
              <span className="uppercase tracking-wider">{ui.phase4}</span>
            </div>

            <div className="space-y-8">
              <h2 className="text-3xl font-serif font-semibold text-slate-900">
                {ui.narrativeTitle}
              </h2>

              <div className="bg-indigo-50 rounded-xl p-4 flex items-start space-x-3 border border-indigo-100">
                <Info className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-indigo-900 leading-relaxed font-medium">
                  {ui.narrativeDesc}
                </p>
              </div>

              <div className="space-y-4">
                {NARRATIVE_STARTERS.map((starter) => (
                  <label key={starter.id} className="flex items-start space-x-3 cursor-pointer p-3 rounded-xl border-2 border-slate-200 hover:border-indigo-300 hover:bg-slate-50 transition-colors">
                    <input 
                      type="checkbox" 
                      checked={answers[starter.id] === 'yes'}
                      onChange={(e) => setAnswers({...answers, [starter.id]: e.target.checked ? 'yes' : 'no'})}
                      className="w-5 h-5 mt-0.5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
                    />
                    <span className="text-slate-700 font-medium">{starter.labels[lang as keyof typeof starter.labels]}</span>
                  </label>
                ))}
              </div>

              <div>
                <textarea
                  value={answers.narrative_text || ''}
                  onChange={(e) => setAnswers({...answers, narrative_text: e.target.value})}
                  placeholder={ui.narrativePlaceholder}
                  maxLength={1000}
                  rows={6}
                  className="w-full text-lg p-4 rounded-xl border-2 border-slate-200 focus:border-indigo-600 focus:ring-0 transition-colors resize-none"
                ></textarea>
                <div className="text-right text-xs text-slate-400 mt-2">
                  {(answers.narrative_text || '').length} / 1000
                </div>
                <p className="text-xs text-slate-500 mt-2 flex items-start gap-1">
                  <span aria-hidden="true">🔒</span>
                  <span>{ui.narrativePrivacyHint || ''}</span>
                </p>
              </div>

              <div className="flex justify-between pt-6 border-t border-slate-100">
                <button onClick={handlePrevQuestion} className="px-6 py-3 text-slate-600 font-medium hover:text-slate-900 transition-colors flex items-center space-x-2">
                  <ArrowLeft className="w-4 h-4" />
                  <span>{ui.back}</span>
                </button>
                <button 
                  onClick={handleNextQuestion} 
                  className="px-8 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition-colors flex items-center space-x-2"
                >
                  <span>{ui.next}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {stage === 'PHOTO' && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            transition={{ duration: 0.3 }}
            className="p-8 sm:p-12"
          >
            <div className="space-y-8">
              <h2 className="text-3xl font-serif font-semibold text-slate-900">
                {ui.photoTitle}
              </h2>

              {photoRestoredNotice && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-900 flex items-start justify-between gap-3">
                  <span>{photoRestoredNotice}</span>
                  <button onClick={() => setPhotoRestoredNotice('')} className="font-medium shrink-0" aria-label="Dismiss">×</button>
                </div>
              )}

              {photoResizedNotice && (
                <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-200 text-sm text-indigo-900 flex items-start justify-between gap-3">
                  <span>{photoResizedNotice}</span>
                  <button onClick={() => setPhotoResizedNotice('')} className="font-medium shrink-0" aria-label="Dismiss">×</button>
                </div>
              )}

              {photoSharedNotice && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-900 flex items-start justify-between gap-3">
                  <span>{photoSharedNotice}</span>
                  <button onClick={() => setPhotoSharedNotice('')} className="font-medium shrink-0" aria-label="Dismiss">×</button>
                </div>
              )}

              {/* Recreation notice (brief section C): shown only when
                  no held file was found and a picker attempt marker
                  existed on boot. The retry control is a <label>
                  bound to the same file input, so tapping it opens
                  the picker through a real user gesture — no
                  programmatic input.click() is ever attempted. */}
              {pickerRecreatedNotice && !photoFile && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900 space-y-3" role="status">
                  <p className="m-0">{pickerRecreatedNotice}</p>
                  <p className="m-0 text-amber-800">{t('pickerRecreatedWhy', 'This is a limit of how some phones return from the photo picker. It is not something you did wrong.')}</p>
                  <label htmlFor="iru-photo-input" className="inline-block px-4 py-2 rounded-xl bg-indigo-600 text-white font-medium cursor-pointer">
                    {t('pickerRetry', 'Pick photo again')}
                  </label>
                </div>
              )}

              <div className="bg-indigo-50 rounded-xl p-4 flex items-start space-x-3 border border-indigo-100">
                <Info className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-indigo-900 leading-relaxed font-medium">
                  {ui.photoDesc}
                </p>
              </div>

              {/* Upload checklist (#10): what the user said they have, what
                  is already uploaded/reviewed, and what is still needed.
                  Never blocks: Continue stays available with or without
                  uploads, and uploaded-but-unreviewed is never styled as
                  verified. */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 text-left">
                <h3 className="text-base font-semibold text-slate-900 mb-3">{t('checklistTitle', 'Document checklist')}</h3>
                <ul className="space-y-2">
                  {buildChecklistItems().map((row: any) => (
                    <li key={row.key} className="text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-slate-800"><strong>{row.label}</strong>{row.expected !== row.label ? ` — ${row.expected}` : ''}</span>
                        <span className={row.state === 'reviewed' ? 'text-emerald-700 font-medium' : row.state === 'uploaded' ? 'text-amber-700 font-medium' : 'text-slate-500'}>
                          {row.state === 'reviewed' ? t('checklistReviewed', 'Reviewed (automated review only — not verified)') : row.state === 'uploaded' ? t('checklistUploaded', 'Uploaded — not reviewed') : t('checklistNeeded', 'Needed')}
                        </span>
                      </div>
                      {row.state === 'reviewed' && row.review && (
                        <p className="text-xs text-slate-500 mt-0.5">{t('photoCategory', 'Category')}: {String(row.review.documentCategory || '')} · {t('photoLegibility', 'Legibility')}: {String(row.review.legibility || '')}</p>
                      )}
                      {row.state === 'uploaded' && row.fileName && (
                        <p className="text-xs text-slate-500 mt-0.5">{row.fileName}</p>
                      )}
                    </li>
                  ))}
                </ul>
                {uploads.filter(u => !u.key).length > 0 && (
                  <p className="text-sm text-slate-600 mt-3">{t('checklistUntagged', 'Uploaded document (type not chosen)')} × {uploads.filter(u => !u.key).length}</p>
                )}
                <p className="text-xs text-slate-500 mt-3">{t('checklistHint', 'You can add more than one document. Each upload stays on this checklist.')}</p>
              </div>

              <div className="space-y-4">
                {/* D5: the file input must stay ACTIVATABLE. A display:none
                    input (Tailwind "hidden") is not keyboard-focusable and
                    label-activation against it is unreliable in real
                    browsers — the dropzone appeared dead. sr-only keeps
                    the control focusable and operable (mouse, touch,
                    keyboard) while visually hidden; htmlFor binds the
                    label explicitly; focus-within shows keyboard users
                    where they are. */}
                <label htmlFor="iru-photo-input" className="block w-full p-6 rounded-xl border-2 border-dashed border-slate-300 hover:border-indigo-400 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-300 transition-colors cursor-pointer text-center">
                  <input
                    id="iru-photo-input"
                    ref={photoInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,.pdf"
                    className="sr-only"
                    onClick={() => {
                      // Save synchronously BEFORE the picker opens, so a
                      // page discard while the picker is foreground still
                      // restores progress. The picker-opened flag tells
                      // boot restore to ask for the document again.
                      saveRecovery(sessionStore(), { stage, language: lang, answers, docType: photoEvidenceKey, pickerOpened: true });
                    }}
                    onCancel={() => {
                      // Cancellation clears the picker-opened flag but is
                      // otherwise a no-op for assessment state by design:
                      // it must never reset stage, language, answers, or
                      // document type. (Do not depend on this event
                      // firing — recovery covers the no-event case.)
                      saveRecovery(sessionStore(), { stage, language: lang, answers, docType: photoEvidenceKey, pickerOpened: false });
                    }}
                    onChange={handlePhotoChange}
                  />
                  <span className="text-slate-600 font-medium">
                    {photoFile ? photoFile.name : (ui.photoChoose || 'Choose a photo…')}
                  </span>
                </label>

                <p className="text-sm text-slate-600 leading-relaxed">
                  {t('pickerGuidance', 'To close the file picker, tap its X or back arrow. Once you are back in IRU, use IRU’s own Back and Continue buttons. Your phone’s Back gesture may take you out of this page.')}
                </p>
                <p className="text-xs text-slate-500 leading-relaxed">
                  {t('pickerTroubleshoot', 'If the photo picker keeps closing without attaching your photo, restart your phone to free up memory, then try again.')}
                </p>
                <label htmlFor="iru-doc-type-select" className="block text-sm font-medium text-slate-700">
                  {t('docTypeLabel', 'Choose the type of document or evidence.')}
                </label>
                <select
                  id="iru-doc-type-select"
                  value={photoEvidenceKey}
                  onChange={(e) => setPhotoEvidenceKey(e.target.value)}
                  className="w-full p-3 rounded-xl border-2 border-slate-200 text-slate-700"
                >
                  <option value="">—</option>
                  {Object.keys(EVIDENCE_ITEM_NAMES).map(k => (
                    <option key={k} value={k}>{(ui.evidenceItemNames && ui.evidenceItemNames[k]) || EVIDENCE_ITEM_NAMES[k]}</option>
                  ))}
                </select>

                <p className="text-xs text-slate-500 flex items-start gap-1">
                  <span aria-hidden="true">🔒</span>
                  <span>{ui.photoPrivacy}</span>
                </p>

                {reviewError && (
                  <div className="space-y-3">
                    <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">{reviewError}</p>
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      {photoFile && (
                        <button
                          onClick={handlePhotoReview}
                          disabled={reviewing}
                          className="px-4 py-2 border-2 border-indigo-600 text-indigo-700 text-sm font-medium rounded-xl hover:bg-indigo-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {t('photoRetry', 'Retry')}
                        </button>
                      )}
                      <button
                        onClick={() => { if (photoInputRef.current) photoInputRef.current.click(); }}
                        className="px-4 py-2 border-2 border-indigo-600 text-indigo-700 text-sm font-medium rounded-xl hover:bg-indigo-50 transition-colors"
                      >
                        {t('photoChooseAnother', 'Choose another document')}
                      </button>
                      <button
                        onClick={handleNextQuestion}
                        className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-xl hover:bg-indigo-700 transition-colors"
                      >
                        {t('photoContinueWithout', 'Continue without the document')}
                      </button>
                    </div>
                  </div>
                )}

                {imageReview && (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 text-left space-y-2">
                    <p className="text-sm text-slate-700"><strong>{t('photoCategory', 'Category')}:</strong> {imageReview.documentCategory}</p>
                    <p className="text-sm text-slate-700"><strong>{t('photoLegibility', 'Legibility')}:</strong> {imageReview.legibility}</p>
                    <p className="text-sm text-slate-700"><strong>{t('photoAppearsComplete', 'Appears complete')}:</strong> {imageReview.appearsComplete}</p>
                    {imageReview.inconsistencies && imageReview.inconsistencies.length > 0 && (
                      <ul className="text-sm text-amber-800 list-disc pl-5">
                        {imageReview.inconsistencies.map((x: string, i: number) => <li key={i}>{x}</li>)}
                      </ul>
                    )}
                    {imageReview.limitations && imageReview.limitations.length > 0 && (
                      <ul className="text-xs text-slate-500 list-disc pl-5">
                        {imageReview.limitations.map((x: string, i: number) => <li key={i}>{x}</li>)}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3 pt-6 border-t border-slate-100 sm:flex-row sm:items-center sm:justify-between">
                <button onClick={handlePrevQuestion} className="px-6 py-3 text-slate-600 font-medium hover:text-slate-900 transition-colors flex items-center justify-center sm:justify-start space-x-2 w-full sm:w-auto">
                  <ArrowLeft className="w-4 h-4" />
                  <span>{ui.back}</span>
                </button>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    onClick={handlePhotoReview}
                    disabled={!photoFile || reviewing}
                    className="px-6 py-3 border-2 border-indigo-600 text-indigo-700 font-medium rounded-xl hover:bg-indigo-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed w-full sm:w-auto"
                  >
                    {reviewing ? (ui.photoReviewing || 'Reviewing…') : (ui.photoReview || 'Review photo')}
                  </button>
                  <button
                    onClick={handleNextQuestion}
                    className="px-8 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition-colors flex items-center justify-center space-x-2 w-full sm:w-auto"
                  >
                    <span>{imageReview ? (ui.next || 'Next') : (ui.photoSkip || ui.next)}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {stage === 'ANALYZING' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
            className="p-16 text-center"
          >
            <div className="w-16 h-16 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto mb-6"></div>
            <h2 className="text-2xl font-serif font-semibold text-slate-900">
              {ui.analyzing}
            </h2>
            <p className="text-slate-500 mt-2">{ui.generating}</p>
            <p className="text-xs text-slate-400 mt-6 max-w-md mx-auto">{ui.disclaimer}</p>
          </motion.div>
        )}

        {stage === 'PACKET' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.7 }}
            className="p-8 sm:p-12 text-center"
          >
            {aiUnavailable ? (
              <div data-testid="review-not-run">
                <AlertTriangle className="w-16 h-16 text-amber-500 mx-auto mb-6" />
                <h2 className="text-3xl font-serif font-bold text-amber-800 mb-4">{t('pktReviewNotRunTitle', 'AI Review Did Not Run')}</h2>
                <p className="text-lg text-slate-600 mb-8">{t('pktReviewNotRunDesc', 'Your document checklist and rule-based findings below are complete, but the automated AI review could not be completed. Please present this packet to a qualified legal professional.')}</p>
              </div>
            ) : (
              <>
                <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-6" />
                <h2 className="text-3xl font-serif font-bold text-slate-900 mb-4">{ui.packetReady}</h2>
                <p className="text-lg text-slate-600 mb-8">
                  {ui.packetDesc}
                </p>
              </>
            )}

            {/* ── Readiness Score + Readiness Review (2026-10-24 fix):
                the same score heuristic (calculateReadinessScore) and
                the same assessment text (renderAssessmentText) the
                printable packet carries, rendered on screen so the
                header's promise above holds on this page too. ── */}
            {(() => {
              const { score, total, alternativesCounted } = calculateReadinessScore();
              // Evidence-aware display (2026-10-29 redesign): coarse band +
              // points, not a percent — see the printable packet comment.
              const scoreBandKey = scoreBandForRatio(score / total);
              const scorePoints = formatScorePoints(score);
              return (
                <div className="mt-8 mb-8 text-left">
                  <div className="inline-block bg-indigo-50 text-indigo-700 px-4 py-2 rounded-full font-bold text-sm">
                    {ui.readinessScore}: {t(scoreBandKey, 'Strong')} ({scorePoints} of {total} evidence items) <span className="font-normal text-xs">{t('pktHeuristicNote', '(approximate document-completeness heuristic — not a validated metric)')}</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">{t('pktScoreReviewNote', 'Automated photo reviews can move this score modestly based on what was observed. They never verify a document, and the score is not a legal determination or a prediction of any outcome.')}</p>
                  {alternativesCounted > 0 && (
                    <p className="text-xs text-slate-500 mt-2" data-testid="alt-credit-note">{t('pktAltCreditNote', 'Where you identified an alternative document, it counts as half credit. That reflects what you reported, not a review: IRU has not verified any document.')}</p>
                  )}
                  <h3 className="text-lg font-serif font-bold text-slate-900 mb-2 mt-6">{ui.readinessReview || 'Readiness Review'}</h3>
                  {integrityFlags.length > 0 && (
                    <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3" data-testid="integrity-note">{t('pktIntegrityNote', 'Some statements in this review may not match the information on your record. Please check “Your Information on Record” and point out any difference to a qualified legal professional.')}</p>
                  )}
                  <p className="text-base text-slate-800 italic bg-slate-50 border border-slate-200 rounded-xl p-4" style={{ whiteSpace: 'pre-wrap' }}>{renderAssessmentText(assessment)}</p>
                  {requestId && <p className="text-xs text-slate-400 mt-2" data-testid="request-ref">{t('pktReference', 'Reference')}: {requestId}</p>}
                </div>
              );
            })()}
            
            {/* USCIS Required Forms \u2014 data from USCIS_FORMS (fees verified as of FEE_SCHEDULE_AS_OF) */}
            {(() => {
              const caseType = answers.case_type || 'asylum';
              const caseForms = USCIS_FORMS[caseType] || USCIS_FORMS.asylum;
              return (
                <div className="mt-8 mb-8 text-left">
                  <h3 className="text-lg font-serif font-bold text-slate-900 mb-2">{t('formsPanelTitle', 'Required Forms for Your Case')}</h3>
                  <p className="text-xs text-slate-500 mb-4">{t('formsPanelNote', 'All forms are official USCIS documents. Download free directly from uscis.gov. Fees last verified {date} — confirm current fees at uscis.gov before filing.').replace('{date}', FEE_SCHEDULE_AS_OF)}</p>
                  <div className="space-y-3">
                    {caseForms.map((form, i) => (
                      <div key={i} className={`rounded-xl border-2 p-4 ${i === 0 || i === 1 && caseType === 'family' ? 'border-indigo-200 bg-indigo-50/30' : 'border-slate-100'}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${i === 0 || i === 1 && caseType === 'family' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{{ PRIMARY: t('formsTagPrimary', 'PRIMARY'), SECONDARY: t('formsTagSecondary', 'SECONDARY'), 'IF TRAVELING': t('formsTagIfTraveling', 'IF TRAVELING'), 'WITH I-485': t('formsTagWithI485', 'WITH I-485') }[form.tag] || form.tag}</span>
                          <span className="font-bold text-slate-900">{form.name}</span>
                          <span className="text-xs text-slate-400 ml-auto">{form.fee === 'Free' ? t('formsFeeFree', 'Free') : form.fee === 'Free (asylum)' ? t('formsFeeFreeAsylum', 'Free (asylum)') : form.fee.replace('(with I-485)', t('formsFeeWithSuffix', '(with I-485)'))}</span>
                        </div>
                        <p className="text-xs text-slate-600 mb-2">{(form.descI18n && form.descI18n[lang]) || form.desc}</p>
                        <div className="flex flex-wrap gap-2">
                          <a href={form.pdf} target="_blank" rel="noopener noreferrer" className="text-xs font-bold bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors">⬇ {t('formsDownload', 'Download PDF')}</a>
                          <a href={form.instructions} target="_blank" rel="noopener noreferrer" className="text-xs font-bold border border-slate-200 text-slate-600 px-3 py-1.5 rounded-lg hover:border-slate-400 transition-colors">{t('formsInstructions', 'Instructions')}</a>
                          <a href={form.page} target="_blank" rel="noopener noreferrer" className="text-xs font-bold border border-slate-200 text-slate-600 px-3 py-1.5 rounded-lg hover:border-slate-400 transition-colors">{t('formsUscisPage', 'USCIS Page')} ↗</a>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-slate-400 text-center mt-3">{t('formsPanelFooter', 'Procedural information only — not legal advice. Verify all forms at uscis.gov before filing.')}</p>
                </div>
              );
            })()}

            {/* ── Your Information on Record (§8): review, confirm, resolve, correct ── */}
            {factRecord && (
              <div className="mt-8 mb-8 text-left">
                <h3 className="text-lg font-serif font-bold text-slate-900 mb-2">{t('factsTitle', 'Your Information on Record')}</h3>
                <p className="text-xs text-slate-500 mb-4">{t('factsIntro', 'Everything IRU is using, where it came from, and what still needs your confirmation.')}</p>
                {factRecord.facts.entry_date && factRecord.facts.entry_date.value && (
                  <p className="text-xs text-slate-500 mb-4" data-testid="date-privacy-note">{t('pktDateNote', 'Your record shows your exact entry date. For privacy, the entry date you typed is reduced to a year and a general time band (for example, 2026, less than 1 year ago) before the automated review sees it; your city, state, and ZIP code answers are not sent. If you upload a document photo for review, details read from that document can be included in the review.')}</p>
                )}
                {factRecord.outputsStale && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 flex flex-wrap items-center gap-3">
                    <p className="text-sm text-amber-900 font-medium flex-1">{t('factsChanged', 'Your information changed. Re-run the analysis or regenerate your form draft so everything stays consistent.')}</p>
                    <button onClick={() => handleInterviewComplete()} className="px-4 py-2 bg-amber-600 text-white text-sm font-semibold rounded-lg hover:bg-amber-700">{t('rerunAnalysis', 'Re-run analysis')}</button>
                  </div>
                )}
                <div className="space-y-2">
                  {Object.values(factRecord.facts).filter((f: any) => f && f.value && FACT_LABELS[f.id]).map((f: any) => (
                    <div key={f.id} className="border border-slate-200 rounded-xl p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-800 text-sm">{(ui.factLabels && ui.factLabels[f.id]) || FACT_LABELS[f.id]}</span>
                        <span className="text-slate-700 text-sm">{displayFactValue(f)}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${f.status === 'conflicting' ? 'bg-red-100 text-red-800' : f.status === 'extracted-unconfirmed' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                          {isDefaultedResidence(f) ? t('factStatusDefault', 'Form default — you did not select this') : f.status === 'conflicting' ? t('factStatusConflicting', 'Sources disagree') : f.status === 'extracted-unconfirmed' ? t('factStatusExtracted', 'From your document — please confirm') : t('factStatusReported', 'You provided this')}
                        </span>
                      </div>
                      {f.status === 'extracted-unconfirmed' && (
                        <button onClick={() => handleConfirmFact(f.id)} className="mt-2 px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700">{t('confirmFact', 'Confirm')}</button>
                      )}
                      {f.status === 'conflicting' && (
                        <div className="mt-2 space-y-1">
                          <button onClick={() => handleResolveConflict(f.id, f.source)} className="block px-3 py-1.5 border border-slate-300 text-xs font-semibold rounded-lg hover:bg-slate-50">
                            {t('factKeep', 'Keep')}: {String(f.value)} <span className="text-slate-400">({f.source === 'document' ? t('factFromDocument', 'from document') : t('factFromAnswer', 'your answer')})</span>
                          </button>
                          {(f.alternatives || []).map((a: any, i: number) => (
                            <button key={i} onClick={() => handleResolveConflict(f.id, a.source)} className="block px-3 py-1.5 border border-slate-300 text-xs font-semibold rounded-lg hover:bg-slate-50">
                              {t('factUseInstead', 'Use instead')}: {String(a.value)} <span className="text-slate-400">({a.source === 'document' ? t('factFromDocument', 'from document') : t('factFromAnswer', 'your answer')})</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {/* Correction (§8 / R4b): EVERY fact on record can be
                          corrected by the applicant — including facts they
                          reported themselves, which previously rendered
                          with no control at all even though the correction
                          handler existed. Saving routes through
                          handleCorrectFact → upsertFact(source:
                          'correction'), which marks outputs stale and
                          withdraws generated drafts like any mutation. */}
                      <div className="mt-2">
                        {editingFactId === f.id ? (
                          <span className="flex flex-wrap items-center gap-2">
                            <input type="text" value={factEditValue} onChange={(e) => setFactEditValue(e.target.value)}
                              className="flex-1 min-w-[12rem] p-2 rounded-lg border-2 border-slate-200 text-sm" />
                            <button onClick={() => { handleCorrectFact(f.id, factEditValue); setEditingFactId(''); }} className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700">{t('saveFact', 'Save')}</button>
                            <button onClick={() => setEditingFactId('')} className="px-3 py-1.5 border border-slate-300 text-xs font-semibold rounded-lg hover:bg-slate-50">{t('cancelEdit', 'Cancel')}</button>
                          </span>
                        ) : (
                          <button onClick={() => { setEditingFactId(f.id); setFactEditValue(String(f.value)); }} className="px-3 py-1.5 border border-slate-300 text-xs font-semibold rounded-lg hover:bg-slate-50">{t('correctFact', 'Correct')}</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Your Story (successive §4): chronology, issues, approval gate ── */}
            {factRecord && factRecord.narrative && (() => {
              const analysis: any = analyzeNarrative(factRecord.narrative, factRecord, lang);
              const approved = factRecord.narrative.status === 'approved';
              const blocking = analysis.issues.filter((i: any) => i.blocking);
              return (
                <div className="mt-8 mb-8 text-left">
                  <h3 className="text-lg font-serif font-bold text-slate-900 mb-2">{t('narrativePanelTitle', 'Your Story — Review and Approve')}</h3>
                  <p className="text-xs text-slate-500 mb-4">{t('narrativePanelIntro', 'Your own words in time order. IRU flags what is missing or unclear and asks — it never adds to your story. Facts from your story are used in form preparation only after you approve it here.')}</p>
                  <div className="space-y-2 mb-4">
                    {analysis.chronology.map((e: any) => (
                      <div key={e.id} className="border border-slate-200 rounded-xl p-3">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{e.date ? `${e.date}${e.datePrecision !== 'exact' ? ' (approximate)' : ''}` : t('narrativeNoDate', 'Date not given')}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{e.origin === 'document-extracted' ? t('narrativeFromDocument', 'From your document') : t('narrativeFromYou', 'Your statement')}</span>
                          {e.needsConfirmation && (
                            <button onClick={() => handleNarrativeConfirm(e.id)} className="px-3 py-1 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700">{t('confirmFact', 'Confirm')}</button>
                          )}
                        </div>
                        <p className="text-sm text-slate-700" style={{ whiteSpace: 'pre-wrap' }}>{e.text}</p>
                      </div>
                    ))}
                  </div>
                  {analysis.issues.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 space-y-3">
                      {analysis.issues.map((issue: any, idx: number) => (
                        <div key={idx}>
                          <p className="text-sm text-amber-900">{issue.question}</p>
                          {issue.kind === 'missing-date' && (
                            <span className="flex gap-2 mt-1">
                              <input type="date" value={narrativeDates[issue.eventId] || ''} onChange={(ev) => setNarrativeDates({ ...narrativeDates, [issue.eventId]: ev.target.value })} className="border border-amber-300 rounded-lg px-2 py-1 text-sm" />
                              <button onClick={() => handleNarrativeDate(issue.eventId)} className="px-3 py-1 bg-amber-600 text-white text-xs font-bold rounded-lg hover:bg-amber-700">{t('saveDate', 'Save date')}</button>
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {narrativeError && <p className="text-sm text-red-700 mb-3">{narrativeError}</p>}
                  {approved ? (
                    <p className="text-sm font-semibold text-emerald-700">{t('narrativeApproved', 'You reviewed and approved your story. Facts from it can now be used in form preparation. Correcting it later will ask you to approve it again.')}</p>
                  ) : (
                    <button onClick={handleApproveNarrative} disabled={blocking.length > 0} className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-40">
                      {t('approveNarrative', 'I reviewed my story — approve it for form preparation')}
                    </button>
                  )}
                </div>
              );
            })()}

            {/* ── Priority Action Table (2026-10-24 fix): the same triage
                builder the printable packet uses (buildTriageRows),
                rendered on screen. ── */}
            {(() => {
              const { rows } = buildTriageRows();
              if (rows.length === 0) return null;
              const badgeClass: Record<string, string> = {
                green: 'bg-green-100 text-green-800',
                red: 'bg-red-100 text-red-800',
                amber: 'bg-amber-100 text-amber-800',
                gray: 'bg-slate-100 text-slate-600',
              };
              return (
                <div className="mt-8 mb-8 text-left">
                  <h3 className="text-lg font-serif font-bold text-slate-900 mb-2">{ui.triageTable}</h3>
                  <table className="w-full border border-slate-200 rounded-lg overflow-hidden">
                    <thead>
                      <tr>
                        <th className="bg-slate-50 text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide border-b border-slate-200">{ui.item}</th>
                        <th className="bg-slate-50 text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide border-b border-slate-200">{ui.status}</th>
                        <th className="bg-slate-50 text-left px-4 py-2 text-xs font-medium text-slate-500 uppercase tracking-wide border-b border-slate-200">{ui.nextStep}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r: any, i: number) => (
                        <tr key={i} className="border-b border-slate-200">
                          <td className="px-4 py-3 text-sm font-medium">{r.item}</td>
                          <td className="px-4 py-3"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${badgeClass[r.statusKind] || badgeClass.gray}`}>{r.statusText}</span></td>
                          <td className="px-4 py-3 text-sm text-slate-500">{r.nextStepText}{r.legalNoteText ? <div className="mt-1 text-xs text-amber-800 font-semibold">{r.legalNoteText}</div> : null}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })()}

            {/* ── Upload checklist (#10): per-document upload states in
                the on-screen packet, matching the printable packet. ── */}
            {(() => {
              const items = buildChecklistItems();
              const untagged = uploads.filter(u => !u.key).length;
              if (items.length === 0 && untagged === 0) return null;
              return (
                <div className="mt-8 mb-8 text-left">
                  <h3 className="text-lg font-serif font-bold text-slate-900 mb-2">{t('checklistTitle', 'Document checklist')}</h3>
                  <ul className="space-y-2">
                    {items.map((row: any) => (
                      <li key={row.key} className="text-sm">
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-slate-800"><strong>{row.label}</strong>{row.expected !== row.label ? ` — ${row.expected}` : ''}</span>
                          <span className={row.state === 'reviewed' ? 'text-emerald-700 font-medium' : row.state === 'uploaded' ? 'text-amber-700 font-medium' : 'text-slate-500'}>
                            {row.state === 'reviewed' ? t('checklistReviewed', 'Reviewed (automated review only — not verified)') : row.state === 'uploaded' ? t('checklistUploaded', 'Uploaded — not reviewed') : t('checklistNeeded', 'Needed')}
                          </span>
                        </div>
                        {row.state === 'reviewed' && row.review && (
                          <p className="text-xs text-slate-500 mt-0.5">{t('photoCategory', 'Category')}: {String(row.review.documentCategory || '')} · {t('photoLegibility', 'Legibility')}: {String(row.review.legibility || '')}</p>
                        )}
                        {row.state === 'reviewed' && row.review && detectReviewMismatch(row.key, row.review.documentCategory).mismatch && (
                          <p className="text-xs text-amber-800 font-semibold mt-0.5">⚠️ {t('photoMismatchNote', 'You listed {item}, but the photo appears to show {category}. Confirm with a qualified reviewer that this document supports what you claimed.').replace('{item}', row.label).replace('{category}', String(row.review.documentCategory || ''))}</p>
                        )}
                        {row.state === 'uploaded' && row.fileName && (
                          <p className="text-xs text-slate-500 mt-0.5">{row.fileName}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                  {untagged > 0 && (
                    <p className="text-sm text-slate-600 mt-3">{t('checklistUntagged', 'Uploaded document (type not chosen)')} × {untagged}</p>
                  )}
                </div>
              );
            })()}

            {/* ── B2C offer (directive §3): both options + exact totals BEFORE
                payment. Only when the paywall build flag is on; amounts come
                from the same pricing module the server enforces with. ── */}
            {PAYWALL_UI_ON() && (() => {
              const offer = buildOffer(lang);
              const evalToken = (() => { try { return sessionStorage.getItem('iru_evaluation_token'); } catch { return null; } })();
              const formTokens = loadFormTokens();
              const owned = purchaseState.ownedForms;
              const oneOwned = owned.length === 1 ? owned[0] : null;
              const otherForm = oneOwned ? (oneOwned === 'I-589' ? 'I-765' : 'I-589') : null;
              return (
                <div className="mt-8 mb-2 text-left border-2 border-amber-300 bg-amber-50 rounded-xl p-4">
                  <h3 className="text-base font-serif font-bold text-slate-900 mb-2">{t('offerTitle', 'Complete preparation — pricing')}</h3>
                  <p className="text-xs text-slate-600 mb-3">{t('offerIntro', 'Begin with the $1.00 limited evaluation — a concise summary of the broad areas that need attention. Your $1.00 is credited in full toward complete preparation. One-time charges in USD. No subscription. IRU prepares drafts for your review; it is not a law firm, provides no legal advice, and files nothing.')}</p>
                  <ul className="text-sm text-slate-700 list-disc pl-5 mb-3">
                    {offer.options.map((o: any) => (
                      <li key={o.sku}><strong>{o.name} — {formatCents(o.totalCents)} {t('offerTotalWord', 'total')}</strong> ({o.scope}){o.savingsNote ? ` — ${o.savingsNote}` : ''}</li>
                    ))}
                    <li><strong>{t('offerAddon', 'Second form later')}</strong> — {formatCents(PRICING.secondForm.chargeCents)} ({t('offerTotalWord', 'total')} {formatCents(PRICING.secondForm.totalCents)})</li>
                  </ul>
                  <div className="flex flex-wrap gap-3">
                    {!purchaseState.hasEvaluation && owned.length === 0 && (
                      <button onClick={() => handleCheckout(SKUS.EVALUATION)} disabled={checkoutBusy} className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50">
                        {t('offerStart', 'Start: $1.00 limited evaluation (test mode)')}
                      </button>
                    )}
                    {purchaseState.hasEvaluation && owned.length === 0 && (
                      <>
                        <button onClick={() => { if (selectedFormId) handleCheckout(SKUS.ONE_FORM, { formId: selectedFormId, prerequisiteToken: evalToken || undefined }); }} disabled={checkoutBusy || !selectedFormId} className="px-5 py-2.5 border-2 border-indigo-600 text-indigo-700 text-sm font-semibold rounded-xl hover:bg-indigo-50 disabled:opacity-50">
                          {t('offerOneForm', 'Complete ONE form')} ({selectedFormId || '…'}) — {formatCents(PRICING.oneForm.chargeCents)} {t('offerMore', 'more')}
                        </button>
                        <button onClick={() => handleCheckout(SKUS.BUNDLE, { prerequisiteToken: evalToken || undefined })} disabled={checkoutBusy} className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50">
                          {t('offerBundle', 'Complete BOTH forms')} — {formatCents(PRICING.bundle.chargeCents)} {t('offerMore', 'more')}
                        </button>
                        {!selectedFormId && <span className="text-xs text-slate-500 self-center">{t('offerPickForm', 'Select a form below to enable the one-form option.')}</span>}
                      </>
                    )}
                    {oneOwned && otherForm && (
                      <button onClick={() => handleCheckout(SKUS.SECOND_FORM_ADDON, { prerequisiteToken: formTokens[oneOwned] })} disabled={checkoutBusy} className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50">
                        {t('offerAddSecond', 'Add')} {otherForm} — {formatCents(PRICING.secondForm.chargeCents)} ({formatCents(PRICING.secondForm.totalCents)} {t('offerTotalWord', 'total')})
                      </button>
                    )}
                    {owned.length >= 2 && <span className="text-sm text-slate-700">{t('offerBothOwned', 'You have preparation for both forms. Generate each draft below.')}</span>}
                  </div>
                </div>
              );
            })()}

            {/* ── Form preparation (§7): select, review mapping, generate DRAFT ── */}
            {factRecord && (
              <div className="mt-8 mb-8 text-left">
                <h3 className="text-lg font-serif font-bold text-slate-900 mb-2">{t('formPrepTitle', 'Prepare an Official Form Draft')}</h3>
                <p className="text-xs text-slate-500 mb-4">{t('formPrepIntro', 'IRU can fill a draft of an official USCIS form from your information on record. You choose the form — IRU does not decide what you should file. Drafts are never signed or submitted by IRU.')}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                  {FORM_REGISTRY.map((entry: any) => (
                    <button key={entry.id} onClick={() => { const s = selectForm(entry.id); setSelectedFormId(s.selectedFormId); setFormError(s.formError); }}
                      className={`p-4 rounded-xl border-2 text-left ${selectedFormId === entry.id ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300'}`}>
                      <span className="block font-bold text-slate-900">{entry.id}</span>
                      <span className="block text-xs text-slate-500 mt-1">{entry.name}</span>
                      <span className="block text-xs text-slate-400 mt-1">{t('formEdition', 'Edition')} {entry.editionDate} · uscis.gov</span>
                    </button>
                  ))}
                </div>
                {selectedFormId && (() => {
                  const entry: any = getFormEntry(selectedFormId);
                  const plan: any = buildFillPlan(factRecord, entry, lang);
                  // D4 guard: the generated-draft panel below renders ONLY
                  // the summary generated for the currently selected form
                  // (summaryForSelection) — never a previous form's draft
                  // under a new selection.
                  const currentSummary: any = summaryForSelection(formSummary, selectedFormId);
                  return (
                    <div className="border border-slate-200 rounded-xl p-4 space-y-4">
                      <p className="text-xs text-slate-500">{localizedApplicability(entry, lang)}</p>
                      <p className="text-sm text-slate-700"><strong>{plan.fill.length}</strong> {t('formPopulated', 'fields can be filled from your information')}.</p>
                      {plan.needsConfirmation.length > 0 && (
                        <div>
                          <p className="text-sm font-semibold text-amber-800">{t('formNeedsConfirm', 'Needs your confirmation before it can be used')}:</p>
                          <ul className="text-sm text-slate-600 list-disc pl-5">
                            {plan.needsConfirmation.map((n: any) => <li key={n.factId}>{n.label}: “{String(n.value)}” {t('formConfirmInFacts', '— confirm it in Your Information above.')}</li>)}
                          </ul>
                        </div>
                      )}
                      {plan.conflicts.length > 0 && (
                        <p className="text-sm font-semibold text-red-700">{t('formConflicts', 'Conflicting values — resolve above')}: {plan.conflicts.map((c: any) => (c.values && c.values.length > 1 ? `${c.label} (“${c.values.map((v: any) => String(v)).join('” vs “')}”)` : c.label)).join('; ')}</p>
                      )}
                      {plan.missing.length > 0 && (
                        <div>
                          <p className="text-sm font-semibold text-slate-800">{t('formMissing', 'Still needed for this form')}:</p>
                          <div className="space-y-2 mt-2">
                            {plan.missing.map((m: any) => (
                              <label key={m.factId} className="block">
                                <span className="block text-xs font-semibold text-slate-500">{m.question}</span>
                                <input type="text" value={formAnswers[m.factId] || ''} onChange={(e) => setFormAnswers({ ...formAnswers, [m.factId]: e.target.value })}
                                  className="w-full p-2.5 rounded-lg border-2 border-slate-200 text-sm" />
                              </label>
                            ))}
                          </div>
                          <button onClick={() => handleSaveFormAnswers(entry, plan)} className="mt-3 px-4 py-2 border-2 border-indigo-600 text-indigo-700 text-sm font-semibold rounded-lg hover:bg-indigo-50">{t('saveAnswers', 'Save answers')}</button>
                        </div>
                      )}
                      {formError && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">{formError}</p>}
                      <div className="flex flex-wrap gap-3">
                        <button onClick={handleGenerateForm} disabled={formBusy} className="px-6 py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50">
                          {formBusy ? t('generatingDraft', 'Generating…') : t('generateDraft', 'Generate DRAFT PDF')}
                        </button>
                        {/* The official blank form is a public reference copy —
                            labeled as such; it grants no preparation. */}
                        <button onClick={downloadBlankForm} className="px-6 py-3 border-2 border-slate-300 text-slate-700 font-semibold rounded-xl hover:bg-slate-50">
                          {t('blankFormBtn', 'Official Blank Form — Reference Copy')} (PDF)
                        </button>
                        {formPdfBase64 && currentSummary && selectedDraftFreshness === 'current' && (() => {
                          const checklist = (currentSummary && currentSummary.finalReviewChecklist) || [];
                          const allChecked = checklist.length > 0 && checklist.every((_: any, i: number) => reviewChecks[i]);
                          return (
                            <button onClick={downloadFormPdf} disabled={checklist.length > 0 && !allChecked}
                              title={checklist.length > 0 && !allChecked ? t('checklistGate', 'Complete the final review checklist below before downloading.') : ''}
                              className="px-6 py-3 bg-green-600 text-white font-semibold rounded-xl hover:bg-green-700 disabled:opacity-50">
                              {t('downloadDraft', 'Download draft PDF')}
                            </button>
                          );
                        })()}
                      </div>
                      {currentFormDraft && selectedDraftFreshness !== 'current' && (
                        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">{t('pktPackageStale', 'Stale — your information changed after this draft was generated. Regenerate it and use only the latest version.')}</p>
                      )}
                      {formPdfBase64 && currentSummary && currentSummary.finalReviewChecklist && !(currentSummary.finalReviewChecklist.every((_: any, i: number) => reviewChecks[i])) && (
                        <p className="text-xs text-amber-800">{t('checklistGate', 'Complete the final review checklist below before downloading.')}</p>
                      )}
                      {currentSummary && (
                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm text-slate-700 space-y-3">
                          <p className="font-bold text-slate-900">{currentSummary.formId} — {t('formEdition', 'Edition')} {currentSummary.editionDate}</p>
                          <p className="text-xs font-semibold text-red-700 uppercase tracking-wide">{currentSummary.draftLabel}</p>
                          {/* Version identification (B2C §5.C): the latest
                              generation is the only current draft. */}
                          {formDraftMeta && formDraftMeta.formId === currentSummary.formId && (
                            <p className="text-xs text-slate-600">
                              <strong>{currentSummary.draftDocumentLabel || 'IRU Pre-filled Draft — Review and Correct'}</strong>
                              {' · '}{t('draftVersion', 'Draft version')} {formDraftMeta.version} ({formDraftMeta.draftId})
                              {' · '}{new Date(formDraftMeta.generatedAt).toLocaleString()}
                              {' · '}{selectedDraftFreshness === 'current'
                                ? <span className="font-semibold text-green-700">{t('draftLatest', 'This is the latest version — use only this one.')}</span>
                                : <span className="font-semibold text-red-700">{t('pktPackageStale', 'Stale — your information changed after this draft was generated. Regenerate it and use only the latest version.')}</span>}
                            </p>
                          )}
                          {currentSummary.staleVersionNote && <p className="text-xs text-amber-800">{currentSummary.staleVersionNote}</p>}
                          {currentSummary.downloadedDraftNote && <p className="text-xs text-slate-500">{currentSummary.downloadedDraftNote}</p>}
                          {/* Pre-download review instructions (B2C §5.A) */}
                          {currentSummary.reviewInstructions && (
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                              <p className="font-semibold text-amber-900">{t('reviewBeforeDownload', 'Before you download — review this draft')}</p>
                              <ul className="list-disc pl-5 text-amber-900">
                                {currentSummary.reviewInstructions.map((r: string, i: number) => <li key={i}>{r}</li>)}
                              </ul>
                              {currentSummary.blankForm && (
                                <p className="mt-2 text-amber-900">
                                  {t('compareBlank', 'Compare it with the')} <button onClick={downloadBlankForm} className="underline font-semibold">{currentSummary.blankForm.label}</button>
                                  {' '}({currentSummary.blankForm.formId}, {t('formEdition', 'Edition')} {currentSummary.blankForm.editionDate}) — {t('officialSource', 'official source')}: <a href={currentSummary.blankForm.sourceUrl} target="_blank" rel="noreferrer" className="underline">{currentSummary.blankForm.sourceUrl}</a>
                                </p>
                              )}
                            </div>
                          )}
                          <div>
                            <p className="font-semibold">{t('formPopulated', 'Filled in from your information')} ({currentSummary.populated.length}):</p>
                            <ul className="list-disc pl-5">{currentSummary.populated.map((p: any, i: number) => <li key={i}>{p.label}: {p.value}</li>)}</ul>
                          </div>
                          {currentSummary.missingRequired.length > 0 && (
                            <div><p className="font-semibold">{t('formMissing', 'Still needed for this form')}:</p>
                            <ul className="list-disc pl-5">{currentSummary.missingRequired.map((m: any, i: number) => <li key={i}>{m.label}</li>)}</ul></div>
                          )}
                          {currentSummary.formatIssues && currentSummary.formatIssues.length > 0 && (
                            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                              <p className="font-semibold text-red-900">{t('formFormatIssues', 'Needs a format correction')}:</p>
                              <ul className="list-disc pl-5 text-red-900">{currentSummary.formatIssues.map((f: any, i: number) => <li key={i}>{f.message}</li>)}</ul>
                            </div>
                          )}
                          <div>
                            <p className="font-semibold">{t('formConsumerSections', 'You complete these parts yourself')}:</p>
                            <ul className="list-disc pl-5">{currentSummary.consumerCompletedSections.map((c: string, i: number) => <li key={i}>{c}</li>)}</ul>
                          </div>
                          {currentSummary.conditionalNotes && currentSummary.conditionalNotes.length > 0 && (
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1.5">
                              {currentSummary.conditionalNotes.map((n: any, i: number) => (
                                <p key={i} className="text-sm text-amber-900"><strong>{n.section}:</strong> {n.note}</p>
                              ))}
                            </div>
                          )}
                          <p className="text-xs text-slate-500">{t('formSignatureNote', 'No signature was added and nothing was submitted. Signing and filing are your responsibility, after your review.')}</p>
                          {/* Final review checklist (B2C §5.D) — the draft
                              is not presented as ready until every item
                              is confirmed. It is a review aid, not a
                              legal certification. */}
                          {currentSummary.finalReviewChecklist && (
                            <div className="border border-slate-300 rounded-lg p-3">
                              <p className="font-semibold text-slate-900">{t('finalChecklistTitle', 'Final review checklist')}</p>
                              {currentSummary.finalReviewChecklist.map((item: string, i: number) => (
                                <label key={i} className="flex items-start gap-2 mt-1.5 cursor-pointer">
                                  <input type="checkbox" checked={!!reviewChecks[i]} onChange={(e) => updateReviewChecks({ ...reviewChecks, [i]: e.target.checked })} className="mt-0.5" />
                                  <span>{item}</span>
                                </label>
                              ))}
                            </div>
                          )}
                          {/* Next steps, tailored to this form + findings (B2C §6) */}
                          {currentSummary.nextSteps && (
                            <div className="border border-indigo-200 bg-indigo-50 rounded-lg p-3 space-y-2">
                              <p className="font-bold text-slate-900">{currentSummary.nextSteps.title}</p>
                              <div>
                                <p className="font-semibold">{t('nsUnderstand', 'What this prepares — and what it does not')}</p>
                                <ul className="list-disc pl-5">{currentSummary.nextSteps.understand.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
                              </div>
                              <div>
                                <p className="font-semibold">{t('nsChecklist', 'Your checklist')}</p>
                                <ol className="list-decimal pl-5">{currentSummary.nextSteps.checklist.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol>
                              </div>
                              <p className="text-xs text-slate-600">{t('nsFullInPacket', 'The complete guidance — including preparing for professional help and finding verified resources — is in your printable packet below.')}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* ── Safe-Landing Hub (2026-10-24 fix): the same
                location-matched organizations the printable packet
                renders (resources state: local + statewide), shown on
                screen so the Next Steps text below — "the organizations
                under Safe-Landing Hub above" — points at a section that
                actually exists on this page. National directories are
                not duplicated here; they already render in Next Steps. ── */}
            <div className="mt-8 mb-8 text-left">
              <h3 className="text-lg font-serif font-bold text-slate-900 mb-2">{ui.localResources}</h3>
              {resourceResult?.isInternational ? (
                <div className="bg-blue-50 border border-blue-400 rounded-lg p-4 mb-4">
                  <p className="text-sm text-blue-900 font-semibold m-0">{t('intlResourcesNote', "You are located outside the United States. IRU's verified local directory covers parts of the U.S. only, so no local provider is shown — the U.S. national directories below can still help you find immigration legal help.")}</p>
                </div>
              ) : resourceResult?.fallback ? (
                <div className="bg-amber-50 border border-amber-400 rounded-lg p-4 mb-4">
                  <p className="text-sm text-amber-900 font-semibold m-0">
                    {answers.zip_code
                      ? t('pktNoProvidersZip', "No verified local providers found for ZIP {zip} in IRU's curated directory yet.").replace('{zip}', answers.zip_code)
                      : t('pktNoProvidersArea', "No verified local providers found for your area in IRU's curated directory yet.")}
                    {' '}{t('pktNoProvidersTail', 'The national directories below can help you find immigration legal aid in your area.')}
                  </p>
                </div>
              ) : null}
              {resources.length > 0 ? (
                <div className="space-y-3">
                  {resources.map((res: any) => {
                    const layerLabel = res.layer === 'statewide' ? t('pktLayerStatewide', 'Statewide') : (res.borough || t('pktLayerLocal', 'Local'));
                    const eligibilityText = localizedResourceText(res, 'eligibility', lang);
                    const servicesText = localizedResourceText(res, 'servicesOffered', lang);
                    const serviceAreaText = localizedResourceText(res, 'serviceArea', lang);
                    const transitText = localizedResourceText(res, 'transit', lang);
                    const exitText = localizedResourceText(res, 'exit', lang);
                    return (
                      <div key={res.name} className="relative p-5 border-2 border-indigo-100 bg-indigo-50 rounded-xl">
                        <span className="absolute top-0 right-0 bg-indigo-600 text-white text-xs font-bold px-3 py-1 rounded-bl-lg uppercase">{layerLabel}</span>
                        <h4 className="text-lg font-bold text-slate-900 mb-1 pr-16">{res.name}</h4>
                        <p className="text-slate-700 font-medium mb-1">{res.address}</p>
                        <p className="text-slate-700 font-medium mb-3"><span dir="ltr">{res.phone}</span></p>
                        {res.website && <p className="mb-3"><a href={res.website} target="_blank" rel="noreferrer" className="text-blue-700 underline text-sm">{res.website.replace(/^https?:\/\//, '')}</a></p>}
                        {servicesText && <p className="text-sm text-slate-700 mb-3"><strong>{t('pktServices', 'Services')}:</strong> {servicesText}</p>}
                        {eligibilityText && <p className="text-sm text-amber-900 bg-amber-100 px-3 py-2 rounded-md mb-3"><strong>{t('pktEligibility', 'Eligibility')}:</strong> {eligibilityText}</p>}
                        <p className="text-xs text-slate-500 italic mb-3">{t('pktServiceArea', 'Service area')}: {serviceAreaText}{res.legalRepresentation ? ` · ${t('pktLegalRep', 'Provides legal representation')}` : ''}</p>
                        {(res.lastVerified || res.sourceOfVerification) && (
                          <p className="text-xs text-slate-500 mb-3">
                            {res.lastVerified ? `${t('pktVerified', 'Verified')}: ${res.lastVerified}` : ''}{res.lastVerified && res.sourceOfVerification ? ' · ' : ''}{res.sourceOfVerification ? `${t('pktVerifiedSource', 'Source')}: ${res.sourceOfVerification}` : ''}
                          </p>
                        )}
                        {(transitText || exitText) && (
                          <div className="bg-white p-3 rounded-lg border border-indigo-200">
                            {transitText && <p className="text-sm font-semibold text-indigo-900 mb-1">🚇 {transitText}</p>}
                            {exitText && <p className="text-sm font-medium text-slate-600 m-0">🚶 {ui.subwayExit}: {exitText}</p>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-slate-500 italic text-sm">{t('pktNoResources', 'No specific resources found.')}</p>
              )}
            </div>

            {/* ── Your preparation package (defect-closure P3B): the
                on-screen counterpart of the packet's package section.
                Same per-form draft store, same freshness rule: a draft
                is enumerated as a current deliverable only while its
                bound fact snapshot matches the current record; a stale
                draft is labeled stale and is never downloadable here. ── */}
            <div className="mt-8 text-left border border-slate-200 bg-white rounded-xl p-5">
              <h3 className="text-base font-serif font-bold text-slate-900 mb-3">{t('pktPackageTitle', 'Your preparation package')}</h3>
              <ul className="text-sm text-slate-700 space-y-2.5">
                <li>{t('pktPackageReport', 'Readiness report — this document: your information on record, evidence review, and findings.')}</li>
                {FORM_REGISTRY.map((entry: any) => {
                  const d: any = draftForForm(formDraftStore, entry.id);
                  const freshness = d ? draftFreshness(d.meta, factRecord, entry) : 'none';
                  return (
                    <li key={entry.id}>
                      {d && freshness === 'current' ? (
                        <span>{t('pktPackageDraft', 'Prepared draft')}: {entry.id} — {t('formEdition', 'Edition')} {entry.editionDate} — {t('draftVersion', 'Draft version')} {d.meta.version}{d.meta.draftId ? ` (${d.meta.draftId})` : ''}{d.meta.generatedAt ? ` · ${new Date(d.meta.generatedAt).toLocaleString()}` : ''}</span>
                      ) : d ? (
                        <span className="text-red-700 font-medium">{t('pktPackageDraft', 'Prepared draft')}: {entry.id} — {t('pktPackageStale', 'Stale — your information changed after this draft was generated. Regenerate it and use only the latest version.')}</span>
                      ) : (
                        <span>{t('pktPackageDraft', 'Prepared draft')}: {entry.id} — {t('pktPackageNotGenerated', 'not generated yet')}</span>
                      )}
                      <br />
                      <span className="text-slate-500">{t('blankFormBtn', 'Official Blank Form — Reference Copy')}: {entry.id} — {t('formEdition', 'Edition')} {entry.editionDate}</span>
                    </li>
                  );
                })}
                <li>{t('pktPackageNextSteps', 'Your Next Steps — the section below, generated from your findings.')}</li>
              </ul>
              <p className="text-xs text-slate-500 italic mt-3">{t('pktPackageNote', 'Drafts are for your review only — not signed and not submitted. If you correct information after generating a draft, that draft becomes stale: regenerate it and use only the latest version.')}</p>
            </div>

            {/* ── Next steps (B2C §6) — the same section the printable
                packet carries, shown on screen. ── */}
            {(() => {
              const ns = buildPacketNextSteps();
              return (
                <div className="mt-8 mb-8 text-left border border-indigo-200 bg-indigo-50 rounded-xl p-5">
                  <h3 className="text-base font-serif font-bold text-slate-900 mb-3">{ns.title}</h3>
                  <p className="text-sm font-semibold text-slate-800 mb-1">{t('nsChecklist', 'Your ordered checklist')}</p>
                  <ol className="list-decimal pl-5 text-sm text-slate-700 space-y-1 mb-3">
                    {ns.checklist.map((s: string, i: number) => <li key={i}>{s}</li>)}
                  </ol>
                  <p className="text-sm text-slate-700 mb-2">{ns.resourcesIntro}</p>
                  <ul className="text-sm text-slate-700 space-y-1">
                    {ns.searchPaths.map((p: any) => (
                      <li key={p.name}><a href={p.url} target="_blank" rel="noreferrer" className="text-indigo-700 underline font-medium">{p.name}</a> — {p.description}</li>
                    ))}
                  </ul>
                  <p className="text-xs text-slate-500 mt-3">{t('nsFullNote', 'The full guidance — what this report does and does not establish, how to review your outputs, and preparing for professional help — is section-by-section in your printable packet.')}</p>
                </div>
              );
            })()}

            <div className="flex flex-col sm:flex-row justify-center items-center gap-4">
              <button
                onClick={openPrintablePacket}
                className="px-8 py-4 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors flex items-center space-x-2 shadow-lg w-full sm:w-auto justify-center"
              >
                <Printer className="w-5 h-5" />
                <span>{ui.openPrint}</span>
              </button>
              
              <button
                type="button"
                onClick={handleStartOver}
                className="px-8 py-4 text-slate-600 font-medium hover:bg-slate-100 rounded-xl transition-colors w-full sm:w-auto justify-center border border-slate-200"
              >
                {ui.startOver}
              </button>
            </div>
          </motion.div>
        )}
        </ErrorBoundary>
      </div>
      
      {stage === 'PACKET' && (
        <div className="mt-8 text-center max-w-2xl">
          <button onClick={copyRawHtml} className="inline-flex items-center space-x-2 text-slate-500 hover:text-slate-700 px-4 py-2 rounded-full text-sm font-medium transition-colors">
            <Copy className="w-4 h-4" />
            <span>{copied ? ui.copied : ui.copyHtml}</span>
          </button>
        </div>
      )}
      <div className="mt-12 text-center text-xs text-slate-400 uppercase tracking-widest relative z-10">
        Sanctuary Architect 20345 | Powered by Parametric Insight Engine
      </div>
    </div>
  );
}
