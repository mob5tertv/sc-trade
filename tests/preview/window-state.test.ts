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
      keyboard: 'game', gameRemembered: 0, focusReturnedToGame: 0,
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
    win.setFocusable(false);
    win.show();
    win.setFocus();
    expect(win.isFocused()).toBe(false);
    win.setFocusable(true);
    win.setFocus();
    expect(win.isFocused()).toBe(true);
    expect(focusEvents).toEqual([true]);
  });

  it('showing a window that can take the focus gives it the keyboard, as Windows activates a shown window', () => {
    const { win, focusEvents } = harness();
    win.show();
    expect(win.isFocused()).toBe(true);
    expect(focusEvents).toEqual([true]);
  });

  it('showing a window that cannot take the focus leaves the keyboard with the game', () => {
    const { win, focusEvents } = harness();
    win.setFocusable(false);
    win.show();
    expect(win.snapshot()).toMatchObject({ visible: true, keyboard: 'game' });
    expect(focusEvents).toEqual([]);
  });

  describe('a mouse press inside the window', () => {
    it('gives the keyboard to a window that can take the focus', () => {
      const { win, focusEvents } = harness();
      win.show();
      win.clickGame(); // the player went to the game and came back with the mouse
      expect(win.isFocused()).toBe(false);
      win.pressInside();
      expect(win.isFocused()).toBe(true);
      expect(focusEvents).toEqual([true, false, true]);
    });

    it('does not give it to a window that cannot take the focus (the strip)', () => {
      const { win, focusEvents } = harness();
      win.setFocusable(false);
      win.show();
      win.pressInside();
      expect(win.snapshot().keyboard).toBe('game');
      expect(focusEvents).toEqual([]);
    });

    it('changes nothing when the overlay already holds the keyboard', () => {
      const { win, changes } = harness();
      win.show();
      const before = changes.length;
      win.pressInside();
      expect(changes).toHaveLength(before);
    });

    it('cannot happen while the window is hidden or lets the clicks through to the game', () => {
      const { win, focusEvents } = harness();
      win.pressInside(); // hidden
      win.show();
      win.clickGame();
      win.setIgnoreCursorEvents(true);
      win.pressInside();
      expect(win.isFocused()).toBe(false);
      expect(focusEvents).toEqual([true, false]);
    });

    it('is not a call to remember_foreground or restore_foreground', () => {
      const { win } = harness();
      win.show();
      win.clickGame();
      win.pressInside();
      expect(win.snapshot()).toMatchObject({ gameRemembered: 0, focusReturnedToGame: 0 });
    });
  });

  it('remembers the game, takes the focus, and returns it', () => {
    const { win, focusEvents } = harness();
    win.rememberForeground();
    win.show();
    win.setFocus();
    expect(win.restoreForeground()).toBe(true);
    expect(win.snapshot()).toMatchObject({ keyboard: 'game', gameRemembered: 1, focusReturnedToGame: 1 });
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
