import React, { useState, useEffect } from 'react';
import { Shield, Globe, Printer, ArrowRight, ArrowLeft, CheckCircle2, Copy, Info } from 'lucide-react';
import { motion } from 'framer-motion';

import { LANGUAGES, UI_LABELS, PHASE_1_QUESTIONS, TRIAGE_QUESTION, PHASE_2_QUESTIONS, PHASE_3_QUESTIONS, NYC_RESOURCES, CONSULATES, PROXIES, NARRATIVE_STARTERS, USCIS_FORMS, FEE_SCHEDULE_AS_OF } from './constants';

// Nationwide layered resource model (local → statewide → national → fallback).
import { resolveResources, resolveResourcesForLocation, ResourceResult, ResourceOrg } from './resources';

// Country-aware location model (directive §3).
import { COUNTRIES, isUsCountry } from './location';

// Canonical fact record (directive §4) — one shared model for answers,
// document extraction, corrections, the packet, and form preparation.
import { createFactRecord, upsertFact, confirmFact, resolveConflict } from '../api/_lib/facts.js';
// Form engine (directive §7): registry + mapper run client-side for the
// review UI; the PDF itself is generated server-side from the same record.
import { FORM_REGISTRY, getFormEntry } from '../api/_lib/forms/registry.js';
import { buildFillPlan, splitFullName } from '../api/_lib/formmap.js';
// Personal Narrative as a first-class stage (successive directive §4):
// chronology + issue analysis + applicant approval gate for form use.
import { createNarrative, addNarrativeEvent, analyzeNarrative, approveNarrative, correctNarrativeEvent, confirmNarrativeEvent, narrativeForPacket } from '../api/_lib/narrative.js';
import { readAnalyzeStream } from '../api/_lib/sse.js';

// B2C pricing + next steps (2026-10-21 directive): the SAME modules the
// server enforces with, so what the consumer is shown is what the
// server charges and what every output must contain.
import { PRICING, SKUS, buildOffer, formatCents } from '../api/_lib/pricing.js';
import { NEXT_STEPS_TITLE, PROFESSIONAL_HELP_POINTS, RESOURCE_SEARCH_PATHS } from '../api/_lib/nextsteps.js';

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
import { EVIDENCE_KB, requiresLegalReview, legalReviewReason, nextActionFor } from '../api/_lib/evidence.js';

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
  'has_proof_of_relationship', 'has_arrests', 'narrative_text',
]);

function stripForServer(answers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(answers)) {
    if (SERVER_FIELD_ALLOWLIST.has(k)) out[k] = answers[k];
  }
  return out;
}

