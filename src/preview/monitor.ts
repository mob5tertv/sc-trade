import type { Rect, Size } from '../core/layout';

/**
 * The monitor of the preview: its size in PHYSICAL pixels (what the display is) and the Windows scale factor.
 * The application works in physical pixels of this monitor, exactly as it does under Tauri.
 */
export interface PreviewMonitor {
  width: number;
  height: number;
  scale: number;
}

export const DEFAULT_MONITOR: PreviewMonitor = { width: 1920, height: 1080, scale: 1 };

const FORMAT = '2560x1440@1';
const PATTERN = /^(\d{3,5})x(\d{3,5})(?:@(\d+(?:\.\d+)?))?$/;
const MIN_SCALE = 0.5;
const MAX_SCALE = 4;

/** `monitor=2560x1440@1.5` (width x height @ scale; the scale is optional). A missing parameter is the default. */
export function parseMonitor(text: string | null | undefined): PreviewMonitor {
  if (text === null || text === undefined || text === '') return DEFAULT_MONITOR;
  const match = PATTERN.exec(text);
  const scale = match === null ? NaN : match[3] === undefined ? 1 : Number(match[3]);
  if (match === null || !(scale >= MIN_SCALE && scale <= MAX_SCALE)) {
    throw new RangeError(`Cannot read the monitor "${text}": expected width x height @ scale, like ${FORMAT}`);
  }
  return { width: Number(match[1]), height: Number(match[2]), scale };
}

export function formatMonitor(monitor: PreviewMonitor): string {
  return `${monitor.width}x${monitor.height}@${monitor.scale}`;
}

/** The monitor in logical pixels: what the application lays its window out in. */
export function logicalSize(monitor: PreviewMonitor): Size {
  return { width: monitor.width / monitor.scale, height: monitor.height / monitor.scale };
}

/**
 * A rect of the desktop in physical pixels (what the window layer sends to Tauri) as a rect of the monitor in
 * logical pixels (what the desktop page draws). The inverse of `toPhysicalRect` from `src/core/layout.ts`
 * up to its rounding of the edges to whole physical pixels.
 */
export function toLogicalRect(rect: Rect, monitorPosition: { x: number; y: number }, scale: number): Rect {
  return {
    x: (rect.x - monitorPosition.x) / scale,
    y: (rect.y - monitorPosition.y) / scale,
    width: rect.width / scale,
    height: rect.height / scale,
  };
}
