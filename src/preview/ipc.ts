import type { FakeHttp } from './http-fake';
import type { PreviewMonitor } from './monitor';
import type { PreviewWindow } from './window-state';

// The answers of the preview to every command the application sends through Tauri's `invoke`: the plugins
// (`plugin:sql|…`, `plugin:window|…`, `plugin:log|…`, `plugin:app|…`, `plugin:path|…`, `plugin:opener|…`,
// `plugin:http|…`) and the commands of our own Rust side (`backup_db`, `remember_foreground`, `take_foreground`, …).
// Names and payloads come from `node_modules/@tauri-apps/*` and `src-tauri/src/*.rs`.
// A command that is not here is an error with its name, never a quiet `null`: a hole must be seen.

export type PreviewLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

/** One request to the SQL side on the dev server; the page adds its session and dataset. */
export interface SqlOp {
  op: 'load' | 'execute' | 'select' | 'close';
  db?: string;
  query?: string;
  values?: unknown[];
}

export interface IpcDeps {
  monitor: PreviewMonitor;
  window: PreviewWindow;
  sql: (op: SqlOp) => Promise<unknown>;
  /** The log of the application (`plugin:log|log`) and the lines the preview itself writes. */
  log: (level: PreviewLogLevel, message: string) => void;
  /** A command nobody mocks was called. */
  onUnknown: (command: string) => void;
  /** The network a scene has put in place (`http-fake.ts`), asked at every request; none (the default): UEX is unreachable at once. */
  http?: () => FakeHttp | null;
}

type Payload = Record<string, unknown>;
export type IpcHandler = (command: string, payload?: Payload) => Promise<unknown>;

// The numbers of `LogLevel` in `@tauri-apps/plugin-log`.
const LOG_LEVELS: Record<number, PreviewLogLevel> = { 1: 'trace', 2: 'debug', 3: 'info', 4: 'warn', 5: 'error' };

/** What a handler returns for a command it does not know. */
const UNKNOWN = Symbol('unknown command');

const LOG_DIR = 'C:\\Users\\preview\\AppData\\Local\\com.sctrade.app\\logs';

/**
 * The payload as Rust would receive it. Tauri turns `PhysicalSize`, `Position` and the like into plain objects
 * on their way out; the mock gets the objects themselves, so they are serialised the same way here.
 */
function wire(payload: unknown): Payload {
  if (payload === undefined || payload === null) return {};
  try {
    return JSON.parse(JSON.stringify(payload)) as Payload;
  } catch {
    return payload as Payload;
  }
}

