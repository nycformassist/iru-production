/**
 * Vertex AI client tests (api/_lib/vertex-client.js).
 *
 * No network, no cost, no real credential: the service account is a
 * DUMMY RSA keypair generated in-process (node:crypto) purely so the
 * real JWT-signing path can be exercised against a mocked fetch.
 * Every test injects its own fetch implementation; the global fetch
 * is never called and no request ever leaves the process.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  generateVertexText,
  generateVertexContentStream,
  getVertexAccessToken,
  getVertexServiceAccount,
  isVertexConfigured,
  getVertexModelNames,
  getVertexGenerateUrl,
  VertexError,
  VertexNotConfiguredError,
  UpstreamUnavailableError,
  _resetVertexTokenCache,
} from './vertex-client.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Dummy service account, generated in-process for these tests only.
// Never a real credential: the keypair exists only inside this test run.
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const DUMMY_SA = JSON.stringify({
  client_email: 'iru-test@inner-temple-514402.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  private_key_id: 'dummy-test-key-1',
});

const VERTEX_OK_BODY = {
  candidates: [{ content: { parts: [{ text: '{"readinessSummary":"ok"}' }] } }],
};

function mockResponse(status, bodyObj) {
  const body = typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => (body ? JSON.parse(body) : {}),
  };
}

/**
 * Build a fetch mock. `handlers.token(fetchCall)` and
 * `handlers.generate(fetchCall)` return mock responses; defaults serve
 * a dummy access token and a successful Vertex response. Every call is
 * recorded in `calls` with its parsed JSON body (when present).
 */
function makeFetch(handlers = {}) {
  const calls = [];
  let tokenCount = 0;
  const fetchImpl = async (url, opts = {}) => {
    let parsedBody = null;
    if (opts.body && typeof opts.body === 'string' && opts.body.startsWith('{')) {
      try { parsedBody = JSON.parse(opts.body); } catch { parsedBody = null; }
    }
    const call = { url, method: opts.method, headers: opts.headers || {}, body: opts.body, parsedBody };
    calls.push(call);
    if (url === TOKEN_URL) {
      tokenCount++;
      if (handlers.token) return handlers.token(call, tokenCount);
      return mockResponse(200, { access_token: `ya29.dummy-token-${tokenCount}`, expires_in: 3600 });
    }
    if (handlers.generate) return handlers.generate(call);
    return mockResponse(200, VERTEX_OK_BODY);
  };
  fetchImpl.calls = calls;
  fetchImpl.tokenCalls = () => calls.filter((c) => c.url === TOKEN_URL);
  fetchImpl.generateCalls = () => calls.filter((c) => c.url !== TOKEN_URL);
  return fetchImpl;
}

const TEXT_REQUEST = {
  contents: [{ role: 'user', parts: [{ text: 'Say hello as JSON.' }] }],
  systemInstruction: 'You are a test system prompt.',
  generationConfig: { responseMimeType: 'application/json' },
};

const ENV_KEYS = ['VERTEX_SERVICE_ACCOUNT_JSON', 'VERTEX_PROJECT_ID', 'VERTEX_LOCATION', 'GEMINI_MODEL', 'GEMINI_FALLBACK_MODEL'];
let savedEnv = {};

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.VERTEX_SERVICE_ACCOUNT_JSON = DUMMY_SA;
  delete process.env.VERTEX_PROJECT_ID;
  delete process.env.VERTEX_LOCATION;
  delete process.env.GEMINI_MODEL;
  delete process.env.GEMINI_FALLBACK_MODEL;
  _resetVertexTokenCache();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  _resetVertexTokenCache();
});

