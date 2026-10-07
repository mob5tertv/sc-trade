import Database from 'better-sqlite3';
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';
import { createSqlService, type SqlService } from '../../scripts/preview/sql-service';
import type { DatasetName } from '../../src/preview/datasets';
import { createIpcHandler } from '../../src/preview/ipc';
import { DEFAULT_MONITOR, type PreviewMonitor } from '../../src/preview/monitor';
import { prepareDataset } from '../../src/preview/seed';
import { createPreviewWindow, type PreviewWindow } from '../../src/preview/window-state';

// What a test needs to run the real platform code (src/platform/*) against the preview boundary in Node:
// a `window` and a `document` that the Tauri API looks for, the mocked IPC and a real SQLite behind it.

/** The few browser globals the Tauri API and the window layer touch; returns what puts the globals back. */
export function installFakeBrowser(): () => void {
  const scope = globalThis as Record<string, unknown>;
  const saved = { window: scope.window, document: scope.document };
  scope.window = globalThis;
  scope.document = { documentElement: { style: { setProperty: () => {} } } };
  return () => {
    scope.window = saved.window;
    scope.document = saved.document;
    if (saved.window === undefined) delete scope.window;
    if (saved.document === undefined) delete scope.document;
  };
}

export interface PreviewHarness {
  win: PreviewWindow;
  sql: SqlService;
  /** Lines the app logged through `plugin:log|log`, as `[level] message`. */
  logged: string[];
  /** The names of the commands that nobody mocks, in the order they were called. */
  unknown: string[];
  /** Focus events (`tauri://focus` / `tauri://blur`) that were sent to the listeners. */
  focusEvents: boolean[];
  /** Stops the mocks and puts the globals back. */
  dispose: () => void;
}

export interface HarnessOptions {
  monitor?: PreviewMonitor;
  dataset?: DatasetName;
  now?: number;
}

/** The mocked boundary exactly as `src/preview/entry.ts` builds it, with an in-memory SQLite and no network. */
export function startPreviewHarness(options: HarnessOptions = {}): PreviewHarness {
  const restoreBrowser = installFakeBrowser();
  const now = options.now ?? 1_800_000_000;
  const logged: string[] = [];
  const unknown: string[] = [];
  const focusEvents: boolean[] = [];

  const sql = createSqlService({
    open: () => new Database(':memory:'),
    prepare: prepareDataset,
    now: () => now,
  });
  const win = createPreviewWindow({
    onFocus: (focused) => {
      focusEvents.push(focused);
      void emit(focused ? 'tauri://focus' : 'tauri://blur', focused);
    },
  });
  const handler = createIpcHandler({
    monitor: options.monitor ?? DEFAULT_MONITOR,
    window: win,
    sql: (op) => sql.handle({ sid: 'test', dataset: options.dataset ?? 'default', ...op }),
    log: (level, message) => logged.push(`[${level}] ${message}`),
    onUnknown: (command) => unknown.push(command),
  });

  mockWindows('main');
  mockIPC((command, payload) => handler(command, payload as Record<string, unknown> | undefined), { shouldMockEvents: true });

  return {
    win, sql, logged, unknown, focusEvents,
    dispose: () => {
      clearMocks();
      sql.closeAll();
      restoreBrowser();
    },
  };
}
