// Browser-local temporary hold for a picked document photo (owner ruling
// 2026-10-28). Purpose: a picked file must survive a page recreation on
// Android Chrome (page discard / back_forward reload while the native
// picker is foreground). Previously the file lived only in React state,
// so any recreation lost it and the user saw "Please select the document
// again." — even though the stage itself was restored.
//
// Scope and privacy, stated plainly so the UI wording can stay honest:
// - Storage is IndexedDB in THIS browser only, one object store, one
//   record. Nothing is sent anywhere by this module. The only network
//   call that ever carries the file is the existing /api/review-image
//   review call in App.tsx, unchanged.
// - The hold is temporary by rule, not by accident: it is cleared on
//   Start Over, on packet completion, and after a successful review
//   (the review result is kept in the uploads checklist; the blob is
//   no longer needed). It is KEPT on review failure so Retry works.
// - It never throws into the picker flow. Every operation is wrapped in
//   try/catch, falls back to an in-memory hold if IndexedDB is
//   unavailable (that fallback cannot survive a recreation, by nature),
//   and never blocks the UI on a store write: callers fire-and-forget.
// - It never touches payment or entitlement keys; those live elsewhere
//   and are cleared only by their own rules.

export const PHOTO_STORE_DB_NAME = 'iru-photo-store';
export const PHOTO_STORE_NAME = 'iru-photo';
export const PHOTO_STORE_KEY = 'current';

export interface StoredPhoto {
  blob: Blob;
  name: string;
  type: string;
  evidenceKey: string;
  savedAt: number;
}

// In-memory fallback only: used when IndexedDB is unavailable (including
// the node test harness, which has no indexedDB). It holds the file for
// the current page only and cannot survive a recreation.
let memoryHold: StoredPhoto | null = null;

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
  const req = indexedDB.open(PHOTO_STORE_DB_NAME, 1);
  req.onupgradeneeded = () => {
    try {
      const db = req.result;
      if (!db.objectStoreNames.contains(PHOTO_STORE_NAME)) {
        db.createObjectStore(PHOTO_STORE_NAME);
      }
    } catch {
      // Creation failure is handled by the caller's catch.
    }
  };
  return requestToPromise(req);
}

async function idbPut(record: StoredPhoto): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(PHOTO_STORE_NAME, 'readwrite');
    tx.objectStore(PHOTO_STORE_NAME).put(record, PHOTO_STORE_KEY);
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
}

async function idbGet(): Promise<StoredPhoto | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(PHOTO_STORE_NAME, 'readonly');
    const value = await requestToPromise<StoredPhoto | null>(
      tx.objectStore(PHOTO_STORE_NAME).get(PHOTO_STORE_KEY),
    );
    return value || null;
  } finally {
    try {
      db.close();
    } catch {
      // Ignore close failures.
    }
  }
}

async function idbDelete(): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(PHOTO_STORE_NAME, 'readwrite');
    tx.objectStore(PHOTO_STORE_NAME).delete(PHOTO_STORE_KEY);
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
}

/** Persist a picked file. Replaces any previously held file. Never throws. */
export async function savePhotoFile(file: Blob, evidenceKey: string): Promise<boolean> {
  try {
    const record: StoredPhoto = {
      blob: file,
      name: (file as File).name || 'document',
      type: file.type || '',
      evidenceKey: evidenceKey || '',
      savedAt: Date.now(),
    };
    // Memory hold is always updated as a same-page backup, even when
    // IndexedDB succeeds, so a transient IDB read failure cannot lose
    // the file in the current page.
    memoryHold = record;
    if (!idbAvailable()) return true;
    try {
      await idbPut(record);
    } catch (err) {
      // IDB failure is not fatal: the memory hold still covers this page.
      try {
        console.warn('Photo store: IndexedDB write failed, using in-memory hold only', err);
      } catch {
        // Logging must never break the picker flow.
      }
    }
    return true;
  } catch (err) {
    try {
      console.warn('Photo store: could not hold picked file', err);
    } catch {
      // Ignore logging failures.
    }
    return false;
  }
}

/** Load the held file, if any. Prefers IndexedDB; falls back to memory. Never throws. */
export async function loadPhotoFile(): Promise<StoredPhoto | null> {
  try {
    if (idbAvailable()) {
      try {
        const fromIdb = await idbGet();
        if (fromIdb && fromIdb.blob) {
          memoryHold = fromIdb;
          return fromIdb;
        }
      } catch (err) {
        try {
          console.warn('Photo store: IndexedDB read failed, using in-memory hold only', err);
        } catch {
          // Ignore logging failures.
        }
      }
    }
    return memoryHold;
  } catch {
    return null;
  }
}

/** Clear the held file from both IndexedDB and memory. Never throws. */
export async function clearPhotoFile(): Promise<boolean> {
  memoryHold = null;
  try {
    if (idbAvailable()) {
      try {
        await idbDelete();
      } catch (err) {
        try {
          console.warn('Photo store: IndexedDB clear failed', err);
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

/** Test-only: reset the in-memory fallback without touching IndexedDB. */
export function __testResetPhotoStoreMemory(): void {
  memoryHold = null;
}
