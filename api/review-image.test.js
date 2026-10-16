/**
 * Temporary image-review endpoint tests. Stubbed vision client —
 * no network, no cost. No real images: a 1x1 PNG is generated in-code.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeVisionReview } from './review-image.js';

// 1x1 transparent PNG (68 bytes) — synthetic, not a real document.
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const GOOD_REVIEW = {
  documentCategory: 'utility bill',
  legibility: 'legible',
  fieldsVisible: ['name', 'address', 'date'],
  appearsComplete: 'yes',
  inconsistencies: [],
  relatedReadinessItem: 'has_lease',
  limitations: ['Image is low resolution in one corner.'],
};

function mockReqRes({ method = 'POST', body = {}, ip = 'img-1' } = {}) {
  const req = { method, body, headers: {}, socket: { remoteAddress: ip } };
  const res = {
    statusCode: 200, headers: {}, jsonBody: null, ended: false,
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    json(o) { this.jsonBody = o; this.ended = true; return this; },
  };
  return { req, res };
}

let handler;
beforeEach(async () => {
  delete globalThis.__IRU_VISION_CLIENT__;
  delete process.env.GEMINI_API_KEY;
  handler = (await import('./review-image.js')).default;
});

function stubVision(text, capture) {
  globalThis.__IRU_VISION_CLIENT__ = {
    async reviewImage(args) {
      if (capture) capture.args = args;
      return text;
    },
  };
}

describe('handler', () => {
  it('405 on non-POST', async () => {
    const { req, res } = mockReqRes({ method: 'GET', ip: 'img-a' });
    await handler(req, res);
    assert.equal(res.statusCode, 405);
  });

  it('500 when no API key and no test client', async () => {
    const { req, res } = mockReqRes({ ip: 'img-b' });
    await handler(req, res);
    assert.equal(res.statusCode, 500);
  });

  it('400 on missing image', async () => {
    stubVision('{}');
    const { req, res } = mockReqRes({ body: {}, ip: 'img-c' });
    await handler(req, res);
    assert.equal(res.statusCode, 400);
  });

  it('400 on unsupported mime type', async () => {
    stubVision('{}');
    const { req, res } = mockReqRes({
      ip: 'img-d',
      body: { imageBase64: TINY_PNG_B64, mimeType: 'image/svg+xml' },
    });
    await handler(req, res);
    assert.equal(res.statusCode, 400);
  });

  it('400 on unknown relatedEvidenceKey', async () => {
    stubVision('{}');
    const { req, res } = mockReqRes({
      ip: 'img-e',
      body: { imageBase64: TINY_PNG_B64, mimeType: 'image/png', relatedEvidenceKey: 'has_spaceship' },
    });
    await handler(req, res);
    assert.equal(res.statusCode, 400);
  });

  it('413 on oversized image', async () => {
    stubVision('{}');
    // base64 that decodes to > 4MB
    const big = Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64');
    const { req, res } = mockReqRes({
      ip: 'img-f',
      body: { imageBase64: big, mimeType: 'image/png' },
    });
    await handler(req, res);
    assert.equal(res.statusCode, 413);
  });

  it('success path returns sanitized review, never the image', async () => {
    const capture = {};
    stubVision(JSON.stringify(GOOD_REVIEW), capture);
    const { req, res } = mockReqRes({
      ip: 'img-g',
      body: { imageBase64: TINY_PNG_B64, mimeType: 'image/png', relatedEvidenceKey: 'has_lease' },
    });
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.jsonBody.ok, true);
    assert.equal(res.jsonBody.review.documentCategory, 'utility bill');
    // The authenticity disclaimer is enforced even when the model omits it.
    assert.ok(res.jsonBody.review.limitations.some(l => /authenticity/i.test(l)));
    // Response never echoes image bytes.
    assert.ok(!JSON.stringify(res.jsonBody).includes(TINY_PNG_B64.slice(0, 40)));
    // Vision prompt constrains the model against authenticity claims.
    assert.ok(/authentic/i.test(capture.args.prompt), 'vision prompt must prohibit authenticity claims');
  });

  it('non-JSON vision output yields safe 502, not a crash', async () => {
    stubVision('two paragraphs of prose');
    const { req, res } = mockReqRes({
      ip: 'img-h',
      body: { imageBase64: TINY_PNG_B64, mimeType: 'image/png' },
    });
    await handler(req, res);
    assert.equal(res.statusCode, 502);
    assert.ok(res.jsonBody.error);
  });

  it('provider error yields safe 502', async () => {
    globalThis.__IRU_VISION_CLIENT__ = {
      async reviewImage() { throw new Error('provider down'); },
    };
    const { req, res } = mockReqRes({
      ip: 'img-i',
      body: { imageBase64: TINY_PNG_B64, mimeType: 'image/png' },
    });
    await handler(req, res);
    assert.equal(res.statusCode, 502);
  });

  it('429 after exceeding capacity', async () => {
    stubVision(JSON.stringify(GOOD_REVIEW));
    const body = { imageBase64: TINY_PNG_B64, mimeType: 'image/png' };
    for (let i = 0; i < 5; i++) {
      const { req, res } = mockReqRes({ body, ip: 'img-flood' });
      await handler(req, res);
      assert.equal(res.statusCode, 200, `request ${i} should pass`);
    }
    const { req, res } = mockReqRes({ body, ip: 'img-flood' });
    await handler(req, res);
    assert.equal(res.statusCode, 429);
  });
});

describe('sanitizeVisionReview', () => {
  it('accepts a schema-conformant review', () => {
    assert.equal(sanitizeVisionReview(GOOD_REVIEW).ok, true);
  });

  it('rejects missing keys and wrong types', () => {
    const o = { ...GOOD_REVIEW };
    delete o.documentCategory;
    assert.equal(sanitizeVisionReview(o).ok, false);
    assert.equal(sanitizeVisionReview({ ...GOOD_REVIEW, fieldsVisible: 'name' }).ok, false);
    assert.equal(sanitizeVisionReview(null).ok, false);
    assert.equal(sanitizeVisionReview('string').ok, false);
  });

  it('strips authenticity claims instead of passing them through', () => {
    const bad = { ...GOOD_REVIEW, documentCategory: 'authentic passport', limitations: ['looks genuine'] };
    const r = sanitizeVisionReview(bad);
    assert.equal(r.ok, true);
    assert.ok(!/authentic|genuine/i.test(r.data.documentCategory));
    assert.ok(!/genuine/i.test(r.data.limitations.join(' ')));
    assert.ok(r.data.limitations.some(l => /authenticity/i.test(l)), 'disclaimer enforced');
  });

  it('strips "legally sufficient" claims', () => {
    const bad = { ...GOOD_REVIEW, inconsistencies: ['This is legally sufficient proof.'] };
    const r = sanitizeVisionReview(bad);
    assert.equal(r.ok, true);
    assert.ok(!/legally sufficient/i.test(r.data.inconsistencies.join(' ')));
  });

  it('caps field lengths (no unbounded model text)', () => {
    const bad = { ...GOOD_REVIEW, documentCategory: 'x'.repeat(5000) };
    const r = sanitizeVisionReview(bad);
    assert.ok(r.data.documentCategory.length <= 200);
  });
});
