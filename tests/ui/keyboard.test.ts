import { describe, expect, it } from 'vitest';
import { cursorPlace, escapeGivesBack, pressBringsCursor, pressSelectsAll } from '../../src/ui/keyboard';

// The decisions of the DOM side of the keyboard rules that need no DOM. The listeners themselves run in the preview
// (`src/preview/scenes-keyboard.ts`), against a real browser.

describe('cursorPlace: what has the cursor of the page, as the watchdog reads it', () => {
  /** A plain button, unless said: no text field, in no group that opens an entry. */
  const place = (over: Partial<Parameters<typeof cursorPlace>[0]> = {}) => cursorPlace({ editable: false, inEntryGroup: false, entryOpen: false, ...over });

  it('a text field is a field: the keyboard is in use there', () => {
    expect(place({ editable: true })).toBe('field');
    // whatever stands around it
    expect(place({ editable: true, inEntryGroup: true, entryOpen: true })).toBe('field');
  });

  it('a control inside a group that opens an entry, with the field of that entry on the page, is part of the entry: the cursor that came to a side of the switch by Tab is still in the line', () => {
    expect(place({ inEntryGroup: true, entryOpen: true })).toBe('entry');
  });

  it('the same control is nothing while the field of its entry is not on the page: there is no entry to be in', () => {
    expect(place({ inEntryGroup: true, entryOpen: false })).toBe('nowhere');
  });

  it('anything else is nothing, and the keyboard goes back: a plain button, a row, the page itself', () => {
    expect(place()).toBe('nowhere');
    // an entry that is on the page does not make a button next to it a part of it
    expect(place({ entryOpen: true })).toBe('nowhere');
  });
});

describe('escapeGivesBack: does this key give the keyboard back to the game', () => {
  it('Esc does, while the window holds the keyboard', () => {
    expect(escapeGivesBack({ key: 'Escape', keyboardHeld: true })).toBe(true);
  });

  it('whatever the field made of the key: the rule is not told, so a field that used Esc itself cannot keep the keyboard', () => {
    // the row of the table stops the key, the search box and the quick entry stop it and take its default away
    const used = { key: 'Escape', keyboardHeld: true, defaultPrevented: true, propagationStopped: true };
    expect(escapeGivesBack(used)).toBe(true);
  });

  it('Esc with the keyboard at the game is nobody\'s business', () => {
    expect(escapeGivesBack({ key: 'Escape', keyboardHeld: false })).toBe(false);
  });

  it('no other key does', () => {
    for (const key of ['Enter', 'Tab', 'Backspace', 'Delete', 'Esc', 'escape', 'a', '1', 'F8']) {
      expect(escapeGivesBack({ key, keyboardHeld: true }), key).toBe(false);
    }
  });
});

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