const num = (value: unknown, what: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${what}: expected a number, got ${JSON.stringify(value)}`);
  return value;
};

/** `{ Physical: {a, b} }` or `{ Logical: {a, b} }` (a `Size` or a `Position`) in physical pixels. */
function physical(value: unknown, fields: [string, string], scale: number): [number, number] {
  const object = (value ?? {}) as { Physical?: Payload; Logical?: Payload };
  const [a, b] = fields;
  if (object.Physical) return [num(object.Physical[a], a), num(object.Physical[b], b)];
  if (object.Logical) return [Math.round(num(object.Logical[a], a) * scale), Math.round(num(object.Logical[b], b) * scale)];
  throw new Error(`expected a Physical or Logical value, got ${JSON.stringify(value)}`);
}

/**
 * How many of the next `place_window` calls fail: a scene sets `__previewPlaceWindowFailures` before the application is loaded
 * (`beforeStart`), to show what the start does with a window that could not be shown the first time.
 */
function failsOnPurpose(): boolean {
  const holder = globalThis as { __previewPlaceWindowFailures?: number };
  const left = holder.__previewPlaceWindowFailures ?? 0;
  if (left <= 0) return false;
  holder.__previewPlaceWindowFailures = left - 1;
  return true;
}

export function createIpcHandler(deps: IpcDeps): IpcHandler {
  const { monitor, window: win, sql, log } = deps;

  /** The monitor in the shape `primaryMonitor()` unwraps: physical pixels, at the corner of the desktop. */
  const monitorInfo = () => ({
    name: 'Preview display',
    position: { x: 0, y: 0 },
    size: { width: monitor.width, height: monitor.height },
    scaleFactor: monitor.scale,
    workArea: { position: { x: 0, y: 0 }, size: { width: monitor.width, height: monitor.height } },
  });

  function windowCommand(name: string, args: Payload): unknown {
    switch (name) {
      case 'primary_monitor':
      case 'current_monitor':
        return monitorInfo();
      case 'available_monitors':
        return [monitorInfo()];
      case 'scale_factor':
        return monitor.scale;
      case 'set_size': {
        const [width, height] = physical(args.value, ['width', 'height'], monitor.scale);
        win.setSize({ width, height });
        return null;
      }
      case 'set_position': {
        const [x, y] = physical(args.value, ['x', 'y'], monitor.scale);
        win.setPosition({ x, y });
        return null;
      }
      case 'outer_size':
      case 'inner_size':
        return win.snapshot().size;
      case 'outer_position':
      case 'inner_position':
        return win.snapshot().position;
      case 'show':
        win.show();
        return null;
      case 'hide':
        win.hide();
        return null;
      case 'close':
        log('info', '[preview] the window was closed (the application quit)');
        win.close();
        return null;
      case 'is_visible':
        return win.snapshot().visible;
      // The command of Tauri that focuses the window is NOT here on purpose. It presses a key through the input stream
      // when Windows refuses the foreground, so the application must never call it (it has no permission for it either,
      // and its name is not written in this folder: tests/release/no-synthetic-input.test.ts looks for it). A call
      // lands in "unmocked command": it fails, and a scene that makes it at its start fails with it (entry.ts).
      case 'set_focusable':
        win.setFocusable(args.value === true);
        return null;
      case 'is_focused':
        return win.isFocused();
      case 'set_skip_taskbar':
        win.setSkipTaskbar(args.value === true);
        return null;
      case 'set_ignore_cursor_events':
        win.setIgnoreCursorEvents(args.value === true);
        return null;
      default:
        return UNKNOWN;
    }
  }

  function answer(command: string, args: Payload): unknown | Promise<unknown> {
    const [plugin, name] = command.includes('|') ? command.split('|', 2) : ['', command];
    switch (plugin) {
      case 'plugin:window':
        return windowCommand(name, args);
      case 'plugin:sql':
        return sqlCommand(name, args);
      case 'plugin:log':
        if (name !== 'log') return UNKNOWN;
        log(LOG_LEVELS[args.level as number] ?? 'info', String(args.message));
        return null;
      case 'plugin:app':
        return name === 'version' ? 'preview' : UNKNOWN;
      case 'plugin:path':
        if (name === 'resolve_directory') return LOG_DIR;
        if (name === 'join') return (args.paths as string[]).join('\\');
        return UNKNOWN;
      case 'plugin:opener':
        if (name !== 'reveal_item_in_dir' && name !== 'open_path' && name !== 'open_url') return UNKNOWN;
        log('info', `[preview] opener ${name}: ${JSON.stringify(args)} (nothing is opened in the preview)`);
        return null;
      case 'plugin:http':
        return httpCommand(name, args);
      case '':
        return ownCommand(name, args);
      default:
        return UNKNOWN;
    }
  }

  function sqlCommand(name: string, args: Payload): unknown {
    if (name !== 'load' && name !== 'execute' && name !== 'select' && name !== 'close') return UNKNOWN;
    return sql({
      op: name,
      db: args.db as string | undefined,
      query: args.query as string | undefined,
      values: args.values as unknown[] | undefined,
    });
  }

  /**
   * There is no network in the preview: UEX is unreachable at once, and the data lives in the database. Unless a scene
   * has put a network of its own in place (`deps.http`): then its requests are answered from there.
   */
  function httpCommand(name: string, args: Payload): unknown {
    const fake = deps.http?.() ?? null;
    if (fake !== null && fake.handles(name)) return fake.command(name, args);
    if (name === 'fetch') {
      const url = String((args.clientConfig as Payload | undefined)?.url ?? '');
      throw new Error(`error sending request for url (${url}): preview mode, there is no network`);
    }
    return name === 'fetch_cancel' || name === 'fetch_cancel_body' ? null : UNKNOWN;
  }

  /** The commands of `src-tauri/src` (`generate_handler!` in lib.rs). */
  function ownCommand(name: string, args: Payload): unknown {
    switch (name) {
      case 'backup_db':
        return null; // no database file, so nothing to back up
      case 'set_log_level':
        log('info', `[preview] Rust log level set to ${String(args.level)}`);
        return null;
      case 'place_window': {
        if (failsOnPurpose()) throw new Error('[preview] place_window fails on purpose (a scene asked for it)');
        // src-tauri/src/place.rs: one SetWindowPos for the position and the size, in physical pixels
        const rect = { x: num(args.x, 'x'), y: num(args.y, 'y'), width: num(args.width, 'width'), height: num(args.height, 'height') };
        if (rect.width < 1 || rect.height < 1) throw new Error(`cannot place a window of ${rect.width}x${rect.height}`);
        win.place(rect);
        log('debug', `[preview] place_window ${rect.x},${rect.y} ${rect.width}x${rect.height}`);
        return null;
      }
      case 'remember_foreground':
        win.rememberForeground(args.quiet === true);
        return null;
      case 'restore_foreground':
        return win.restoreForeground();
      case 'take_foreground': {
        // src-tauri/src/focus.rs: one request at most, the answer of Windows is final. The Windows of the preview is a
        // strict one (focus-model.ts): it says yes only to a window that is in front already. The line stands in for
        // the `[focus]` line of the Rust side.
        const { foreground, asked } = win.takeForeground();
        if (foreground) log('info', `[preview] take_foreground: the overlay is the foreground window already (asked: ${asked})`);
        else log('warn', `[preview] take_foreground: a strict Windows refuses, the overlay is not the foreground window (asked: ${asked})`);
        return foreground;
      }
      case 'panel_is_foreground':
        return win.isFocused();
      case 'set_trigger_keys':
        log('debug', '[preview] set_trigger_keys'); // a scene counts these: how often the application sets the keys again
        return [null, null, null]; // every key is accepted; there is no keyboard hook
      default:
        return UNKNOWN;
    }
  }

  return async (command, payload) => {
    const result = await answer(command, wire(payload));
    if (result === UNKNOWN) {
      deps.onUnknown(command);
      throw new Error(`[preview] unmocked Tauri command: ${command} (add it to src/preview/ipc.ts)`);
    }
    return result;
  };
}
