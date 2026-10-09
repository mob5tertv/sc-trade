import { describe, expect, it } from 'vitest';
import {
  createTypingMemory, isUnconfirmed, KEYBOARD_IDLE_MS, keyboardUnused, settlesTyping,
  type EditedField, type FieldPlace, type TypedText,
} from '../../src/ui/vm/keyboard-idle';

/** The two fields of the open row of the table: the page says the cell is saved by Enter and when it is left. */
const ROW: FieldPlace = { inForm: false, commits: true, cell: '3:1:buy' };
/** A field of the settings: the page says it is saved by Enter and when it is left; it is saved alone. */
const SETTINGS: FieldPlace = { inForm: false, commits: true, cell: null };
/** A field of a form (the quick entry, the form of a trade): Enter submits the form, leaving the field does nothing. */
const FORM: FieldPlace = { inForm: true, commits: false, cell: null };
/** A field the rules know nothing about (the location box): the page says nothing of when it is saved. */
const ELSEWHERE: FieldPlace = { inForm: false, commits: false, cell: null };

/** The field with the cursor: a number stands in it, it is not marked as refused and it is no open list, unless said. */
const field = (over: Partial<EditedField> = {}): EditedField => ({ text: '2350', refused: false, choosing: false, ...over });

/** The keyboard was taken at 0, no key was pressed since and nothing was typed anywhere, unless said. */
const use = (over: Partial<Parameters<typeof keyboardUnused>[0]> = {}) => keyboardUnused({
  now: KEYBOARD_IDLE_MS, lastKeyAt: Number.NEGATIVE_INFINITY, takenAt: 0, field: field(), typed: [], ...over,
});

