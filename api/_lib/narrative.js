/**
 * lib/narrative.js — Personal Narrative as a first-class workflow stage
 * (successive directive §4). NOT a packet afterthought.
 *
 * The narrative organizes the APPLICANT'S OWN ACCOUNT into a coherent
 * chronology. Hard rules:
 * - Event text is the applicant's own words, stored verbatim. This module
 *   NEVER rewrites, embellishes, or invents events, dates, identities,
 *   evidence, or legal grounds. Analysis only FLAGS and ASKS.
 * - Origins are distinguished: 'applicant-statement' vs
 *   'document-extracted' (an extracted event is a claim about what a
 *   document contains; it must be confirmed by the applicant before it
 *   counts as their statement) vs 'verified' (RESERVED — no function
 *   here can create one).
 * - Uncertainty is surfaced, never converted into fact: missing dates,
 *   unclear events, unexplained gaps, and inconsistencies with the
 *   canonical fact record become explicit issues + focused questions.
 * - The applicant must review, correct, and APPROVE the narrative
 *   before it may be used in form preparation (see the gate in
 *   lib/formmap.js). Any correction after approval revokes the
 *   approval and marks derived outputs stale.
 * - The narrative is optional: it exists only when relevant to the
 *   applicant's objective. Nothing here forces it into every workflow.
 *
 * Pure functions, no I/O — fully unit-testable. Shared by client + server.
 */

export const NARRATIVE_VERSION = 1;

export const NARRATIVE_STATUSES = [
  'not-started',
  'draft',        // events exist, not yet reviewed
  'needs-review', // issues outstanding or corrected since last review
  'approved',     // applicant reviewed and approved for form preparation
];

export const EVENT_ORIGINS = ['applicant-statement', 'document-extracted', 'verified'];

/** Gap between consecutive dated events beyond which we ask, not assume. */
export const GAP_THRESHOLD_DAYS = 548; // ~18 months

/** Below this length an event is flagged unclear (heuristic, labeled as such). */
export const MIN_EVENT_DETAIL_CHARS = 20;

let eventSeq = 0;

export function createNarrative(nowIso) {
  return {
    version: NARRATIVE_VERSION,
    status: 'not-started',
    events: [],
    approvedAt: null,
    acknowledgedWarnings: [],
    createdAt: nowIso || null,
    updatedAt: nowIso || null,
  };
}

/**
 * Parse a date the applicant supplied. Accepts YYYY-MM-DD, MM/DD/YYYY,
 * YYYY-MM, YYYY. Returns { iso, precision } or null when unparseable —
 * unparseable is reported, never guessed.
 */
export function parseEventDate(raw) {
  if (raw === null || raw === undefined) return null;
  const v = String(raw).trim();
  if (!v) return null;
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return { iso: `${m[1]}-${m[2]}-${m[3]}`, precision: 'exact' };
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const mm = m[1].padStart(2, '0');
    const dd = m[2].padStart(2, '0');
    return { iso: `${m[3]}-${mm}-${dd}`, precision: 'exact' };
  }
  m = v.match(/^(\d{4})-(\d{2})$/);
  if (m) return { iso: `${m[1]}-${m[2]}-01`, precision: 'month' };
  m = v.match(/^(\d{4})$/);
  if (m) return { iso: `${m[1]}-01-01`, precision: 'year' };
  return null;
}

/**
 * Add an event in the applicant's own words (verbatim). Document-extracted
 * events start unconfirmed. Adding an event always moves the narrative
 * out of 'approved' — new content requires fresh review.
 */
export function addNarrativeEvent(narrative, input, nowIso) {
  if (!narrative || !Array.isArray(narrative.events)) throw new Error('narrative: invalid narrative');
  const text = typeof input?.text === 'string' ? input.text : '';
  if (!text.trim()) throw new Error('narrative: event text required (the applicant\'s own words)');
  const origin = EVENT_ORIGINS.includes(input.origin) ? input.origin : 'applicant-statement';
  if (origin === 'verified') {
    throw new Error('narrative: "verified" origin is reserved and cannot be set from applicant or document input');
  }
  const parsed = parseEventDate(input.date);
  const event = {
    id: input.id || `evt_${++eventSeq}`,
    text, // verbatim — never rewritten by this module
    date: parsed ? input.date : (input.date || null),
    dateIso: parsed ? parsed.iso : null,
    datePrecision: parsed ? parsed.precision : 'unknown',
    origin,
    sourceRef: input.sourceRef || null,
    factIds: Array.isArray(input.factIds) ? input.factIds.slice(0, 5) : [],
    needsConfirmation: origin === 'document-extracted',
    history: [],
    createdAt: nowIso || null,
    updatedAt: nowIso || null,
  };
  narrative.events.push(event);
  narrative.status = narrative.status === 'not-started' ? 'draft' : 'needs-review';
  narrative.approvedAt = null;
  narrative.updatedAt = nowIso || null;
  return event;
}

