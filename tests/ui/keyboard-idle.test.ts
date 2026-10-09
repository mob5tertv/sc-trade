import { describe, expect, it } from 'vitest';
import {
  createTypingMemory, isUnconfirmed, KEYBOARD_IDLE_MS, keyboardUnused, settlesTyping,
  type EditedField, type FieldPlace, type TypedText,
} from '../../src/ui/vm/keyboard-idle';

/** The field with the cursor: a number stands in it, it is not marked as refused and it is no open list, unless said. */
const field = (over: Partial<EditedField> = {}): EditedField => ({ text: '2350', refused: false, choosing: false, ...over });

/** The keyboard was taken at 0, no key was pressed since and nothing was typed anywhere, unless said. */
const use = (over: Partial<Parameters<typeof keyboardUnused>[0]> = {}) => keyboardUnused({
  now: KEYBOARD_IDLE_MS, lastKeyAt: Number.NEGATIVE_INFINITY, takenAt: 0, field: field(), typed: [], ...over,
});

/** Something the player typed that still stands in its field, not settled and not refused, unless said. */
const typedText = (over: Partial<TypedText> = {}): TypedText => ({ typed: '2400', now: '2400', settled: false, refused: false, ...over });

describe('KEYBOARD_IDLE_MS', () => {
  it('is fifteen seconds', () => {
    expect(KEYBOARD_IDLE_MS).toBe(15_000);
  });
});

