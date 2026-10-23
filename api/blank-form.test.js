/**
 * blank-form.test.js — D3 regression (browser E2E, 2026-10-22).
 *
 * GET /api/blank-form?form=I-589 failed in deployment with
 * ERR_INVALID_RESPONSE. Root cause: the X-Iru-Document-Label header value
 * contains an em dash (U+2014), which a real Node HTTP response rejects
 * (ERR_INVALID_CHAR) — the handler threw before sending a single byte of
 * PDF. The pre-existing tests used a permissive mock res whose setHeader
 * never validated characters, so the defect was invisible to them.
 *
 * These tests therefore run the REAL handler behind a REAL Node HTTP
 * server and fetch it the way a browser would.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import handler from './blank-form.js';

// Vercel-style res helpers on a real ServerResponse.
function augment(req, res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => {
    const body = JSON.stringify(obj);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Length', Buffer.byteLength(body));
    res.end(body);
    return res;
  };
  res.send = (buf) => { res.end(buf); return res; };
}

let server;
let base;
before(async () => {
  server = http.createServer(async (req, res) => {
    augment(req, res);
    const u = new URL(req.url, 'http://localhost');
    req.query = Object.fromEntries(u.searchParams);
    req.socket = { remoteAddress: `10.8.0.${Math.floor(Math.random() * 200) + 1}` };
    await handler(req, res);
  });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server && server.close());

describe('blank-form endpoint over real HTTP (D3)', () => {
  for (const [formId, template] of [['I-589', 'i-589.pdf'], ['I-765', 'i-765.pdf']]) {
    it(`serves a valid PDF response for ${formId}`, async () => {
      const resp = await fetch(`${base}/api/blank-form?form=${formId}`);
      assert.equal(resp.status, 200);
      assert.equal(resp.headers.get('content-type'), 'application/pdf');
      const label = resp.headers.get('x-iru-document-label');
      assert.ok(label && /Official Blank Form/.test(label), 'label header survives the wire');
      assert.ok([...label].every((c) => c.charCodeAt(0) < 128), 'header value is header-safe ASCII');
      const buf = Buffer.from(await resp.arrayBuffer());
      assert.ok(buf.length > 10000, 'non-empty body');
      assert.equal(buf.subarray(0, 4).toString('latin1'), '%PDF', 'body begins with %PDF');
      const templateBytes = await readFile(path.join(process.cwd(), 'forms', 'templates', template));
      assert.equal(
        createHash('sha256').update(buf).digest('hex'),
        createHash('sha256').update(templateBytes).digest('hex'),
        'served bytes are the verified official template, unmodified',
      );
      assert.equal(Number(resp.headers.get('content-length')), buf.length, 'content-length matches the body');
    });
  }

  it('unknown form is a clean 4xx JSON error', async () => {
    const resp = await fetch(`${base}/api/blank-form?form=I-999`);
    assert.equal(resp.status, 400);
    assert.match(resp.headers.get('content-type'), /application\/json/);
    const body = await resp.json();
    assert.match(body.error, /Unknown form/);
  });
});
