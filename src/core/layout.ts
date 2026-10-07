// Pure window geometry in logical pixels: no Tauri imports, no logging.
// The window is exactly as big as its content and stands at an ANCHOR: a corner of the monitor and two
// offsets (distances from that corner's two monitor edges). The anchor corner of the window stays fixed
// while the size changes (mini bar <-> expanded view, sections opening and closing): a window anchored at
// the bottom right grows up and to the left. There are no empty transparent margins around the interface.

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

/** Distances of the window from the two monitor edges of its anchor corner. */
export interface Offset {
  dx: number;
  dy: number;
}

/** The distance between the window and the edges of the monitor, and the offsets of a fresh window. */
export const WINDOW_MARGIN = 16;

const DEFAULT_OFFSET: Offset = { dx: WINDOW_MARGIN, dy: WINDOW_MARGIN };

/**
 * The offset the window is really placed with. A value that would push the window off the monitor is
 * not refused, it is cut here: never negative, never more than half of the monitor (the nearest corner
 * of a window on the monitor is never farther than that, so a stored offset beyond it can only be wrong).
 */
function effectiveOffset(monitor: Size, offset: Offset): Offset {
  const clamp = (value: number, half: number): number => Math.max(0, Math.min(value, Math.floor(half)));
  return { dx: clamp(offset.dx, monitor.width / 2), dy: clamp(offset.dy, monitor.height / 2) };
}

/** The largest content the window can hold from its anchor: the monitor minus the offsets and the margin on the far side. */
export function maxContentSize(monitor: Size, offset: Offset = DEFAULT_OFFSET): Size {
  const { dx, dy } = effectiveOffset(monitor, offset);
  return {
    width: Math.max(0, monitor.width - dx - WINDOW_MARGIN),
    height: Math.max(0, monitor.height - dy - WINDOW_MARGIN),
  };
}

/**
 * A window of the size `size` (cut down to `maxContentSize` when the content is bigger) at the anchor
 * `corner` + `offset`. Everything is relative to the monitor; the whole window is on the monitor.
 */
export function anchoredRect(monitor: Size, corner: Corner, size: Size, offset: Offset = DEFAULT_OFFSET): Rect {
  const { dx, dy } = effectiveOffset(monitor, offset);
  const max = maxContentSize(monitor, offset);
  const width = Math.min(size.width, max.width);
  const height = Math.min(size.height, max.height);
  const x = corner.endsWith('left') ? dx : monitor.width - width - dx;
  const y = corner.startsWith('top') ? dy : monitor.height - height - dy;
  return {
    x: Math.max(0, Math.min(x, monitor.width - width)),
    y: Math.max(0, Math.min(y, monitor.height - height)),
    width,
    height,
  };
}

/**
 * The anchor of a window that was put somewhere (after a drag): the corner nearest to the CENTRE of the window
 * (the left and the top win a tie) and the whole-pixel distances of the window from that corner's edges.
 */
export function anchorFromRect(monitor: Size, rect: Rect): { corner: Corner; dx: number; dy: number } {
  const left = rect.x + rect.width / 2 <= monitor.width / 2;
  const top = rect.y + rect.height / 2 <= monitor.height / 2;
  const dx = left ? rect.x : monitor.width - rect.x - rect.width;
  const dy = top ? rect.y : monitor.height - rect.y - rect.height;
  return {
    corner: `${top ? 'top' : 'bottom'}-${left ? 'left' : 'right'}`,
    dx: Math.max(0, Math.round(dx)),
    dy: Math.max(0, Math.round(dy)),
  };
}

/**
 * Where a window goes when the pointer has moved by `delta` since the drag began: the rect the drag began with,
 * shifted, in whole pixels, and kept on the monitor. Worked out from the START of the drag each time, so the
 * result does not depend on how many moves were seen on the way.
 */
export function movedRect(start: Rect, delta: { dx: number; dy: number }, monitor: Size): Rect {
  const x = Math.round(start.x + delta.dx);
  const y = Math.round(start.y + delta.dy);
  return {
    x: Math.max(0, Math.min(x, monitor.width - start.width)),
    y: Math.max(0, Math.min(y, monitor.height - start.height)),
    width: start.width,
    height: start.height,
  };
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