describe('keyboardUnused: the keyboard goes back to the game by itself', () => {
  it('when no key was pressed for fifteen seconds after the keyboard was taken and nothing typed waits to be confirmed', () => {
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

  it('never while something the player typed waits to be confirmed, wherever the cursor is and however long he is away', () => {
    expect(use({ typed: [typedText()] })).toBe(false);
    expect(use({ now: 3_600_000, typed: [typedText()] })).toBe(false);
    // the cursor stands in another field, an empty one: what waits in the first field still keeps the keyboard
    expect(use({ field: field({ text: '' }), typed: [typedText()] })).toBe(false);
    // one waiting text among settled ones is enough
    expect(use({ typed: [typedText({ settled: true }), typedText({ typed: '120', now: '120' })] })).toBe(false);
  });

  it('when everything typed was settled, emptied, replaced or is gone', () => {
    expect(use({ typed: [typedText({ settled: true }), typedText({ typed: '', now: '' }), typedText({ now: 'HUR-L1' }), typedText({ now: null })] })).toBe(true);
  });

  it('never while the field with the cursor is marked as refused and holds something', () => {
    expect(use({ field: field({ text: 'abc', refused: true }) })).toBe(false);
  });

  it('a refused field that is empty (a price is required and none was given) holds nothing to lose', () => {
    expect(use({ field: field({ text: '', refused: true }) })).toBe(true);
    expect(use({ field: field({ text: '  ', refused: true }) })).toBe(true);
  });

  it('never while a list may be open: it was pressed and nothing was chosen yet (the player reads the ships, and no key is needed for that)', () => {
    expect(use({ field: field({ text: '', choosing: true }) })).toBe(false);
    expect(use({ now: 3_600_000, field: field({ text: '', choosing: true }) })).toBe(false);
  });

  it('when the choice was made the list is like any field that holds nothing typed', () => {
    expect(use({ now: KEYBOARD_IDLE_MS - 1, field: field({ text: '', choosing: false }) })).toBe(false);
    expect(use({ field: field({ text: '', choosing: false }) })).toBe(true);
  });
});

describe('isUnconfirmed: what the player typed and nobody has dealt with', () => {
  it('is a text that still stands in its field as he typed it', () => {
    expect(isUnconfirmed(typedText())).toBe(true);
  });

  it('is not a text he settled himself (Enter, Esc, leaving the cell), unless it was refused', () => {
    expect(isUnconfirmed(typedText({ settled: true }))).toBe(false);
    expect(isUnconfirmed(typedText({ settled: true, refused: true }))).toBe(true);
  });

  it('is not an empty text, a text the program has replaced, or the text of a field that left the page', () => {
    expect(isUnconfirmed(typedText({ typed: '', now: '' }))).toBe(false);
    expect(isUnconfirmed(typedText({ typed: '  ', now: '  ' }))).toBe(false);
    expect(isUnconfirmed(typedText({ typed: 'hur', now: 'HUR-L1' }))).toBe(false);
    expect(isUnconfirmed(typedText({ now: null }))).toBe(false);
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

// The walks of the review of task 47: the automatic return must never cause a write, or the loss, of something the player
// typed and did not confirm. The memory keeps WHICH field was typed into and what stood in it; the fields are names here.
describe('createTypingMemory: what was typed where, and whether it still waits', () => {
  /** The two fields of the open row of the table: they are saved together, and leaving the cell saves it. */
  const ROW: FieldPlace = { inForm: false, cell: '3:1:buy' };
  /** A field of a form (the quick entry, the form of a trade): Enter submits the form, leaving the field does nothing. */
  const FORM: FieldPlace = { inForm: true, cell: null };
  /** A field that is saved alone (a number of the settings, the location box). */
  const ALONE: FieldPlace = { inForm: false, cell: null };

  /** The page: what stands in each field now (a field that is not named has left the page), and which are marked as refused. */
  const page = (texts: Record<string, string>, refused: string[] = []) => (name: string) => ({
    text: name in texts ? texts[name] : null, refused: refused.includes(name),
  });

  /** Whether the keyboard goes back `afterMs` after the last key, with the cursor in a field that holds `cursorText`. */
  const goesBack = (typed: TypedText[], afterMs = 16_500, cursorText = '') => keyboardUnused({
    now: afterMs, lastKeyAt: 0, takenAt: 0, field: field({ text: cursorText }), typed,
  });

  it('trace A: a price typed into the row, then Tab into the quantity: the keyboard stays, so no timer saves the price', () => {
    const memory = createTypingMemory<string>();
    memory.typed('price', '2400', ROW);
    // Tab: the cursor goes to the other field of the same cell, which is not leaving it; nothing is told
    const now = page({ price: '2400', scu: '' });
    expect(goesBack(memory.read(now))).toBe(false);
    expect(goesBack(memory.read(now), 60_000)).toBe(false);
    expect(goesBack(memory.read(now), 3_600_000)).toBe(false);
  });

  it('trace B: a quantity typed, then the cursor moved to the price that merely stands there: the keyboard stays', () => {
    const memory = createTypingMemory<string>();
    memory.typed('scu', '120', ROW);
    expect(goesBack(memory.read(page({ price: '988', scu: '120' })), 16_500, '988')).toBe(false);
  });

  it('the quick entry: a price typed, the cursor in another, empty field: the keyboard stays (the window does not fold over the line)', () => {
    const memory = createTypingMemory<string>();
    memory.typed('quick-price', '2900', FORM);
    const now = page({ 'quick-commodity': '', 'quick-price': '2900', 'quick-scu': '' });
    expect(goesBack(memory.read(now))).toBe(false);
    // Enter in ANOTHER field of the form (a commodity is picked from the list) does not confirm the price
    memory.typed('quick-commodity', 'sti', FORM);
    memory.key('quick-commodity', 'Enter', FORM);
    expect(goesBack(memory.read(page({ 'quick-commodity': 'STIM Stims', 'quick-price': '2900', 'quick-scu': '' })))).toBe(false);
    // ...and neither does a press outside the fields and a click back into another field of the form
    memory.left('quick-price', FORM);
    expect(goesBack(memory.read(page({ 'quick-commodity': 'STIM Stims', 'quick-price': '2900', 'quick-scu': '' })))).toBe(false);
  });

  it('a form says itself what came of Enter: emptied fields (saved) let the keyboard go, a text that stays (refused) keeps it', () => {
    const memory = createTypingMemory<string>();
    memory.typed('quick-price', '2900', FORM);
    memory.key('quick-price', 'Enter', FORM);
    expect(goesBack(memory.read(page({ 'quick-price': '2900' })))).toBe(false); // no commodity: refused, the text stays
    expect(goesBack(memory.read(page({ 'quick-price': '' })))).toBe(true); // saved: the form emptied its fields
  });

  it('typed, then Enter in the row, then fifteen seconds: the keyboard goes back', () => {
    const memory = createTypingMemory<string>();
    memory.typed('price', '2400', ROW);
    memory.key('price', 'Enter', ROW);
    const read = memory.read(page({ price: '2400', scu: '' }));
    expect(goesBack(read, KEYBOARD_IDLE_MS - 1, '2400')).toBe(false);
    expect(goesBack(read, KEYBOARD_IDLE_MS, '2400')).toBe(true);
  });

  it('Enter in one field of the row confirms the other one too: the cell is saved whole', () => {
    const memory = createTypingMemory<string>();
    memory.typed('price', '2400', ROW);
    memory.typed('scu', '120', ROW);
    memory.key('scu', 'Enter', ROW);
    expect(goesBack(memory.read(page({ price: '2400', scu: '120' })), 16_500, '120')).toBe(true);
  });

  it('Enter that was refused confirms nothing: a field of the cell is marked, and the keyboard stays', () => {
    const memory = createTypingMemory<string>();
    memory.typed('price', 'abc', ROW);
    memory.typed('scu', '120', ROW);
    memory.key('scu', 'Enter', ROW);
    // the page says for every field of the cell that the cell was refused
    expect(goesBack(memory.read(page({ price: 'abc', scu: '120' }, ['price', 'scu'])), 16_500, '120')).toBe(false);
  });

  it('Esc in the row takes back what was typed into the cell', () => {
    const memory = createTypingMemory<string>();
    memory.typed('price', '2400', ROW);
    memory.key('price', 'Escape', ROW);
    expect(goesBack(memory.read(page({ price: '2400', scu: '' })))).toBe(true);
  });

  it('a key that settles nothing settles nothing', () => {
    const memory = createTypingMemory<string>();
    memory.typed('price', '2400', ROW);
    for (const key of ['Tab', '5', 'Backspace', 'ArrowLeft']) memory.key('price', key, ROW);
    expect(goesBack(memory.read(page({ price: '2400' })))).toBe(false);
  });

  it('typed in a field that has since left the page (the row was folded, the form closed): the keyboard goes back', () => {
    const memory = createTypingMemory<string>();
    memory.typed('price', '2400', ROW);
    expect(goesBack(memory.read(page({})))).toBe(true);
  });

  it('typed, and the same text still stands there sixty seconds later: the keyboard stays', () => {
    const memory = createTypingMemory<string>();
    memory.typed('price', '24', ROW);
    memory.typed('price', '240', ROW);
    memory.typed('price', '2400', ROW); // every key is told; the last text is what counts
    expect(goesBack(memory.read(page({ price: '2400' })), 60_000, '2400')).toBe(false);
  });

  it('typed and taken out again by hand: an empty field keeps nothing', () => {
    const memory = createTypingMemory<string>();
    memory.typed('price', '24', ROW);
    memory.typed('price', '', ROW);
    expect(goesBack(memory.read(page({ price: '' })))).toBe(true);
  });

  it('a text the program replaced (a place picked from the list) counts no more, even if the same letters stand there again later', () => {
    const memory = createTypingMemory<string>();
    memory.typed('location', 'hur', ALONE);
    expect(goesBack(memory.read(page({ location: 'HUR-L1' })))).toBe(true);
    expect(goesBack(memory.read(page({ location: 'hur' })))).toBe(true);
  });

  it('leaving the cell by the player\'s own hand settles it (the table saves a cell that is left); moving inside the cell is told to nobody', () => {
    const memory = createTypingMemory<string>();
    memory.typed('price', '2400', ROW);
    memory.typed('scu', '120', ROW);
    memory.left('scu', ROW); // a click on «Купил», Tab onto a button, a click on the game
    expect(goesBack(memory.read(page({ price: '2400', scu: '120' })))).toBe(true);
  });

  it('a cell that was left with a number that cannot be saved is marked, and keeps the keyboard when the player comes back to it', () => {
    const memory = createTypingMemory<string>();
    memory.typed('price', 'abc', ROW);
    memory.left('price', ROW);
    expect(goesBack(memory.read(page({ price: 'abc', scu: '' }, ['price', 'scu'])))).toBe(false);
  });

  it('a field that is saved alone is settled by its own Enter and by being left, and only it', () => {
    const memory = createTypingMemory<string>();
    memory.typed('capacity', '500', ALONE);
    memory.typed('budget', '90000', ALONE);
    memory.key('capacity', 'Enter', ALONE);
    expect(goesBack(memory.read(page({ capacity: '500', budget: '90000' })))).toBe(false); // the budget still waits
    memory.left('budget', ALONE);
    expect(goesBack(memory.read(page({ capacity: '500', budget: '90000' })))).toBe(true);
  });

  it('typing again after Enter is a new text that waits', () => {
    const memory = createTypingMemory<string>();
    memory.typed('price', '2400', ROW);
    memory.key('price', 'Enter', ROW);
    memory.typed('price', '24005', ROW);
    expect(goesBack(memory.read(page({ price: '24005' })))).toBe(false);
  });
});