describe('service account configuration', () => {
  it('isVertexConfigured is false when the env var is absent or malformed', () => {
    delete process.env.VERTEX_SERVICE_ACCOUNT_JSON;
    assert.equal(isVertexConfigured(), false);
    assert.equal(getVertexServiceAccount(), null);

    process.env.VERTEX_SERVICE_ACCOUNT_JSON = 'not-json{';
    assert.equal(isVertexConfigured(), false);
    assert.equal(getVertexServiceAccount(), null);

    process.env.VERTEX_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'x@y.z' });
    assert.equal(isVertexConfigured(), false, 'private_key is required');
  });

  it('isVertexConfigured is true with a well-formed dummy service account', () => {
    assert.equal(isVertexConfigured(), true);
    const sa = getVertexServiceAccount();
    assert.equal(sa.client_email, 'iru-test@inner-temple-514402.iam.gserviceaccount.com');
  });

  it('model defaults are the supported Vertex models, never the retired ones', () => {
    const { primary, fallback } = getVertexModelNames();
    assert.equal(primary, 'gemini-3.8-flash');
    assert.equal(fallback, 'gemini-3.5-flash');
    assert.ok(!['gemini-2.5-flash', 'gemini-3.6-flash'].includes(primary));
    assert.ok(!['gemini-2.5-flash', 'gemini-3.6-flash'].includes(fallback));

    process.env.GEMINI_MODEL = 'custom-primary';
    process.env.GEMINI_FALLBACK_MODEL = 'custom-fallback';
    assert.deepEqual(getVertexModelNames(), { primary: 'custom-primary', fallback: 'custom-fallback' });
  });

  it('generate URL is the global v1beta1 endpoint, never v1', () => {
    const url = getVertexGenerateUrl('gemini-3.8-flash');
    assert.equal(
      url,
      'https://aiplatform.googleapis.com/v1beta1/projects/inner-temple-514402/locations/global/publishers/google/models/gemini-3.8-flash:generateContent'
    );
    assert.ok(!url.includes('/v1/'), 'must not use the v1 endpoint');
  });
});

describe('token caching and 401 handling', () => {
  it('second call reuses the cached token (no second token fetch)', async () => {
    const fetchImpl = makeFetch();
    const first = await generateVertexText(TEXT_REQUEST, { fetchImpl });
    const second = await generateVertexText(TEXT_REQUEST, { fetchImpl });
    assert.equal(first, '{"readinessSummary":"ok"}');
    assert.equal(second, '{"readinessSummary":"ok"}');
    assert.equal(fetchImpl.tokenCalls().length, 1, 'token endpoint hit exactly once');
    assert.equal(fetchImpl.generateCalls().length, 2);
  });

  it('401 clears the cached token so the next call re-authenticates', async () => {
    let generateCount = 0;
    const fetchImpl = makeFetch({
      generate: () => {
        generateCount++;
        if (generateCount === 1) {
          return mockResponse(401, { error: { message: 'Request had invalid authentication credentials.' } });
        }
        return mockResponse(200, VERTEX_OK_BODY);
      },
    });
    await assert.rejects(
      generateVertexText(TEXT_REQUEST, { fetchImpl }),
      (err) => err instanceof VertexError && err.status === 401
    );
    assert.equal(fetchImpl.tokenCalls().length, 1, 'one token fetch before the 401');

    const text = await generateVertexText(TEXT_REQUEST, { fetchImpl });
    assert.equal(text, '{"readinessSummary":"ok"}');
    assert.equal(fetchImpl.tokenCalls().length, 2, '401 forced a fresh token exchange');
    const secondGenerate = fetchImpl.generateCalls()[1];
    assert.equal(secondGenerate.headers.Authorization, 'Bearer ya29.dummy-token-2');
  });

  it('getVertexAccessToken caches across direct calls too', async () => {
    const fetchImpl = makeFetch();
    const a = await getVertexAccessToken(undefined, fetchImpl);
    const b = await getVertexAccessToken(undefined, fetchImpl);
    assert.equal(a, b);
    assert.equal(fetchImpl.tokenCalls().length, 1);
  });
});