/** Applicant confirms a document-extracted event as their own statement. */
export function confirmNarrativeEvent(narrative, eventId, nowIso) {
  const event = findEvent(narrative, eventId);
  if (event.needsConfirmation) {
    event.needsConfirmation = false;
    event.history.push({ change: 'confirmed-by-applicant', at: nowIso || null });
    event.updatedAt = nowIso || null;
    narrative.status = 'needs-review';
    narrative.updatedAt = nowIso || null;
  }
  return event;
}

/**
 * Applicant corrects an event (their words, their date). The prior
 * version is preserved in history; approval is revoked; derived
 * outputs (packet, form drafts) are marked stale on the fact record.
 */
export function correctNarrativeEvent(narrative, record, eventId, patch, nowIso) {
  const event = findEvent(narrative, eventId);
  event.history.push({
    change: 'corrected-by-applicant',
    at: nowIso || null,
    priorText: event.text,
    priorDate: event.date,
  });
  if (typeof patch.text === 'string' && patch.text.trim()) event.text = patch.text;
  if (patch.date !== undefined) {
    const parsed = parseEventDate(patch.date);
    event.date = patch.date || null;
    event.dateIso = parsed ? parsed.iso : null;
    event.datePrecision = parsed ? parsed.precision : 'unknown';
  }
  if (Array.isArray(patch.factIds)) event.factIds = patch.factIds.slice(0, 5);
  event.updatedAt = nowIso || null;
  narrative.status = 'needs-review';
  narrative.approvedAt = null;
  narrative.updatedAt = nowIso || null;
  if (record) record.outputsStale = true;
  return event;
}

function findEvent(narrative, eventId) {
  const event = (narrative?.events || []).find((e) => e.id === eventId);
  if (!event) throw new Error(`narrative: unknown event "${eventId}"`);
  return event;
}

/**
 * Analyze the narrative against the canonical fact record.
 * Returns a chronology (dated events ascending; undated last, in the
 * order given — their order is NOT invented) and a list of issues,
 * each with a focused question for the applicant. Issues never alter
 * the events themselves.
 */
export function analyzeNarrative(narrative, record) {
  const events = narrative?.events || [];
  const dated = events.filter((e) => e.dateIso).slice()
    .sort((a, b) => (a.dateIso < b.dateIso ? -1 : a.dateIso > b.dateIso ? 1 : 0));
  const undated = events.filter((e) => !e.dateIso);
  const chronology = [...dated, ...undated];

  const issues = [];
  for (const event of chronology) {
    if (!event.dateIso) {
      issues.push({
        eventId: event.id, kind: 'missing-date', blocking: true,
        question: `When did this happen? "${snippet(event.text)}" — an approximate month/year is fine; IRU will record it as approximate, not exact.`,
      });
    }
    if (String(event.text || '').trim().length < MIN_EVENT_DETAIL_CHARS) {
      issues.push({
        eventId: event.id, kind: 'unclear-event', blocking: false,
        question: `Can you add a little more detail, in your own words, about what happened? "${snippet(event.text)}"`,
      });
    }
    if (event.needsConfirmation) {
      issues.push({
        eventId: event.id, kind: 'unconfirmed-document-event', blocking: true,
        question: `This event came from a document, not from you. Is it accurate as written? "${snippet(event.text)}"`,
      });
    }
    for (const factId of event.factIds || []) {
      const fact = record?.facts?.[factId];
      if (!fact) continue;
      if (fact.status === 'conflicting') {
        issues.push({
          eventId: event.id, kind: 'fact-conflict', blocking: true, factId,
          question: `Your information on record disagrees with itself about "${factId}". Please resolve that conflict before this part of your story is used.`,
        });
      } else if (event.dateIso && fact.value && fact.type === 'date') {
        const factDate = parseEventDate(fact.value);
        if (factDate && factDate.iso !== event.dateIso) {
          issues.push({
            eventId: event.id, kind: 'date-inconsistency', blocking: true, factId,
            question: `The date here (${event.date}) differs from the date on record for the same event (${fact.value}). Which is correct?`,
          });
        }
      }
    }
  }
  for (let i = 1; i < dated.length; i++) {
    const days = Math.round((Date.parse(dated[i].dateIso) - Date.parse(dated[i - 1].dateIso)) / 86400000);
    if (days > GAP_THRESHOLD_DAYS) {
      issues.push({
        eventId: dated[i].id, kind: 'unexplained-gap', blocking: false,
        question: `There is a gap of about ${Math.round(days / 30)} months between "${snippet(dated[i - 1].text)}" and "${snippet(dated[i].text)}". Is anything important missing in between? You may also leave this as-is.`,
      });
    }
  }
  return { chronology, issues };
}

