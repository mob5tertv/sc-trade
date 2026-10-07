import { invoke } from '@tauri-apps/api/core';
import { currentMonitor, getCurrentWindow, primaryMonitor } from '@tauri-apps/api/window';
import {
  anchoredRect,
  maxContentSize,
  toPhysicalRect,
  type Corner,
  type Offset,
  type Rect,
  type Size,
} from '../core/layout';
import type { Logger } from '../data/logger';

// The one overlay window. It is as big as its content, anchored to a corner of the primary monitor (the anchor
// corner stays where it is while the size changes), and it never takes the keyboard focus from the game by itself: buttons are clicked with the mouse while the
// game stays the active window. The keyboard is taken only for the time a text field is edited
// (`takeKeyboard`) and handed back afterwards (`giveKeyboard`). Every failure is logged and rethrown, so
// the caller can keep its own state consistent.

export type WindowMode = 'mini' | 'expanded';

export interface WindowLayout {
  /** The anchor: a corner of the monitor and the distances of the window from that corner's two edges. */
  corner: Corner;
  offset: Offset;
  /** Whether the collapsed window (the mini bar) is shown; off, it is hidden and the tray or a key opens it. */
  showMini: boolean;
  /** Applied as the CSS custom property `--overlay-opacity` on the document root. */
  opacity: number;
}

/** What the window holds for the moment between the first show and the first measurement of the content. */
const FIRST_CONTENT: Size = { width: 240, height: 26 };

interface MonitorGeometry {
  /** Monitor size in logical pixels. */
  size: Size;
  /** Top-left corner of the monitor in physical pixels of the desktop (not 0,0 on a secondary monitor). */
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
  return {
    size: { width: size.width, height: size.height },
    origin: { x: monitor.position.x, y: monitor.position.y },
    source,
    name: monitor.name,
    scaleFactor: monitor.scaleFactor,
  };
}

function applyOpacity(opacity: number): void {
  document.documentElement.style.setProperty('--overlay-opacity', String(opacity));
}

/** The interface cannot be taller or wider than this: past it the content scrolls instead of the window growing. */
function applyMaxSize(max: Size): void {
  const style = document.documentElement.style;
  style.setProperty('--sc-max-w', `${max.width}px`);
  style.setProperty('--sc-max-h', `${max.height}px`);
}

const sameRect = (a: Rect, b: Rect): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/** Where the window stands now, in physical pixels of the desktop; `null` until it was placed. */
let placed: Rect | null = null;
/** The same place in logical pixels of the monitor, and the monitor it was worked out for (a drag starts from here). */
let placedLogical: { rect: Rect; monitor: MonitorGeometry } | null = null;

/**
 * Puts the window, sized to `content` (CSS pixels), into the corner of the monitor. Position and size
 * are set by ONE call in physical pixels (`place_window`), so there is no frame in which the window has
 * already moved and not yet grown. A rect that is already there is not set again.
 */
