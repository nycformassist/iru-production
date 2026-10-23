/**
 * sse-stream.test.js — D2 regression (browser E2E, 2026-10-22).
 *
 * In the deployed browser, the readiness analysis always ended with
 * "Analysis could not be generated." + "Readiness Score: 0%", while
 * direct API calls to /api/analyze worked. Root cause: the client's SSE
 * reader split EACH network chunk on '\n' and parsed the pieces
 * independently — the terminal 'done' event (the whole assessment on one
 * multi-KB line) straddles chunk boundaries under any realistic network
 * segmentation, failed JSON.parse, and was silently skipped.
 *
 * The first test below runs the PRE-FIX parsing loop (copied verbatim in
 * behavior) over a realistic stream and shows the loss; the rest prove
 * the shared consumer (api/_lib/sse.js, used by src/App.tsx) recovers the
 * assessment from the same bytes at every chunking, and that the REAL
 * /api/analyze handler's output — fed a client-shaped payload — survives
 * the same trip.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sseEvents, readAnalyzeStream } from './_lib/sse.js';
import { createFactRecord, upsertFact } from './_lib/facts.js';
import analyzeHandler from './analyze.js';

const ASSESSMENT = {
  readinessSummary: 'Your Kreyòl documents are in order — résumé of gaps follows. ' + 's'.repeat(240),
  // Sized like the real payloads: the serialized done-event line exceeds
  // 6 KB, so it straddles any realistic network chunk boundary.
  factsProvided: Array.from({ length: 14 }, (_, i) => `Fact ${i} — provided with supporting detail ` + 'f'.repeat(120)),
  missingInformation: Array.from({ length: 14 }, (_, i) => `Missing ${i} — needed before filing ` + 'm'.repeat(120)),
  contradictions: [], inferences: [], suggestedQuestions: ['What happened in 2021?'],
  uncertaintyNotes: ['Dates are approximate'], notLegalAdvice: 'Not legal advice.',
  evidenceGaps: [],
};

function buildSseBytes() {
  let sse = '';
  for (const piece of ['M ap ', 'analize ', 'dosye w la…']) {
    sse += `data: ${JSON.stringify({ type: 'chunk', text: piece })}\n\n`;
  }
  sse += `data: ${JSON.stringify({ type: 'done', assessment: ASSESSMENT })}\n\n`;
  return new TextEncoder().encode(sse);
}

function fakeReader(bytes, sliceSize) {
  let i = 0;
  return {
    async read() {
      if (i >= bytes.length) return { done: true, value: undefined };
      const v = bytes.subarray(i, i + sliceSize);
      i += sliceSize;
      return { done: false, value: v };
    },
  };
}

/** The pre-fix client loop (src/App.tsx before D2), behavior verbatim. */
async function preFixClientParse(bytes, sliceSize) {
  const reader = fakeReader(bytes, sliceSize);
  const decoder = new TextDecoder();
  let finalAssessment = null;
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
        }
      } catch { /* skip malformed lines */ }
    }
  }
  return finalAssessment;
}

describe('D2: SSE consumption across chunk boundaries', () => {
  const bytes = buildSseBytes();

  it('control: the pre-fix parser loses the assessment at realistic chunkings', async () => {
    assert.ok(await preFixClientParse(bytes, bytes.length), 'single-read delivery worked — the local-test illusion');
    for (const slice of [4096, 1024, 613]) {
      assert.equal(await preFixClientParse(bytes, slice), null,
        `pre-fix parser must drop the done event at slice=${slice} (the deployed-browser symptom)`);
    }
  });

  it('the shared consumer recovers the assessment at EVERY chunking', async () => {
    for (const slice of [bytes.length, 4096, 1024, 613, 64, 7, 1]) {
      const { assessment, aiUnavailable } = await readAnalyzeStream(fakeReader(bytes, slice));
      assert.deepEqual(assessment, ASSESSMENT, `slice=${slice}`);
      assert.equal(aiUnavailable, false);
    }
  });

  it('events stream incrementally and in order (chunk events are not held to the end)', async () => {
    const seen = [];
    for await (const e of sseEvents(fakeReader(bytes, 100))) seen.push(e.type);
    assert.deepEqual(seen, ['chunk', 'chunk', 'chunk', 'done']);
  });
});

