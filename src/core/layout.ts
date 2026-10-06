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

export const STRIP_SIZE: Size = { width: 520, height: 32 };

const DEFAULT_STRIP_MARGIN = 16;

/** The strip in a corner of the monitor, `margin` pixels away from the monitor edges. */
export function stripRect(monitor: Size, corner: Corner, margin: number = DEFAULT_STRIP_MARGIN): Rect {
  const { width, height } = STRIP_SIZE;
  const x = corner.endsWith('left') ? margin : monitor.width - width - margin;
  const y = corner.startsWith('top') ? margin : monitor.height - height - margin;
  return { x, y, width, height };
}

/** The panel: full monitor height, glued to one side, never wider than the monitor. */
export function panelRect(monitor: Size, side: 'left' | 'right', width: number): Rect {
  const panelWidth = Math.min(width, monitor.width);
  const x = side === 'left' ? 0 : monitor.width - panelWidth;
  return { x, y: 0, width: panelWidth, height: monitor.height };
}
