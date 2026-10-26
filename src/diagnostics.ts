// Lightweight diagnostics for the IRU Android document-picker recovery
// pass (2026-10-26). Framework-free and DOM-free at import time so the
// logic is unit-testable under the existing node test harness.
//
// ACTIVATION: diagnostics are collected in memory always (cheap ring
// buffer), but the on-screen overlay is rendered ONLY when the page URL
// contains "?debug=1". Normal users never see it.
//
// PRIVACY CONTRACT (enforced by call sites, verified by test): record()
// stores exactly what the caller passes — type, timestamp, and a detail
// object. Callers must pass ONLY non-sensitive facts: stage names,
// event names, booleans, and counters. NEVER pass answers, names,
// addresses, file names, file contents, document previews, review
// output, or payment data. Error events record the error NAME only,
// never the message or stack, because messages can embed user data.

export const DIAGNOSTIC_PARAM = 'debug';
export const DIAGNOSTIC_VALUE = '1';
export const DIAGNOSTIC_EVENT_LIMIT = 30;
export const DIAGNOSTIC_BOOT_SESSION_KEY = 'iru_diag_boot_session';
export const DIAGNOSTIC_BOOT_TOTAL_KEY = 'iru_diag_boot_total';

declare const __IRU_BUILD_SHA__: string | undefined;

/** Minimal storage surface; real Storage satisfies it, tests pass fakes. */
export type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

export type DiagnosticDetail = Record<string, string | number | boolean>;

export type DiagnosticEvent = {
  ts: number;
  type: string;
  detail: DiagnosticDetail;
};

export type DiagnosticLog = {
  events: DiagnosticEvent[];
  record: (type: string, detail?: DiagnosticDetail) => void;
  clear: () => void;
};

export type DiagnosticsHandle = {
  log: DiagnosticLog;
  record: (type: string, detail?: DiagnosticDetail) => void;
  buildSha: string;
  bootSessionCount: number;
  bootTotalCount: number;
  navigationType: string;
  wasDiscarded: boolean;
  snapshot: () => string;
  mountOverlay: () => { refresh: () => void; unmount: () => void } | null;
};

/** True only for "?debug=1" (or an equivalent query string). */
export function isDiagnosticsEnabled(search: string): boolean {
  try {
    return new URLSearchParams(search).get(DIAGNOSTIC_PARAM) === DIAGNOSTIC_VALUE;
  } catch {
    return false;
  }
}

/**
 * Build commit SHA, injected by Vite at build time (see vite.config.ts
 * define for __IRU_BUILD_SHA__, sourced from VERCEL_GIT_COMMIT_SHA or
 * GIT_COMMIT_SHA). Under the node test harness the define is absent, so
 * the typeof guard falls back to 'local-dev' instead of throwing.
 */
export function getBuildSha(): string {
  try {
    const v =
      typeof __IRU_BUILD_SHA__ !== 'undefined' ? __IRU_BUILD_SHA__ : undefined;
    return typeof v === 'string' && v.length > 0 ? v : 'local-dev';
  } catch {
    return 'local-dev';
  }
}

