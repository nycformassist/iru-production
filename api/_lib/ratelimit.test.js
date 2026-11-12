import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter, clientIp } from './ratelimit.js';

describe('createLimiter', () => {
  it('allows up to capacity then blocks', () => {
    const l = createLimiter({ capacity: 3, windowMs: 60000 });
    l._reset();
    assert.equal(l.check('ip1').allowed, true);
    assert.equal(l.check('ip1').allowed, true);
    assert.equal(l.check('ip1').allowed, true);
    const r = l.check('ip1');
    assert.equal(r.allowed, false);
    assert.ok(r.retryAfterMs > 0);
  });

  it('tracks keys independently', () => {
    const l = createLimiter({ capacity: 1, windowMs: 60000 });
    l._reset();
    assert.equal(l.check('a').allowed, true);
    assert.equal(l.check('a').allowed, false);
    assert.equal(l.check('b').allowed, true);
  });

  it('resets after the window', () => {
    const l = createLimiter({ capacity: 1, windowMs: 5 });
    l._reset();
    assert.equal(l.check('a').allowed, true);
    assert.equal(l.check('a').allowed, false);
    return new Promise((resolve) => setTimeout(() => {
      assert.equal(l.check('a').allowed, true);
      resolve();
    }, 10));
  });

  it('caps buckets at MAX_BUCKETS with oldest-first eviction', () => {
    const l = createLimiter({ capacity: 1, windowMs: 60000 });
    l._reset();
    for (let i = 0; i < 5100; i++) l.check(`ip-${i}`);
    assert.ok(l._size() <= 5000, `buckets capped, got ${l._size()}`);
    // The newest keys still work; the oldest were evicted (fresh bucket).
    assert.equal(l.check('ip-5099').allowed, false); // already consumed
    assert.equal(l.check('ip-0').allowed, true); // evicted → fresh bucket
  });
});

describe('clientIp', () => {
  it('prefers x-vercel-forwarded-for (set by the Vercel edge, not the client)', () => {
    assert.equal(
      clientIp({ headers: { 'x-vercel-forwarded-for': '1.2.3.4', 'x-forwarded-for': '9.9.9.9, 5.6.7.8' } }),
      '1.2.3.4',
    );
  });
  it('takes the rightmost x-forwarded-for entry (leftmost is sender-controlled)', () => {
    assert.equal(clientIp({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } }), '5.6.7.8');
  });
  it('a single x-forwarded-for entry is used as-is', () => {
    assert.equal(clientIp({ headers: { 'x-forwarded-for': '1.2.3.4' } }), '1.2.3.4');
  });
  it('falls back to socket address', () => {
    assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '9.9.9.9' } }), '9.9.9.9');
  });
  it('never throws on malformed req', () => {
    assert.equal(typeof clientIp({}), 'string');
  });
});
