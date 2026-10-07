// Pure window geometry in logical pixels: no Tauri imports, no logging.
// The window is exactly as big as its content and glued to a corner of the monitor: it has no size of
// its own, so there are no empty transparent margins around the interface.

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** The distance between the window and the edges of the monitor. */
export const WINDOW_MARGIN = 16;

/** The largest content the window can hold: the monitor minus the margin on each side. */
export function maxContentSize(monitor: Size, margin: number = WINDOW_MARGIN): Size {
  return {
    width: Math.max(0, monitor.width - 2 * margin),
    height: Math.max(0, monitor.height - 2 * margin),
  };
}

/**
 * A window of the size `size` (cut down to `maxContentSize` when the content is bigger) glued to a
 * corner of the monitor, `margin` pixels away from its edges. Everything is relative to the monitor.
 */
export function anchoredRect(monitor: Size, corner: Corner, size: Size, margin: number = WINDOW_MARGIN): Rect {
  const max = maxContentSize(monitor, margin);
  const width = Math.min(size.width, max.width);
  const height = Math.min(size.height, max.height);
  const x = corner.endsWith('left') ? margin : monitor.width - width - margin;
  const y = corner.startsWith('top') ? margin : monitor.height - height - margin;
  return { x, y, width, height };
}

/**
 * A logical rect of a monitor as a rect in physical pixels of the whole desktop, given where that
 * monitor starts (physical) and its scale factor. Use it to place the window on a monitor whose
 * scale differs from the one the window is on now: logical sizes and positions are converted
 * with the scale of the monitor the window is on at that moment, physical ones are not.
 * The edges are rounded, not the sizes, so a rect glued to a monitor edge stays glued.
 */
export function toPhysicalRect(rect: Rect, monitorPosition: { x: number; y: number }, scale: number): Rect {
  const left = Math.round(rect.x * scale);
  const top = Math.round(rect.y * scale);
  const right = Math.round((rect.x + rect.width) * scale);
  const bottom = Math.round((rect.y + rect.height) * scale);
  return {
    x: monitorPosition.x + left,
    y: monitorPosition.y + top,
    width: right - left,
    height: bottom - top,
  };
}
