/**
 * c3-analyze-failure-modes.test.js — C3 through the REAL /api/analyze handler.
 *
 * A live run once showed "AI analysis unavailable" with no way to tell a
 * provider error from a timeout from blank output, and the user could not
 * quote a request id. These tests pin: the bounded retry, no retry where
 * retrying is wrong, blank output as a failure, request ids in both terminal
 * payloads, and privacy-safe diagnostics in the logs.
 */
import { describe, it, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import analyzeHandler from './analyze.js';
import { validateModelOutput } from './_lib/prompt.js';

const Y = new Date().getUTCFullYear();
let ipN = 0;
const nextIp = () => `10.30.0.${++ipN}`;

function mockReqRes(ip) {
  const req = {
    method: 'POST', headers: {}, socket: { remoteAddress: ip },
    body: {
      answers: { country_of_origin: 'Cuba', residence_country: 'US', entry_date: `${Y}-01-05`, case_type: 'asylum', marital_status: 'single', has_prior_arrests: 'no', narrative_text: 'SECRET-NARRATIVE-TEXT' },
      lang: 'EN', narrativeStarters: [], imageReviews: [],
    },
  };
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

const goodJson = (over = {}) => JSON.stringify({
  readinessSummary: 'A complete review.', factsProvided: [], missingInformation: [],
  contradictions: [], inferences: [], suggestedQuestions: [], uncertaintyNotes: [],
  notLegalAdvice: 'Not legal advice.', evidenceGaps: [], ...over,
});

async function run(clientImpl) {
  let calls = 0;
  globalThis.__IRU_AI_CLIENT__ = { generateContentStream(p) { calls++; return clientImpl(calls, p); } };
  const { req, res } = mockReqRes(nextIp());
  const logs = [];
  const oLog = console.log, oErr = console.error;
  console.log = (...a) => logs.push(a.join(' '));
  console.error = (...a) => logs.push(a.join(' '));
  try { await analyzeHandler(req, res); } finally { console.log = oLog; console.error = oErr; }
  const events = res.chunks.join('').split('\n').filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(5)));
  const terminal = events.find(e => e.type === 'done' || e.type === 'error');
  const ev = name => logs.filter(l => l.includes(`"event":"${name}"`)).map(l => JSON.parse(l));
  return { calls: () => calls, terminal, events, logs, ev };
}

const statusErr = (status, msg = 'provider error') => Object.assign(new Error(msg), { status });

