import { fitScale, windowFrame, windowStatus } from './host-model';
import { logicalSize, formatMonitor, parseMonitor, type PreviewMonitor } from './monitor';
import { MESSAGE_SOURCE, type PreviewHostGlobal, type PreviewMessage } from './protocol';
import { DEFAULT_SCENE, SCENES } from './scenes';
import type { WindowSnapshot } from './window-state';

// The desktop page: a field the size of the monitor, the picture of the game on it, and the window of the
// overlay in an iframe that is moved and resized exactly as the application asks through the mocked Tauri
// boundary. The service bar is OUTSIDE the field, so a picture of the window or of the field never has it.

const MONITOR_PRESETS = ['1920x1080@1', '2560x1440@1', '2560x1440@1.5', '3840x2160@1.5', '1366x768@1'];

const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`preview.html has no #${id}`);
  return found as T;
};

const bar = element('bar');
const stage = element('stage');
const sizer = element('sizer');
const field = element('field');
const overlay = element<HTMLIFrameElement>('overlay');
const sceneSelect = element<HTMLSelectElement>('scene');
const monitorSelect = element<HTMLSelectElement>('monitor');
const gameButton = element('game');
const statusLine = element('status');

const params = new URLSearchParams(location.search);
const noShrink = params.get('zoom') === '1';
const sceneName = params.get('scene') ?? DEFAULT_SCENE;

let hostError: string | null = null;
let monitor: PreviewMonitor;
try {
  monitor = parseMonitor(params.get('monitor'));
} catch (err) {
  hostError = err instanceof Error ? err.message : String(err);
  monitor = parseMonitor(null);
}

let state: WindowSnapshot | null = null;
let ready = false;
let appError: string | null = null;
let messageCount = 0;
let scale = 1;

const logical = logicalSize(monitor);

// ---- the controls ---------------------------------------------------------------------------------

function go(change: Record<string, string>): void {
  const next = new URLSearchParams(location.search);
  for (const [key, value] of Object.entries(change)) next.set(key, value);
  location.search = next.toString();
}

for (const scene of SCENES) sceneSelect.add(new Option(`${scene.name} — ${scene.title}`, scene.name, false, scene.name === sceneName));
if (!SCENES.some((scene) => scene.name === sceneName)) sceneSelect.add(new Option(`${sceneName} — нет такой сцены`, sceneName, true, true));
sceneSelect.addEventListener('change', () => go({ scene: sceneSelect.value }));

const currentMonitor = formatMonitor(monitor);
for (const preset of MONITOR_PRESETS.includes(currentMonitor) ? MONITOR_PRESETS : [currentMonitor, ...MONITOR_PRESETS]) {
  monitorSelect.add(new Option(preset, preset, false, preset === currentMonitor));
}
monitorSelect.addEventListener('change', () => go({ monitor: monitorSelect.value }));

/** The player clicks the game: an overlay that holds the keyboard loses it. */
function clickGame(): void {
  overlay.contentWindow?.__preview?.clickGame();
}
gameButton.addEventListener('click', clickGame);
// the game is everything of the field that is not the overlay window
field.addEventListener('click', (event) => {
  if (event.target === field) clickGame();
});

// ---- the layout ---------------------------------------------------------------------------------

function layout(): void {
  scale = fitScale(logical, { width: window.innerWidth, height: window.innerHeight - bar.offsetHeight }, noShrink);
  sizer.style.width = `${logical.width * scale}px`;
  sizer.style.height = `${logical.height * scale}px`;
  field.style.width = `${logical.width}px`;
  field.style.height = `${logical.height}px`;
  field.style.transform = `scale(${scale})`;
  stage.style.overflow = noShrink ? 'visible' : 'hidden';
}

function placeWindow(): void {
  const frame = state === null ? null : windowFrame(state, monitor);
  overlay.style.visibility = frame === null ? 'hidden' : 'visible';
  if (frame !== null) {
    overlay.style.left = `${frame.x}px`;
    overlay.style.top = `${frame.y}px`;
    overlay.style.width = `${frame.width}px`;
    overlay.style.height = `${frame.height}px`;
  }
  // a window that lets the clicks through is not the target of the mouse: they land on the game
  overlay.style.pointerEvents = state?.ignoreCursorEvents ? 'none' : 'auto';
}

function describe(): void {
  statusLine.classList.toggle('error', hostError !== null || appError !== null);
  const where = `монитор ${formatMonitor(monitor)}, поле ${Math.round(logical.width)}×${Math.round(logical.height)}`;
  let text: string;
  if (hostError !== null) text = hostError;
  else if (appError !== null) text = `Ошибка: ${appError} · ${where}`;
  else if (state === null) text = `${ready ? 'окно ещё не показано' : 'запуск…'} · ${where}`;
  else text = `${windowStatus(state)} · ${where}`;
  statusLine.textContent = text;
  statusLine.title = text; // the line is cut to the width of the window; the full text is in the tooltip
}

window.addEventListener('resize', layout);
window.addEventListener('message', (event: MessageEvent<PreviewMessage>) => {
  const message = event.data;
  if (event.source !== overlay.contentWindow || message?.source !== MESSAGE_SOURCE) return;
  if (message.type === 'window') state = message.state;
  else {
    ready = true;
    appError = message.error;
  }
  messageCount++;
  placeWindow();
  describe();
});

// ---- the picture of the game ---------------------------------------------------------------------

/** The first picture of `Screenshot/` (the dev server decides), or the dark gradient the field starts with. */
async function loadBackdrop(): Promise<void> {
  try {
    const info = (await (await fetch('/__preview/info')).json()) as { backdrop: boolean };
    if (!info.backdrop) return;
    const image = new Image();
    image.src = '/__preview/backdrop';
    await image.decode();
    field.style.backgroundImage = 'url(/__preview/backdrop)';
  } catch {
    // the gradient stays
  }
}

// ---- for the screenshot script ---------------------------------------------------------------------

const rectOf = (el: HTMLElement) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
};

const nextFrames = (): Promise<void> =>
  Promise.race([
    new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    new Promise<void>((resolve) => setTimeout(resolve, 150)),
  ]);

const hostApi: PreviewHostGlobal = {
  get error() {
    return hostError;
  },
  settled: loadBackdrop(),
  fieldRect: () => rectOf(field),
  windowRect: () => (state !== null && windowFrame(state, monitor) !== null ? rectOf(overlay) : null),
  gamePoint() {
    const f = rectOf(field);
    const w = hostApi.windowRect();
    const candidates = [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75], [0.1, 0.1], [0.9, 0.9]];
    for (const [cx, cy] of candidates) {
      const x = f.x + f.width * cx;
      const y = f.y + f.height * cy;
      if (w === null || x < w.x - 20 || x > w.x + w.width + 20 || y < w.y - 20 || y > w.y + w.height + 20) return { x, y };
    }
    return { x: f.x + 5, y: f.y + 5 };
  },
  clickGame,
  async settle(maxMs = 2000) {
    const deadline = performance.now() + maxMs;
    for (;;) {
      const before = messageCount;
      await nextFrames();
      if (messageCount === before || performance.now() > deadline) return;
    }
  },
  barHeight: () => bar.offsetHeight,
};
window.__previewHost = hostApi;

// ---- start ---------------------------------------------------------------------------------------

layout();
placeWindow();
describe();
if (hostError === null) {
  const next = new URLSearchParams(location.search);
  next.set('scene', sceneName);
  next.set('monitor', formatMonitor(monitor));
  overlay.src = `/preview-app.html?${next.toString()}`;
}