/** Return the storage object only if it quacks like Storage; else null. */
export function safeStorage(candidate: unknown): StorageLike | null {
  try {
    if (
      candidate &&
      typeof (candidate as StorageLike).getItem === 'function' &&
      typeof (candidate as StorageLike).setItem === 'function' &&
      typeof (candidate as StorageLike).removeItem === 'function'
    ) {
      return candidate as StorageLike;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Increment a numeric counter key. Never throws: unavailable or throwing
 * storage yields 0 and the app continues. Returns the new value (0 when
 * storage was unusable).
 */
export function incrementCounter(
  storage: StorageLike | null | undefined,
  key: string,
): number {
  if (!storage) return 0;
  try {
    const raw = storage.getItem(key);
    const parsed = raw === null ? 0 : parseInt(raw, 10);
    const next = Number.isFinite(parsed) ? parsed + 1 : 1;
    storage.setItem(key, String(next));
    return next;
  } catch {
    return 0;
  }
}

/** Normalize navigation-entry data captured (guarded) by the caller. */
export function getNavigationInfo(
  navType: unknown,
  wasDiscarded: unknown,
): { type: string; wasDiscarded: boolean } {
  return {
    type: typeof navType === 'string' && navType.length > 0 ? navType : 'unknown',
    wasDiscarded: wasDiscarded === true,
  };
}

/** Bounded ring buffer: keeps only the latest `limit` events. */
export function createEventLog(limit: number = DIAGNOSTIC_EVENT_LIMIT): DiagnosticLog {
  const events: DiagnosticEvent[] = [];
  return {
    events,
    record: (type: string, detail: DiagnosticDetail = {}) => {
      events.push({ ts: Date.now(), type, detail });
      while (events.length > limit) events.shift();
    },
    clear: () => {
      events.length = 0;
    },
  };
}

type ListenerTarget = {
  addEventListener: (type: string, listener: (e: unknown) => void) => void;
  removeEventListener: (type: string, listener: (e: unknown) => void) => void;
};

/**
 * Attach diagnostic listeners to a target (window or document in the app,
 * a fake EventTarget in tests). Records the event type plus, for error
 * events, the error NAME only — never message or stack. For error and
 * unhandledrejection events the optional onUnhandled callback fires so
 * the app can show a non-fatal user message. Returns a cleanup function.
 */
export function installDiagnosticListeners(
  target: ListenerTarget | null | undefined,
  record: (type: string, detail?: DiagnosticDetail) => void,
  eventNames: string[],
  onUnhandled?: () => void,
): () => void {
  if (!target) return () => {};
  const handlers: Array<{ name: string; fn: (e: unknown) => void }> = [];
  for (const name of eventNames) {
    const fn = (e: unknown) => {
      if (name === 'error' || name === 'unhandledrejection') {
        const err =
          name === 'error'
            ? (e as { error?: { name?: unknown } }).error
            : (e as { reason?: { name?: unknown } }).reason;
        const errName =
          err && typeof err.name === 'string' ? err.name : 'unknown';
        record(name, { errorName: errName });
        try {
          if (onUnhandled) onUnhandled();
        } catch {
          /* a failing banner callback must never break diagnostics */
        }
        return;
      }
      if (name === 'visibilitychange') {
        const state = (e as { target?: { visibilityState?: unknown } }).target
          ?.visibilityState;
        record(name, {
          visibilityState:
            typeof state === 'string' ? state : 'unknown',
        });
        return;
      }
      record(name, {});
    };
    try {
      target.addEventListener(name, fn);
      handlers.push({ name, fn });
    } catch {
      /* a single unattachable listener must not break the rest */
    }
  }
  return () => {
    for (const h of handlers) {
      try {
        target.removeEventListener(h.name, h.fn);
      } catch {
        /* ignore cleanup failures */
      }
    }
  };
}

/**
 * Create a diagnostics handle. No DOM or storage is touched here; the app
 * fills in counters/navigation data after guarded reads, and mounts the
 * overlay only when ?debug=1 is present. record() auto-refreshes the
 * overlay when mounted.
 */
export function createDiagnostics(): DiagnosticsHandle {
  const log = createEventLog(DIAGNOSTIC_EVENT_LIMIT);
  let overlay: {
    element: unknown;
    render: () => void;
    unmount: () => void;
  } | null = null;

  const handle: DiagnosticsHandle = {
    log,
    record: (type: string, detail: DiagnosticDetail = {}) => {
      log.record(type, detail);
      try {
        if (overlay) overlay.render();
      } catch {
        /* overlay refresh must never break recording */
      }
    },
    buildSha: getBuildSha(),
    bootSessionCount: 0,
    bootTotalCount: 0,
    navigationType: 'unknown',
    wasDiscarded: false,
    snapshot: () => {
      return JSON.stringify(
        {
          buildSha: handle.buildSha,
          bootSessionCount: handle.bootSessionCount,
          bootTotalCount: handle.bootTotalCount,
          navigationType: handle.navigationType,
          wasDiscarded: handle.wasDiscarded,
          events: log.events,
        },
        null,
        2,
      );
    },
    mountOverlay: () => {
      try {
        const doc = (globalThis as unknown as { document?: unknown }).document as
          | {
              createElement: (tag: string) => {
                style: Record<string, string>;
                textContent: string | null;
                appendChild: (child: unknown) => void;
                remove: () => void;
                addEventListener: (
                  type: string,
                  listener: () => void,
                ) => void;
              };
              body: { appendChild: (child: unknown) => void };
            }
          | undefined;
        if (!doc || !doc.createElement || !doc.body) return null;
        const nav = (globalThis as unknown as {
          navigator?: { clipboard?: { writeText: (t: string) => Promise<void> } };
        }).navigator;
        const panel = doc.createElement('div');
        panel.style.position = 'fixed';
        panel.style.right = '8px';
        panel.style.bottom = '8px';
        panel.style.zIndex = '9999';
        panel.style.maxWidth = '92vw';
        panel.style.maxHeight = '50vh';
        panel.style.overflow = 'auto';
        panel.style.background = '#0f172a';
        panel.style.color = '#e2e8f0';
        panel.style.borderRadius = '12px';
        panel.style.padding = '12px';
        panel.style.fontSize = '12px';
        panel.style.fontFamily = 'monospace';
        const title = doc.createElement('div');
        title.textContent = 'IRU diagnostics (debug only — not shown to normal users)';
        const copyBtn = doc.createElement('button');
        copyBtn.textContent = 'Copy';
        copyBtn.addEventListener('click', () => {
          const text = handle.snapshot();
          try {
            if (nav && nav.clipboard && nav.clipboard.writeText) {
              nav.clipboard.writeText(text).then(
                () => {
                  copyBtn.textContent = 'Copied!';
                },
                () => {
                  copyBtn.textContent = 'Copy failed';
                },
              );
            }
          } catch {
            copyBtn.textContent = 'Copy failed';
          }
        });
        const hideBtn = doc.createElement('button');
        hideBtn.textContent = 'Hide';
        hideBtn.addEventListener('click', () => {
          try {
            panel.remove();
          } catch {
            /* ignore */
          }
          overlay = null;
        });
        const pre = doc.createElement('pre');
        pre.style.whiteSpace = 'pre-wrap';
        pre.style.wordBreak = 'break-word';
        panel.appendChild(title);
        panel.appendChild(copyBtn);
        panel.appendChild(hideBtn);
        panel.appendChild(pre);
        doc.body.appendChild(panel);
        const render = () => {
          try {
            pre.textContent = handle.snapshot();
          } catch {
            /* ignore */
          }
        };
        overlay = { element: panel, render, unmount: () => {
          try {
            panel.remove();
          } catch {
            /* ignore */
          }
          overlay = null;
        } };
        render();
        return {
          refresh: render,
          unmount: overlay.unmount,
        };
      } catch {
        return null;
      }
    },
  };
  return handle;
}
