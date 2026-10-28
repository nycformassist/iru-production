// File System Access picker route + on-device handle probes (2026-10-28,
// supplement item 2). EXPERIMENT, debug-gated: see PICKER_ROUTES_PUBLIC.
//
// WHY THIS EXISTS. The A17 logs prove the failing mechanism: the page is
// recreated while the native picker is foreground, so the <input type=file>
// `change` event never fires in any live page. They also show
// `showOpenFilePicker` is PRESENT on that phone (feature-detect only).
// API presence is not proof of anything else. Two things are unknown and
// can only be settled on the device:
//
//   Q1. Does picking through showOpenFilePicker AVOID the recreation that
//       the <input> route suffers? (If the picker promise resolves in a
//       live page, that is a fix: use this route where available.)
//   Q2. Does a stored FileSystemFileHandle stay usable after a recreation,
//       or does it need a new permission grant? Chrome's own documentation
//       says a handle retrieved from IndexedDB is "likely to return
//       'prompt'", i.e. it must be re-granted with a user gesture.
//
// What this module can NOT do, stated plainly: a handle only reaches
// IndexedDB if the picker promise resolves in a LIVE page. If the page is
// recreated during the picker, the promise dies with it and nothing is
// stored, exactly like the <input> route. Handle persistence therefore
// cannot, by itself, rescue a during-picker recreation; it matters only
// after the handle has arrived. Q1 is the decisive question.
//
// The production blob hold (photoFileStore.ts, 72689dc) is unchanged and
// remains the thing that restores a landed file. This module adds NO
// production behaviour: every UI entry point is gated by
// pickerRoutesVisible(), which is false for normal users.
//
// Privacy: nothing here sends anything anywhere. Handles are stored in
// this browser's IndexedDB only, in a separate database, and are cleared
// wherever the photo hold is cleared (Start Over, packet completion,
// successful review). Diagnostics from this module carry only enumerated
// states, booleans, a MIME class, and a size bucket — never a file name,
// never a message or stack.

import { summarizeFileForDiagnostics } from './diagnostics.ts';
import type { DiagnosticDetail } from './diagnostics.ts';

/**
 * Flip to true ONLY after the A17 test shows a route is a real fix.
 * While false, the alternate routes are reachable only with ?debug=1.
 */
export const PICKER_ROUTES_PUBLIC = false;

export function pickerRoutesVisible(debugEnabled: boolean): boolean {
  return PICKER_ROUTES_PUBLIC || debugEnabled === true;
}

export const FSA_HANDLE_DB_NAME = 'iru-photo-handle-store';
export const FSA_HANDLE_STORE_NAME = 'handle';
export const FSA_HANDLE_KEY = 'current';

/** The slice of FileSystemFileHandle this module uses. */
export interface FsaFileHandle {
  getFile: () => Promise<File>;
  queryPermission?: (d?: { mode?: 'read' | 'readwrite' }) => Promise<string>;
  requestPermission?: (d?: { mode?: 'read' | 'readwrite' }) => Promise<string>;
}

export interface StoredHandle {
  handle: FsaFileHandle;
  evidenceKey: string;
  savedAt: number;
}

export type FsaPickResult =
  | { status: 'picked'; handle: FsaFileHandle; file: File }
  | { status: 'cancelled' }
  | { status: 'unsupported' }
  | { status: 'error'; errorName: string; stage: 'picker' | 'getFile' };

export const FSA_PICKER_OPTIONS = {
  multiple: false,
  excludeAcceptAllOption: false,
  types: [
    {
      description: 'Document photo or PDF',
      accept: {
        'image/jpeg': ['.jpg', '.jpeg'],
        'image/png': ['.png'],
        'image/webp': ['.webp'],
        'image/gif': ['.gif'],
        'application/pdf': ['.pdf'],
      },
    },
  ],
};

/** Error NAME only, and only if it is a plain identifier. */
function safeName(e: unknown): string {
  try {
    const n = e && typeof (e as { name?: unknown }).name === 'string' ? (e as { name: string }).name : '';
    return /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(n) ? n : 'unknown';
  } catch {
    return 'unknown';
  }
}

function safePermission(p: unknown): 'granted' | 'prompt' | 'denied' | 'unknown' {
  return p === 'granted' || p === 'prompt' || p === 'denied' ? p : 'unknown';
}

export function hasFsaPicker(g: unknown = globalThis): boolean {
  try {
    return typeof (g as { showOpenFilePicker?: unknown }).showOpenFilePicker === 'function';
  } catch {
    return false;
  }
}

/**
 * Open the File System Access picker. MUST be called synchronously from a
 * user-gesture handler: the first statement that runs is the
 * showOpenFilePicker call itself, with no await before it (an await first
 * would spend the user activation and the browser would refuse).
 * Never throws; every failure is returned as an enumerated result.
 */
export async function pickViaFsa(g: unknown = globalThis): Promise<FsaPickResult> {
  const api = g as { showOpenFilePicker?: (o: unknown) => Promise<unknown> };
  if (typeof api.showOpenFilePicker !== 'function') return { status: 'unsupported' };
  let handles: unknown;
  try {
    handles = await api.showOpenFilePicker(FSA_PICKER_OPTIONS);
  } catch (e) {
    const name = safeName(e);
    return name === 'AbortError' ? { status: 'cancelled' } : { status: 'error', errorName: name, stage: 'picker' };
  }
  const handle = Array.isArray(handles) ? (handles[0] as FsaFileHandle | undefined) : undefined;
  if (!handle || typeof handle.getFile !== 'function') {
    return { status: 'error', errorName: 'NoHandle', stage: 'picker' };
  }
  try {
    const file = await handle.getFile();
    return { status: 'picked', handle, file };
  } catch (e) {
    return { status: 'error', errorName: safeName(e), stage: 'getFile' };
  }
}

