import { invoke } from '@tauri-apps/api/core';
import {
  currentMonitor,
  getCurrentWindow,
  LogicalPosition,
  LogicalSize,
  primaryMonitor,
} from '@tauri-apps/api/window';
import { panelRect, panelSideFor, stripRect, type Corner, type Rect, type Size } from '../core/layout';
import type { Logger } from '../data/logger';

export type WindowMode = 'strip' | 'panel';

/** The panel opens on the side of the strip, so there is no panel side here. */
export interface WindowLayout {
  panelWidth: number;
  stripCorner: Corner;
  showStrip: boolean;
  /** Applied as the CSS custom property `--overlay-opacity` on the document root. */
  opacity: number;
}

export interface SetModeOptions {
  /**
   * Whether collapsing to the strip hands the keyboard focus back to the game (default `true`).
   * Pass `false` when the player has already moved on, e.g. clicked the game: the panel lost the
   * focus by itself and the game must not be pulled back by force.
   */
  restoreFocus?: boolean;
}

interface MonitorGeometry {
  /** Monitor size in logical pixels. */
  size: Size;
  /** Top-left corner of the monitor in logical pixels (not 0,0 on a secondary monitor). */
  origin: { x: number; y: number };
  /** Which monitor it is, for the log. */
  source: 'primary' | 'current' | 'screen';
  name: string | null;
  scaleFactor: number;
}

/** The window always goes to the primary monitor, wherever the app was started from. */
async function monitorGeometry(log: Logger): Promise<MonitorGeometry> {
  let source: 'primary' | 'current' = 'primary';
  let monitor = await primaryMonitor();
  if (monitor === null) {
    source = 'current';
    log.warn('window', 'no primary monitor, trying the current one');
    monitor = await currentMonitor();
  }
  if (monitor === null) {
    log.warn('window', 'no current monitor, falling back to the screen size', {
      width: screen.width,
      height: screen.height,
    });
    return {
      size: { width: screen.width, height: screen.height },
      origin: { x: 0, y: 0 },
      source: 'screen',
      name: null,
      scaleFactor: window.devicePixelRatio,
    };
  }
  const size = monitor.size.toLogical(monitor.scaleFactor);
  const position = monitor.position.toLogical(monitor.scaleFactor);
  return {
    size: { width: size.width, height: size.height },
    origin: { x: position.x, y: position.y },
    source,
    name: monitor.name,
    scaleFactor: monitor.scaleFactor,
  };
}

async function place(rect: Rect, origin: { x: number; y: number }): Promise<void> {
  const win = getCurrentWindow();
  await win.setSize(new LogicalSize(rect.width, rect.height));
  await win.setPosition(new LogicalPosition(origin.x + rect.x, origin.y + rect.y));
}

function applyOpacity(opacity: number): void {
  document.documentElement.style.setProperty('--overlay-opacity', String(opacity));
}

/**
 * Logs every real focus change of the window (what Windows did, not what the app asked for).
 * `onLost` is called each time the window loses the focus. Returns the function that stops listening.
 */
export function watchFocus(getMode: () => WindowMode, log: Logger, onLost?: () => void): Promise<() => void> {
  return getCurrentWindow().onFocusChanged(({ payload: focused }) => {
    log.info('window', 'focus changed', { focused, mode: getMode() });
    if (!focused) onLost?.();
  });
}

/**
 * Switches the single overlay window between its two states.
 * - `panel`: remembers the game window, takes clicks, fills the side of the monitor where the strip
 *   stands, takes the focus.
 * - `strip`: a small clickable badge in a corner that never takes the focus (or hidden when
 *   `showStrip` is off); the focus goes back to the game unless `options.restoreFocus` is `false`.
 * The geometry comes from the primary monitor.
 * Failures are logged and rethrown so the caller can keep its own state consistent.
 */
export async function setMode(
  mode: WindowMode,
  layout: WindowLayout,
  log: Logger,
  options: SetModeOptions = {},
): Promise<void> {
  log.info('window', 'set mode', { mode, layout });
  try {
    applyOpacity(layout.opacity);
    const win = getCurrentWindow();
    const monitor = await monitorGeometry(log);
    const { size, origin } = monitor;
    const monitorInfo = { source: monitor.source, name: monitor.name, size, origin, scale: monitor.scaleFactor };

    if (mode === 'panel') {
      await invoke('remember_foreground');
      await win.setFocusable(true);
      await win.setIgnoreCursorEvents(false);
      const side = panelSideFor(layout.stripCorner);
      const rect = panelRect(size, side, layout.panelWidth);
      await place(rect, origin);
      await win.show();
      // `skipTaskbar` from the config is applied once, while the window is still hidden.
      await win.setSkipTaskbar(true);
      await win.setFocus();
      // Only what was requested; the real focus changes are logged by `watchFocus`.
      log.info('window', 'panel shown, focus requested', { side, rect, monitor: monitorInfo });
      return;
    }

    // The strip must never take the keyboard focus from the game, not even on its first show.
    await win.setFocusable(false);
    if (layout.showStrip) {
      const rect = stripRect(size, layout.stripCorner);
      // The strip is a button: it must receive the click.
      await win.setIgnoreCursorEvents(false);
      await place(rect, origin);
      await win.show();
      await win.setSkipTaskbar(true);
      log.info('window', 'strip shown, clickable, not focusable', { rect, monitor: monitorInfo });
    } else {
      await win.hide();
      log.info('window', 'strip disabled, window hidden', { monitor: monitorInfo });
    }
    if (options.restoreFocus ?? true) {
      const restored = await invoke<boolean>('restore_foreground');
      log.info('window', 'focus handed back to the game', { restored });
    } else {
      log.info('window', 'focus left where the player put it');
    }
  } catch (err) {
    log.error('window', 'set mode failed', { mode, err });
    throw err;
  }
}
