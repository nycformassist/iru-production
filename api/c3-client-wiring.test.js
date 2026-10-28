/**
 * c3-client-wiring.test.js — C3 client side: status honesty and diagnosability.
 *
 * When the model review did not run, the packet previously still showed a
 * green check and "Your Readiness Packet is Ready". These are source-level
 * guards (the component cannot be rendered under node:test), plus a real
 * SSE round-trip for the request id. Live rendering is verified in Preview.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readAnalyzeStream } from './_lib/sse.js';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const consts = readFileSync(new URL('../src/constants.tsx', import.meta.url), 'utf8');
const enc = s => new TextEncoder().encode(s);
const reader = bytes => { let sent = false; return { async read() { if (sent) return { done: true }; sent = true; return { done: false, value: bytes }; } }; };

describe('C3: the packet never says "ready" when the review did not run', () => {
  it('the on-screen header branches on aiUnavailable: amber warning vs green ready', () => {
    const i = app.indexOf("{aiUnavailable ? (\n              <div data-testid=\"review-not-run\">");
    assert.ok(i > 0, 'unavailable branch present');
    const block = app.slice(i, i + 1600);
    assert.ok(block.includes('AlertTriangle') && block.includes('text-amber-500'));
    assert.ok(block.includes("pktReviewNotRunTitle"));
    const [unavailableBranch, readyBranch] = block.split('            ) : (');
    assert.ok(readyBranch, 'else branch present');
    assert.ok(!unavailableBranch.includes('CheckCircle2') && !unavailableBranch.includes('packetReady'),
      'the unavailable branch has no green check and never says ready');
    assert.ok(readyBranch.includes('CheckCircle2') && readyBranch.includes('{ui.packetReady}'),
      'the normal branch is unchanged');
  });

  it('the print packet carries the same warning', () => {
    assert.ok(/\$\{aiUnavailable \? `<p[^`]*pktReviewNotRunTitle/.test(app));
  });

  it('a successful re-run still clears the state (no stale amber header)', () => {
    assert.ok(app.includes('} else { setAiUnavailable(false); }'));
  });
});

describe('C3: the request id reaches the user', () => {
  it('on screen and in the print footer, only when present', () => {
    assert.ok(app.includes('data-testid="request-ref"'));
    assert.ok(/\{requestId && <p/.test(app));
    assert.ok(/\$\{requestId \? `<div[^`]*pktReference/.test(app));
  });
  it('Start Over clears it', () => {
    assert.ok(app.includes("setIntegrityFlags([]);\n    setRequestId('');"));
  });
  it('SSE consumer returns a sane request id from done and error events and ignores junk', async () => {
    const ok = await readAnalyzeStream(reader(enc(`data: ${JSON.stringify({ type: 'error', status: 'ai_unavailable', requestId: 'k3x9ab', assessment: { x: 1 } })}\n\n`)));
    assert.equal(ok.requestId, 'k3x9ab');
    assert.equal(ok.aiUnavailable, true);
    const junk = await readAnalyzeStream(reader(enc(`data: ${JSON.stringify({ type: 'done', requestId: '<script>x</script>', assessment: { x: 1 } })}\n\n`)));
    assert.equal(junk.requestId, '');
    const none = await readAnalyzeStream(reader(enc(`data: ${JSON.stringify({ type: 'done', assessment: { x: 1 } })}\n\n`)));
    assert.equal(none.requestId, '');
  });
});

describe('C3: strings exist in all five languages', () => {
  for (const key of ['pktReviewNotRunTitle', 'pktReviewNotRunDesc', 'pktReference']) {
    it(key, () => assert.equal((consts.match(new RegExp(`${key}:`, 'g')) || []).length, 5));
  }
});