const snippet = (text) => String(text || '').trim().slice(0, 80);

/**
 * Applicant approval. Refused while BLOCKING issues remain (missing
 * dates, unresolved fact conflicts, date inconsistencies, unconfirmed
 * document-extracted events). Non-blocking warnings (gaps, unclear
 * events) are recorded as acknowledged by the applicant — surfaced,
 * never silently converted into facts.
 */
export function approveNarrative(narrative, record, nowIso) {
  if (!narrative || !Array.isArray(narrative.events) || narrative.events.length === 0) {
    throw new Error('narrative: nothing to approve — no narrative events');
  }
  const { issues } = analyzeNarrative(narrative, record);
  const blocking = issues.filter((i) => i.blocking);
  if (blocking.length > 0) {
    throw new Error(`narrative: approval refused — ${blocking.length} blocking issue(s) unresolved: ${[...new Set(blocking.map((i) => i.kind))].join(', ')}`);
  }
  narrative.acknowledgedWarnings = issues.filter((i) => !i.blocking).map((i) => i.kind);
  narrative.status = 'approved';
  narrative.approvedAt = nowIso || null;
  narrative.updatedAt = nowIso || null;
  return narrative;
}

/** The ONLY gate form preparation consults (see lib/formmap.js). */
export function isNarrativeApproved(narrative) {
  return !!narrative && narrative.status === 'approved' && Array.isArray(narrative.events) && narrative.events.length > 0;
}

/**
 * Packet export: the chronology with honest status labeling. An
 * unapproved narrative is exported as an UNAPPROVED DRAFT — visible to
 * the applicant in their own package, never represented as settled.
 */
export function narrativeForPacket(narrative, record) {
  if (!narrative || !Array.isArray(narrative.events) || narrative.events.length === 0) return null;
  const { chronology, issues } = analyzeNarrative(narrative, record);
  return {
    status: narrative.status,
    approved: isNarrativeApproved(narrative),
    approvedAt: narrative.approvedAt,
    label: isNarrativeApproved(narrative)
      ? 'Personal narrative — reviewed and approved by the applicant.'
      : 'Personal narrative — DRAFT, not yet reviewed and approved by the applicant. Not used in form preparation.',
    chronology: chronology.map((e) => ({
      date: e.date, datePrecision: e.datePrecision, text: e.text, origin: e.origin,
    })),
    openIssues: issues.map((i) => ({ kind: i.kind, question: i.question, blocking: i.blocking })),
  };
}

/**
 * Validate/sanitize an untrusted (client-supplied) narrative before
 * server use. A client can claim 'approved' only in the same sense the
 * applicant approves in their own session — but events are re-derived
 * conservatively: document-extracted events stay unconfirmed unless
 * the payload itself records the applicant's confirmation, and event
 * dates are re-parsed here, never trusted as parsed.
 */
export function sanitizeNarrative(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.events)) return null;
  const narrative = createNarrative(raw.createdAt || null);
  narrative.status = NARRATIVE_STATUSES.includes(raw.status) ? raw.status : 'draft';
  narrative.approvedAt = typeof raw.approvedAt === 'string' ? raw.approvedAt : null;
  narrative.events = raw.events.slice(0, 50).map((e, idx) => {
    const parsed = parseEventDate(e?.date);
    const origin = EVENT_ORIGINS.includes(e?.origin) && e.origin !== 'verified' ? e.origin : 'applicant-statement';
    return {
      id: typeof e?.id === 'string' ? e.id.slice(0, 64) : `evt_s${idx}`,
      text: typeof e?.text === 'string' ? e.text.slice(0, 4000) : '',
      date: parsed ? e.date : (typeof e?.date === 'string' ? e.date : null),
      dateIso: parsed ? parsed.iso : null,
      datePrecision: parsed ? parsed.precision : 'unknown',
      origin,
      sourceRef: null,
      factIds: Array.isArray(e?.factIds) ? e.factIds.filter((x) => typeof x === 'string').slice(0, 5) : [],
      needsConfirmation: origin === 'document-extracted' ? e?.needsConfirmation !== false : false,
      history: [],
      createdAt: null,
      updatedAt: null,
    };
  }).filter((e) => e.text.trim());
  if (narrative.events.length === 0) return null;
  return narrative;
}