// ---------------------------------------------------------------------
// Handle store: separate IndexedDB database so the 72689dc photo store
// (schema v1, one object store) is not touched. No in-memory fallback:
// a handle that cannot be persisted has no value for this experiment.
// ---------------------------------------------------------------------

function getIdb(idb?: unknown): any {
  if (idb) return idb;
  try {
    return typeof indexedDB !== 'undefined' ? indexedDB : null;
  } catch {
    return null;
  }
}

function req2p<T>(req: any): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
  });
}

async function withStore<T>(idb: any, mode: 'readonly' | 'readwrite', op: (store: any) => any): Promise<T | undefined> {
  const open = idb.open(FSA_HANDLE_DB_NAME, 1);
  open.onupgradeneeded = () => {
    try {
      const db = open.result;
      if (!db.objectStoreNames.contains(FSA_HANDLE_STORE_NAME)) db.createObjectStore(FSA_HANDLE_STORE_NAME);
    } catch {
      /* surfaced by the caller's catch */
    }
  };
  const db: any = await req2p(open);
  try {
    const tx = db.transaction(FSA_HANDLE_STORE_NAME, mode);
    const req = op(tx.objectStore(FSA_HANDLE_STORE_NAME));
    if (mode === 'readonly') return await req2p<T>(req);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
    return undefined;
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
}

/** Persist the handle (structured clone). Never throws. */
export async function saveFsaHandle(handle: FsaFileHandle, evidenceKey: string, idb?: unknown): Promise<boolean> {
  try {
    const store = getIdb(idb);
    if (!store) return false;
    const record: StoredHandle = { handle, evidenceKey: evidenceKey || '', savedAt: Date.now() };
    await withStore(store, 'readwrite', (s) => s.put(record, FSA_HANDLE_KEY));
    return true;
  } catch {
    return false;
  }
}

/** Load the stored handle, or null. Never throws. */
export async function loadFsaHandle(idb?: unknown): Promise<StoredHandle | null> {
  try {
    const store = getIdb(idb);
    if (!store) return null;
    const v = await withStore<StoredHandle | null>(store, 'readonly', (s) => s.get(FSA_HANDLE_KEY));
    return v && v.handle && typeof v.handle.getFile === 'function' ? v : null;
  } catch {
    return null;
  }
}

/** Remove the stored handle. Never throws. */
export async function clearFsaHandle(idb?: unknown): Promise<boolean> {
  try {
    const store = getIdb(idb);
    if (!store) return true;
    await withStore(store, 'readwrite', (s) => s.delete(FSA_HANDLE_KEY));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------
// Boot-time and tap-time probes. These ANSWER Q2 on the device.
// ---------------------------------------------------------------------

type Recorder = (type: string, detail?: DiagnosticDetail) => void;

/**
 * Boot probe (debug only). Reports whether a stored handle exists, what
 * permission state it has after the recreation, and — only if permission
 * is already granted — whether getFile() works. It never calls
 * requestPermission (that needs a user gesture; see regrantStoredHandle).
 * Returns true when a stored handle was found.
 */
export async function probeStoredHandle(
  record: Recorder,
  load: () => Promise<StoredHandle | null> = loadFsaHandle,
): Promise<boolean> {
  try {
    const stored = await load();
    if (!stored) {
      record('fsa-handle-probe', { found: false });
      return false;
    }
    const h = stored.handle;
    let permission: string = 'unsupported';
    if (typeof h.queryPermission === 'function') {
      try {
        permission = safePermission(await h.queryPermission({ mode: 'read' }));
      } catch (e) {
        permission = `error:${safeName(e)}`;
      }
    }
    const detail: DiagnosticDetail = { found: true, permission };
    if (permission === 'granted') {
      try {
        const file = await h.getFile();
        const s = summarizeFileForDiagnostics(file);
        detail.getFileOk = true;
        detail.mimeClass = s.mimeClass;
        detail.sizeBucket = s.sizeBucket;
      } catch (e) {
        detail.getFileOk = false;
        detail.errorName = safeName(e);
      }
    }
    record('fsa-handle-probe', detail);
    return true;
  } catch {
    try {
      record('fsa-handle-probe', { found: false, probeFailed: true });
    } catch {
      /* never break boot */
    }
    return false;
  }
}

/**
 * Tap-time re-grant (debug only; must run inside a click handler so
 * requestPermission has a user gesture). Returns the File on success.
 */
export async function regrantStoredHandle(
  record: Recorder,
  load: () => Promise<StoredHandle | null> = loadFsaHandle,
): Promise<{ file: File; evidenceKey: string } | null> {
  try {
    const stored = await load();
    if (!stored) {
      record('fsa-handle-regrant', { found: false });
      return null;
    }
    const h = stored.handle;
    let permission: string = 'unsupported';
    if (typeof h.requestPermission === 'function') {
      try {
        permission = safePermission(await h.requestPermission({ mode: 'read' }));
      } catch (e) {
        permission = `error:${safeName(e)}`;
      }
    }
    const detail: DiagnosticDetail = { found: true, permission };
    let file: File | null = null;
    if (permission === 'granted') {
      try {
        file = await h.getFile();
        const s = summarizeFileForDiagnostics(file);
        detail.getFileOk = true;
        detail.mimeClass = s.mimeClass;
        detail.sizeBucket = s.sizeBucket;
      } catch (e) {
        detail.getFileOk = false;
        detail.errorName = safeName(e);
      }
    }
    record('fsa-handle-regrant', detail);
    return file ? { file, evidenceKey: stored.evidenceKey } : null;
  } catch {
    try {
      record('fsa-handle-regrant', { found: false, probeFailed: true });
    } catch {
      /* ignore */
    }
    return null;
  }
}
