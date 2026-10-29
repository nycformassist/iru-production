// Browser-local hold for a file shared TO the installed PWA via
// Web Share Target (2026-10-28). The service worker (public/sw.js)
// intercepts the share POST, stores the File objects here, and
// redirects to /?shared=1; the app consumes them once onto the PHOTO
// stage (see App.tsx) and clears this store, so a later reload never
// re-applies the same share.
//
// This is a NEW store, separate from the picked-photo hold
// (src/photoFileStore.ts, iru-photo-store). The DB/store/key names
// MUST match public/sw.js, which writes this store. Nothing in this
// module sends anything anywhere: the only network call that ever
// carries the file is the existing /api/review-image review call in
// App.tsx, unchanged. The shared file follows the same clear rules as
// the photo hold: cleared on Start Over, on packet completion, and
// after a successful review (the review result is kept in the uploads
// checklist; the blob is no longer needed). It is KEPT on review
// failure — via the normal photo hold, into which the consumed file
// is also saved — so Retry works. It never throws into the boot flow.

export const SHARED_FILE_DB_NAME = 'iru-shared-store';
export const SHARED_FILE_STORE_NAME = 'iru-shared';
export const SHARED_FILE_KEY = 'current';

export interface SharedFileRecord {
  files: Blob[];
  savedAt: number;
}

// In-memory fallback only: used when IndexedDB is unavailable
// (including the node test harness, which has no indexedDB). It holds
// the file for the current page only and cannot survive a recreation.
let memoryShared: SharedFileRecord | null = null;

function idbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function requestToPromise<T>(req: any): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
  });
}

async function openDb(): Promise<any> {
  const req = indexedDB.open(SHARED_FILE_DB_NAME, 1);
  req.onupgradeneeded = () => {
    try {
      const db = req.result;
      if (!db.objectStoreNames.contains(SHARED_FILE_STORE_NAME)) {
        db.createObjectStore(SHARED_FILE_STORE_NAME);
      }
    } catch {
      // Creation failure is handled by the caller's catch.
    }
  };
  return requestToPromise(req);
}

/** Load the shared record, if any. Prefers IndexedDB; falls back to memory. Never throws. */
export async function loadSharedFile(): Promise<SharedFileRecord | null> {
  try {
    if (idbAvailable()) {
      try {
        const db = await openDb();
        try {
          const tx = db.transaction(SHARED_FILE_STORE_NAME, 'readonly');
          const value = await requestToPromise<SharedFileRecord | null>(
            tx.objectStore(SHARED_FILE_STORE_NAME).get(SHARED_FILE_KEY),
          );
          if (value && value.files) {
            memoryShared = value;
            return value;
          }
        } finally {
          try {
            db.close();
          } catch {
            // Ignore close failures.
          }
        }
      } catch (err) {
        try {
          console.warn('Shared file store: IndexedDB read failed, using in-memory hold only', err);
        } catch {
          // Ignore logging failures.
        }
      }
    }
    return memoryShared;
  } catch {
    return null;
  }
}

/** Clear the shared record from both IndexedDB and memory. Never throws. */
export async function clearSharedFile(): Promise<boolean> {
  memoryShared = null;
  try {
    if (idbAvailable()) {
      try {
        const db = await openDb();
        try {
          const tx = db.transaction(SHARED_FILE_STORE_NAME, 'readwrite');
          tx.objectStore(SHARED_FILE_STORE_NAME).delete(SHARED_FILE_KEY);
          await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
            tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
          });
        } finally {
          try {
            db.close();
          } catch {
            // Ignore close failures.
          }
        }
      } catch (err) {
        try {
          console.warn('Shared file store: IndexedDB clear failed', err);
        } catch {
          // Ignore logging failures.
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Consume a shared file ONCE: load it, then clear the shared store so
 * a later reload never re-applies the same share. Returns the files,
 * or null when nothing was shared. Never throws. The caller is
 * responsible for saving the consumed file into the normal photo hold
 * (src/photoFileStore.ts) so it survives later recreations and follows
 * the normal clear-on-success / keep-on-failure rules.
 */
export async function consumeSharedFile(): Promise<Blob[] | null> {
  try {
    const record = await loadSharedFile();
    if (!record || !record.files || record.files.length === 0) return null;
    // Clear first: even if the caller then fails to use the file, a
    // stale share must never be re-applied on the next boot. The
    // caller holds the returned files in memory for this page.
    await clearSharedFile();
    return record.files;
  } catch {
    return null;
  }
}

/** Test-only: seed the in-memory fallback without touching IndexedDB. */
export function __testSeedSharedFile(files: Blob[]): void {
  memoryShared = { files, savedAt: Date.now() };
}

/** Test-only: reset the in-memory fallback without touching IndexedDB. */
export function __testResetSharedFileStoreMemory(): void {
  memoryShared = null;
}
