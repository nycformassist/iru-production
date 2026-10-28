/**
 * c4-c8-notes.test.js — C4 (half-credit explanation) and C8 (date privacy note).
 *
 * C4: the score gives 0.5 for a ticked alternative while the same row says
 * "not reviewed", with no on-page explanation. Weights are unchanged; only the
 * explanation is added, on screen and in print.
 *
 * C8: the record shows the exact entry date while the review uses year+band.
 * The note must be TRUE. These tests pin the truth behind each sentence:
 * the typed date/city/state/ZIP never reach the model, and — the limit the
 * note's last sentence discloses — values extracted from an uploaded document
 * photo DO reach the model (only names and ID numbers are excluded).
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { minimizeForModel } from './_lib/privacy.js';
import { createFactRecord, upsertFact } from './_lib/facts.js';
import analyzeHandler from './analyze.js';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const consts = readFileSync(new URL('../src/constants.tsx', import.meta.url), 'utf8');

describe('C4: half-credit explanation', () => {
  it('weights are unchanged: yes = 1, ticked alternative = 0.5', () => {
    const fn = app.slice(app.indexOf('const calculateReadinessScore'), app.indexOf('const calculateReadinessScore') + 1700);
    assert.ok(/if \(eff\[key\] === 'yes'\) \{\s*score\+\+;/.test(fn));
    assert.ok(/score \+= 0\.5;[^\n]*\n\s*alternativesCounted\+\+;/.test(fn), 'the counter increments exactly where 0.5 is awarded');
    assert.ok(fn.includes('return { score, total: total || 1, alternativesCounted };'));
  });

  it('both render paths show the note only when an alternative earned credit', () => {
    assert.ok(/\{alternativesCounted > 0 && \(\s*<p[^>]*data-testid="alt-credit-note"/.test(app), 'on screen');
    assert.ok(/\$\{alternativesCounted > 0 \? `<p[^`]*pktAltCreditNote/.test(app), 'print');
    assert.equal((app.match(/const \{ score, total, alternativesCounted \} = calculateReadinessScore\(\);/g) || []).length, 2);
  });

  it('the note says half credit AND not verified (the honest arithmetic)', () => {
    const en = /pktAltCreditNote: "([^"]+)"/.exec(consts)[1];
    assert.match(en, /half credit/);
    assert.match(en, /not a review/);
    assert.match(en, /has not verified any document/);
    assert.equal((consts.match(/pktAltCreditNote:/g) || []).length, 5);
  });
});

describe('C8: the date/privacy note is true', () => {
  const typed = {
    country_of_origin: 'Cuba', case_type: 'asylum', entry_date: '2026-10-13',
    residence_city: 'Bronx', residence_region: 'NY', zip_code: '10466',
    residence_postal_code: '10466', residence_street: '1 Main Street', narrative_text: '',
  };

  it('typed entry date, city, state, ZIP, and street never reach the model input', () => {
    const blob = JSON.stringify(minimizeForModel(typed, []));
    for (const secret of ['2026-10-13', '10-13', 'Bronx', '10466', 'Main Street']) {
      assert.ok(!blob.includes(secret), `${secret} must not be in the minimized record`);
    }
    const m = minimizeForModel(typed, []);
    assert.equal(m.entryYear, '2026');
    assert.ok(m.entryRecency, 'a recency band is what the model gets');
  });

  describe('LIMIT the note discloses: document-extracted values do reach the model', () => {
    afterEach(() => { delete globalThis.__IRU_AI_CLIENT__; });
    it('an entry date read from an uploaded document appears in the prompt', async () => {
      const now = '2026-10-22T00:00:00.000Z';
      const rec = createFactRecord(now);
      upsertFact(rec, { id: 'entry_date', value: '2026-10-13', source: 'document', type: 'date', sourceRef: { documentType: 'I-94' } }, now);
      let seenPrompt = '';
      globalThis.__IRU_AI_CLIENT__ = { async *generateContentStream(p) { seenPrompt = p; yield { text: '{}' }; } };
      const req = { method: 'POST', headers: {}, socket: { remoteAddress: '10.40.0.1' },
        body: { answers: { country_of_origin: 'Cuba', case_type: 'asylum', entry_date: '2026-10-13', narrative_text: '' }, lang: 'EN', narrativeStarters: [], imageReviews: [], factRecord: JSON.parse(JSON.stringify(rec)) } };
      const res = { statusCode: 200, headers: {}, chunks: [], status(c) { this.statusCode = c; return this; }, setHeader() {}, json() { return this; }, write(s) { this.chunks.push(s); }, end() {} };
      const oErr = console.error, oLog = console.log; console.error = () => {}; console.log = () => {};
      try { await analyzeHandler(req, res); } finally { console.error = oErr; console.log = oLog; }
      assert.ok(seenPrompt.includes('DOCUMENT-EXTRACTED FACTS'), 'document facts section present');
      assert.ok(/entry_date: "2026-10-13"/.test(seenPrompt), 'document-extracted exact date reaches the model — the note must disclose this');
    });
  });

  it('both render paths show the note only when an entry date is on record', () => {
    assert.ok(/factRecord\.facts\.entry_date && factRecord\.facts\.entry_date\.value && \(\s*<p[^>]*data-testid="date-privacy-note"/.test(app), 'on screen');
    assert.ok(/\$\{factRecord && factRecord\.facts && factRecord\.facts\.entry_date && factRecord\.facts\.entry_date\.value \? `<p[^`]*pktDateNote/.test(app), 'print');
  });

  it('the note is scoped: no claim about names, and it discloses document uploads', () => {
    const en = /pktDateNote: "([^"]+)"/.exec(consts)[1];
    assert.match(en, /year and a general time band/);
    assert.match(en, /city, state, and ZIP code answers are not sent/);
    assert.match(en, /document photo/);
    assert.ok(!/\bname/i.test(en), 'must not claim anything about names (free-text narrative is scrubbed by pattern only)');
    assert.equal((consts.match(/pktDateNote:/g) || []).length, 5);
  });
});