describe('retry and failover semantics', () => {
  it('403 surfaces immediately: no retry, no fallback model', async () => {
    const fetchImpl = makeFetch({
      generate: () => mockResponse(403, { error: { message: 'PERMISSION_DENIED: billing not enabled.' } }),
    });
    await assert.rejects(
      generateVertexText(TEXT_REQUEST, { fetchImpl }),
      (err) => err instanceof VertexError && err.status === 403
    );
    const generates = fetchImpl.generateCalls();
    assert.equal(generates.length, 1, '403 must not be retried');
    assert.ok(!generates.some((c) => c.url.includes('gemini-3.5-flash')), '403 must not fall over to the fallback model');
  });

  it('fallback model is used on 404', async () => {
    const fetchImpl = makeFetch({
      generate: (call) => {
        if (call.url.includes('gemini-3.8-flash')) {
          return mockResponse(404, { error: { message: 'Model not found.' } });
        }
        return mockResponse(200, { candidates: [{ content: { parts: [{ text: 'fallback-text' }] } }] });
      },
    });
    const text = await generateVertexText(TEXT_REQUEST, { fetchImpl });
    assert.equal(text, 'fallback-text');
    const generates = fetchImpl.generateCalls();
    assert.equal(generates.length, 2);
    assert.ok(generates[0].url.includes('gemini-3.8-flash'));
    assert.ok(generates[1].url.includes('gemini-3.5-flash'));
  });

  it('both models 404: the configuration error surfaces as-is, not as a 503', async () => {
    const fetchImpl = makeFetch({
      generate: () => mockResponse(404, { error: { message: 'Model not found.' } }),
    });
    await assert.rejects(
      generateVertexText(TEXT_REQUEST, { fetchImpl }),
      (err) => err instanceof VertexError && err.status === 404
    );
    assert.equal(fetchImpl.generateCalls().length, 2, 'primary 404 then fallback 404, no retries');
  });

  it('429 is retried once on the same model, then succeeds', async () => {
    let generateCount = 0;
    const fetchImpl = makeFetch({
      generate: () => {
        generateCount++;
        if (generateCount === 1) return mockResponse(429, { error: { message: 'Resource exhausted.' } });
        return mockResponse(200, VERTEX_OK_BODY);
      },
    });
    const text = await generateVertexText(TEXT_REQUEST, { fetchImpl, retryDelayMs: 0 });
    assert.equal(text, '{"readinessSummary":"ok"}');
    assert.equal(fetchImpl.generateCalls().length, 2);
    assert.ok(fetchImpl.generateCalls().every((c) => c.url.includes('gemini-3.8-flash')), 'retry stays on the primary model');
  });

  it('429 on both attempts surfaces as upstream-unavailable, not a generic error', async () => {
    const fetchImpl = makeFetch({
      generate: () => mockResponse(429, { error: { message: 'Resource exhausted.' } }),
    });
    await assert.rejects(
      generateVertexText(TEXT_REQUEST, { fetchImpl, retryDelayMs: 0 }),
      (err) => err instanceof UpstreamUnavailableError
    );
    assert.equal(fetchImpl.generateCalls().length, 2, 'bounded: exactly two attempts on the primary');
  });
});

