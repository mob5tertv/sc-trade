import { describe, expect, it } from 'vitest';
import { pressBringsCursor, pressSelectsAll } from '../../src/ui/keyboard';

// The decisions of the DOM side of the keyboard rules that need no DOM. The listeners themselves run in the preview
// (`src/preview/scenes-keyboard.ts`), against a real browser.

describe('pressBringsCursor: is this press the one that brings a number field the cursor', () => {
  it('is, when the field has no cursor yet', () => {
    expect(pressBringsCursor({ focused: false, keyboardHeld: true })).toBe(true);
    expect(pressBringsCursor({ focused: false, keyboardHeld: false })).toBe(true);
  });

  it('is not, when the field has the cursor and the window holds the keyboard: that is the second click', () => {
    expect(pressBringsCursor({ focused: true, keyboardHeld: true })).toBe(false);
  });

  it('is, when the field kept the focus of the page while the keyboard was with the game (the player clicked the game and came back)', () => {
    expect(pressBringsCursor({ focused: true, keyboardHeld: false })).toBe(true);
  });
});

describe('pressSelectsAll: what the end of a press does with the number in the field', () => {
  const press = (over: Partial<Parameters<typeof pressSelectsAll>[0]> = {}) => pressSelectsAll({ broughtCursor: true, start: 2, end: 2, length: 4, ...over });

  it('selects the whole number after the press that brought the cursor: the browser has put a caret where the mouse was', () => {
    expect(press()).toBe(true);
    expect(press({ start: 0, end: 0 })).toBe(true);
    expect(press({ start: 4, end: 4 })).toBe(true);
  });

  it('keeps a number that is selected whole selected (the release of the button would take the selection away)', () => {
    expect(press({ start: 0, end: 4 })).toBe(true);
  });

  it('leaves a part the player dragged over with that very press as he selected it', () => {
    expect(press({ start: 1, end: 3 })).toBe(false);
    expect(press({ start: 0, end: 3 })).toBe(false);
    expect(press({ start: 1, end: 4 })).toBe(false);
  });

  it('leaves the caret where the click put it when the field had the cursor already: one digit is being corrected', () => {
    expect(press({ broughtCursor: false })).toBe(false);
    expect(press({ broughtCursor: false, start: 0, end: 4 })).toBe(false);
    expect(press({ broughtCursor: false, start: 1, end: 3 })).toBe(false);
  });

  it('selects when the field cannot say where its caret is', () => {
    expect(press({ start: null, end: null })).toBe(true);
  });

  it('an empty field has nothing to lose', () => {
    expect(press({ start: 0, end: 0, length: 0 })).toBe(true);
  });
});