export default function App() {
  const [lang, setLang] = useState('EN');
  const [stage, setStage] = useState<'LANG' | 'PHASE1' | 'TRIAGE' | 'PHASE2' | 'PHASE3' | 'PHASE4' | 'PHOTO' | 'ANALYZING' | 'PACKET'>('LANG');
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [resources, setResources] = useState<any[]>([]);
  const [resourceResult, setResourceResult] = useState<ResourceResult | null>(null);
  const [consulate, setConsulate] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const [assessment, setAssessment] = useState<any>(null);
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const [isNycCoverage, setIsNycCoverage] = useState(true);
  // Optional one-time document photo review (never persisted server-side).
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoEvidenceKey, setPhotoEvidenceKey] = useState('');
  const [imageReview, setImageReview] = useState<any>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState('');
  // Canonical fact record + form preparation (directives §4/§7/§8).
  const [factRecord, setFactRecord] = useState<any>(null);
  const [narrativeError, setNarrativeError] = useState('');
  const [narrativeDates, setNarrativeDates] = useState<Record<string, string>>({});
  const [selectedFormId, setSelectedFormId] = useState<string>('');
  const [formSummary, setFormSummary] = useState<any>(null);
  const [formPdfBase64, setFormPdfBase64] = useState<string>('');
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [formAnswers, setFormAnswers] = useState<Record<string, string>>({});
  // Form review (B2C §5): version identification + final-review checklist.
  const [formDraftMeta, setFormDraftMeta] = useState<{ draftId: string; generatedAt: string; version: number; formId: string } | null>(null);
  const [reviewChecks, setReviewChecks] = useState<Record<number, boolean>>({});
  // Purchase state for the offer panel (B2C §3), refreshed from the
  // server-side entitlement status of the tokens this browser holds.
  const [purchaseState, setPurchaseState] = useState<{ hasEvaluation: boolean; ownedForms: string[] }>({ hasEvaluation: false, ownedForms: [] });
  const [checkoutBusy, setCheckoutBusy] = useState(false);

  // Purchase state is refreshed from the server whenever the packet
  // (and its offer/form panels) is shown.
  useEffect(() => {
    if (stage === 'PACKET') { refreshPurchaseState(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  /** Plain-text rendering of the structured assessment for the packet. */
  const renderAssessmentText = (a: any): string => {
    if (aiUnavailable) {
      return 'AI analysis unavailable. Showing rule-based findings from your intake answers.\n\n' +
        (a?.readinessSummary || 'The automated readiness review could not be completed. Please present your packet to a qualified legal professional.');
    }
    if (!a) return 'Analysis could not be generated.';
    const section = (title: string, items: string[]) =>
      items && items.length > 0 ? `${title}:\n${items.map(i => `\u2022 ${i}`).join('\n')}` : '';
    return [
      a.readinessSummary || '',
      section('Information provided', a.factsProvided),
      section('Missing information', a.missingInformation),
      section('Contradictions to resolve', a.contradictions),
      section('Suggested questions for your legal consultation', a.suggestedQuestions),
      section('Uncertainty notes', a.uncertaintyNotes),
      a.notLegalAdvice || '',
    ].filter(Boolean).join('\n\n');
  };

  const ui = UI_LABELS[lang] || UI_LABELS['EN'];
  // New-feature strings: translated for EN/ES; other languages fall back to English.
  const t = (key: string, fallback: string) => (ui[key] as string) || fallback;

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
      'has_proof_of_relationship', 'has_arrests',
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

  const getQuestionsForStage = () => {
    if (stage === 'PHASE1') return PHASE_1_QUESTIONS;
    if (stage === 'TRIAGE') return [TRIAGE_QUESTION];
    if (stage === 'PHASE2') return PHASE_2_QUESTIONS[answers.case_type || 'asylum'] || [];
    if (stage === 'PHASE3') return PHASE_3_QUESTIONS;
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
      setCurrentQ(PHASE_3_QUESTIONS.length - 1);
    } else if (currentQ > 0) {
      setCurrentQ(currentQ - 1);
    } else {
      if (stage === 'PHASE3') {
        setStage('PHASE2');
        setCurrentQ((PHASE_2_QUESTIONS[answers.case_type || 'asylum'] || []).length - 1);
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

  /** One-time document photo review. The image is sent once and never stored by IRU. */
  const handlePhotoReview = async () => {
    if (!photoFile || reviewing) return;
    setReviewError('');
    setImageReview(null);
    if (photoFile.size > 4 * 1024 * 1024) {
      setReviewError(ui.photoError || 'Review unavailable.');
      return;
    }
    setReviewing(true);
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(photoFile);
      });
      const imageBase64 = dataUrl.split(',')[1] || '';
      const response = await fetch('/api/review-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64,
          mimeType: photoFile.type || 'image/jpeg',
          relatedEvidenceKey: photoEvidenceKey || undefined,
        }),
      });
      if (!response.ok) throw new Error(`Server error: ${response.status}`);
      const data = await response.json();
      if (data && data.ok && data.review) {
        setImageReview(data.review);
      } else {
        throw new Error('Bad review response');
      }
    } catch (e) {
      console.error('Photo review error:', e);
      setReviewError(ui.photoError || 'Review unavailable. You can continue without it.');
    } finally {
      setReviewing(false);
    }
  };

  // ── Complete reset ───────────────────────────────────────────────────────
  const handleStartOver = () => {
    setStage('LANG');
    setAnswers({});
    setCurrentQ(0);
    setImageReview(null);
    setPhotoFile(null);
    setReviewError('');
    setAssessment(null);
    setAiUnavailable(false);
    setIsNycCoverage(true);
    setResourceResult(null);
    setFactRecord(null);
    setSelectedFormId('');
    setFormSummary(null);
    setFormPdfBase64('');
    setFormError('');
    setFormAnswers({});
    setPhotoEvidenceKey('');
    setConsulate(null);
    setResources([]);
    setCopied(false);
    setFormDraftMeta(null);
    setReviewChecks({});
    setPurchaseState({ hasEvaluation: false, ownedForms: [] });
  };

  // ── Facts: consumer confirmation / conflict resolution / correction (§8).
  // Every mutation goes through the canonical record; derived outputs are
  // marked stale by the record itself and the UI offers regeneration.
  const applyFactMutation = (mutate: (rec: any) => void) => {
    if (!factRecord) return;
    const next = JSON.parse(JSON.stringify(factRecord));
    mutate(next);
    setFactRecord(next);
    // A previously generated form draft no longer matches the record:
    // it is stale, so it is withdrawn and the review state resets.
    setFormSummary(null);
    setFormPdfBase64('');
    setFormDraftMeta(null);
    setReviewChecks({});
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
      setFormSummary(null);
      setFormPdfBase64('');
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
    setFormSummary(null);
    setFormPdfBase64('');
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      // The entitlement that covers THIS form (B2C scoped grants), with
      // the legacy single-token key as fallback.
      const formTokens = loadFormTokens();
      const savedToken = formTokens[selectedFormId] || sessionStorage.getItem('iru_entitlement_token');
      if (savedToken) headers['x-entitlement-token'] = savedToken;
      const resp = await fetch('/api/generate-form', {
        method: 'POST',
        headers,
        body: JSON.stringify({ formId: selectedFormId, factRecord }),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data || !data.ok) {
        throw new Error((data && data.error) || `Server error: ${resp.status}`);
      }
      setFormSummary(data.summary);
      setFormPdfBase64(data.pdfBase64);
      // Version identification (B2C §5.C): every generation is a new,
      // distinguishable draft; only the latest is current.
      setFormDraftMeta((prev) => ({
        draftId: data.draftId || '',
        generatedAt: data.generatedAt || new Date().toISOString(),
        version: (prev && prev.formId === selectedFormId ? prev.version : 0) + 1,
        formId: selectedFormId,
      }));
      setReviewChecks({});
    } catch (e: any) {
      setFormError(e && e.message ? e.message : 'Form generation unavailable.');
    } finally {
      setFormBusy(false);
    }
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
      const resp = await fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data || !data.checkoutUrl) throw new Error((data && data.error) || 'Checkout unavailable.');
      // Keep the buyer's credential(s) for the return + later delivery.
      if (data.sku === SKUS.EVALUATION) {
        sessionStorage.setItem('iru_evaluation_token', data.entitlementToken);
      } else if (data.scope && data.scope.kind === 'forms' && Array.isArray(data.scope.forms)) {
        for (const f of data.scope.forms) saveFormToken(f, data.entitlementToken);
      } else {
        sessionStorage.setItem('iru_entitlement_token', data.entitlementToken);
        sessionStorage.setItem('iru_entitlement_id', data.entitlementId);
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
    const bytes = Uint8Array.from(atob(formPdfBase64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedFormId}-DRAFT.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const handleInterviewComplete = async () => {
    setStage('ANALYZING');
    // Country-aware layered resolution (§3.3): ZIP/postal selects resources
    // only — it never gates the federal readiness workflow. Non-U.S. users
    // get honestly-labeled national directories, never a U.S. org as "local".
    const residenceCountry = answers.residence_country || 'US';
    const result = resolveResourcesForLocation({
      country: residenceCountry,
      postalCode: residenceCountry === 'US' ? (answers.zip_code || '') : (answers.residence_postal_code || ''),
      region: answers.residence_region || '',
      city: answers.residence_city || '',
    });
    setResourceResult(result);
    // One canonical fact record for the packet and form preparation (§4).
    const record = buildFactRecord(answers, imageReview);
    setFactRecord(record);
    setIsNycCoverage(result.isNycCoverage);
    // Flatten verified orgs for the packet renderer (local first, then statewide).
    setResources([...result.local, ...result.statewide]);

    const country = (answers.country_of_origin || '').toLowerCase().trim();
    if (country && CONSULATES[country]) setConsulate(CONSULATES[country]);

    try {
      const narrativeStarters = NARRATIVE_STARTERS
        .filter(s => answers[s.id] === 'yes')
        .map(s => s.labels['EN']);

      // Privacy: strip direct identifiers before any network call.
      const serverAnswers = stripForServer(answers);

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
          imageReviews: imageReview ? [imageReview] : [],
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
      const { assessment: finalAssessment, aiUnavailable: streamAiUnavailable } =
        await readAnalyzeStream(response.body!.getReader());
      if (streamAiUnavailable) {
        // AI failed; fallback assessment provided but marked as unavailable
        setAiUnavailable(true);
      }
      setAssessment(finalAssessment);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        console.error('AI request timed out after 90s');
      } else {
        console.error('AI Generation Error:', error);
      }
      setAssessment(null);
    }

    setStage('PACKET');
  };

  const generateExecutiveSummary = () => {
    const name = answers.full_name || "The applicant";
    const country = answers.country_of_origin || "their home country";
    const caseType = answers.case_type === 'asylum' ? "asylum" : answers.case_type === 'family' ? "a family petition" : "citizenship";
    const entry = answers.entry_date ? `entered the United States on ${answers.entry_date}` : "entered the United States on an unspecified date";
    const residenceCountry = answers.residence_country || 'US';
    const residence = residenceCountry === 'US'
      ? `They reside in the ${answers.zip_code || 'unspecified'} zip code area`
      : `They currently live in ${answers.residence_city ? answers.residence_city + ', ' : ''}${residenceCountry}`;
    return `${name}, originally from ${country}, ${entry} and is currently seeking ${caseType}. ${residence} and have completed an initial evidence audit to prepare for their legal consultation.`;
  };

  const calculateReadinessScore = () => {
    let score = 0;
    let total = 0;
    const check = (key: string) => {
      if (answers[key]) {
        total++;
        if (answers[key] === 'yes') {
          score++;
        } else if (PROXIES[key]) {
          const selectedProxies = PROXIES[key].items.filter((i: any) => answers[i.id] === 'yes');
          if (selectedProxies.length > 0) {
            score += 0.5;  // Secondary docs carry half weight vs primary
          }
        }
      }
    };
    // NOTE: has_arrests is deliberately excluded from positive scoring —
    // having an arrest record is not "readiness". It is surfaced separately
    // as a flag to discuss with counsel (see triage table).
    ['has_passport', 'has_i94', 'has_lease', 'has_persecution_proof', 'has_green_card', 'has_tax_transcripts', 'has_marriage_cert', 'has_proof_of_relationship'].forEach(check);
    return { score, total: total || 1 };
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
   * search paths; no eligibility determination, no guarantee. English
   * body text, following the packet's established pattern for guidance
   * content (the evidence-gap knowledge base is likewise English with
   * a note); UI chrome strings go through t().
   */
  const buildPacketNextSteps = () => {
    const conflicts = factRecord ? Object.values(factRecord.facts).filter((f: any) => f.status === 'conflicted').length : 0;
    const unconfirmed = factRecord ? Object.values(factRecord.facts).filter((f: any) => f.status === 'reported-unconfirmed').length : 0;
    const pct = assessment && typeof assessment.readinessPercent === 'number' ? assessment.readinessPercent : null;
    const understand: string[] = [
      `This report organizes the information you provided for your ${(assessment && assessment.caseType) || answers.case_type || 'immigration'} preparation and identifies what still needs attention. It is based only on your answers and documents — nothing was independently verified.`,
      ...(pct !== null
        ? [`Your readiness estimate is ${pct}%. It is an approximate document-completeness heuristic — not a probability, a score of your chances, or a prediction of any outcome.`]
        : []),
      `The evidence review identified ${Object.keys(EVIDENCE_KB).filter((k) => answers[k] && answers[k] !== 'yes').length} item(s) to address, listed above in priority order.`,
      ...(conflicts > 0 ? [`${conflicts} item(s) in your information are in conflict between sources and are listed above — resolve them before relying on any output.`] : []),
      ...(unconfirmed > 0 ? [`${unconfirmed} value(s) came from your documents and still need your confirmation.`] : []),
      'This report does not decide whether you are eligible for any immigration benefit, and it does not predict or guarantee any outcome.',
      'Preparation assistance is not legal advice, and IRU is not a law firm. Nothing has been signed, filed, or submitted on your behalf.',
    ];
    const review: string[] = formSummary
      ? [
          `Your latest form output is the ${formSummary.formId} draft (Edition ${formSummary.editionDate}), labeled "IRU Pre-filled Draft — Review and Correct". Earlier downloads of the same form are stale once your information changes — use only the latest version.`,
          `Compare the draft with the "Official Blank Form — Reference Copy" (${formSummary.formId}, Edition ${formSummary.editionDate}${formSummary.blankForm ? `, ${formSummary.blankForm.sourceUrl}` : ''}) and with your own records before any use.`,
          'Confirm the current edition, instructions, fee, and filing address on the official form page before you use the form — official requirements change.',
        ]
      : [
          'No form draft was generated in this session. If you prepare a form, compare the pre-filled draft with the official blank form and your own records before any use, and confirm the current edition, instructions, fee, and filing address on the official USCIS form page.',
        ];
    const verifiedOrgs = resourceResult && !resourceResult.isInternational ? (resourceResult.local || []) : [];
    const resourcesIntro = verifiedOrgs.length > 0
      ? 'The organizations under "Local Resources" above were matched by IRU to the location you provided. IRU does not guarantee their availability, cost, capacity, or acceptance of your case. The directories below are additional general starting points.'
      : resourceResult && resourceResult.isInternational
        ? 'You are located outside IRU\u2019s U.S. resource coverage area, so no U.S. organization is presented as local to you. Use the general directories below to find qualified help that serves your situation, and confirm any deadline or filing question with an official source or a qualified professional.'
        : 'No verified local organization was matched for this report. The directories below are general starting points for finding qualified help — inclusion is not a recommendation, and availability is not guaranteed.';
    const checklist: string[] = [
      ...(conflicts > 0 ? [`Resolve the ${conflicts} conflicting item(s) in your information, then regenerate any affected outputs.`] : []),
      ...(unconfirmed > 0 ? [`Confirm the ${unconfirmed} document-provided value(s) marked as needing confirmation.`] : []),
      'Work through the evidence gaps above in priority order; for each one, use the listed primary evidence or an accepted alternative.',
      ...(formSummary
        ? [`Review your ${formSummary.formId} draft field by field against the official blank form and your records; correct mistakes in your information and regenerate so you hold only the latest version.`]
        : ['If you prepare a form draft, review it field by field before any use.']),
      'Confirm the current form editions, instructions, fees, and any deadline that may apply to you with an official source (uscis.gov) or a qualified professional.',
      'If you consult an attorney or accredited representative, bring this report and your latest draft version.',
    ];
    return { title: NEXT_STEPS_TITLE, understand, review, professionalHelp: PROFESSIONAL_HELP_POINTS as string[], resourcesIntro, searchPaths: RESOURCE_SEARCH_PATHS, checklist };
  };

  const generateHtml = () => {
    const { score, total } = calculateReadinessScore();
    const readinessPercent = Math.round((score / total) * 100);

    const resourcesHtml = resources.map((res: ResourceOrg) => {
      const layerLabel = res.layer === 'statewide' ? 'Statewide' : (res.borough || 'Local');
      const eligibilityHtml = res.eligibility
        ? `<p style="font-size: 0.875rem; color: #92400e; background-color: #fef3c7; padding: 0.5rem 0.75rem; border-radius: 0.375rem; margin: 0 0 0.75rem 0;"><strong>Eligibility:</strong> ${escapeHtml(res.eligibility)}</p>`
        : '';
      const servicesHtml = res.servicesOffered
        ? `<p style="font-size: 0.875rem; color: #334155; margin: 0 0 0.75rem 0;"><strong>Services:</strong> ${escapeHtml(res.servicesOffered)}</p>`
        : '';
      const transitHtml = (res.transit || res.exit)
        ? `<div style="background-color: white; padding: 1rem; border-radius: 0.5rem; border: 1px solid #c7d2fe; margin-bottom: 1rem;">
          ${res.transit ? `<p style="font-size: 0.875rem; font-weight: 600; color: #312e81; margin: 0 0 0.5rem 0;">🚇 ${escapeHtml(res.transit)}</p>` : ''}
          ${res.exit ? `<p style="font-size: 0.875rem; font-weight: 500; color: #475569; margin: 0;">🚶 ${escapeHtml(ui.subwayExit)}: ${escapeHtml(res.exit)}</p>` : ''}
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
        <p style="color: #334155; margin: 0 0 0.75rem 0; font-weight: 500;">${escapeHtml(res.phone)}</p>
        ${websiteHtml}
        ${servicesHtml}
        ${eligibilityHtml}
        <p style="font-size: 0.8rem; color: #64748b; margin: 0 0 0.75rem 0; font-style: italic;">Service area: ${escapeHtml(res.serviceArea)}${res.legalRepresentation ? ' · Provides legal representation' : ''}</p>
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
        <p style="margin: 0; font-size: 0.85rem; color: #475569;">${escapeHtml(dir.description)}</p>
      </div>
    `).join('');

    const triageRows: string[] = [];
    let hasAlternatives = false;
    const badge = (text: string, kind: 'green' | 'red' | 'amber' | 'gray') => {
      const styles: Record<string, string> = {
        green: 'background-color: #dcfce7; color: #166534;',
        red: 'background-color: #fee2e2; color: #991b1b;',
        amber: 'background-color: #fef3c7; color: #92400e;',
        gray: 'background-color: #f1f5f9; color: #475569;',
      };
      return `<span class="status-green" style="${styles[kind]}">${escapeHtml(text)}</span>`;
    };
    /**
     * Honest evidence states (mirrors api/_lib/evidence.js resolveState):
     * - "yes" → reported, NOT verified (amber — never green "ready")
     * - "no" → action required; self-reported alternatives listed as
     *   alternatives, never as verification
     * - "unknown" → unknown
     * Nothing the system has not reviewed is ever styled as ready.
     */
    const addRow = (item: string, key: string, nextStepYes: string, nextStepNo: string) => {
      if (!answers[key]) return;
      const ans = answers[key];
      const st = ui.evidenceStates || {};
      let statusHtml: string;
      let nextStepHtml: string;
      if (ans === 'yes') {
        statusHtml = badge(st.reportedNotVerified || 'Reported — not verified', 'amber');
        nextStepHtml = nextStepYes;
      } else if (ans === 'unknown') {
        statusHtml = badge(st.unknown || 'Unknown', 'gray');
        nextStepHtml = nextStepNo;
      } else {
        statusHtml = badge(st.actionRequired || 'Action required', 'red');
        const selectedProxies = (PROXIES[key]?.items || []).filter((i: any) => answers[i.id] === 'yes');
        if (selectedProxies.length > 0) {
          hasAlternatives = true;
          const proxyNames = selectedProxies.map((i: any) => escapeHtml(i.label[lang])).join(', ');
          nextStepHtml = `${escapeHtml(st.alternativeIdentified || ui.alternativesReported || 'Alternatives reported')}: ${proxyNames}. ${escapeHtml(ui.alternativesNotReviewed || '')}`;
        } else {
          nextStepHtml = nextStepNo;
        }
      }
      const legalNote = requiresLegalReview(key)
        ? `<div style="margin-top:0.5rem;font-size:0.75rem;color:#92400e;font-weight:600;">⚖️ ${escapeHtml(st.legalReviewRequired || 'Needs qualified legal review')}</div>`
        : '';

      triageRows.push(`
          <tr>
            <td style="font-weight: 500;">${escapeHtml(item)}</td>
            <td>${statusHtml}</td>
            <td style="color: #64748b;">${nextStepHtml}${legalNote}</td>
          </tr>
        `);
    };

    addRow('Passport', 'has_passport', 'Photo-Vault & Email to self', consulate ? `Visit ${consulate.name} at ${consulate.address}` : 'Locate alternative ID');
    addRow('I-94 Record', 'has_i94', 'Photo-Vault & Email to self', 'Retrieve digitally at i94.cbp.dhs.gov');
    addRow('Formal Lease', 'has_lease', 'Photo-Vault & Email to self', 'Gather alternative residence documents');
    addRow('Proof of Persecution', 'has_persecution_proof', 'Photo-Vault & Email to self', 'Begin gathering photos, reports, or witness letters');
    addRow('Green Card', 'has_green_card', 'Photo-Vault & Email to self', 'Locate or request replacement');
    addRow('Tax Transcripts', 'has_tax_transcripts', 'Photo-Vault & Email to self', 'Request from IRS.gov');
    addRow('Marriage/Divorce Certs', 'has_marriage_cert', 'Photo-Vault & Email to self', 'Request from vital records');
    addRow('Proof of Relationship', 'has_proof_of_relationship', 'Photo-Vault & Email to self', 'Gather photos, joint accounts');
    addRow('Certificates of Disposition', 'has_arrests', 'Photo-Vault & Email to self', 'Request from criminal court');

    // Evidence Gaps & Alternatives section — rendered from the server-side KB.
    // Alternatives are per-item with supports/limitations; nothing is marked ready.
    const gapKeys = Object.keys(EVIDENCE_KB).filter(k => answers[k] && answers[k] !== 'yes');
    const gapSectionHtml = gapKeys.length > 0 ? `
        <div class="section">
          <h3 class="section-title font-serif">${escapeHtml(ui.gapSectionTitle || 'Evidence Gaps & Alternatives')}</h3>
          ${gapKeys.map(k => {
            const kb: any = (EVIDENCE_KB as any)[k];
            if (!kb) return '';
            const na = nextActionFor(k, answers[k]);
            const legalFlag = requiresLegalReview(k)
              ? `<p style="font-size:0.875rem;color:#92400e;font-weight:600;">⚖️ ${escapeHtml(legalReviewReason(k) || '')}</p>`
              : '';
            // Cross-reference the standalone Document Photo Review section when
            // the uploaded photo was reviewed for this gap — avoids duplicating
            // the findings here while showing the integration.
            const imageRef = (imageReview && imageReview.relatedReadinessItem === k)
              ? `<p style="font-size:0.875rem;color:#4f46e5;background-color:#eef2ff;border-radius:0.5rem;padding:0.75rem 1rem;margin:0 0 0.5rem 0;">📷 ${escapeHtml(ui.imageInformedGap || 'An uploaded photo was reviewed for this item. The observations informed the guidance above — nothing has been verified.')}</p>`
              : '';
            return `
            <div style="border: 1px solid #e2e8f0; border-radius: 0.75rem; padding: 1.25rem; margin-bottom: 1rem; background-color: #fffbeb;">
              <h4 style="margin: 0 0 0.5rem 0; font-size: 1rem; font-weight: 700; color: #0f172a;">${escapeHtml(EVIDENCE_ITEM_NAMES[k] || k)} — ${escapeHtml(answers[k] === 'unknown' ? (ui.evidenceStates?.unknown || 'Unknown') : (ui.evidenceStates?.actionRequired || 'Action required'))}</h4>
              <p style="margin: 0 0 0.5rem 0; font-size: 0.875rem; color: #334155;"><strong>Target fact:</strong> ${escapeHtml(kb.targetFact)}</p>
              <p style="margin: 0 0 0.5rem 0; font-size: 0.875rem; color: #334155;"><strong>Primary evidence:</strong> ${escapeHtml(kb.primaryEvidence)}</p>
              <ul style="margin: 0 0 0.5rem 0; padding-left: 1.25rem; font-size: 0.875rem; color: #334155;">
                ${kb.alternatives.map((a: any) => `
                <li style="margin-bottom: 0.5rem;">
                  <strong>${escapeHtml(a.label)}</strong><br/>
                  <span>${escapeHtml(ui.gapMaySupport || 'May help show')}: ${escapeHtml(a.supports)}</span><br/>
                  <span>${escapeHtml(ui.gapCannotShow || 'Cannot show by itself')}: ${escapeHtml(a.limitations)}</span>
                </li>`).join('')}
              </ul>
              <p style="margin: 0 0 0.5rem 0; font-size: 0.875rem; color: #334155;"><strong>${escapeHtml(ui.gapNextAction || 'Next step')}:</strong> ${escapeHtml(na.step)} <em>(${(na.responsible || '')}, ${(na.priority || '')} priority)</em></p>
              ${imageRef}
              ${legalFlag}
            </div>`;
          }).join('')}
          <p style="font-size: 0.8rem; color: #64748b; font-style: italic;">Alternative descriptions are in English. Ask your legal representative to explain any item you do not understand.</p>
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
    const factStatusLabel = (f: any) => f.status === 'conflicting' ? 'Sources disagree — needs your decision'
      : f.status === 'extracted-unconfirmed' ? 'From your document — not yet confirmed by you'
      : f.source === 'document' ? 'From your document — confirmed by you' : 'Provided by you';
    const factRows = factRecord ? Object.values(factRecord.facts)
      .filter((f: any) => f && f.value && FACT_DISPLAY_NAMES[f.id])
      .map((f: any) => `<tr><td style="font-weight:500;">${escapeHtml(FACT_DISPLAY_NAMES[f.id])}</td><td>${escapeHtml(String(f.value))}</td><td style="color:#64748b;">${escapeHtml(factStatusLabel(f))}</td></tr>`).join('') : '';
    const factsSectionHtml = factRows ? `
        <div class="section">
          <h3 class="section-title font-serif">${escapeHtml(t('factsTitle', 'Your Information on Record'))}</h3>
          <table><thead><tr><th>Item</th><th>Value</th><th>Status</th></tr></thead><tbody>${factRows}</tbody></table>
          <p style="font-size:0.8rem;color:#64748b;font-style:italic;">Document-extracted values show what a document contains; they are not proof of authenticity. Correct anything that is wrong before relying on it.</p>
        </div>` : '';

    // Next steps (B2C §6) — part of THIS report, not a separate document.
    const ns = buildPacketNextSteps();
    const li = (items: string[]) => items.map(s => `<li style="margin-bottom:0.35rem;">${escapeHtml(s)}</li>`).join('');
    const nextStepsHtml = `
        <div class="section">
          <h3 class="section-title font-serif">${escapeHtml(ns.title)}</h3>
          <h4 style="font-size:1rem;font-weight:700;margin:0 0 0.5rem;">A. What this report does — and does not — establish</h4>
          <ul style="margin:0 0 1rem;padding-left:1.25rem;font-size:0.875rem;color:#334155;">${li(ns.understand)}</ul>
          <h4 style="font-size:1rem;font-weight:700;margin:0 0 0.5rem;">B. How to review your information and any form output</h4>
          <ul style="margin:0 0 1rem;padding-left:1.25rem;font-size:0.875rem;color:#334155;">${li(ns.review)}</ul>
          <h4 style="font-size:1rem;font-weight:700;margin:0 0 0.5rem;">C. Preparing for professional help</h4>
          <ul style="margin:0 0 1rem;padding-left:1.25rem;font-size:0.875rem;color:#334155;">${li(ns.professionalHelp)}</ul>
          <h4 style="font-size:1rem;font-weight:700;margin:0 0 0.5rem;">D. Finding additional help</h4>
          <p style="margin:0 0 0.5rem;font-size:0.875rem;color:#334155;">${escapeHtml(ns.resourcesIntro)}</p>
          <ul style="margin:0 0 1rem;padding-left:1.25rem;font-size:0.875rem;color:#334155;">
            ${ns.searchPaths.map(p => `<li style="margin-bottom:0.35rem;"><strong>${escapeHtml(p.name)}</strong> — ${escapeHtml(p.description)}<br/><span style="color:#64748b;">${escapeHtml(p.url)}</span></li>`).join('')}
          </ul>
          <h4 style="font-size:1rem;font-weight:700;margin:0 0 0.5rem;">E. Your ordered checklist</h4>
          <ol style="margin:0;padding-left:1.25rem;font-size:0.875rem;color:#334155;">${li(ns.checklist)}</ol>
        </div>`;

    const selectedStarters = NARRATIVE_STARTERS.filter(s => answers[s.id] === 'yes').map(s => s.labels[lang as keyof typeof s.labels]);
    const narrativeText = answers.narrative_text || '';
    const hasNarrative = selectedStarters.length > 0 || narrativeText.trim().length > 0;

    return `
      <!DOCTYPE html>
      <html lang="en">
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
            ${ui.readinessScore}: ${readinessPercent}% <span style="font-weight:400;font-size:0.75rem;">(approximate document-completeness heuristic \u2014 not a validated metric)</span>
          </div>
        </div>
        <div class="section">
          <h3 class="section-title font-serif">${escapeHtml(ui.readinessReview || 'Readiness Review')}</h3>
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
            <p style="margin: 0 0 0.75rem; font-size: 0.8rem; font-weight: 600; color: #475569;">${escapeHtml(narrativeForPacket(factRecord.narrative, factRecord)?.label || '')}</p>
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
            <p style="margin: 0 0 0.5rem 0;"><strong>Category:</strong> ${escapeHtml(String(imageReview.documentCategory || ''))}</p>
            <p style="margin: 0 0 0.5rem 0;"><strong>Legibility:</strong> ${escapeHtml(String(imageReview.legibility || ''))} &nbsp; <strong>Appears complete:</strong> ${escapeHtml(String(imageReview.appearsComplete || ''))}</p>
            ${(imageReview.inconsistencies || []).length > 0 ? `<ul style="margin: 0 0 0.5rem 0; padding-left: 1.25rem;">${(imageReview.inconsistencies || []).map((x: any) => `<li>${escapeHtml(String(x))}</li>`).join('')}</ul>` : ''}
            ${(imageReview.limitations || []).length > 0 ? `<ul style="margin: 0; padding-left: 1.25rem; color: #64748b;">${(imageReview.limitations || []).map((x: any) => `<li>${escapeHtml(String(x))}</li>`).join('')}</ul>` : ''}
            <p style="margin: 0.75rem 0 0 0; font-size: 0.8rem; color: #64748b; font-style: italic;">${escapeHtml(ui.photoPrivacy || '')} This review does not establish authenticity or legal sufficiency.</p>
          </div>
        </div>` : ''}
        <div class="section">
          <h3 class="section-title font-serif">${ui.localResources}</h3>
          ${resourceResult?.isInternational ? `<div style="background-color: #eff6ff; border: 1px solid #3b82f6; border-radius: 0.5rem; padding: 1rem; margin-bottom: 1rem;">
            <p style="font-size: 0.875rem; color: #1e40af; margin: 0; font-weight: 600;">
              ${escapeHtml(t('intlResourcesNote', "You are located outside the United States. IRU's verified local directory covers parts of the U.S. only, so no local provider is shown — the U.S. national directories below can still help you find immigration legal help."))}
            </p>
          </div>` : resourceResult?.fallback ? `<div style="background-color: #fef3c7; border: 1px solid #f59e0b; border-radius: 0.5rem; padding: 1rem; margin-bottom: 1rem;">
            <p style="font-size: 0.875rem; color: #92400e; margin: 0; font-weight: 600;">
              ${answers.zip_code
                ? `No verified local providers found for ZIP ${escapeHtml(answers.zip_code)} in IRU's curated directory yet.`
                : 'No verified local providers found for your area in IRU\'s curated directory yet.'}
              The national directories below can help you find immigration legal aid in your area.
            </p>
          </div>` : ''}
          ${resourcesHtml || '<p style="color: #64748b; font-style: italic;">No specific resources found.</p>'}
          ${nationalDirsHtml ? `<h4 style="font-size: 1rem; font-weight: 700; color: #0f172a; margin: 1.5rem 0 0.75rem 0;">National Directories</h4>${nationalDirsHtml}` : ''}
        </div>
        ${nextStepsHtml}
        <div class="footer">
          ${hasAlternatives ? `<p style="font-size: 0.875rem; font-weight: 600; color: #92400e; background-color: #fef3c7; padding: 1rem; border-radius: 0.5rem; margin-bottom: 1rem; text-align: left;">${ui.noteForLegalCounsel}</p>` : ''}
          <p>${ui.privacyShield}</p>
          <small>${ui.disclaimer}</small>
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
      alert("Please allow pop-ups to print your Readiness Packet.");
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

  return (
    <div className="min-h-screen flex flex-col items-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl w-full text-center mb-8">
        <img src="/seal.png" alt="SMRG - Saint Martin Revenue Group" className="w-24 h-24 mx-auto mb-6 object-contain" />
        <h1 className="text-4xl font-serif font-bold text-slate-900 mb-4 tracking-tight">
          {ui.title}
        </h1>
        <p className="text-lg text-slate-600 font-medium">
          {ui.subtitle}
        </p>
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

      <div className="max-w-3xl w-full bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        {stage === 'LANG' && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="p-8 sm:p-12"
          >
            <div className="text-center mb-8">
              <Globe className="w-12 h-12 text-indigo-500 mx-auto mb-4" />
              <h2 className="text-2xl font-serif font-semibold text-slate-900">{ui.selectLanguage}</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8 text-left">
              <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
                <h3 className="font-bold text-indigo-900 mb-1">{t('whatWeDo', 'What IRU does')}</h3>
                <p className="text-sm text-indigo-900/80">{t('whatWeDoText', 'IRU helps you organize your circumstances and documents, identify missing information, prepare for your next steps, find relevant resources, and fill in supported official immigration forms (currently I-589 and I-765 drafts) from information you provide.')}</p>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                <h3 className="font-bold text-slate-800 mb-1">{t('whatWeDont', 'What IRU does not do')}</h3>
                <p className="text-sm text-slate-600">{t('whatWeDontText', 'IRU is not a law firm and does not give legal advice, decide your eligibility, sign, or submit any form. You review and control everything.')}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {LANGUAGES.map((l) => (
                <button
                  key={l.code}
                  onClick={() => { setLang(l.code); setStage('PHASE1'); setCurrentQ(0); }}
                  className="p-4 rounded-xl border-2 text-left transition-all duration-200 border-slate-200 hover:border-indigo-300 hover:bg-slate-50 text-slate-700"
                >
                  <span className="block text-lg font-medium">{l.name}</span>
                  <span className="block text-xs text-slate-500 mt-1">{l.code}</span>
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
                {question.labels[lang as keyof typeof question.labels]}
              </h2>

              <div className="bg-indigo-50 rounded-xl p-4 flex items-start space-x-3 border border-indigo-100">
                <Shield className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-indigo-900 leading-relaxed font-medium">
                  {question.guardianTips[lang as keyof typeof question.guardianTips]}
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
                        {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
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
                        <span className="block text-sm font-semibold text-slate-600 mb-1">ZIP Code (optional — for local resources)</span>
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
                      <span className="block text-sm font-semibold text-slate-600 mb-1">Street address (optional — used only if you prepare a form)</span>
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
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="p-8 sm:p-12"
          >
            <div className="space-y-8">
              <h2 className="text-3xl font-serif font-semibold text-slate-900">
                {ui.photoTitle}
              </h2>

              <div className="bg-indigo-50 rounded-xl p-4 flex items-start space-x-3 border border-indigo-100">
                <Info className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-indigo-900 leading-relaxed font-medium">
                  {ui.photoDesc}
                </p>
              </div>

              <div className="space-y-4">
                <label className="block w-full p-6 rounded-xl border-2 border-dashed border-slate-300 hover:border-indigo-400 transition-colors cursor-pointer text-center">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,.pdf"
                    className="hidden"
                    onChange={(e) => { setPhotoFile(e.target.files && e.target.files[0] ? e.target.files[0] : null); setImageReview(null); setReviewError(''); }}
                  />
                  <span className="text-slate-600 font-medium">
                    {photoFile ? photoFile.name : (ui.photoChoose || 'Choose a photo…')}
                  </span>
                </label>

                <select
                  value={photoEvidenceKey}
                  onChange={(e) => setPhotoEvidenceKey(e.target.value)}
                  className="w-full p-3 rounded-xl border-2 border-slate-200 text-slate-700"
                >
                  <option value="">—</option>
                  {Object.keys(EVIDENCE_ITEM_NAMES).map(k => (
                    <option key={k} value={k}>{EVIDENCE_ITEM_NAMES[k]}</option>
                  ))}
                </select>

                <p className="text-xs text-slate-500 flex items-start gap-1">
                  <span aria-hidden="true">🔒</span>
                  <span>{ui.photoPrivacy}</span>
                </p>

                {reviewError && (
                  <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">{reviewError}</p>
                )}

                {imageReview && (
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 text-left space-y-2">
                    <p className="text-sm text-slate-700"><strong>Category:</strong> {imageReview.documentCategory}</p>
                    <p className="text-sm text-slate-700"><strong>Legibility:</strong> {imageReview.legibility}</p>
                    <p className="text-sm text-slate-700"><strong>Appears complete:</strong> {imageReview.appearsComplete}</p>
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

              <div className="flex justify-between pt-6 border-t border-slate-100">
                <button onClick={handlePrevQuestion} className="px-6 py-3 text-slate-600 font-medium hover:text-slate-900 transition-colors flex items-center space-x-2">
                  <ArrowLeft className="w-4 h-4" />
                  <span>{ui.back}</span>
                </button>
                <div className="flex gap-3">
                  <button
                    onClick={handlePhotoReview}
                    disabled={!photoFile || reviewing}
                    className="px-6 py-3 border-2 border-indigo-600 text-indigo-700 font-medium rounded-xl hover:bg-indigo-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {reviewing ? (ui.photoReviewing || 'Reviewing…') : (ui.photoReview || 'Review photo')}
                  </button>
                  <button
                    onClick={handleNextQuestion}
                    className="px-8 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition-colors flex items-center space-x-2"
                  >
                    <span>{ui.photoSkip || ui.next}</span>
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
            <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-6" />
            <h2 className="text-3xl font-serif font-bold text-slate-900 mb-4">{ui.packetReady}</h2>
            <p className="text-lg text-slate-600 mb-8">
              {ui.packetDesc}
            </p>
            
            {/* USCIS Required Forms \u2014 data from USCIS_FORMS (fees verified as of FEE_SCHEDULE_AS_OF) */}
            {(() => {
              const caseType = answers.case_type || 'asylum';
              const caseForms = USCIS_FORMS[caseType] || USCIS_FORMS.asylum;
              return (
                <div className="mt-8 mb-8 text-left">
                  <h3 className="text-lg font-serif font-bold text-slate-900 mb-2">Required Forms for Your Case</h3>
                  <p className="text-xs text-slate-500 mb-4">All forms are official USCIS documents. Download free directly from uscis.gov. Fees last verified {FEE_SCHEDULE_AS_OF} \u2014 confirm current fees at uscis.gov before filing.</p>
                  <div className="space-y-3">
                    {caseForms.map((form, i) => (
                      <div key={i} className={`rounded-xl border-2 p-4 ${i === 0 || i === 1 && caseType === 'family' ? 'border-indigo-200 bg-indigo-50/30' : 'border-slate-100'}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${i === 0 || i === 1 && caseType === 'family' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{form.tag}</span>
                          <span className="font-bold text-slate-900">{form.name}</span>
                          <span className="text-xs text-slate-400 ml-auto">{form.fee}</span>
                        </div>
                        <p className="text-xs text-slate-600 mb-2">{form.desc}</p>
                        <div className="flex flex-wrap gap-2">
                          <a href={form.pdf} target="_blank" rel="noopener noreferrer" className="text-xs font-bold bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors">⬇ Download PDF</a>
                          <a href={form.instructions} target="_blank" rel="noopener noreferrer" className="text-xs font-bold border border-slate-200 text-slate-600 px-3 py-1.5 rounded-lg hover:border-slate-400 transition-colors">Instructions</a>
                          <a href={form.page} target="_blank" rel="noopener noreferrer" className="text-xs font-bold border border-slate-200 text-slate-600 px-3 py-1.5 rounded-lg hover:border-slate-400 transition-colors">USCIS Page ↗</a>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-slate-400 text-center mt-3">Procedural information only — not legal advice. Verify all forms at uscis.gov before filing.</p>
                </div>
              );
            })()}

            {/* ── Your Information on Record (§8): review, confirm, resolve, correct ── */}
            {factRecord && (
              <div className="mt-8 mb-8 text-left">
                <h3 className="text-lg font-serif font-bold text-slate-900 mb-2">{t('factsTitle', 'Your Information on Record')}</h3>
                <p className="text-xs text-slate-500 mb-4">{t('factsIntro', 'Everything IRU is using, where it came from, and what still needs your confirmation.')}</p>
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
                        <span className="font-semibold text-slate-800 text-sm">{FACT_LABELS[f.id]}</span>
                        <span className="text-slate-700 text-sm">{String(f.value)}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${f.status === 'conflicting' ? 'bg-red-100 text-red-800' : f.status === 'extracted-unconfirmed' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                          {f.status === 'conflicting' ? t('factStatusConflicting', 'Sources disagree') : f.status === 'extracted-unconfirmed' ? t('factStatusExtracted', 'From your document — please confirm') : t('factStatusReported', 'You provided this')}
                        </span>
                      </div>
                      {f.status === 'extracted-unconfirmed' && (
                        <button onClick={() => handleConfirmFact(f.id)} className="mt-2 px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700">{t('confirmFact', 'Confirm')}</button>
                      )}
                      {f.status === 'conflicting' && (
                        <div className="mt-2 space-y-1">
                          <button onClick={() => handleResolveConflict(f.id, f.source)} className="block px-3 py-1.5 border border-slate-300 text-xs font-semibold rounded-lg hover:bg-slate-50">
                            Keep: {String(f.value)} <span className="text-slate-400">({f.source === 'document' ? 'from document' : 'your answer'})</span>
                          </button>
                          {(f.alternatives || []).map((a: any, i: number) => (
                            <button key={i} onClick={() => handleResolveConflict(f.id, a.source)} className="block px-3 py-1.5 border border-slate-300 text-xs font-semibold rounded-lg hover:bg-slate-50">
                              Use instead: {String(a.value)} <span className="text-slate-400">({a.source === 'document' ? 'from document' : 'your answer'})</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Your Story (successive §4): chronology, issues, approval gate ── */}
            {factRecord && factRecord.narrative && (() => {
              const analysis: any = analyzeNarrative(factRecord.narrative, factRecord);
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

            {/* ── B2C offer (directive §3): both options + exact totals BEFORE
                payment. Only when the paywall build flag is on; amounts come
                from the same pricing module the server enforces with. ── */}
            {PAYWALL_UI_ON() && (() => {
              const offer = buildOffer();
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
                          {t('offerOneForm', 'Complete ONE form')} ({selectedFormId || '…'}) — {formatCents(PRICING.oneForm.upgradeChargeCents)} {t('offerMore', 'more')}
                        </button>
                        <button onClick={() => handleCheckout(SKUS.BUNDLE, { prerequisiteToken: evalToken || undefined })} disabled={checkoutBusy} className="px-5 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50">
                          {t('offerBundle', 'Complete BOTH forms')} — {formatCents(PRICING.bundle.upgradeChargeCents)} {t('offerMore', 'more')}
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
                    <button key={entry.id} onClick={() => { setSelectedFormId(entry.id); setFormSummary(null); setFormPdfBase64(''); setFormError(''); setFormDraftMeta(null); setReviewChecks({}); }}
                      className={`p-4 rounded-xl border-2 text-left ${selectedFormId === entry.id ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300'}`}>
                      <span className="block font-bold text-slate-900">{entry.id}</span>
                      <span className="block text-xs text-slate-500 mt-1">{entry.name}</span>
                      <span className="block text-xs text-slate-400 mt-1">{t('formEdition', 'Edition')} {entry.editionDate} · uscis.gov</span>
                    </button>
                  ))}
                </div>
                {selectedFormId && (() => {
                  const entry: any = getFormEntry(selectedFormId);
                  const plan: any = buildFillPlan(factRecord, entry);
                  return (
                    <div className="border border-slate-200 rounded-xl p-4 space-y-4">
                      <p className="text-xs text-slate-500">{entry.applicability}</p>
                      <p className="text-sm text-slate-700"><strong>{plan.fill.length}</strong> {t('formPopulated', 'fields can be filled from your information')}.</p>
                      {plan.needsConfirmation.length > 0 && (
                        <div>
                          <p className="text-sm font-semibold text-amber-800">{t('formNeedsConfirm', 'Needs your confirmation before it can be used')}:</p>
                          <ul className="text-sm text-slate-600 list-disc pl-5">
                            {plan.needsConfirmation.map((n: any) => <li key={n.factId}>{n.label}: “{String(n.value)}” — confirm it in Your Information above.</li>)}
                          </ul>
                        </div>
                      )}
                      {plan.conflicts.length > 0 && (
                        <p className="text-sm font-semibold text-red-700">{t('formConflicts', 'Conflicting values — resolve above')}: {plan.conflicts.map((c: any) => c.label).join('; ')}</p>
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
                          <button onClick={() => handleSaveFormAnswers(entry, plan)} className="mt-3 px-4 py-2 border-2 border-indigo-600 text-indigo-700 text-sm font-semibold rounded-lg hover:bg-indigo-50">Save answers</button>
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
                        {formPdfBase64 && (() => {
                          const checklist = (formSummary && formSummary.finalReviewChecklist) || [];
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
                      {formPdfBase64 && formSummary && formSummary.finalReviewChecklist && !(formSummary.finalReviewChecklist.every((_: any, i: number) => reviewChecks[i])) && (
                        <p className="text-xs text-amber-800">{t('checklistGate', 'Complete the final review checklist below before downloading.')}</p>
                      )}
                      {formSummary && (
                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm text-slate-700 space-y-3">
                          <p className="font-bold text-slate-900">{formSummary.formId} — {t('formEdition', 'Edition')} {formSummary.editionDate}</p>
                          <p className="text-xs font-semibold text-red-700 uppercase tracking-wide">{formSummary.draftLabel}</p>
                          {/* Version identification (B2C §5.C): the latest
                              generation is the only current draft. */}
                          {formDraftMeta && formDraftMeta.formId === formSummary.formId && (
                            <p className="text-xs text-slate-600">
                              <strong>{formSummary.draftDocumentLabel || 'IRU Pre-filled Draft — Review and Correct'}</strong>
                              {' · '}{t('draftVersion', 'Draft version')} {formDraftMeta.version} ({formDraftMeta.draftId})
                              {' · '}{new Date(formDraftMeta.generatedAt).toLocaleString()}
                              {' · '}<span className="font-semibold text-green-700">{t('draftLatest', 'This is the latest version — use only this one.')}</span>
                            </p>
                          )}
                          {formSummary.staleVersionNote && <p className="text-xs text-amber-800">{formSummary.staleVersionNote}</p>}
                          {/* Pre-download review instructions (B2C §5.A) */}
                          {formSummary.reviewInstructions && (
                            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                              <p className="font-semibold text-amber-900">{t('reviewBeforeDownload', 'Before you download — review this draft')}</p>
                              <ul className="list-disc pl-5 text-amber-900">
                                {formSummary.reviewInstructions.map((r: string, i: number) => <li key={i}>{r}</li>)}
                              </ul>
                              {formSummary.blankForm && (
                                <p className="mt-2 text-amber-900">
                                  {t('compareBlank', 'Compare it with the')} <button onClick={downloadBlankForm} className="underline font-semibold">{formSummary.blankForm.label}</button>
                                  {' '}({formSummary.blankForm.formId}, {t('formEdition', 'Edition')} {formSummary.blankForm.editionDate}) — {t('officialSource', 'official source')}: <a href={formSummary.blankForm.sourceUrl} target="_blank" rel="noreferrer" className="underline">{formSummary.blankForm.sourceUrl}</a>
                                </p>
                              )}
                            </div>
                          )}
                          <div>
                            <p className="font-semibold">{t('formPopulated', 'Filled in from your information')} ({formSummary.populated.length}):</p>
                            <ul className="list-disc pl-5">{formSummary.populated.map((p: any, i: number) => <li key={i}>{p.label}: {p.value}</li>)}</ul>
                          </div>
                          {formSummary.missingRequired.length > 0 && (
                            <div><p className="font-semibold">{t('formMissing', 'Still needed for this form')}:</p>
                            <ul className="list-disc pl-5">{formSummary.missingRequired.map((m: any, i: number) => <li key={i}>{m.label}</li>)}</ul></div>
                          )}
                          <div>
                            <p className="font-semibold">{t('formConsumerSections', 'You complete these parts yourself')}:</p>
                            <ul className="list-disc pl-5">{formSummary.consumerCompletedSections.map((c: string, i: number) => <li key={i}>{c}</li>)}</ul>
                          </div>
                          <p className="text-xs text-slate-500">{t('formSignatureNote', 'No signature was added and nothing was submitted. Signing and filing are your responsibility, after your review.')}</p>
                          {/* Final review checklist (B2C §5.D) — the draft
                              is not presented as ready until every item
                              is confirmed. It is a review aid, not a
                              legal certification. */}
                          {formSummary.finalReviewChecklist && (
                            <div className="border border-slate-300 rounded-lg p-3">
                              <p className="font-semibold text-slate-900">{t('finalChecklistTitle', 'Final review checklist')}</p>
                              {formSummary.finalReviewChecklist.map((item: string, i: number) => (
                                <label key={i} className="flex items-start gap-2 mt-1.5 cursor-pointer">
                                  <input type="checkbox" checked={!!reviewChecks[i]} onChange={(e) => setReviewChecks({ ...reviewChecks, [i]: e.target.checked })} className="mt-0.5" />
                                  <span>{item}</span>
                                </label>
                              ))}
                            </div>
                          )}
                          {/* Next steps, tailored to this form + findings (B2C §6) */}
                          {formSummary.nextSteps && (
                            <div className="border border-indigo-200 bg-indigo-50 rounded-lg p-3 space-y-2">
                              <p className="font-bold text-slate-900">{formSummary.nextSteps.title}</p>
                              <div>
                                <p className="font-semibold">{t('nsUnderstand', 'What this prepares — and what it does not')}</p>
                                <ul className="list-disc pl-5">{formSummary.nextSteps.understand.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
                              </div>
                              <div>
                                <p className="font-semibold">{t('nsChecklist', 'Your checklist')}</p>
                                <ol className="list-decimal pl-5">{formSummary.nextSteps.checklist.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol>
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
                onClick={handleStartOver} 
                className="px-8 py-4 text-slate-600 font-medium hover:bg-slate-100 rounded-xl transition-colors w-full sm:w-auto justify-center border border-slate-200"
              >
                {ui.startOver}
              </button>
            </div>
          </motion.div>
        )}
      </div>
      
      {stage === 'PACKET' && (
        <div className="mt-8 text-center max-w-2xl">
          <button onClick={copyRawHtml} className="inline-flex items-center space-x-2 text-slate-500 hover:text-slate-700 px-4 py-2 rounded-full text-sm font-medium transition-colors">
            <Copy className="w-4 h-4" />
            <span>{copied ? ui.copied : ui.copyHtml}</span>
          </button>
        </div>
      )}
      <div className="mt-12 text-center text-xs text-slate-400 uppercase tracking-widest">
        Sanctuary Architect 20345 | Powered by Parametric Insight Engine
      </div>
    </div>
  );
}
