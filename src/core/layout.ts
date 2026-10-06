// Pure window geometry in logical pixels: no Tauri imports, no logging.

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

/** The strip is a small clickable badge: it takes the clicks of its own area, so it must not be big. */
export const STRIP_SIZE: Size = { width: 260, height: 36 };

const DEFAULT_STRIP_MARGIN = 16;

/** The strip in a corner of the monitor, `margin` pixels away from the monitor edges. */
export function stripRect(monitor: Size, corner: Corner, margin: number = DEFAULT_STRIP_MARGIN): Rect {
  const { width, height } = STRIP_SIZE;
  const x = corner.endsWith('left') ? margin : monitor.width - width - margin;
  const y = corner.startsWith('top') ? margin : monitor.height - height - margin;
  return { x, y, width, height };
}

/** The panel opens on the side where the strip stands, so the cursor is over it right away. */
export function panelSideFor(corner: Corner): 'left' | 'right' {
  return corner.endsWith('left') ? 'left' : 'right';
}

/** The panel: full monitor height, glued to one side, never wider than the monitor. */
export function panelRect(monitor: Size, side: 'left' | 'right', width: number): Rect {
  const panelWidth = Math.min(width, monitor.width);
  const x = side === 'left' ? 0 : monitor.width - panelWidth;
  return { x, y: 0, width: panelWidth, height: monitor.height };
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
