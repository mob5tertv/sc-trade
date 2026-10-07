import type { WindowSnapshot } from './window-state';

// What the page of the application (`entry.ts`, inside the iframe) and the desktop page (`host.ts`) say to each
// other and to the screenshot script (`scripts/preview/shot.mjs`).

export const MESSAGE_SOURCE = 'sc-trade-preview';

/** Sent to the parent page with `postMessage`. */
export type PreviewMessage =
  | { source: typeof MESSAGE_SOURCE; type: 'window'; state: WindowSnapshot }
  | { source: typeof MESSAGE_SOURCE; type: 'ready'; error: string | null };

/** The mocked state of the window in one flat object, what `shot --state` prints. */
export interface PreviewState {
  scene: string;
  dataset: string;
  monitor: string;
  visible: boolean;
  closed: boolean;
  size: { width: number; height: number };
  position: { x: number; y: number };
  focusable: boolean;
  ignoreCursorEvents: boolean;
  skipTaskbar: boolean;
  /** The keyboard is with the overlay. */
  focused: boolean;
  keyboard: 'game' | 'overlay';
  /** How many times the game window was remembered (what the Rust side would store). */
  gameRemembered: number;
  /** How many times the focus was handed back to the game and Windows accepted it. */
  focusReturnedToGame: number;
  /** Commands of Tauri that were called and are not mocked, each name once. */
  unknownCommands: string[];
}

/** `window.__preview` in the page of the application. */
export interface PreviewGlobal {
  /** The scene is applied and the screen has settled. Also set when the start failed: look at `error`. */
  ready: boolean;
  error: string | null;
  scene: string;
  /** The last 500 lines of the log of the application and of the preview itself. */
  log: string[];
  state(): PreviewState;
  /** The player clicks the game. */
  clickGame(): void;
  /** Milliseconds since a command of the application last crossed the mocked boundary; 0 while one is being answered. */
  idleMs(): number;
}

/** `window.__previewHost` in the desktop page. Rectangles are in pixels of the page. */
export interface PreviewHostGlobal {
  /** The desktop page itself could not be set up (a bad `monitor=` parameter, for instance). */
  error: string | null;
  /** The background picture is loaded. */
  settled: Promise<void>;
  /** The field that stands for the monitor. */
  fieldRect(): { x: number; y: number; width: number; height: number };
  /** The overlay window; `null` while it is hidden. */
  windowRect(): { x: number; y: number; width: number; height: number } | null;
  /** A point of the field away from the overlay window, where the game is. */
  gamePoint(): { x: number; y: number };
  clickGame(): void;
  /**
   * Resolves when the window state has not changed for two animation frames and the application is not waiting
   * for the answer of a command (at most `maxMs`).
   */
  settle(maxMs?: number): Promise<void>;
  /** The height of the service bar above the field. */
  barHeight(): number;
}

declare global {
  interface Window {
    __preview?: PreviewGlobal;
    __previewHost?: PreviewHostGlobal;
  }
}