async function placeContent(
  content: Size,
  layout: WindowLayout,
  monitor: MonitorGeometry,
  log: Logger,
): Promise<void> {
  // nothing is laid out yet (the content has no size): there is nothing to place
  if (!(content.width > 0) || !(content.height > 0)) return;
  const rect = anchoredRect(monitor.size, layout.corner, content, layout.offset);
  const physical = toPhysicalRect(rect, monitor.origin, monitor.scaleFactor);
  if (placed !== null && sameRect(placed, physical)) {
    placedLogical = { rect, monitor };
    return;
  }
  await invoke('place_window', { x: physical.x, y: physical.y, width: physical.width, height: physical.height });
  placed = physical;
  placedLogical = { rect, monitor };
  log.info('window', 'window placed', {
    corner: layout.corner, offset: layout.offset, content, rect, physical, scale: monitor.scaleFactor,
  });
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
 * The first show. The window does not take the focus (not even now), takes the clicks, stays out of the
 * taskbar, and stands in its corner with a small first size; `fitWindow` sets the real size as soon as
 * the content is measured. With `showMini` off the window is prepared and stays hidden.
 * Returns the largest size the content may have (the monitor minus the margins).
 */
export async function showWindow(layout: WindowLayout, log: Logger): Promise<Size> {
  log.info('window', 'show window', { layout });
  try {
    applyOpacity(layout.opacity);
    const win = getCurrentWindow();
    await win.setFocusable(false);
    await win.setIgnoreCursorEvents(false);
    await win.setSkipTaskbar(true);
    const monitor = await monitorGeometry(log);
    const max = maxContentSize(monitor.size, layout.offset);
    applyMaxSize(max);
    placed = null;
    await placeContent(FIRST_CONTENT, layout, monitor, log);
    if (layout.showMini) await win.show();
    log.info('window', layout.showMini ? 'window shown, clickable, not focusable' : 'mini bar is off, window stays hidden', {
      max,
      monitor: { source: monitor.source, name: monitor.name, size: monitor.size, origin: monitor.origin, scale: monitor.scaleFactor },
    });
    return max;
  } catch (err) {
    log.error('window', 'show window failed', { err });
    throw err;
  }
}

/**
 * Sets the window to the size of its content (CSS pixels) at its anchor on the primary monitor. The
 * anchor, the opacity and the largest size are applied each time, so a change of any of them goes
 * through here. The same rectangle is not set a second time.
 */
export async function fitWindow(content: Size, layout: WindowLayout, log: Logger): Promise<void> {
  try {
    applyOpacity(layout.opacity);
    const monitor = await monitorGeometry(log);
    applyMaxSize(maxContentSize(monitor.size, layout.offset));
    await placeContent(content, layout, monitor, log);
  } catch (err) {
    log.error('window', 'cannot fit the window', { content, err });
    throw err;
  }
}

/**
 * The window as it stands now, in logical pixels of the primary monitor, with the size of that monitor:
 * what a drag starts from. `null` until the window has been placed.
 */
export function windowGeometry(): { rect: Rect; monitor: Size } | null {
  return placedLogical === null ? null : { rect: { ...placedLogical.rect }, monitor: { ...placedLogical.monitor.size } };
}

/**
 * Moves the window to `rect` (logical pixels of the monitor) with ONE `place_window`, keeping its size. This
 * is the drag: it is called up to once per frame, so a success is not logged; a failure is.
 */
export async function moveWindow(rect: Rect, log: Logger): Promise<void> {
  if (placedLogical === null) return;
  const { monitor } = placedLogical;
  const physical = toPhysicalRect(rect, monitor.origin, monitor.scaleFactor);
  if (placed !== null && sameRect(placed, physical)) return; // e.g. the pointer keeps pushing against the edge of the monitor
  try {
    await invoke('place_window', { x: physical.x, y: physical.y, width: physical.width, height: physical.height });
  } catch (err) {
    log.error('window', 'cannot move the window', { rect, err });
    throw err;
  }
  placed = physical;
  placedLogical = { rect: { ...rect }, monitor };
}

/** Shows or hides the window; showing never takes the focus (the window is not focusable). */
export async function setWindowVisible(visible: boolean, log: Logger): Promise<void> {
  try {
    const win = getCurrentWindow();
    if (visible) await win.show();
    else await win.hide();
    log.info('window', visible ? 'window shown' : 'window hidden');
  } catch (err) {
    log.error('window', 'cannot change the visibility', { visible, err });
    throw err;
  }
}

/**
 * The player needs the keyboard (a text field is clicked): remembers the window that has the focus (the
 * game), makes the overlay focusable and focuses it. Windows may refuse the focus, e.g. when a key
 * opened the window while the game had it.
 */
export async function takeKeyboard(log: Logger): Promise<void> {
  try {
    const win = getCurrentWindow();
    await invoke('remember_foreground');
    await win.setFocusable(true);
    await win.setFocus();
    const focused = await win.isFocused();
    if (focused) log.info('window', 'keyboard taken', { focused });
    else log.warn('window', 'keyboard taken, but Windows did not give the window the focus', { focused });
  } catch (err) {
    log.error('window', 'cannot take the keyboard', { err });
    throw err;
  }
}

/**
 * The keyboard is not needed any more: the window stops being focusable and, when `restore` is set,
 * the remembered window gets the focus back. Pass `restore: false` when the player has already moved on
 * (clicked the game): the focus is where he put it and is not pulled anywhere by force.
 */
export async function giveKeyboard(log: Logger, restore: boolean): Promise<void> {
  try {
    await getCurrentWindow().setFocusable(false);
    const restored = restore ? await invoke<boolean>('restore_foreground') : null;
    log.info('window', 'keyboard given', { restore, restored });
  } catch (err) {
    log.error('window', 'cannot give the keyboard back', { restore, err });
    throw err;
  }
}
