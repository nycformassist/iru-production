// Lightweight diagnostics for the IRU Android document-picker recovery
// pass (2026-10-26). Framework-free and DOM-free at import time so the
// logic is unit-testable under the existing node test harness.
//
// ACTIVATION: diagnostics are collected in memory always (cheap ring
// buffer), but the on-screen overlay is rendered ONLY when the page URL
// contains "?debug=1". Normal users never see it.
//
// MINIMIZED DEFAULT (2026-10-26 fix for the overlay obstructing mobile
// testing): when enabled, the overlay opens as ONE small top-right pill,
// never as the full panel, so the app is testable unobstructed
// immediately. Tapping the pill expands the full log panel; Minimize
// collapses back to the pill. Logging continues in both states and
// minimizing never clears the log. There is deliberately no destructive
// Close: the old Hide button was a one-way door (panel removed, no
// reopen path) that forced the tester to choose between an obstructing
// panel and no diagnostics at all for the session.
//
// PRIVACY CONTRACT (enforced by call sites, verified by test): record()
// stores exactly what the caller passes — type, timestamp, and a detail
// object. Callers must pass ONLY non-sensitive facts: stage names,
// event names, booleans, and counters. NEVER pass answers, names,
// addresses, file names, file contents, document previews, review
// output, or payment data. Error events record the error NAME only,
// never the message or stack, because messages can embed user data.

/**
 * Non-sensitive description of a picked file for the debug log (2026-10-28):
 * MIME class and a coarse size bucket ONLY. Never the file name, contents,
 * or any preview. Lets a device test show WHY a selection failed (HEIC,
 * empty type from a cloud provider, oversize) without logging the document.
 */
export function summarizeFileForDiagnostics(
  file: { type?: unknown; size?: unknown } | null | undefined,
): { mimeClass: string; sizeBucket: string } {
  if (!file) return { mimeClass: 'none', sizeBucket: 'none' };
  const type = typeof file.type === 'string' ? file.type.toLowerCase() : '';
  const known = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
  let mimeClass = 'other';
  if (type === '') mimeClass = 'empty';
  else if (known.includes(type)) mimeClass = type;
  else if (type === 'image/heic' || type === 'image/heif') mimeClass = 'heic';
  const size = typeof file.size === 'number' && Number.isFinite(file.size) ? file.size : -1;
  let sizeBucket = 'unknown';
  if (size === 0) sizeBucket = 'empty';
  else if (size > 0 && size < 1024 * 1024) sizeBucket = '<1MB';
  else if (size >= 1024 * 1024 && size < 3 * 1024 * 1024) sizeBucket = '1-3MB';
  else if (size >= 3 * 1024 * 1024) sizeBucket = '>=3MB';
  return { mimeClass, sizeBucket };
}

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
 * Debug-overlay gating from the live URL. Lives HERE (not in App.tsx)
 * deliberately: App.tsx carries standing structural guards proving it
 * never reads the return URL query and never parses URL parameters
 * (those guards exist so ?checkout=success cannot grant entitlement).
 * This helper only decides whether the debug overlay shows; it cannot
 * grant, read, or alter any entitlement, payment, or assessment state.
 * Returns false wherever no browser location exists (e.g. node tests).
 */
export function isDiagnosticsEnabledFromLocation(): boolean {
  try {
    const loc = (globalThis as unknown as { location?: { search?: unknown } })
      .location;
    const search = loc && typeof loc.search === 'string' ? loc.search : '';
    return isDiagnosticsEnabled(search);
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
        // Minimized default: the overlay opens as ONE small floating pill,
        // never as the full panel, so ?debug=1 never greets the tester
        // with a half-screen panel over the assessment. There is no
        // backdrop, wrapper, or full-screen layer — the pill (minimized)
        // or the panel (expanded, only after the user taps the pill) is
        // the ONLY element the overlay adds, so taps anywhere outside it
        // reach the app. Both elements are fixed (outside document flow,
        // no layout shift) and border-box sized so they cannot overflow
        // a 320px viewport: pill maxWidth 50vw + right 8px, panel
        // maxWidth 92vw + right 8px, each < 100vw including padding.
        // Placement: top-right. The app has no fixed header and no
        // persistent top-right control (language selection is a step
        // screen; photo/Skip/Review/Continue controls live in the
        // scrolling content column), so the pill sits over the
        // header/margin zone — never over the step action buttons that
        // the old bottom-right panel covered. A fixed element can
        // transiently overlap in-flow content during scroll, but the
        // pill footprint (~110x44px) cannot cover a button row, and a
        // small scroll reveals anything beneath it.
        const pill = doc.createElement('button');
        pill.style.position = 'fixed';
        pill.style.top = '8px';
        pill.style.right = '8px';
        pill.style.zIndex = '9999';
        pill.style.boxSizing = 'border-box';
        pill.style.pointerEvents = 'auto';
        pill.style.maxWidth = '50vw';
        pill.style.minHeight = '44px';
        pill.style.padding = '8px 10px';
        pill.style.whiteSpace = 'nowrap';
        pill.style.overflow = 'hidden';
        pill.style.textOverflow = 'ellipsis';
        pill.style.background = '#0f172a';
        pill.style.color = '#e2e8f0';
        pill.style.border = '1px solid #334155';
        pill.style.borderRadius = '999px';
        pill.style.fontSize = '12px';
        pill.style.fontFamily = 'monospace';
        const panel = doc.createElement('div');
        panel.style.position = 'fixed';
        panel.style.top = '8px';
        panel.style.right = '8px';
        panel.style.zIndex = '9999';
        panel.style.boxSizing = 'border-box';
        panel.style.pointerEvents = 'auto';
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
        // Minimize (not Hide): collapsing returns to the pill and NEVER
        // stops logging or loses the log. The old Hide button removed
        // the panel with no reopen path — a one-way door that forced the
        // tester to choose between an obstructing panel and no
        // diagnostics at all for the session. There is deliberately no
        // destructive Close: minimizing is the single dismiss action.
        const minimizeBtn = doc.createElement('button');
        minimizeBtn.textContent = 'Minimize';
        const pre = doc.createElement('pre');
        pre.style.whiteSpace = 'pre-wrap';
        pre.style.wordBreak = 'break-word';
        panel.appendChild(title);
        panel.appendChild(copyBtn);
        panel.appendChild(minimizeBtn);
        panel.appendChild(pre);
        let expanded = false;
        let shown: { remove: () => void } = pill;
        const render = () => {
          try {
            pill.textContent = `Debug log (${log.events.length}) ▸`;
            if (expanded) pre.textContent = handle.snapshot();
          } catch {
            /* ignore */
          }
        };
        const expand = () => {
          try {
            shown.remove();
          } catch {
            /* ignore */
          }
          expanded = true;
          shown = panel;
          doc.body.appendChild(panel);
          render();
        };
        const minimize = () => {
          try {
            shown.remove();
          } catch {
            /* ignore */
          }
          expanded = false;
          shown = pill;
          doc.body.appendChild(pill);
          render();
        };
        pill.addEventListener('click', expand);
        minimizeBtn.addEventListener('click', minimize);
        doc.body.appendChild(pill);
        const unmount = () => {
          try {
            shown.remove();
          } catch {
            /* ignore */
          }
          overlay = null;
        };
        overlay = { element: pill, render, unmount };
        render();
        return {
          refresh: render,
          unmount,
        };
      } catch {
        return null;
      }
    },
  };
  return handle;
}
