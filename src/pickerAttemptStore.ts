// Synchronous picker-attempt marker (2026-10-28, brief sections A/C).
// Problem it addresses: the 72689dc IndexedDB photo hold only runs AFTER
// handlePhotoChange fires. If the page is recreated DURING the native
// picker, change never fires, the hold never runs, and the restored page
// has no way to tell "picker opened, never resolved" apart from an
// ordinary restore. This marker is written synchronously at onClick,
// BEFORE the picker opens, so it can survive a same-tab reload that an
// asynchronous IndexedDB transaction in a dying page cannot be relied
// on to survive.
//
// Privacy: the marker carries NO file name, NO file contents, NO MIME
// type, NO size — only an attempt count and the document evidence key
// (docType), which is already stored in the assessment recovery payload.
// It is cleared on picker-change (file picked), on picker-cancel, on
// Start Over, and on packet completion, so a stale marker cannot make
// every later restore claim a recreation. If the Android process kill
// also clears sessionStorage, the marker will be absent on the restore
// boot — that case falls back to the generic "select the document
// again" notice, exactly as before. Marker survival on a real A17
// recreation is therefore still an unverified, device-tested claim.

export const PICKER_ATTEMPT_KEY = 'iru_picker_attempt_v1';

export interface PickerAttempt {
  openedAt: number;
  attemptCount: number;
  docType: string | null;
}

/** Minimal storage surface, mirroring diagnostics.ts StorageLike. */
export type PickerStorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function defaultStorage(): PickerStorageLike | null {
  try {
    const s = (globalThis as unknown as { sessionStorage?: PickerStorageLike })
      .sessionStorage;
    if (
      s &&
      typeof s.getItem === 'function' &&
      typeof s.setItem === 'function' &&
      typeof s.removeItem === 'function'
    ) {
      return s;
    }
  } catch {
    return null;
  }
  return null;
}

function resolveStorage(
  storage?: PickerStorageLike | null,
): PickerStorageLike | null {
  if (storage) return storage;
  return defaultStorage();
}

/**
 * Record a picker opening, synchronously. Must be called FIRST in the
 * input onClick handler, before saveRecovery and before the browser
 * hands control to the picker intent. Increments attemptCount when a
 * previous marker exists (i.e. a prior attempt was never resolved);
 * a cleared marker restarts the count at 1. Never throws, never blocks
 * the picker: storage failure simply means no marker for this attempt.
 */
export function markPickerOpened(
  docType: string | null,
  storage?: PickerStorageLike | null,
): void {
  try {
    const store = resolveStorage(storage);
    if (!store) return;
    const prev = readPickerAttempt(store);
    const next: PickerAttempt = {
      openedAt: Date.now(),
      attemptCount: (prev ? prev.attemptCount : 0) + 1,
      docType: typeof docType === 'string' && docType.length > 0 ? docType : null,
    };
    store.setItem(PICKER_ATTEMPT_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable — never block the picker.
  }
}

/** Read the current marker, or null when absent or malformed. */
export function readPickerAttempt(
  storage?: PickerStorageLike | null,
): PickerAttempt | null {
  try {
    const store = resolveStorage(storage);
    if (!store) return null;
    const raw = store.getItem(PICKER_ATTEMPT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PickerAttempt>;
    if (typeof parsed.openedAt !== 'number') return null;
    if (typeof parsed.attemptCount !== 'number') return null;
    return {
      openedAt: parsed.openedAt,
      attemptCount: parsed.attemptCount,
      docType:
        typeof parsed.docType === 'string' ? parsed.docType : null,
    };
  } catch {
    return null;
  }
}

/** Remove the marker. Safe to call when no marker exists. */
export function clearPickerAttempt(
  storage?: PickerStorageLike | null,
): void {
  try {
    const store = resolveStorage(storage);
    if (!store) return;
    store.removeItem(PICKER_ATTEMPT_KEY);
  } catch {
    // Ignore: clearing is best-effort.
  }
}
