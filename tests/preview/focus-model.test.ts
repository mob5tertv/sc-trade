import { describe, expect, it } from 'vitest';
import { createFocusModel } from '../../src/preview/focus-model';

// "Who has the keyboard": the game or the overlay. The model decides, the caller sends the event.
describe('focus model', () => {
  it('starts with the game holding the keyboard and nothing remembered', () => {
    const focus = createFocusModel();
    expect(focus.state()).toEqual({ keyboard: 'game', focusable: true, remembered: 0, restored: 0 });
    expect(focus.isFocused()).toBe(false);
  });

  it('takes the keyboard from the game and hands it back', () => {
    const focus = createFocusModel();
    focus.remember();
    expect(focus.take(true)).toBe('focus');
    expect(focus.state().keyboard).toBe('overlay');
    expect(focus.isFocused()).toBe(true);

    expect(focus.restore()).toEqual({ restored: true, event: 'blur' });
    expect(focus.state()).toMatchObject({ keyboard: 'game', remembered: 1, restored: 1 });
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

  it('has nothing to give back when no game window was remembered', () => {
    const focus = createFocusModel();
    expect(focus.restore()).toEqual({ restored: false, event: null });
    expect(focus.state().restored).toBe(0);
  });

  it('does not remember the overlay itself as the game', () => {
    const focus = createFocusModel();
    focus.take(true);
    focus.remember();
    // the overlay holds the keyboard: nothing to remember, as the Rust side ignores its own window
    expect(focus.restore()).toEqual({ restored: false, event: null });
    expect(focus.state()).toMatchObject({ keyboard: 'overlay', remembered: 1, restored: 0 });
  });

  it('keeps what it remembered, so a later restore works again', () => {
    const focus = createFocusModel();
    focus.remember();
    focus.take(true);
    focus.restore();
    focus.take(true);
    expect(focus.restore()).toEqual({ restored: true, event: 'blur' });
    expect(focus.state().restored).toBe(2);
  });

  it('counts a restore that found the keyboard already with the game, without an event', () => {
    const focus = createFocusModel();
    focus.remember();
    expect(focus.restore()).toEqual({ restored: true, event: null });
    expect(focus.state().restored).toBe(1);
  });

  it('a click on the game takes the keyboard away without counting as a return', () => {
    const focus = createFocusModel();
    focus.remember();
    focus.take(true);
    expect(focus.clickGame()).toBe('blur');
    expect(focus.state()).toMatchObject({ keyboard: 'game', restored: 0 });
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
