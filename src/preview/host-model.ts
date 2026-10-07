import type { Rect, Size } from '../core/layout';
import { toLogicalRect, type PreviewMonitor } from './monitor';
import type { WindowSnapshot } from './window-state';

// The pure parts of the desktop page (`host.ts`): where the overlay window is drawn and what the status line says.

/**
 * How much the desktop is shrunk so that all of it fits the browser window. It never grows above 1, and
 * `zoom=1` (`noShrink`) turns the shrinking off, which the screenshots use to get exact pixels.
 */
export function fitScale(field: Size, available: Size, noShrink = false): number {
  if (noShrink || available.width <= 0 || available.height <= 0) return 1;
  return Math.min(1, available.width / field.width, available.height / field.height);
}

/**
 * Where the window is drawn on the desktop, in logical pixels of the monitor: the physical rect the
 * application set, divided by the scale. `null` when nothing is drawn (the window is hidden or closed).
 */
export function windowFrame(window: WindowSnapshot, monitor: PreviewMonitor): Rect | null {
  if (!window.visible || window.closed) return null;
  const physical: Rect = { ...window.position, ...window.size };
  return toLogicalRect(physical, { x: 0, y: 0 }, monitor.scale);
}

/** The status line of the service bar (Russian): the window, the keyboard and the focus given back. */
export function windowStatus(window: WindowSnapshot): string {
  const state = window.closed ? 'окно закрыто' : window.visible ? 'окно показано' : 'окно скрыто';
  const parts = [
    state,
    `${window.size.width}×${window.size.height} физ. px`,
    `положение ${window.position.x}, ${window.position.y}`,
    window.focusable ? 'может взять фокус' : 'не берёт фокус',
    window.ignoreCursorEvents ? 'клики проходят в игру' : 'принимает клики',
    `клавиатура: ${window.keyboard === 'game' ? 'игра' : 'оверлей'}`,
    `фокус возвращён игре: ${window.focusReturnedToGame}`,
  ];
  return parts.join(' · ');
}