describe('request body shape', () => {
  it('carries camelCase systemInstruction and contents entries with an explicit user role', async () => {
    const fetchImpl = makeFetch();
    // Inject a token provider to isolate the body-shape assertion from
    // the JWT signing path (which the smoke test covers end-to-end).
    await generateVertexText(TEXT_REQUEST, {
      fetchImpl,
      getAccessToken: async () => 'injected-token',
    });
    const generates = fetchImpl.generateCalls();
    assert.equal(generates.length, 1);
    const call = generates[0];
    assert.equal(call.headers.Authorization, 'Bearer injected-token');
    const body = call.parsedBody;
    assert.ok(body, 'request body must be JSON');
    assert.ok('systemInstruction' in body, 'systemInstruction must be camelCase');
    assert.ok(!('system_instruction' in body), 'snake_case system_instruction must never be sent');
    assert.equal(body.systemInstruction.parts[0].text, 'You are a test system prompt.');
    assert.equal(body.contents[0].role, 'user', 'every content entry needs an explicit role');
    assert.equal(body.contents[0].parts[0].text, 'Say hello as JSON.');
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
  });

  it('stream wrapper yields the full text as a single chunk (analyze SSE shape)', async () => {
    const fetchImpl = makeFetch();
    const chunks = [];
    for await (const chunk of generateVertexContentStream('prompt text', { fetchImpl })) {
      chunks.push(chunk);
    }
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].text, '{"readinessSummary":"ok"}');
    const body = fetchImpl.generateCalls()[0].parsedBody;
    assert.equal(body.contents[0].role, 'user');
    assert.equal(body.contents[0].parts[0].text, 'prompt text');
  });
});

describe('fail-closed without a credential', () => {
  it('missing VERTEX_SERVICE_ACCOUNT_JSON fails closed; no provider call is attempted', async () => {
    delete process.env.VERTEX_SERVICE_ACCOUNT_JSON;
    const fetchImpl = makeFetch();
    await assert.rejects(
      generateVertexText(TEXT_REQUEST, { fetchImpl }),
      (err) => err instanceof VertexNotConfiguredError
    );
    assert.equal(fetchImpl.calls.length, 0, 'no token exchange and no generateContent without a credential');
  });

  it('switched code paths contain no AI Studio references', () => {
    const vertexSrc = readFileSync('./api/_lib/vertex-client.js', 'utf8');
    const analyzeSrc = readFileSync('./api/analyze.js', 'utf8');
    const reviewSrc = readFileSync('./api/review-image.js', 'utf8');
    for (const [name, src] of [['vertex-client.js', vertexSrc], ['analyze.js', analyzeSrc], ['review-image.js', reviewSrc]]) {
      assert.ok(!src.includes('@google/genai'), `${name} must not import @google/genai`);
      assert.ok(!src.includes('GEMINI_API_KEY'), `${name} must not reference GEMINI_API_KEY`);
    }
    assert.ok(/from ['"]\.\/_lib\/vertex-client\.js['"]/.test(analyzeSrc), 'analyze.js must use the Vertex client');
    assert.ok(/from ['"]\.\/_lib\/vertex-client\.js['"]/.test(reviewSrc), 'review-image.js must use the Vertex client');
  });
});

describe('smoke: dummy service account end-to-end over mocked fetch', () => {
  it('token request (real JWT signing) -> generateContent -> parsed JSON text', async () => {
    const fetchImpl = makeFetch();
    const text = await generateVertexText(TEXT_REQUEST, { fetchImpl });
    assert.equal(text, '{"readinessSummary":"ok"}');
    // Exactly two network calls, both to Google endpoints, both mocked:
    // the OAuth token exchange, then generateContent. Nothing real.
    assert.equal(fetchImpl.calls.length, 2);
    const [tokenCall, generateCall] = fetchImpl.calls;
    assert.equal(tokenCall.url, TOKEN_URL);
    assert.ok(tokenCall.body.includes('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer'));
    const assertion = decodeURIComponent(tokenCall.body.split('assertion=')[1]);
    assert.equal(assertion.split('.').length, 3, 'JWT assertion has header.payload.signature');
    assert.ok(generateCall.url.startsWith('https://aiplatform.googleapis.com/v1beta1/'));
    assert.ok(generateCall.url.includes('gemini-3.8-flash'));
    assert.equal(generateCall.headers.Authorization, 'Bearer ya29.dummy-token-1');
    // The returned text parses as the JSON the endpoints expect.
    assert.deepEqual(JSON.parse(text), { readinessSummary: 'ok' });
  });
});
