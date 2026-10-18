import React, { useState, useRef } from 'react';
import { Shield, Globe, Printer, ArrowRight, ArrowLeft, CheckCircle2, Copy, Info } from 'lucide-react';
import { motion } from 'framer-motion';

import { LANGUAGES, UI_LABELS, PHASE_1_QUESTIONS, TRIAGE_QUESTION, PHASE_2_QUESTIONS, PHASE_3_QUESTIONS, NYC_RESOURCES, CONSULATES, PROXIES, NARRATIVE_STARTERS, USCIS_FORMS, FEE_SCHEDULE_AS_OF } from './constants';

// Evidence intelligence (server-side source of truth, pure module — no
// secrets, no I/O). Imported read-only for honest packet rendering.
import { EVIDENCE_KB, requiresLegalReview, legalReviewReason, nextActionFor } from '../api/lib/evidence.js';

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

/** Escape user/AI content before injecting into the printable packet HTML. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Fields the analysis endpoint is allowed to receive. Direct identifiers
 * (name, zip) stay on the device for the local packet; the server allowlists
 * again as defense in depth (see api/lib/privacy.js).
 */
const SERVER_FIELD_ALLOWLIST = new Set([
  'country_of_origin', 'entry_date', 'case_type',
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
  const [consulate, setConsulate] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const [assessment, setAssessment] = useState<any>(null);
  const [aiUnavailable, setAiUnavailable] = useState(false);
  // Optional one-time document photo review (never persisted server-side).
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoEvidenceKey, setPhotoEvidenceKey] = useState('');
  const [imageReview, setImageReview] = useState<any>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState('');

  /** Plain-text rendering of the structured assessment for the packet. */
  const renderAssessmentText = (a: any): string => {
    if (!a) return 'Analysis could not be generated.';
    if (aiUnavailable) {
      return 'AI analysis unavailable. Showing rule-based findings from your intake answers.\n\n' +
        (a.readinessSummary || '');
    }
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

  // ── Complete reset (prevents stale results) ────────────────────────────────
  const handleStartOver = () => {
    // Abort any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    // Bump runId so late responses are ignored
    setRunId(prev => prev + 1);
    // Reset all state
    setStage('LANG');
    setAnswers({});
    setCurrentQ(0);
    setImageReview(null);
    setPhotoFile(null);
    setReviewError('');
    setAssessment(null);
    setAiUnavailable(false);
  };

  const handleInterviewComplete = async () => {
    const currentRunId = runId;
    // Create abort controller for this request
    abortControllerRef.current = new AbortController();
    setStage('ANALYZING');
    const zip = answers.zip_code || '';
    const prefix = zip.substring(0, 3);
    const match = NYC_RESOURCES.find(r => r.prefix === prefix);
    if (match) setResources([match]);
    else setResources(NYC_RESOURCES.filter(r => r.prefix === '100' || r.prefix === '104'));

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
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      if (!response.ok) throw new Error(`Server error: ${response.status}`);

      // SSE streaming reader — defeats Vercel 10s kill-switch
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let finalAssessment: any = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value).split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'done' || event.type === 'error') {
              if (event.assessment) finalAssessment = event.assessment;
              if (event.status === 'ai_unavailable') {
                // AI failed; fallback assessment provided but marked as unavailable
                setAiUnavailable(true);
              }
            }
          } catch { /* skip malformed lines */ }
        }
      }
      // Ignore stale responses (user clicked Start Over during request)
      if (currentRunId !== runId) {
        console.log('[iru] Ignoring stale response after reset');
        return;
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
    return `${name}, originally from ${country}, ${entry} and is currently seeking ${caseType}. They reside in the ${answers.zip_code || 'unspecified'} zip code area and have completed an initial evidence audit to prepare for their legal consultation.`;
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

  const generateHtml = () => {
    const { score, total } = calculateReadinessScore();
    const readinessPercent = Math.round((score / total) * 100);

    const resourcesHtml = resources.map(res => `
      <div style="padding: 1.5rem; border: 2px solid #e0e7ff; background-color: #eef2ff; border-radius: 0.75rem; margin-bottom: 1rem; position: relative;">
        <div style="position: absolute; top: 0; right: 0; background-color: #4f46e5; color: white; font-size: 0.75rem; font-weight: 700; padding: 0.25rem 0.75rem; border-bottom-left-radius: 0.5rem; text-transform: uppercase;">
          ${res.borough}
        </div>
        <h4 style="font-size: 1.25rem; font-weight: 700; color: #0f172a; margin: 0 0 0.5rem 0;">${res.name}</h4>
        <p style="color: #334155; margin: 0 0 0.25rem 0; font-weight: 500;">${res.address}</p>
        <p style="color: #334155; margin: 0 0 1rem 0; font-weight: 500;">${res.phone}</p>
        <div style="background-color: white; padding: 1rem; border-radius: 0.5rem; border: 1px solid #c7d2fe; margin-bottom: 1rem;">
          <p style="font-size: 0.875rem; font-weight: 600; color: #312e81; margin: 0 0 0.5rem 0;">🚇 ${res.transit}</p>
          <p style="font-size: 0.875rem; font-weight: 500; color: #475569; margin: 0;">🚶 ${ui.subwayExit}: ${res.exit}</p>
        </div>
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
     * Honest evidence states (mirrors api/lib/evidence.js resolveState):
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
          ${resourcesHtml || '<p style="color: #64748b; font-style: italic;">No specific resources found.</p>'}
        </div>
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
                {question.type === 'radio' && question.options ? (
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
                  disabled={!answers[question.id]}
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

            <div className="flex flex-col sm:flex-row justify-center items-center gap-4">
              <button 
                onClick={openPrintablePacket}
                className="px-8 py-4 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-colors flex items-center space-x-2 shadow-lg w-full sm:w-auto justify-center"
              >
                <Printer className="w-5 h-5" />
                <span>{ui.openPrint}</span>
              </button>
              
              <button 
                onClick={() => { setStage('LANG'); setAnswers({}); setCurrentQ(0); setImageReview(null); setPhotoFile(null); setReviewError(''); }} 
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