// ── Handler-level contract: the REAL /api/analyze, client-shaped payload ──
function mockReqRes({ body, ip }) {
  const req = { method: 'POST', body, headers: {}, socket: { remoteAddress: ip } };
  const res = {
    statusCode: 200, headers: {}, chunks: [], ended: false,
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    json(o) { this.jsonBody = o; this.ended = true; return this; },
    write(s) { this.chunks.push(s); },
    end() { this.ended = true; },
  };
  return { req, res };
}

function clientShapedPayload() {
  // Mirrors src/App.tsx handleInterviewComplete: stripForServer answers
  // (strings only), narrativeStarters labels, imageReviews array, and the
  // canonical fact record built from the same answers.
  const now = '2026-10-22T00:00:00.000Z';
  const rec = createFactRecord(now);
  upsertFact(rec, { id: 'full_name', value: 'Marie Claire Toussaint', source: 'answer' }, now);
  upsertFact(rec, { id: 'country_of_origin', value: 'Haiti', source: 'answer' }, now);
  upsertFact(rec, { id: 'entry_date', value: '2023-03-14', source: 'answer', type: 'date' }, now);
  return {
    answers: {
      country_of_origin: 'Haiti', case_type: 'asylum', has_passport: 'yes',
      entry_date: '2023-03-14', narrative_text: 'I fled after threats against my family.',
    },
    lang: 'EN',
    narrativeStarters: ['I fear for my physical safety if I return.'],
    imageReviews: [],
    factRecord: JSON.parse(JSON.stringify(rec)),
  };
}

describe('D2: /api/analyze handler output survives browser-style delivery', () => {
  afterEach(() => {
    delete globalThis.__IRU_AI_CLIENT__;
    delete process.env.GEMINI_API_KEY;
  });

  it('done event assessment is recovered after arbitrary re-chunking', async () => {
    globalThis.__IRU_AI_CLIENT__ = {
      async *generateContentStream() { yield { text: JSON.stringify(ASSESSMENT) }; },
    };
    const { req, res } = mockReqRes({ body: clientShapedPayload(), ip: '10.7.2.1' });
    await analyzeHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Content-Type'], 'text/event-stream');
    const bytes = new TextEncoder().encode(res.chunks.join(''));
    for (const slice of [613, 1024, 1]) {
      const { assessment, aiUnavailable } = await readAnalyzeStream(fakeReader(bytes, slice));
      assert.ok(assessment, `assessment recovered at slice=${slice}`);
      assert.equal(assessment.readinessSummary, ASSESSMENT.readinessSummary);
      assert.equal(aiUnavailable, false);
    }
  });

  it('AI failure still delivers the flagged fallback through the same consumer', async () => {
    globalThis.__IRU_AI_CLIENT__ = {
      async *generateContentStream() { throw new Error('provider down'); },
    };
    const { req, res } = mockReqRes({ body: clientShapedPayload(), ip: '10.7.2.2' });
    await analyzeHandler(req, res);
    const bytes = new TextEncoder().encode(res.chunks.join(''));
    const { assessment, aiUnavailable } = await readAnalyzeStream(fakeReader(bytes, 613));
    assert.ok(assessment, 'fallback assessment is delivered, not lost');
    assert.equal(aiUnavailable, true, 'fallback is honestly flagged ai_unavailable');
  });
});

describe('D2: client wiring', () => {
  it('src/App.tsx consumes the stream via the shared buffering module', () => {
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    assert.match(app, /from '\.\.\/api\/_lib\/sse\.js'/, 'App imports the shared SSE consumer');
    assert.match(app, /readAnalyzeStream\(response\.body!\.getReader\(\)\)/);
    assert.ok(!app.includes('decoder.decode(value).split'),
      'the per-chunk split parser (the D2 defect) must not return');
  });
});
