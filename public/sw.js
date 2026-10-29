// IRU service worker — Web Share Target ONLY (2026-10-28).
//
// Purpose: on a Galaxy A17 every picker route recreates the page DURING
// the picker, before the file arrives. A file shared from Gallery/Files
// to the installed PWA does not go through a picker at all: Chrome
// launches the app with a multipart POST to the manifest share_target
// action, and this worker intercepts that POST, stores the File objects
// in browser-local IndexedDB, and redirects to the app root with
// ?shared=1, where the app consumes the file once onto the PHOTO stage.
//
// Deliberate limits, stated so the behaviour stays honest:
// - This worker NEVER caches anything. Every non-share request passes
//   through untouched, so a new Preview build can never be masked by a
//   stale cached app version. There is no offline mode.
// - The shared file is NEVER sent to any server by this worker. The only
//   network call that ever carries it is the existing /api/review-image
//   review call in App.tsx, unchanged.
// - The store below (iru-shared-store / iru-shared / current) is a NEW
//   store, separate from the photo hold (iru-photo-store). Its DB/store/
//   key names MUST match src/sharedFileStore.ts, which reads it.
// - If the POST cannot be stored (no files, formData failure, IDB
//   failure), the worker still redirects to the app root so the app
//   loads; the file is lost in that case, but the app never breaks.
// - If this worker is not yet installed/active (e.g. the very first
//   share, before the installed app has been opened once), the POST
//   reaches the server instead (Vercel rewrites it to /index.html) and
//   the file is lost. The owner test steps therefore say: open the
//   installed app once first, THEN share. Nothing here can fix a
//   pre-registration share.

var SHARE_TARGET_PATH = '/share-target';
var SHARED_FILE_FIELD = 'shared_files';
var SHARED_DB_NAME = 'iru-shared-store';
var SHARED_STORE_NAME = 'iru-shared';
var SHARED_KEY = 'current';

function isShareTargetRequest(request) {
  try {
    if (!request || request.method !== 'POST') return false;
    var url = new URL(request.url);
    return url.pathname === SHARE_TARGET_PATH;
  } catch (e) {
    return false;
  }
}

function sharedRedirectUrl() {
  try {
    if (typeof self !== 'undefined' && self.location) {
      return new URL('/?shared=1', self.location.href).toString();
    }
  } catch (e) {
    // Fall through to the relative URL.
  }
  return '/?shared=1';
}

function idbRequestToPromise(req) {
  return new Promise(function (resolve, reject) {
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error || new Error('IndexedDB request failed')); };
  });
}

function openSharedDb() {
  var req = indexedDB.open(SHARED_DB_NAME, 1);
  req.onupgradeneeded = function () {
    try {
      var db = req.result;
      if (!db.objectStoreNames.contains(SHARED_STORE_NAME)) {
        db.createObjectStore(SHARED_STORE_NAME);
      }
    } catch (e) {
      // Creation failure surfaces via the caller's catch.
    }
  };
  return idbRequestToPromise(req);
}

function putSharedFiles(files) {
  return openSharedDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx;
      try {
        tx = db.transaction(SHARED_STORE_NAME, 'readwrite');
        tx.objectStore(SHARED_STORE_NAME).put(
          { files: files, savedAt: Date.now() },
          SHARED_KEY,
        );
      } catch (e) {
        reject(e);
        return;
      }
      tx.oncomplete = function () {
        try { db.close(); } catch (e) { /* ignore */ }
        resolve();
      };
      tx.onerror = function () { reject(tx.error || new Error('IndexedDB transaction failed')); };
      tx.onabort = function () { reject(tx.error || new Error('IndexedDB transaction aborted')); };
    });
  });
}

function handleShareTarget(event) {
  event.respondWith((async function () {
    try {
      var formData = await event.request.formData();
      var files = formData.getAll(SHARED_FILE_FIELD).filter(function (f) {
        return f && typeof f !== 'string';
      });
      if (files.length > 0) {
        await putSharedFiles(files);
      }
      return Response.redirect(sharedRedirectUrl(), 303);
    } catch (e) {
      // Never break the app on a share failure: load the root.
      try {
        return Response.redirect(sharedRedirectUrl(), 303);
      } catch (e2) {
        return new Response('', { status: 303, headers: { Location: '/' } });
      }
    }
  })());
}

// Guarded so this file can be loaded in a test harness (where `self`
// is a stub) without registering listeners against a missing global.
// In a real browser worker, `self` is always defined.
if (typeof self !== 'undefined' && self.addEventListener) {
  self.addEventListener('install', function (event) {
    try {
      if (event.waitUntil) event.waitUntil(self.skipWaiting());
    } catch (e) {
      // Activation failure must never break the app.
    }
  });
  self.addEventListener('activate', function (event) {
    try {
      if (event.waitUntil) event.waitUntil(self.clients.claim());
    } catch (e) {
      // Claim failure must never break the app.
    }
  });
  self.addEventListener('fetch', function (event) {
    try {
      if (isShareTargetRequest(event.request)) {
        handleShareTarget(event);
      }
      // Every other request: passthrough. No caching, by design.
    } catch (e) {
      // A handler failure must never break an unrelated request.
    }
  });
}
