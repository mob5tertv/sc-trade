import { emit } from '@tauri-apps/api/event';
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import { tick } from 'svelte';
import { GALLERY_SCENE } from './gallery/scene';
import { currentHttpFake } from './http-fake';
import { createIpcHandler, type PreviewLogLevel, type SqlOp } from './ipc';
import { formatMonitor, parseMonitor } from './monitor';
import { MESSAGE_SOURCE, type PreviewGlobal, type PreviewMessage, type PreviewState } from './protocol';
import { createRingLog } from './ring-log';
import { DEFAULT_SCENE, findScene, SCENES, type Scene } from './scenes';
import { createPreviewWindow, type WindowSnapshot } from './window-state';

// The page of the application inside the preview. It puts the mocked Tauri boundary in place FIRST, then loads
// the real application (`src/main.ts`, untouched), waits for it to start, applies the scene and says it is ready.
// Nothing here is part of the production build: only `preview-app.html` loads this file.

const BOOT_TIMEOUT_MS = 20_000;
/** The screen is settled when no command has crossed the boundary for this long. */
const QUIET_MS = 300;
const QUIET_TIMEOUT_MS = 10_000;

const params = new URLSearchParams(location.search);
const startedAt = performance.now();
const ring = createRingLog();
const unknown = new Set<string>();
let lastActivity = performance.now();
/** Commands of the application that have not been answered yet (a statement that waits for the dev server). */
let inFlight = 0;
/**
 * A request that waits for the network is not an application that is busy: a scene may hold one on purpose, to show a
 * refresh on its way, and the screen is settled all the same. (Without a network of the scene's own it is answered at once.)
 */
const WAITS_FOR_THE_NETWORK = 'plugin:http|fetch_send';

/** How long nothing has crossed the mocked boundary; zero while a command is still being answered. */
const idleMs = (): number => (inFlight > 0 ? 0 : performance.now() - lastActivity);

const preview: PreviewGlobal = {
  ready: false,
  error: null,
  scene: params.get('scene') ?? DEFAULT_SCENE,
  get log() {
    return ring.lines();
  },
  state: () => {
    throw new Error('the preview is not set up yet');
  },
  clickGame: () => {},
  idleMs,
};
window.__preview = preview;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Two animation frames; a timer backs them up in case the page is not painting. */
const frames = (): Promise<void> =>
  Promise.race([
    new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    sleep(200),
  ]);

function write(level: PreviewLogLevel, message: string): void {
  ring.push(`${String(Math.round(performance.now() - startedAt)).padStart(6)}ms [${level}] ${message}`);
  const method = level === 'trace' ? 'debug' : level;
  console[method](message);
}

function post(message: PreviewMessage): void {
  if (window.parent !== window) window.parent.postMessage(message, location.origin);
}

/** The SQL of the application goes to the dev server: a real SQLite database per page load, made from the dataset. */
function sqlTransport(scene: Scene): (op: SqlOp) => Promise<unknown> {
  const sid = crypto.randomUUID();
  return async (op) => {
    const response = await fetch('/__preview/sql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sid, dataset: scene.dataset, ...op }),
    });
    const body = (await response.json()) as { ok: true; result: unknown } | { ok: false; error: string };
    if (!body.ok) throw new Error(body.error);
    return body.result;
  };
}

/** What `@tauri-apps/plugin-os` reads from the page: Windows 11. */
function installOsPlugin(): void {
  (window as unknown as Record<string, unknown>).__TAURI_OS_PLUGIN_INTERNALS__ = {
    eol: '\r\n', platform: 'windows', version: '10.0.26200', family: 'windows', os_type: 'windows', arch: 'x86_64', exe_extension: 'exe',
  };
}

async function waitForStart(app: { phase: string }): Promise<void> {
  const deadline = performance.now() + BOOT_TIMEOUT_MS;
  while (app.phase === 'booting') {
    if (performance.now() > deadline) throw new Error(`the application did not finish starting in ${BOOT_TIMEOUT_MS / 1000} s`);
    await sleep(25);
  }
}

/** Waits until nothing has crossed the boundary for `QUIET_MS`: the window has been placed, the logs are written. */
async function waitForQuiet(): Promise<void> {
  const deadline = performance.now() + QUIET_TIMEOUT_MS;
  while (idleMs() < QUIET_MS) {
    if (performance.now() > deadline) throw new Error(`the application is still busy after ${QUIET_TIMEOUT_MS / 1000} s`);
    await sleep(50);
  }
}

