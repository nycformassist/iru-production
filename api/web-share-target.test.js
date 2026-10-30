// Web Share Target (2026-10-28): the installed PWA can receive a file
// shared from Gallery/Files, bypassing the native picker that recreates
// the page DURING the pick on the A17. Synthetic fixtures only.
// Behavioural where the logic is a pure module (shared store, service
// worker handler via a vm harness); source-guarded where it lives in
// App.tsx (React/JSX cannot run under the node harness).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import {
  SHARED_FILE_DB_NAME,
  SHARED_FILE_STORE_NAME,
  SHARED_FILE_KEY,
  consumeSharedFile,
  clearSharedFile,
  __testSeedSharedFile,
  __testResetSharedFileStoreMemory,
} from '../src/sharedFileStore.ts';
import {
  PHOTO_STORE_DB_NAME,
  PHOTO_STORE_NAME,
} from '../src/photoFileStore.ts';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const swSrc = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const manifestText = readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8');
const manifest = JSON.parse(manifestText);
const mainSrc = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function pngSize(path) {
  const buf = readFileSync(new URL(path, import.meta.url));
  assert.equal(buf[0], 0x89, 'PNG signature');
  assert.equal(buf.toString('ascii', 1, 4), 'PNG');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

test('manifest: valid, installable, and declares a file share target', () => {
  assert.ok(manifest.name && manifest.short_name, 'name + short_name');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.theme_color && manifest.background_color, 'theme + background');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2, 'icons present');
  const st = manifest.share_target;
  assert.ok(st, 'share_target present');
  assert.equal(st.action, '/share-target');
  assert.equal(st.method, 'POST');
  assert.equal(st.enctype, 'multipart/form-data');
  assert.ok(Array.isArray(st.params.files) && st.params.files.length >= 1, 'files params');
  const files = st.params.files[0];
  assert.equal(files.name, 'shared_files');
  // BOTH MIME types and extensions: Chrome for Android is picky here.
  for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']) {
    assert.ok(files.accept.includes(mime), `accept includes ${mime}`);
  }
  for (const ext of ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.pdf']) {
    assert.ok(files.accept.includes(ext), `accept includes ${ext}`);
  }
});

test('manifest: declared icons exist at the declared sizes', () => {
  for (const icon of manifest.icons) {
    const p = `../public${icon.src}`;
    assert.ok(existsSync(new URL(p, import.meta.url)), `${icon.src} exists`);
    const { width, height } = pngSize(p);
    const [w, h] = String(icon.sizes).split('x').map(Number);
    assert.equal(width, w, `${icon.src} width`);
    assert.equal(height, h, `${icon.src} height`);
  }
});

