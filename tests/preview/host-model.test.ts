import { describe, expect, it } from 'vitest';
import { fitScale, windowFrame, windowStatus } from '../../src/preview/host-model';
import { parseMonitor } from '../../src/preview/monitor';
import type { WindowSnapshot } from '../../src/preview/window-state';

const snapshot = (partial: Partial<WindowSnapshot> = {}): WindowSnapshot => ({
  visible: true, closed: false,
  position: { x: 0, y: 0 }, size: { width: 470, height: 1080 },
  focusable: true, ignoreCursorEvents: false, skipTaskbar: true,
  keyboard: 'game', remembered: 0, restored: 0,
  ...partial,
});

describe('fitScale', () => {
  const field = { width: 1920, height: 1080 };

  it('shrinks the field to fit the browser window, keeping the proportions', () => {
    expect(fitScale(field, { width: 960, height: 2000 })).toBeCloseTo(0.5);
    expect(fitScale(field, { width: 5000, height: 540 })).toBeCloseTo(0.5);
  });

  it('never enlarges the field', () => {
    expect(fitScale(field, { width: 5000, height: 5000 })).toBe(1);
  });

  it('zoom=1 turns the shrinking off', () => {
    expect(fitScale(field, { width: 100, height: 100 }, true)).toBe(1);
  });

  it('survives a window of no size', () => {
    expect(fitScale(field, { width: 0, height: 0 })).toBe(1);
  });
});

describe('windowFrame', () => {
  it('is the rectangle of the window in logical pixels of the desktop', () => {
    const monitor = parseMonitor('2560x1440@1.5');
    expect(windowFrame(snapshot({ position: { x: 2146, y: 0 }, size: { width: 705, height: 1440 } }), monitor))
      .toEqual({ x: 2146 / 1.5, y: 0, width: 705 / 1.5, height: 960 });
  });

  it('is nothing while the window is hidden or closed', () => {
    const monitor = parseMonitor('1920x1080@1');
    expect(windowFrame(snapshot({ visible: false }), monitor)).toBeNull();
    expect(windowFrame(snapshot({ closed: true, visible: false }), monitor)).toBeNull();
  });
});

describe('windowStatus', () => {
  it('says in Russian where the window is and who has the keyboard', () => {
    const text = windowStatus(snapshot({ position: { x: 1450, y: 0 }, remembered: 3, restored: 2 }));
    expect(text).toContain('470×1080');
    expect(text).toContain('1450, 0');
    expect(text).toContain('клавиатура: игра');
    expect(text).toContain('фокус возвращён игре: 2');
  });

  it('names the overlay when it holds the keyboard', () => {
    expect(windowStatus(snapshot({ keyboard: 'overlay' }))).toContain('клавиатура: оверлей');
  });

  it('says when the window is hidden or closed', () => {
    expect(windowStatus(snapshot({ visible: false }))).toContain('окно скрыто');
    expect(windowStatus(snapshot({ visible: false, closed: true }))).toContain('окно закрыто');
  });

  it('says when clicks pass through to the game and when the window cannot take the focus', () => {
    const text = windowStatus(snapshot({ ignoreCursorEvents: true, focusable: false }));
    expect(text).toContain('клики проходят в игру');
    expect(text).toContain('не берёт фокус');
  });
});