async function run(): Promise<void> {
  // `gallery=<page>[/<state>]`: the component gallery stands in for the application (see src/preview/gallery/)
  const galleryName = params.get('gallery');
  const scene = galleryName === null ? findScene(preview.scene) : GALLERY_SCENE;
  if (scene === undefined) {
    throw new Error(`unknown scene "${preview.scene}"; known scenes: ${SCENES.map((s) => s.name).join(', ')}`);
  }
  const monitor = parseMonitor(params.get('monitor'));

  const win = createPreviewWindow({
    onChange: (state: WindowSnapshot) => post({ source: MESSAGE_SOURCE, type: 'window', state }),
    // Tauri sends the focus events from its own loop, not from inside the command; Windows delivers the loss of the
    // focus even later. A scene can set `__previewBlurDelayMs` to show what that late blur does.
    onFocus: (focused) => {
      const delay = focused ? 0 : Number((window as unknown as { __previewBlurDelayMs?: number }).__previewBlurDelayMs ?? 0);
      setTimeout(() => void emit(focused ? 'tauri://focus' : 'tauri://blur', focused), delay);
    },
  });
  preview.clickGame = () => win.clickGame();
  // A press inside the overlay gives it the keyboard when it can take the focus (the strip never does). Windows
  // activates the window BEFORE the page hears of the press, so this is the first listener a press meets: the capture
  // phase of the window, ahead of the listeners the application has on the document.
  window.addEventListener('pointerdown', () => win.pressInside(), true);
  preview.state = (): PreviewState => {
    const w = win.snapshot();
    return {
      scene: scene.name, dataset: scene.dataset, monitor: formatMonitor(monitor),
      visible: w.visible, closed: w.closed, size: w.size, position: w.position,
      focusable: w.focusable, ignoreCursorEvents: w.ignoreCursorEvents, skipTaskbar: w.skipTaskbar,
      focused: w.keyboard === 'overlay', keyboard: w.keyboard,
      gameRemembered: w.gameRemembered, focusReturnedToGame: w.focusReturnedToGame,
      unknownCommands: [...unknown],
    };
  };

  const handler = createIpcHandler({
    monitor,
    window: win,
    sql: sqlTransport(scene),
    log: write,
    onUnknown: (command) => {
      unknown.add(command);
      console.error(`[preview] unmocked Tauri command: ${command}`);
    },
    http: currentHttpFake,
  });

  installOsPlugin();
  mockWindows('main');
  mockIPC(
    (command, payload) => {
      const counted = command !== WAITS_FOR_THE_NETWORK;
      if (counted) inFlight++;
      lastActivity = performance.now();
      return handler(command, payload as Record<string, unknown> | undefined).finally(() => {
        if (counted) inFlight--;
        lastActivity = performance.now();
      });
    },
    { shouldMockEvents: true },
  );
  write('info', `[preview] scene ${scene.name}, dataset ${scene.dataset}, monitor ${formatMonitor(monitor)}`);

  if (galleryName !== null) {
    const { mountGallery } = await import('./gallery/mount');
    await mountGallery({ name: galleryName, bg: params.get('bg'), opacity: params.get('opacity'), win, scale: monitor.scale });
    await waitForQuiet();
    await document.fonts.ready;
    await frames();
    return;
  }

  // The real application: main.ts mounts it on import, and `boot()` runs from its root component.
  await import('../main');
  const { app } = await import('../ui/state.svelte');
  await waitForStart(app);
  await waitForQuiet();

  await scene.act?.(app);

  await tick();
  await waitForQuiet();
  await document.fonts.ready;
  await frames();
  // A command nobody answers is a hole in the preview, or a call the application must never make (`set_focus`, see
  // ipc.ts): the scene has failed, whatever the screen looks like.
  if (unknown.size > 0) throw new Error(`the scene called Tauri commands that are not mocked: ${[...unknown].join(', ')}`);
}

void run()
  .catch((err: unknown) => {
    preview.error = err instanceof Error ? err.message : String(err);
    write('error', `[preview] the scene failed: ${preview.error}`);
  })
  .finally(() => {
    preview.ready = true;
    post({ source: MESSAGE_SOURCE, type: 'ready', error: preview.error });
  });
