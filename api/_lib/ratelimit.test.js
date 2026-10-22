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
});

describe('clientIp', () => {
  it('prefers x-forwarded-for first entry', () => {
    assert.equal(clientIp({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } }), '1.2.3.4');
  });
  it('falls back to socket address', () => {
    assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '9.9.9.9' } }), '9.9.9.9');
  });
  it('never throws on malformed req', () => {
    assert.equal(typeof clientIp({}), 'string');
  });
});
