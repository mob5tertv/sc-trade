import { describe, expect, it } from 'vitest';
import { createFocusModel } from '../../src/preview/focus-model';

// "Who has the keyboard": the game or the overlay. The model decides, the caller sends the event.
describe('focus model', () => {
  it('starts with the game holding the keyboard and nothing remembered', () => {
    const focus = createFocusModel();
    expect(focus.state()).toEqual({ keyboard: 'game', focusable: true, gameRemembered: 0, focusReturnedToGame: 0 });
    expect(focus.isFocused()).toBe(false);
  });

  it('takes the keyboard from the game and hands it back', () => {
    const focus = createFocusModel();
    focus.remember();
    expect(focus.take(true)).toBe('focus');
    expect(focus.state().keyboard).toBe('overlay');
    expect(focus.isFocused()).toBe(true);

    expect(focus.restore()).toEqual({ restored: true, event: 'blur' });
    expect(focus.state()).toMatchObject({ keyboard: 'game', gameRemembered: 1, focusReturnedToGame: 1 });
  });

  it('does not repeat the focus event when the overlay already has the keyboard', () => {
    const focus = createFocusModel();
    expect(focus.take(true)).toBe('focus');
    expect(focus.take(true)).toBeNull();
  });

  it('refuses the focus while the window cannot take it, or is not on screen', () => {
    const focus = createFocusModel();
    focus.setFocusable(false);
    expect(focus.take(true)).toBeNull();
    expect(focus.isFocused()).toBe(false);

    focus.setFocusable(true);
    expect(focus.take(false)).toBeNull();
    expect(focus.take(true)).toBe('focus');
  });

  describe('take_foreground, with a Windows that is strict', () => {
    it('is refused while the game has the keyboard, however activatable the window is: it was asked, and nothing moved', () => {
      const focus = createFocusModel();
      focus.remember();
      expect(focus.takeForeground()).toEqual({ foreground: false, asked: true });
      expect(focus.state()).toMatchObject({ keyboard: 'game', focusable: true });
      expect(focus.isFocused()).toBe(false);
      // asking again changes nothing: there is no trick that makes this Windows agree
      expect(focus.takeForeground()).toEqual({ foreground: false, asked: true });
    });

    it('finds the overlay in front already after a press activated it, and asks nothing', () => {
      const focus = createFocusModel();
      focus.remember();
      expect(focus.take(true)).toBe('focus'); // the press on an activatable window
      expect(focus.takeForeground()).toEqual({ foreground: true, asked: false });
      expect(focus.state().keyboard).toBe('overlay');
    });

    it('is refused again once the player has clicked the game', () => {
      const focus = createFocusModel();
      focus.take(true);
      focus.clickGame();
      expect(focus.takeForeground()).toEqual({ foreground: false, asked: true });
    });
  });

  it('has nothing to give back when no game window was remembered', () => {
    const focus = createFocusModel();
    expect(focus.restore()).toEqual({ restored: false, event: null });
    expect(focus.state().focusReturnedToGame).toBe(0);
  });

  it('does not remember the overlay itself as the game', () => {
    const focus = createFocusModel();
    focus.take(true);
    focus.remember();
    // the overlay holds the keyboard: nothing to remember, as the Rust side ignores its own window
    expect(focus.restore()).toEqual({ restored: false, event: null });
    expect(focus.state()).toMatchObject({ keyboard: 'overlay', gameRemembered: 0, focusReturnedToGame: 0 });
  });

  it('counts only the calls that store a game window, the way src-tauri/src/focus.rs does', () => {
    const focus = createFocusModel();
    focus.remember();
    focus.remember();
    expect(focus.state().gameRemembered).toBe(2);
    focus.take(true);
    focus.remember(); // refused: the foreground window is the overlay's own
    focus.remember();
    expect(focus.state().gameRemembered).toBe(2);
    focus.clickGame();
    focus.remember();
    expect(focus.state().gameRemembered).toBe(3);
  });

  it('a quiet refresh that finds the game it already knows is not counted; one that finds it for the first time is', () => {
    const focus = createFocusModel();
    focus.remember(true); // nothing was remembered yet: this is news
    expect(focus.state().gameRemembered).toBe(1);
    focus.remember(true);
    focus.remember(true);
    expect(focus.state().gameRemembered).toBe(1); // the same window every 400 ms
    focus.remember(); // the pointer came over a field again: asked aloud
    expect(focus.state().gameRemembered).toBe(2);
    focus.take(true);
    focus.remember(true); // the overlay's own window is never remembered, quietly or not
    expect(focus.state().gameRemembered).toBe(2);
    expect(focus.restore()).toEqual({ restored: true, event: 'blur' });
  });

  it('keeps what it remembered, so a later restore works again', () => {
    const focus = createFocusModel();
    focus.remember();
    focus.take(true);
    focus.restore();
    focus.take(true);
    expect(focus.restore()).toEqual({ restored: true, event: 'blur' });
    expect(focus.state().focusReturnedToGame).toBe(2);
  });

  it('counts a restore that found the keyboard already with the game, without an event', () => {
    const focus = createFocusModel();
    focus.remember();
    expect(focus.restore()).toEqual({ restored: true, event: null });
    expect(focus.state().focusReturnedToGame).toBe(1);
  });

  it('a click on the game takes the keyboard away without counting as a return', () => {
    const focus = createFocusModel();
    focus.remember();
    focus.take(true);
    expect(focus.clickGame()).toBe('blur');
    expect(focus.state()).toMatchObject({ keyboard: 'game', focusReturnedToGame: 0 });
    expect(focus.clickGame()).toBeNull();
  });

  it('losing the screen (hide) gives the keyboard to the game', () => {
    const focus = createFocusModel();
    focus.take(true);
    expect(focus.leaveScreen()).toBe('blur');
    expect(focus.leaveScreen()).toBeNull();
    expect(focus.state().keyboard).toBe('game');
  });
});
