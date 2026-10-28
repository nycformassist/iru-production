// Context-aware gating for the marriage / relationship evidence questions
// (owner ruling 2026-10-28). Pure module: no React, no storage, no DOM, so
// the questionnaire, the packet and the tests all share ONE rule.
//
// Context available before PHASE2: PHASE1 (marital_status) + TRIAGE
// (case_type: asylum | citizenship | family).
//
//   Single + asylum / citizenship : marriage SKIP, relationship SKIP
//   Single + family petition      : marriage SKIP, relationship ASK (family scope)
//   Married / divorced / widowed  : ASK both
//
// To change the ruling to "skip both in every context, including family",
// set RELATIONSHIP_ASKED_WHEN_SINGLE_FOR to [] — nothing else changes.

export const MARRIAGE_KEY = 'has_marriage_cert';
export const RELATIONSHIP_KEY = 'has_proof_of_relationship';

/** Case types for which a SINGLE applicant is still asked about relationship proof. */
export const RELATIONSHIP_ASKED_WHEN_SINGLE_FOR: readonly string[] = ['family'];

type Answers = Record<string, string | undefined>;

function caseTypeOf(answers: Answers): string {
  // Same default the questionnaire uses when no triage answer exists.
  return answers.case_type || 'asylum';
}

export function isSingle(answers: Answers): boolean {
  return !!answers && answers.marital_status === 'single';
}

/** Marriage certificates are marriage-scoped: single means nothing to certify. */
export function isMarriageNotApplicable(answers: Answers): boolean {
  return isSingle(answers);
}

/** Relationship proof is N/A for a single applicant unless the case is one of the allowed family contexts. */
export function isRelationshipNotApplicable(answers: Answers): boolean {
  return (
    isSingle(answers) &&
    !RELATIONSHIP_ASKED_WHEN_SINGLE_FOR.includes(caseTypeOf(answers))
  );
}

/** Evidence ids that must NOT be asked (and must not survive in state) for these answers. */
export function skippedEvidenceKeys(answers: Answers): string[] {
  const out: string[] = [];
  if (isMarriageNotApplicable(answers)) out.push(MARRIAGE_KEY);
  if (isRelationshipNotApplicable(answers)) out.push(RELATIONSHIP_KEY);
  return out;
}

/** Filter a PHASE2 question list by the gating rule (live: recomputed from answers every call). */
export function filterPhase2Questions<T extends { id: string }>(
  questions: readonly T[],
  answers: Answers,
): T[] {
  const skipped = new Set(skippedEvidenceKeys(answers));
  if (skipped.size === 0) return questions.slice();
  return questions.filter((q) => !skipped.has(q.id));
}

/**
 * Remove stored answers (and their alternative-proof ticks) for questions
 * that are now skipped. Returns the SAME object when nothing changes, so it
 * is safe to use in a state-update effect without causing a render loop.
 * Rule chosen for stale answers: they are CLEARED (not kept as hidden "N/A"
 * values), so no stale yes/no can reach the packet, checklist, score, fact
 * record or model prompt.
 */
export function pruneSkippedAnswers<T extends Record<string, string | undefined>>(
  answers: T,
): T {
  const skipped = skippedEvidenceKeys(answers);
  if (skipped.length === 0) return answers;
  let next: Record<string, string | undefined> | null = null;
  const drop = (k: string) => {
    if (k in answers) {
      if (!next) next = { ...answers };
      delete next[k];
    }
  };
  for (const key of skipped) {
    drop(key);
    // Alternative-proof tick boxes belong to the skipped question.
    const prefix = key === MARRIAGE_KEY ? 'proxy_marriage_' : 'proxy_relationship_';
    for (const k of Object.keys(answers)) {
      if (k.startsWith(prefix)) drop(k);
    }
  }
  return (next as unknown as T) || answers;
}

type Lang = 'EN' | 'ES' | 'ZH' | 'HT' | 'AR';
type TextByLang = Record<Lang, string>;

/**
 * A single applicant in a family petition is asked about FAMILY relationship
 * evidence, not marriage. These replace the default label/tip only in that
 * context (the default wording mentions joint bank accounts and a
 * bona-fide-marriage framing). Back-translation checked, see report.
 */
export const FAMILY_RELATIONSHIP_LABELS: TextByLang = {
  EN: 'Do you have proof of your family relationship (for example birth certificates, family photos, or other records)?',
  ES: '¿Tiene prueba de su relación familiar (por ejemplo, actas de nacimiento, fotos familiares u otros registros)?',
  ZH: '您有家庭关系的证明吗(例如出生证明、家庭照片或其他记录)?',
  HT: 'Èske w gen prèv relasyon fanmi w (pa egzanp, sètifika nesans, foto fanmi, oswa lòt dosye)?',
  AR: 'هل لديك إثبات لعلاقتك العائلية (مثل شهادات الميلاد أو الصور العائلية أو سجلات أخرى)؟',
};
export const FAMILY_RELATIONSHIP_TIPS: TextByLang = {
  EN: 'Shows the family relationship the petition is based on.',
  ES: 'Demuestra la relación familiar en la que se basa la petición.',
  ZH: '证明申请所依据的家庭关系。',
  HT: 'Montre relasyon fanmi demann lan baze sou li.',
  AR: 'يثبت العلاقة العائلية التي يستند إليها الطلب.',
};

/** True when the relationship question is being asked of a SINGLE applicant (family scope wording applies). */
export function usesFamilyRelationshipWording(
  questionId: string,
  answers: Answers,
): boolean {
  return questionId === RELATIONSHIP_KEY && isSingle(answers);
}

export function scopedQuestionText(
  question: { id: string; labels: Record<string, string>; guardianTips: Record<string, string> },
  answers: Answers,
  lang: string,
): { label: string; tip: string } {
  if (usesFamilyRelationshipWording(question.id, answers)) {
    const l = (lang in FAMILY_RELATIONSHIP_LABELS ? lang : 'EN') as Lang;
    return { label: FAMILY_RELATIONSHIP_LABELS[l], tip: FAMILY_RELATIONSHIP_TIPS[l] };
  }
  return { label: question.labels[lang], tip: question.guardianTips[lang] };
}