/** 2400 typed over 2350 in a field of the row; it still stands there, not settled and not refused, unless said. */
const typedText = (over: Partial<TypedText> = {}): TypedText => ({
  typed: '2400', start: '2350', now: '2400', place: ROW, settled: false, refused: false, ...over,
});

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

  it('when everything typed was settled, replaced or is gone', () => {
    expect(use({ typed: [typedText({ settled: true }), typedText({ now: '2350' }), typedText({ now: null })] })).toBe(true);
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

describe('isUnconfirmed: what the player entered and nobody has dealt with', () => {
  it('nothing waits in a field that left the page, wherever it stood', () => {
    for (const place of [ROW, SETTINGS, FORM, ELSEWHERE]) expect(isUnconfirmed(typedText({ place, now: null }))).toBe(false);
  });

  describe('where the page says the field is saved by Enter and when it is left (a cell of the table, the settings)', () => {
    it('what he typed waits while it stands there, until he settles it himself', () => {
      expect(isUnconfirmed(typedText())).toBe(true);
      expect(isUnconfirmed(typedText({ settled: true }))).toBe(false);
      expect(isUnconfirmed(typedText({ place: SETTINGS }))).toBe(true);
    });

    it('a settled text that was refused still waits', () => {
      expect(isUnconfirmed(typedText({ settled: true, refused: true }))).toBe(true);
    });

    it('an EMPTIED field waits like any other: leaving it would save "nothing" over what stood there (the budget of the settings)', () => {
      expect(isUnconfirmed(typedText({ place: SETTINGS, typed: '', start: '90000', now: '' }))).toBe(true);
      expect(isUnconfirmed(typedText({ typed: '', now: '' }))).toBe(true);
    });

    it('typed back to the very text that stood there, it still waits: the table saves a typed price that equals a reference price', () => {
      expect(isUnconfirmed(typedText({ typed: '2350', now: '2350' }))).toBe(true);
    });

    it('a text the program put in its place waits for nothing', () => {
      expect(isUnconfirmed(typedText({ now: '2 400' }))).toBe(false);
    });
  });

  describe('in a form (the quick entry, the form of a trade)', () => {
    const inForm = (over: Partial<TypedText> = {}) => typedText({ place: FORM, typed: '2900', start: '', now: '2900', ...over });

    it('the field waits while it holds anything else than before the player began', () => {
      expect(isUnconfirmed(inForm())).toBe(true);
    });

    it('no key and no leaving settles it', () => {
      expect(isUnconfirmed(inForm({ settled: true }))).toBe(true);
    });

    it('a text the program put in place of what he typed (a commodity picked from the list) is his entry too', () => {
      expect(isUnconfirmed(inForm({ typed: 'sti', now: 'STIM Stims' }))).toBe(true);
    });

    it('back at what stood there before he began (the form emptied its fields after a save, or he deleted what he typed) nothing waits', () => {
      expect(isUnconfirmed(inForm({ now: '' }))).toBe(false);
      expect(isUnconfirmed(inForm({ typed: '', now: '' }))).toBe(false);
      expect(isUnconfirmed(inForm({ typed: '385', start: '385', now: '385' }))).toBe(false); // the form of a trade starts with a number
    });

    it('with no starting text known the field waits while it is on the page', () => {
      expect(isUnconfirmed(inForm({ start: null }))).toBe(true);
      expect(isUnconfirmed(inForm({ start: null, now: '' }))).toBe(true);
    });
  });

  describe('anywhere else (a field the rules know nothing about)', () => {
    const elsewhere = (over: Partial<TypedText> = {}) => typedText({ place: ELSEWHERE, typed: 'zzz', start: 'HUR-L1', now: 'zzz', ...over });

    it('what he typed waits while it stands there and differs from what stood there before', () => {
      expect(isUnconfirmed(elsewhere())).toBe(true);
      expect(isUnconfirmed(elsewhere({ typed: '', now: '' }))).toBe(true); // emptied: not what stood there
      expect(isUnconfirmed(elsewhere({ typed: 'HUR-L1', now: 'HUR-L1' }))).toBe(false); // typed back
    });

    it('no key and no leaving settles it: nobody said the field is saved then', () => {
      expect(isUnconfirmed(elsewhere({ settled: true }))).toBe(true);
    });

    it('only the program lets go: it replaced the text (a place was picked)', () => {
      expect(isUnconfirmed(elsewhere({ typed: 'mic', now: 'MIC-L1' }))).toBe(false);
    });
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

// The walks of the two reviews of task 47: the automatic return must never cause a write, or the loss, of something the
// player entered and did not confirm. The memory keeps WHICH field was typed into, what stood in it before and after; the
// fields are names here.
describe('createTypingMemory: what was typed where, and whether it still waits', () => {
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
    memory.begins('price', '2350');
    memory.typed('price', '2400', ROW);
    // Tab: the cursor goes to the other field of the same cell, which is not leaving it; nothing is told but the new field
    memory.begins('scu', '');
    const now = page({ price: '2400', scu: '' });
    expect(goesBack(memory.read(now))).toBe(false);
    expect(goesBack(memory.read(now), 60_000)).toBe(false);
    expect(goesBack(memory.read(now), 3_600_000)).toBe(false);
  });

  it('trace B: a quantity typed, then the cursor moved to the price that merely stands there: the keyboard stays', () => {
    const memory = createTypingMemory<string>();
    memory.begins('scu', '');
    memory.typed('scu', '120', ROW);
    memory.begins('price', '988');
    expect(goesBack(memory.read(page({ price: '988', scu: '120' })), 16_500, '988')).toBe(false);
  });

  it('trace N: the budget of the settings emptied, no Tab, no Enter: the keyboard stays, so no timer saves "no budget"', () => {
    const memory = createTypingMemory<string>();
    memory.begins('budget', '90000');
    memory.typed('budget', '9000', SETTINGS);
    memory.typed('budget', '', SETTINGS);
    const now = page({ budget: '' });
    expect(goesBack(memory.read(now))).toBe(false);
    expect(goesBack(memory.read(now), 60_000)).toBe(false);
    // Enter is the player's own "no budget": the settings save it, and the keyboard may go
    memory.key('budget', 'Enter', SETTINGS);
    expect(goesBack(memory.read(now))).toBe(true);
  });

  it('the quick entry: a price typed and deleted back to empty: nothing waits', () => {
    const memory = createTypingMemory<string>();
    memory.begins('quick-price', '');
    memory.typed('quick-price', '29', FORM);
    expect(goesBack(memory.read(page({ 'quick-price': '29' })))).toBe(false);
    memory.typed('quick-price', '', FORM);
    expect(goesBack(memory.read(page({ 'quick-price': '' })))).toBe(true);
  });

  it('the quick entry: a price typed, the cursor in another, empty field: the keyboard stays (the window does not fold over the line)', () => {
    const memory = createTypingMemory<string>();
    memory.begins('quick-price', '');
    memory.typed('quick-price', '2900', FORM);
    const now = page({ 'quick-commodity': '', 'quick-price': '2900', 'quick-scu': '' });
    expect(goesBack(memory.read(now))).toBe(false);
    // Enter in ANOTHER field of the form (a commodity is picked from the list) does not confirm the price
    memory.begins('quick-commodity', '');
    memory.typed('quick-commodity', 'sti', FORM);
    memory.key('quick-commodity', 'Enter', FORM);
    expect(goesBack(memory.read(page({ 'quick-commodity': 'STIM Stims', 'quick-price': '2900', 'quick-scu': '' })))).toBe(false);
    // ...and neither does a press outside the fields and a click back into another field of the form
    memory.left('quick-price', FORM);
    expect(goesBack(memory.read(page({ 'quick-commodity': 'STIM Stims', 'quick-price': '2900', 'quick-scu': '' })))).toBe(false);
  });

  it('trace P: a commodity typed and picked with Enter, the cursor in the empty price: the pick is the player\'s entry, the keyboard stays', () => {
    const memory = createTypingMemory<string>();
    memory.begins('quick-commodity', '');
    memory.typed('quick-commodity', 'sti', FORM);
    memory.key('quick-commodity', 'Enter', FORM); // the list puts «STIM Stims» in place of «sti», and the cursor into the price
    memory.left('quick-commodity', FORM);
    memory.begins('quick-price', '');
    const picked = page({ 'quick-commodity': 'STIM Stims', 'quick-price': '', 'quick-scu': '' });
    expect(goesBack(memory.read(picked))).toBe(false);
    expect(goesBack(memory.read(picked), 60_000)).toBe(false);
    // the price is typed and saved: the form empties every field, and nothing waits any more
    memory.typed('quick-price', '2900', FORM);
    memory.key('quick-price', 'Enter', FORM);
    expect(goesBack(memory.read(page({ 'quick-commodity': '', 'quick-price': '', 'quick-scu': '' })))).toBe(true);
    // the next commodity of the series is picked: it waits again, from the same empty start
    memory.typed('quick-commodity', 'med', FORM);
    expect(goesBack(memory.read(page({ 'quick-commodity': 'MEDS Medical Supplies', 'quick-price': '', 'quick-scu': '' })))).toBe(false);
  });

  it('a form says itself what came of Enter: emptied fields (saved) let the keyboard go, a text that stays (refused) keeps it', () => {
    const memory = createTypingMemory<string>();
    memory.begins('quick-price', '');
    memory.typed('quick-price', '2900', FORM);
    memory.key('quick-price', 'Enter', FORM);
    expect(goesBack(memory.read(page({ 'quick-price': '2900' })))).toBe(false); // no commodity: refused, the text stays
    expect(goesBack(memory.read(page({ 'quick-price': '' })))).toBe(true); // saved: the form emptied its fields
  });

  it('a field of a form keeps its starting text while what was entered stands: the cursor coming back begins nothing new', () => {
    const memory = createTypingMemory<string>();
    memory.begins('quick-price', '');
    memory.typed('quick-price', '2900', FORM);
    memory.begins('quick-scu', '');
    memory.begins('quick-price', '2900'); // the cursor is back in the price: «2900» is not where it started
    expect(goesBack(memory.read(page({ 'quick-price': '2900', 'quick-scu': '' })), 16_500, '2900')).toBe(false);
  });

  it('typed into a field of a form with nobody having seen what stood there: it waits while the field is on the page', () => {
    const memory = createTypingMemory<string>();
    memory.typed('trade-scu', '77', FORM);
    expect(goesBack(memory.read(page({ 'trade-scu': '77' })))).toBe(false);
    expect(goesBack(memory.read(page({})))).toBe(true); // the form closed
  });

  it('typed, then Enter in the row, then fifteen seconds: the keyboard goes back', () => {
    const memory = createTypingMemory<string>();
    memory.begins('price', '2350');
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
    memory.begins('price', '2350');
    memory.typed('price', '24', ROW);
    memory.typed('price', '240', ROW);
    memory.typed('price', '2400', ROW); // every key is told; the last text is what counts
    expect(goesBack(memory.read(page({ price: '2400' })), 60_000, '2400')).toBe(false);
  });

  it('typed into the row and deleted again: the cell holds a draft all the same, and the keyboard stays', () => {
    const memory = createTypingMemory<string>();
    memory.begins('price', '988');
    memory.typed('price', '9889', ROW);
    memory.typed('price', '988', ROW); // the very number of UEX that stood there: the table would save it as mine when the cell is left
    expect(goesBack(memory.read(page({ price: '988' })), 16_500, '988')).toBe(false);
    memory.typed('price', '', ROW);
    expect(goesBack(memory.read(page({ price: '' })))).toBe(false);
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

  it('a field of the settings is settled by its own Enter and by being left, and only it', () => {
    const memory = createTypingMemory<string>();
    memory.typed('capacity', '500', SETTINGS);
    memory.typed('budget', '90000', SETTINGS);
    memory.key('capacity', 'Enter', SETTINGS);
    expect(goesBack(memory.read(page({ capacity: '500', budget: '90000' })))).toBe(false); // the budget still waits
    memory.left('budget', SETTINGS);
    expect(goesBack(memory.read(page({ capacity: '500', budget: '90000' })))).toBe(true);
  });

  it('trace O: a query that matches nothing, Enter in the location box: nobody said that box is saved by Enter, so the keyboard stays', () => {
    const memory = createTypingMemory<string>();
    memory.begins('location', 'HUR-L1');
    memory.typed('location', 'zzz', ELSEWHERE);
    memory.key('location', 'Enter', ELSEWHERE);
    expect(goesBack(memory.read(page({ location: 'zzz' })), 16_500, 'zzz')).toBe(false);
    memory.key('location', 'Escape', ELSEWHERE);
    memory.left('location', ELSEWHERE);
    expect(goesBack(memory.read(page({ location: 'zzz' })), 60_000, 'zzz')).toBe(false);
  });

  it('a text the program replaced outside a form (a place picked from the list) counts no more, even if the same letters stand there again later', () => {
    const memory = createTypingMemory<string>();
    memory.begins('location', 'HUR-L1');
    memory.typed('location', 'mic', ELSEWHERE);
    expect(goesBack(memory.read(page({ location: 'MIC-L1' })))).toBe(true);
    expect(goesBack(memory.read(page({ location: 'mic' })))).toBe(true);
  });

  it('after the program replaced the text, typing begins anew from what stands there now', () => {
    const memory = createTypingMemory<string>();
    memory.begins('location', 'HUR-L1');
    memory.typed('location', 'mic', ELSEWHERE);
    // the place was picked; the next key comes before anybody looked at the page
    memory.begins('location', 'MIC-L1');
    memory.typed('location', 'MIC-L1x', ELSEWHERE);
    expect(goesBack(memory.read(page({ location: 'MIC-L1x' })), 16_500, 'MIC-L1x')).toBe(false);
    memory.typed('location', 'MIC-L1', ELSEWHERE);
    expect(goesBack(memory.read(page({ location: 'MIC-L1' })), 16_500, 'MIC-L1')).toBe(true);
  });

  it('typing again after Enter is a new text that waits', () => {
    const memory = createTypingMemory<string>();
    memory.typed('price', '2400', ROW);
    memory.key('price', 'Enter', ROW);
    memory.typed('price', '24005', ROW);
    expect(goesBack(memory.read(page({ price: '24005' })))).toBe(false);
  });
});
