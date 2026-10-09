import { describe, expect, it } from 'vitest';
import { hasUnsavedTyping, KEYBOARD_IDLE_MS, keyboardUnused, settlesTyping, type EditedField } from '../../src/ui/vm/keyboard-idle';

/** A field with a number standing in it that the player has not typed into, unless said. */
const field = (over: Partial<EditedField> = {}): EditedField => ({ text: '2350', typed: false, refused: false, ...over });

/** The keyboard was taken at 0 and no key was pressed since, unless said. */
const use = (over: Partial<Parameters<typeof keyboardUnused>[0]> = {}) => keyboardUnused({
  now: KEYBOARD_IDLE_MS, lastKeyAt: Number.NEGATIVE_INFINITY, takenAt: 0, field: field(), ...over,
});

describe('KEYBOARD_IDLE_MS', () => {
  it('is fifteen seconds', () => {
    expect(KEYBOARD_IDLE_MS).toBe(15_000);
  });
});

describe('keyboardUnused: the keyboard goes back to the game by itself', () => {
  it('when no key was pressed for fifteen seconds after the keyboard was taken and nothing was typed into the field', () => {
    expect(use()).toBe(true);
    expect(use({ now: 60_000 })).toBe(true);
  });

  it('not a moment earlier', () => {
    expect(use({ now: KEYBOARD_IDLE_MS - 1 })).toBe(false);
    expect(use({ now: 0 })).toBe(false);
  });

  it('counts from the last key or from the take, whichever is later', () => {
    // a key at 10 s: the time runs from it
    expect(use({ now: 24_999, takenAt: 0, lastKeyAt: 10_000 })).toBe(false);
    expect(use({ now: 25_000, takenAt: 0, lastKeyAt: 10_000 })).toBe(true);
    // the keyboard was taken again at 20 s (a press on another field): the time runs from that
    expect(use({ now: 34_999, takenAt: 20_000, lastKeyAt: 10_000 })).toBe(false);
    expect(use({ now: 35_000, takenAt: 20_000, lastKeyAt: 10_000 })).toBe(true);
  });

  it('never while the keys keep coming: a series of prices is typed with pauses shorter than the limit', () => {
    let lastKeyAt = 0;
    for (let now = 0; now <= 120_000; now += 5000) {
      expect(use({ now, takenAt: 0, lastKeyAt })).toBe(false);
      lastKeyAt = now; // a digit, or Enter
    }
  });

  it('never while the field holds what the player typed and has not saved, however long he is away', () => {
    expect(use({ field: field({ text: '24', typed: true }) })).toBe(false);
    expect(use({ now: 3_600_000, field: field({ text: '24', typed: true }) })).toBe(false);
  });

  it('when what was typed was taken out again: the field is empty', () => {
    expect(use({ field: field({ text: '', typed: true }) })).toBe(true);
    expect(use({ field: field({ text: '  ', typed: true }) })).toBe(true);
  });

  it('when what was typed was sent: Enter settled it, and the number merely stands in the field again', () => {
    // 2400 typed, Enter at 5 s: the time runs from that key
    expect(use({ now: 19_999, lastKeyAt: 5000, field: field({ text: '2400', typed: false }) })).toBe(false);
    expect(use({ now: 20_000, lastKeyAt: 5000, field: field({ text: '2400', typed: false }) })).toBe(true);
  });

  it('never while the field is marked as refused: what stands in it was typed and is not saved', () => {
    expect(use({ field: field({ text: 'abc', refused: true }) })).toBe(false);
    expect(use({ field: field({ text: 'abc', typed: true, refused: true }) })).toBe(false);
  });

  it('a refused field that is empty (a price is required and none was given) holds nothing to lose', () => {
    expect(use({ field: field({ text: '', refused: true }) })).toBe(true);
  });

  it('an empty field that was never typed into (the commodity of the quick entry after a saved price)', () => {
    expect(use({ field: field({ text: '' }) })).toBe(true);
  });
});

describe('hasUnsavedTyping', () => {
  it('is what the player typed and what was refused, never a number that merely stands in the field', () => {
    expect(hasUnsavedTyping(field())).toBe(false);
    expect(hasUnsavedTyping(field({ typed: true }))).toBe(true);
    expect(hasUnsavedTyping(field({ refused: true }))).toBe(true);
    expect(hasUnsavedTyping(field({ text: '', typed: true, refused: true }))).toBe(false);
  });
});

describe('settlesTyping: the keys after which what was typed is typed no more', () => {
  it('Enter sends it and Esc takes it back', () => {
    expect(settlesTyping('Enter')).toBe(true);
    expect(settlesTyping('Escape')).toBe(true);
  });

  it('no other key does', () => {
    for (const key of ['1', 'a', 'Tab', 'Backspace', 'Delete', 'ArrowLeft', ' ', 'F8', 'Shift']) expect(settlesTyping(key)).toBe(false);
  });
});