describe('C3: bounded retry', () => {
  afterEach(() => { delete globalThis.__IRU_AI_CLIENT__; mock.timers.reset(); });

  it('retries once after a transient failure BEFORE any chunk, then succeeds', async () => {
    const r = await run(async function* (n) {
      if (n === 1) throw statusErr(503, 'overloaded');
      yield { text: goodJson() };
    });
    assert.equal(r.calls(), 2);
    assert.equal(r.terminal.type, 'done');
    assert.equal(r.terminal.status, undefined, 'a recovered review is a normal review');
    const [retry] = r.ev('iru_analyze_retry');
    assert.equal(retry.attempt, 1);
    assert.equal(retry.providerStatus, '503');
    assert.equal(retry.chunksSent, 0);
  });

  it('two transient failures end in ai_unavailable with both attempts diagnosable', async () => {
    const r = await run(async function* () { throw statusErr(503); });
    assert.equal(r.calls(), 2, 'exactly one retry, never a loop');
    assert.equal(r.terminal.type, 'error');
    assert.equal(r.terminal.status, 'ai_unavailable');
    const [fail] = r.ev('iru_analyze_failure');
    assert.equal(fail.attempt, 2);
    assert.equal(fail.chunksSent, 0);
    assert.equal(fail.providerStatus, '503');
    assert.equal(typeof fail.model, 'string');
    assert.ok(fail.model.length > 0);
    assert.equal(r.ev('iru_analyze_retry').length, 1);
  });

  it('never retries a permanent client error (bad key / retired model)', async () => {
    for (const status of [400, 401, 403, 404]) {
      const r = await run(async function* () { throw statusErr(status); });
      assert.equal(r.calls(), 1, `status ${status} must not retry`);
      assert.equal(r.terminal.status, 'ai_unavailable');
      assert.equal(r.ev('iru_analyze_retry').length, 0);
    }
  });

  it('never retries after a chunk reached the client (it already rendered partial text)', async () => {
    const r = await run(async function* () { yield { text: '{"readinessSummary":' }; throw statusErr(503); });
    assert.equal(r.calls(), 1);
    assert.equal(r.terminal.status, 'ai_unavailable');
    const [fail] = r.ev('iru_analyze_failure');
    assert.equal(fail.chunksSent, 1);
    assert.equal(typeof fail.firstChunkMs, 'number');
  });

  it('never retries a timeout (the budget is spent)', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let calls = 0;
    globalThis.__IRU_AI_CLIENT__ = { generateContentStream() { calls++; return (async function* () { await new Promise(() => {}); })(); } };
    const { req, res } = mockReqRes(nextIp());
    const logs = [];
    const oErr = console.error; console.error = (...a) => logs.push(a.join(' '));
    try {
      const p = analyzeHandler(req, res);
      for (let i = 0; i < 20; i++) await Promise.resolve();
      t.mock.timers.tick(45000);
      await p;
    } finally { console.error = oErr; }
    assert.equal(calls, 1);
    const fail = JSON.parse(logs.find(l => l.includes('iru_analyze_failure')));
    assert.match(fail.message, /timeout/);
    assert.ok(!logs.some(l => l.includes('iru_analyze_retry')));
  });
});

describe('C3: blank or invalid output is a failure, not a review', () => {
  afterEach(() => { delete globalThis.__IRU_AI_CLIENT__; });

  it('validator rejects blank readinessSummary and blank notLegalAdvice', () => {
    assert.equal(validateModelOutput(goodJson()).ok, true);
    for (const over of [{ readinessSummary: '' }, { readinessSummary: '   \n' }, { notLegalAdvice: '' }]) {
      const v = validateModelOutput(goodJson(over));
      assert.equal(v.ok, false);
      assert.match(v.error, /blank/);
    }
  });

  it('a blank summary from the model yields ai_unavailable plus a diagnosable validation log', async () => {
    const r = await run(async function* () { yield { text: goodJson({ readinessSummary: '' }) }; });
    assert.equal(r.terminal.type, 'done');
    assert.equal(r.terminal.status, 'ai_unavailable');
    const [v] = r.ev('iru_analyze_validation_failure');
    assert.match(v.message, /blank/);
    assert.equal(v.responseEmpty, false);
    assert.equal(v.chunksSent, 1);
    assert.equal(v.attempt, 1);
  });
});

describe('C3: request id and log privacy', () => {
  afterEach(() => { delete globalThis.__IRU_AI_CLIENT__; });

  it('success payload carries a request id', async () => {
    const r = await run(async function* () { yield { text: goodJson() }; });
    assert.match(r.terminal.requestId, /^[a-z0-9]{1,16}$/i);
  });

  it('error payload carries the SAME request id that appears in the log line', async () => {
    const r = await run(async function* () { throw statusErr(401); });
    assert.match(r.terminal.requestId, /^[a-z0-9]{1,16}$/i);
    const [fail] = r.ev('iru_analyze_failure');
    assert.equal(fail.requestId, r.terminal.requestId);
  });

  it('no log line contains intake text, the prompt, or the API key', async () => {
    const r = await run(async function* (n) { if (n === 1) throw statusErr(503); throw statusErr(503); });
    const blob = r.logs.join('\n');
    assert.ok(!blob.includes('SECRET-NARRATIVE-TEXT'));
    assert.ok(!/applicant_data|HARD RULES/.test(blob));
    assert.ok(!/GEMINI_API_KEY|AIza/.test(blob));
  });
});
