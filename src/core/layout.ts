// Pure window geometry in logical pixels: no Tauri imports, no logging.
// The window is exactly as big as its content and stands at an ANCHOR: a corner of the monitor and two
// offsets (distances from that corner's two monitor edges). The anchor corner of the window stays fixed
// while the size changes (mini bar <-> expanded view, sections opening and closing): a window anchored at
// the top left grows down and to the right, one anchored at the bottom right grows up and to the left.
// There are no empty transparent margins around the interface.
//
// A window the player has dragged is always anchored by its TOP edge (see `anchorFromRect`), so the mini
// line stays where the header was and the window unfolds downward. The bottom corners are only a choice in
// the settings. When the window does not fit from its anchor it is SHIFTED onto the screen (the anchor is
// not changed, so folding it brings the mini line back to its place); it is never made smaller for that.

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

/** The largest content the window can hold: the monitor minus the margin on both sides, wherever the anchor is. */
export function maxContentSize(monitor: Size): Size {
  return {
    width: Math.max(0, monitor.width - 2 * WINDOW_MARGIN),
    height: Math.max(0, monitor.height - 2 * WINDOW_MARGIN),
  };
}

/**
 * Moves a stretch of one axis (from `start`, `length` long) onto a monitor side of `total` pixels. A stretch that is
 * already on it stays where it is, even when it is closer to the edge than the margin (an offset of 0 is allowed);
 * one that sticks out is put `WINDOW_MARGIN` away from the edge it was pushed against.
 */
function shiftOnto(start: number, length: number, total: number): number {
  if (start + length > total) return Math.max(0, total - length - WINDOW_MARGIN);
  if (start < 0) return WINDOW_MARGIN;
  return start;
}

/**
 * A window of the size `size` (cut down to `maxContentSize` when the content is bigger) at the anchor
 * `corner` + `offset`. Everything is relative to the monitor; the whole window is on the monitor: when it does not
 * fit from its anchor (an expanded window under a mini line that stands near the bottom edge, a wide one at the right
 * edge) it is shifted in, the anchor itself stays as it is. A negative offset is taken as 0.
 */
export function anchoredRect(monitor: Size, corner: Corner, size: Size, offset: Offset = DEFAULT_OFFSET): Rect {
  const dx = Math.max(0, offset.dx);
  const dy = Math.max(0, offset.dy);
  const max = maxContentSize(monitor);
  const width = Math.min(size.width, max.width);
  const height = Math.min(size.height, max.height);
  const x = corner.endsWith('left') ? dx : monitor.width - width - dx;
  const y = corner.startsWith('top') ? dy : monitor.height - height - dy;
  return { x: shiftOnto(x, width, monitor.width), y: shiftOnto(y, height, monitor.height), width, height };
}

/**
 * The anchor of a window that was put somewhere (after a drag). Always by the TOP edge: the side is the one the CENTRE of
 * the window is nearer to (the left wins a tie), `dx` is the whole-pixel distance from that side of the monitor to the
 * window, `dy` the distance from the top of the monitor to the top of the window. So the window unfolds downward from
 * where its header is, however low it stands.
 */
export function anchorFromRect(monitor: Size, rect: Rect): { corner: 'top-left' | 'top-right'; dx: number; dy: number } {
  const left = rect.x + rect.width / 2 <= monitor.width / 2;
  const dx = left ? rect.x : monitor.width - rect.x - rect.width;
  return {
    corner: left ? 'top-left' : 'top-right',
    dx: Math.max(0, Math.round(dx)),
    dy: Math.max(0, Math.round(rect.y)),
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
