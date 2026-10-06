import { invoke } from '@tauri-apps/api/core';
import { currentMonitor, getCurrentWindow, LogicalPosition, LogicalSize } from '@tauri-apps/api/window';
import { panelRect, stripRect, type Corner, type Rect, type Size } from '../core/layout';
import type { Logger } from '../data/logger';

export type WindowMode = 'strip' | 'panel';

export interface WindowLayout {
  panelSide: 'left' | 'right';
  panelWidth: number;
  stripCorner: Corner;
  showStrip: boolean;
  /** Applied as the CSS custom property `--overlay-opacity` on the document root. */
  opacity: number;
}

interface MonitorGeometry {
  /** Monitor size in logical pixels. */
  size: Size;
  /** Top-left corner of the monitor in logical pixels (not 0,0 on a secondary monitor). */
  origin: { x: number; y: number };
}

async function monitorGeometry(log: Logger): Promise<MonitorGeometry> {
  const monitor = await currentMonitor();
  if (monitor === null) {
    log.warn('window', 'no current monitor, falling back to the screen size', {
      width: screen.width,
      height: screen.height,
    });
    return { size: { width: screen.width, height: screen.height }, origin: { x: 0, y: 0 } };
  }
  const size = monitor.size.toLogical(monitor.scaleFactor);
  const position = monitor.position.toLogical(monitor.scaleFactor);
  return {
    size: { width: size.width, height: size.height },
    origin: { x: position.x, y: position.y },
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
 * Switches the single overlay window between its two states.
 * - `panel`: remembers the game window, takes clicks, fills one side of the monitor, takes the focus.
 * - `strip`: click-through strip in a corner (or hidden when `showStrip` is off), focus goes back to the game.
 * Failures are logged and rethrown so the caller can keep its own state consistent.
 */
export async function setMode(mode: WindowMode, layout: WindowLayout, log: Logger): Promise<void> {
  log.info('window', 'set mode', { mode, layout });
  try {
    applyOpacity(layout.opacity);
    const win = getCurrentWindow();
    const { size, origin } = await monitorGeometry(log);

    if (mode === 'panel') {
      await invoke('remember_foreground');
      await win.setIgnoreCursorEvents(false);
      const rect = panelRect(size, layout.panelSide, layout.panelWidth);
      await place(rect, origin);
      await win.show();
      await win.setFocus();
      log.info('window', 'panel shown and focused', { rect, monitor: size });
      return;
    }

    if (layout.showStrip) {
      const rect = stripRect(size, layout.stripCorner);
      await win.setIgnoreCursorEvents(true);
      await place(rect, origin);
      await win.show();
      log.info('window', 'strip shown, click-through', { rect, monitor: size });
    } else {
      await win.hide();
      log.info('window', 'strip disabled, window hidden');
    }
    const restored = await invoke<boolean>('restore_foreground');
    log.info('window', 'focus handed back to the game', { restored });
  } catch (err) {
    log.error('window', 'set mode failed', { mode, err });
    throw err;
  }
}