test('index + main: manifest linked and service worker registered, non-fatally', () => {
  assert.match(indexHtml, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(mainSrc, /serviceWorker\.register\('\/sw\.js'\)/);
  assert.match(mainSrc, /catch\(\(\) => \{\}\)/);
});

test('shared store: separate database/store/key from the photo hold', () => {
  assert.equal(SHARED_FILE_DB_NAME, 'iru-shared-store');
  assert.equal(SHARED_FILE_STORE_NAME, 'iru-shared');
  assert.equal(SHARED_FILE_KEY, 'current');
  assert.notEqual(SHARED_FILE_DB_NAME, PHOTO_STORE_DB_NAME);
  assert.notEqual(SHARED_FILE_STORE_NAME, PHOTO_STORE_NAME);
  assert.match(swSrc, /iru-shared-store/);
  assert.match(swSrc, /iru-shared/);
});

test('shared store: consume reads once, then a later load returns null', async () => {
  __testResetSharedFileStoreMemory();
  const file = new File(['shared-document-bytes'], 'shared-doc.jpg', { type: 'image/jpeg' });
  __testSeedSharedFile([file]);
  const consumed = await consumeSharedFile();
  assert.ok(consumed && consumed.length === 1, 'one file consumed');
  assert.equal(await consumed[0].text(), 'shared-document-bytes');
  assert.equal(await consumeSharedFile(), null, 'second consume is empty');
  await clearSharedFile();
});

test('shared store: clear is idempotent and never throws', async () => {
  __testResetSharedFileStoreMemory();
  assert.equal(await clearSharedFile(), true);
  assert.equal(await clearSharedFile(), true);
});

// Minimal IndexedDB double for the service-worker harness: open/upgrade,
// put/get/delete, transaction completion. Mirrors the fake used by the
// picker-routes tests.
function fakeIdb() {
  const dbs = new Map();
  return {
    _dbs: dbs,
    open(name) {
      const req = {};
      queueMicrotask(() => {
        if (!dbs.has(name)) dbs.set(name, new Map());
        const dbStores = dbs.get(name);
        const db = {
          objectStoreNames: { contains: (s) => dbStores.has(s) },
          createObjectStore: (s) => { if (!dbStores.has(s)) dbStores.set(s, new Map()); },
          transaction: (storeName) => {
            if (!dbStores.has(storeName)) dbStores.set(storeName, new Map());
            const store = dbStores.get(storeName);
            const tx = {
              oncomplete: null, onerror: null, onabort: null, error: null,
              objectStore: () => ({
                put: (val, key) => {
                  store.set(key, val);
                  const r = {};
                  queueMicrotask(() => { r.result = key; r.onsuccess && r.onsuccess(); });
                  return r;
                },
                get: (key) => {
                  const r = {};
                  queueMicrotask(() => { r.result = store.has(key) ? store.get(key) : undefined; r.onsuccess && r.onsuccess(); });
                  return r;
                },
                delete: (key) => {
                  store.delete(key);
                  const r = {};
                  queueMicrotask(() => { r.onsuccess && r.onsuccess(); });
                  return r;
                },
              }),
            };
            queueMicrotask(() => { tx.oncomplete && tx.oncomplete(); });
            return tx;
          },
          close: () => {},
        };
        req.result = db;
        if (req.onupgradeneeded) req.onupgradeneeded();
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    },
  };
}

function loadSwHarness() {
  const listeners = new Map();
  const idb = fakeIdb();
  const sandbox = {
    console,
    URL,
    indexedDB: idb,
    Response: class {
      static redirect(url, status) { return { url, status, redirected: true }; }
      constructor(body, init) { this.body = body; this.status = init && init.status; }
    },
    self: {
      location: { href: 'https://preview.example/' },
      skipWaiting: () => {},
      clients: { claim: () => {} },
      addEventListener: (type, fn) => {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
    },
  };
  sandbox.self.self = sandbox.self;
  vm.createContext(sandbox);
  vm.runInContext(swSrc, sandbox, { filename: 'sw.js' });
  return { listeners, idb, sandbox };
}

test('service worker: share POST stores the file and redirects to ?shared=1', async () => {
  const { listeners, idb } = loadSwHarness();
  assert.ok(listeners.has('fetch'), 'fetch listener registered');
  const file = { name: 'shared-doc.jpg', type: 'image/jpeg', size: 1234 };
  let respondWithArg;
  const event = {
    request: {
      method: 'POST',
      url: 'https://preview.example/share-target',
      formData: async () => ({ getAll: (name) => (name === 'shared_files' ? [file] : []) }),
    },
    respondWith: (p) => { respondWithArg = p; },
  };
  for (const fn of listeners.get('fetch')) fn(event);
  assert.ok(respondWithArg, 'share POST got respondWith');
  const res = await respondWithArg;
  assert.equal(res.status, 303);
  assert.ok(String(res.url).includes('?shared=1'), 'redirect carries shared flag');
  // Stored record: the worker's own DB, key 'current', file inside.
  const stored = idb._dbs.get('iru-shared-store').get('iru-shared').get('current');
  assert.ok(stored, 'shared record stored');
  assert.equal(stored.files[0], file, 'stored file is the shared file');
});

test('service worker: a non-share request is untouched (no respondWith, no cache)', () => {
  const { listeners } = loadSwHarness();
  let called = false;
  const event = {
    request: { method: 'GET', url: 'https://preview.example/' },
    respondWith: () => { called = true; },
  };
  for (const fn of listeners.get('fetch')) fn(event);
  assert.equal(called, false, 'navigation GET is not intercepted');
  assert.ok(!/caches\.open|caches\.put|cache\.put/.test(swSrc), 'worker caches nothing');
  assert.ok(!/fetch\(/.test(swSrc.replace(/addEventListener/g, '')), 'worker makes no network fetch');
});

test('app boot: shared file is consumed once and lands on PHOTO', () => {
  assert.match(app, /consumeSharedFile\(\)/);
  assert.ok(!app.includes('shared-file-received'), 'the shared-file debug event was testing instrumentation (removed 2026-10-29)');
  assert.match(app, /setStage\('PHOTO'\)/);
  assert.match(app, /photoSharedNotice/);
  // The shared notice never shows a file name: it is a fixed string.
  const sharedBlock = app.slice(app.indexOf('photoSharedNotice'));
  assert.ok(!/photoFile\.name/.test(sharedBlock.slice(0, 800)), 'shared notice carries no file name');
});

test('app clear rules: shared file clears on Start Over, packet, and successful review', () => {
  const startOver = app.slice(app.indexOf('const handleStartOver'));
  assert.match(startOver, /clearSharedFile\(\)/);
  const packet = app.slice(app.indexOf("if (stage === 'PACKET')"));
  assert.match(packet, /clearSharedFile\(\)/);
  const review = app.slice(app.indexOf('const handlePhotoReview'));
  assert.match(review, /clearSharedFile\(\)/);
  // Review failure paths do not clear the photo hold; the shared file
  // survives failure via the normal hold it was copied into.
  assert.match(app, /setPhotoSharedNotice\(''\)/);
});

test('app: shared arrival is triggered by the store alone, never by URL parameters', () => {
  // The SHARE TARGET flow (?shared=1) must not parse URL parameters —
  // the trigger is the shared-file store alone. (Phase 2 adds a
  // separate Stripe-return handler that reads ?checkout=success as a
  // trigger for server verification; that is scoped to the paywall
  // journey and does not affect share-target arrival.)
  // Extract the share-target section and verify it has no URL parsing.
  const shareIdx = app.indexOf('Web Share Target arrival');
  assert.ok(shareIdx !== -1, 'share-target section exists');
  const shareSection = app.slice(shareIdx, shareIdx + 3000);
  assert.ok(!/location\.search/.test(shareSection), 'share-target section: no location.search');
  assert.ok(!/URLSearchParams/.test(shareSection), 'share-target section: no URLSearchParams');
  assert.ok(!/shared=1/.test(shareSection) || shareSection.includes('does\n  // NOT read the URL'),
    'share-target section documents that it does not read the URL flag');
});

test('app: no questionnaire gating or record invention for a shared file', () => {
  assert.match(app, /Answers are never invented/);
  assert.ok(!/photoShared.*case_type|case_type.*photoShared/.test(app), 'no gating tied to shared arrival');
});
