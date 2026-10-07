import { describe, expect, it } from 'vitest';
import { createPreviewWindow, type WindowSnapshot } from '../../src/preview/window-state';

function harness() {
  const changes: WindowSnapshot[] = [];
  const focusEvents: boolean[] = [];
  const win = createPreviewWindow({
    onChange: (snapshot) => changes.push(snapshot),
    onFocus: (focused) => focusEvents.push(focused),
  });
  return { win, changes, focusEvents };
}

describe('preview window', () => {
  it('starts like the window of tauri.conf.json: hidden, 240x26, away from the taskbar', () => {
    const { win } = harness();
    expect(win.snapshot()).toEqual({
      visible: false, closed: false,
      position: { x: 0, y: 0 }, size: { width: 240, height: 26 },
      focusable: true, ignoreCursorEvents: false, skipTaskbar: true,
      keyboard: 'game', remembered: 0, restored: 0,
    });
  });

  it('reports every change to the page, with the whole state', () => {
    const { win, changes } = harness();
    win.setPosition({ x: 1644, y: 16 });
    win.setSize({ width: 260, height: 36 });
    win.show();
    expect(changes).toHaveLength(3);
    expect(changes[2]).toMatchObject({ visible: true, position: { x: 1644, y: 16 }, size: { width: 260, height: 36 } });
  });

  it('places the position and the size together: one report, never a state with only one of them', () => {
    const { win, changes } = harness();
    win.place({ x: 1464, y: 16, width: 440, height: 300 });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ position: { x: 1464, y: 16 }, size: { width: 440, height: 300 } });
    win.place({ x: 1464, y: 16, width: 440, height: 300 });
    expect(changes).toHaveLength(1);
  });

  it('does not report a call that changes nothing', () => {
    const { win, changes } = harness();
    win.setIgnoreCursorEvents(false);
    win.setSkipTaskbar(true);
    win.hide();
    expect(changes).toHaveLength(0);
  });

  it('hands out snapshots that later changes do not touch', () => {
    const { win } = harness();
    const before = win.snapshot();
    win.setSize({ width: 100, height: 100 });
    expect(before.size).toEqual({ width: 240, height: 26 });
  });

  it('gives the focus to the overlay only when the window is shown and focusable', () => {
    const { win, focusEvents } = harness();
    win.setFocus(); // hidden
    expect(win.isFocused()).toBe(false);
    win.show();
    win.setFocusable(false);
    win.setFocus();
    expect(win.isFocused()).toBe(false);
    win.setFocusable(true);
    win.setFocus();
    expect(win.isFocused()).toBe(true);
    expect(focusEvents).toEqual([true]);
  });

  it('remembers the game, takes the focus, and returns it', () => {
    const { win, focusEvents } = harness();
    win.rememberForeground();
    win.show();
    win.setFocus();
    expect(win.restoreForeground()).toBe(true);
    expect(win.snapshot()).toMatchObject({ keyboard: 'game', remembered: 1, restored: 1 });
    expect(focusEvents).toEqual([true, false]);
  });

  it('a click on the game takes the focus from a focused overlay', () => {
    const { win, focusEvents } = harness();
    win.show();
    win.setFocus();
    win.clickGame();
    expect(win.isFocused()).toBe(false);
    expect(focusEvents).toEqual([true, false]);
  });

  it('hiding a focused window gives the keyboard to the game', () => {
    const { win, focusEvents } = harness();
    win.show();
    win.setFocus();
    win.hide();
    expect(win.snapshot()).toMatchObject({ visible: false, keyboard: 'game' });
    expect(focusEvents).toEqual([true, false]);
  });

  it('close hides the window for good and says so', () => {
    const { win } = harness();
    win.show();
    win.close();
    expect(win.snapshot()).toMatchObject({ visible: false, closed: true });
    win.show();
    expect(win.snapshot().visible).toBe(false);
  });
});
