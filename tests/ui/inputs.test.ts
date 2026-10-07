import { describe, expect, it } from 'vitest';
import { formatUec } from '../../src/core/format';
import { baseTexts, cellEditBase, rejectedFields, resolveCellEdit, resolveTrade } from '../../src/ui/vm/inputs';
import type { EditBase } from '../../src/ui/vm/inputs';
import type { Cell } from '../../src/ui/vm/terminal-rows';

const cell = (partial: Partial<Cell> = {}): Cell => ({
  own: null, ownScu: null, ownScuBase: null, ownScuRate: null, hint: null, hintScu: null,
  badge: null, uexRange: null, range: { kind: 'none' }, ownLast: null, trend: null, warn: false, ...partial,
});

describe('cellEditBase', () => {
  it('is what the inputs show: my own price and my own quantity', () => {
    expect(cellEditBase(cell({ own: 6120, ownScu: 340 }))).toEqual({ price: 6120, scu: 340, priceIsOwn: true });
    expect(cellEditBase(cell({ own: 6120, ownScu: 0 }))).toEqual({ price: 6120, scu: 0, priceIsOwn: true });
  });
  it('shows the price the row shows when it is not mine: the UEX one, or my cold one kept as a hint', () => {
    expect(cellEditBase(cell({ hint: 6900, hintScu: 500 }))).toEqual({ price: 6900, scu: null, priceIsOwn: false });
    expect(cellEditBase(cell({ hint: 4200 }))).toEqual({ price: 4200, scu: null, priceIsOwn: false });
  });
  it('prefers my own price to a hint', () => {
    expect(cellEditBase(cell({ own: 6120, hint: 6900 }))).toEqual({ price: 6120, scu: null, priceIsOwn: true });
  });
  it('has no price when the row has none at all', () => {
    expect(cellEditBase(cell())).toEqual({ price: null, scu: null, priceIsOwn: false });
  });
  describe('a price that is not a whole number (UEX gives REAL averages)', () => {
    it('holds what the row shows: the price rounded the way the row writes it', () => {
      for (const hint of [7345.6, 7345.5, 7345.4, 1499.49, 99.5, 988]) {
        const price = cellEditBase(cell({ hint })).price;
        expect(price, String(hint)).toBe(Math.round(hint));
        expect(Number.isInteger(price), String(hint)).toBe(true);
        expect(formatUec(price ?? 0), String(hint)).toBe(formatUec(hint));
      }
      expect(cellEditBase(cell({ hint: 7345.6 }))).toEqual({ price: 7346, scu: null, priceIsOwn: false });
      expect(baseTexts(cellEditBase(cell({ hint: 7345.6 }))).price).toBe('7346');
    });
    it('rounds my own price the same way, so that the field and the row never disagree', () => {
      expect(cellEditBase(cell({ own: 6120.4 }))).toEqual({ price: 6120, scu: null, priceIsOwn: true });
    });
    it('is saved as the whole number the row shows: Enter, or a quantity typed alone', () => {
      const base = cellEditBase(cell({ hint: 7345.6 }));
      expect(resolveCellEdit({ price: null, scu: null }, base, 'enter')).toEqual({ kind: 'save', price: 7346, scu: null });
      expect(resolveCellEdit({ price: null, scu: '50' }, base)).toEqual({ kind: 'save', price: 7346, scu: 50 });
      expect(resolveCellEdit({ price: '7346', scu: null }, base)).toEqual({ kind: 'save', price: 7346, scu: null }); // confirmed as typed
    });
    it('has no price when it rounds to zero: the row shows 0, which the typed path refuses too, so the price is required', () => {
      const base = cellEditBase(cell({ hint: 0.3 }));
      expect(base).toEqual({ price: null, scu: null, priceIsOwn: false });
      expect(baseTexts(base).price).toBe('');
      expect(resolveCellEdit({ price: null, scu: null }, base, 'enter')).toEqual({ kind: 'invalid', price: true, scu: false });
      expect(resolveCellEdit({ price: null, scu: '50' }, base)).toEqual({ kind: 'invalid', price: true, scu: false });
      expect(resolveCellEdit({ price: '5', scu: null }, base)).toEqual({ kind: 'save', price: 5, scu: null });
    });
  });
  it('never takes a quantity of UEX or an estimate for something I typed', () => {
    // a quantity of UEX is a placeholder; an estimated stock is shown as text next to an empty input
    expect(cellEditBase(cell({ hint: 6900, hintScu: 500 })).scu).toBeNull();
    expect(cellEditBase(cell({ own: 6120, ownScu: 250, ownScuBase: { scu: 40, age: '20 мин' } }))).toEqual({ price: 6120, scu: null, priceIsOwn: true });
  });
});

describe('baseTexts', () => {
  it('is the plain digits of the base, empty for what is unknown', () => {
    expect(baseTexts({ price: 6120, scu: 0, priceIsOwn: true })).toEqual({ price: '6120', scu: '0' });
    expect(baseTexts({ price: 6900, scu: null, priceIsOwn: false })).toEqual({ price: '6900', scu: '' });
    expect(baseTexts({ price: null, scu: null, priceIsOwn: false })).toEqual({ price: '', scu: '' });
  });
});

// `null` in an edit is a field the player did not touch in this edit; a text, even an empty one, was typed.
describe('resolveCellEdit', () => {
  const base: EditBase = { price: 6120, scu: 340, priceIsOwn: true };
  /** The price in the field is the one of UEX (or my cold one): nothing of mine stands there. */
  const uex: EditBase = { price: 6900, scu: null, priceIsOwn: false };
  /** The row has no price at all. */
  const none: EditBase = { price: null, scu: null, priceIsOwn: false };

  describe('on leaving the cell', () => {
    it('has nothing to save when nothing was typed', () => {
      expect(resolveCellEdit({ price: null, scu: null }, base)).toEqual({ kind: 'unchanged' });
      expect(resolveCellEdit({ price: null, scu: null }, uex)).toEqual({ kind: 'unchanged' });
      expect(resolveCellEdit({ price: null, scu: null }, none)).toEqual({ kind: 'unchanged' });
    });
    it('has nothing to save when what was typed equals my own price, however it is written', () => {
      expect(resolveCellEdit({ price: '6120', scu: '340' }, base)).toEqual({ kind: 'unchanged' });
      expect(resolveCellEdit({ price: ' 6 120 ', scu: null }, base)).toEqual({ kind: 'unchanged' });
      expect(resolveCellEdit({ price: null, scu: '340' }, base)).toEqual({ kind: 'unchanged' });
    });
    it('says "leave" by default', () => {
      expect(resolveCellEdit({ price: '6120', scu: null }, base, 'leave')).toEqual(resolveCellEdit({ price: '6120', scu: null }, base));
    });

    it('saves a price typed alone with no quantity: the quantity that is shown was not typed now', () => {
      expect(resolveCellEdit({ price: '6200', scu: null }, base)).toEqual({ kind: 'save', price: 6200, scu: null });
    });
    it('saves both when both were typed', () => {
      expect(resolveCellEdit({ price: '6200', scu: '300' }, base)).toEqual({ kind: 'save', price: 6200, scu: 300 });
    });
    it('saves a quantity typed alone together with the price of the field', () => {
      expect(resolveCellEdit({ price: null, scu: '300' }, base)).toEqual({ kind: 'save', price: 6120, scu: 300 });
      expect(resolveCellEdit({ price: null, scu: '0' }, base)).toEqual({ kind: 'save', price: 6120, scu: 0 });
    });
    it('sends a quantity that was typed even when the price changed and the quantity is the one shown', () => {
      expect(resolveCellEdit({ price: '6200', scu: '340' }, base)).toEqual({ kind: 'save', price: 6200, scu: 340 });
      expect(resolveCellEdit({ price: '6120', scu: '300' }, base)).toEqual({ kind: 'save', price: 6120, scu: 300 });
    });
    it('reads the current values it is given, not the ones from when the typing began', () => {
      // the same typed quantity pairs with whichever price the cell has now
      expect(resolveCellEdit({ price: null, scu: '300' }, { ...base, price: 6120 })).toMatchObject({ price: 6120 });
      expect(resolveCellEdit({ price: null, scu: '300' }, { ...base, price: 6400 })).toMatchObject({ price: 6400 });
    });
    it('treats an emptied quantity as no reading, not as a change', () => {
      expect(resolveCellEdit({ price: null, scu: '' }, base)).toEqual({ kind: 'unchanged' });
      expect(resolveCellEdit({ price: null, scu: '' }, uex)).toEqual({ kind: 'unchanged' });
      expect(resolveCellEdit({ price: '6200', scu: '' }, base)).toEqual({ kind: 'save', price: 6200, scu: null });
    });
    it('has nothing to delete when an emptied price had nothing behind it', () => {
      expect(resolveCellEdit({ price: '', scu: null }, none)).toEqual({ kind: 'unchanged' });
    });

    describe('with the price of UEX in the field (nothing of mine there)', () => {
      it('saves a quantity typed alone, with that price: the player need not touch the price', () => {
        expect(resolveCellEdit({ price: null, scu: '50' }, uex)).toEqual({ kind: 'save', price: 6900, scu: 50 });
        expect(resolveCellEdit({ price: null, scu: '0' }, uex)).toEqual({ kind: 'save', price: 6900, scu: 0 });
      });
      it('saves a price that was corrected, with no quantity', () => {
        expect(resolveCellEdit({ price: '6890', scu: null }, uex)).toEqual({ kind: 'save', price: 6890, scu: null });
      });
      it('saves a price that was typed and is the same as the one shown: the player confirmed it', () => {
        expect(resolveCellEdit({ price: '6900', scu: null }, uex)).toEqual({ kind: 'save', price: 6900, scu: null });
        expect(resolveCellEdit({ price: ' 6 900', scu: '120' }, uex)).toEqual({ kind: 'save', price: 6900, scu: 120 });
      });
      it('saves both a corrected price and a quantity', () => {
        expect(resolveCellEdit({ price: '6890', scu: '50' }, uex)).toEqual({ kind: 'save', price: 6890, scu: 50 });
      });
    });

    describe('with no price at all', () => {
      it('saves a price typed over nothing, with no quantity', () => {
        expect(resolveCellEdit({ price: '6200', scu: null }, none)).toEqual({ kind: 'save', price: 6200, scu: null });
      });
      it('does not save a quantity typed alone, and asks for the price', () => {
        expect(resolveCellEdit({ price: null, scu: '50' }, none)).toEqual({ kind: 'invalid', price: true, scu: false });
      });
    });

    it('marks an unparsable price and saves nothing', () => {
      expect(resolveCellEdit({ price: 'abc', scu: null }, base)).toEqual({ kind: 'invalid', price: true, scu: false });
      expect(resolveCellEdit({ price: '0', scu: null }, base)).toEqual({ kind: 'invalid', price: true, scu: false });
      expect(resolveCellEdit({ price: 'abc', scu: null }, uex)).toEqual({ kind: 'invalid', price: true, scu: false });
    });
    it('marks an emptied price: a price cannot be deleted from here', () => {
      expect(resolveCellEdit({ price: '', scu: null }, base)).toEqual({ kind: 'invalid', price: true, scu: false });
      expect(resolveCellEdit({ price: '', scu: '300' }, base)).toEqual({ kind: 'invalid', price: true, scu: false });
      expect(resolveCellEdit({ price: '', scu: null }, uex)).toEqual({ kind: 'invalid', price: true, scu: false });
    });
    it('marks an unparsable quantity', () => {
      expect(resolveCellEdit({ price: null, scu: '3x0' }, base)).toEqual({ kind: 'invalid', price: false, scu: true });
      expect(resolveCellEdit({ price: null, scu: '3x0' }, uex)).toEqual({ kind: 'invalid', price: false, scu: true });
    });
    it('marks both when both are wrong', () => {
      expect(resolveCellEdit({ price: '-', scu: 'q' }, base)).toEqual({ kind: 'invalid', price: true, scu: true });
    });

    it('compares what is typed after a save with what was sent: leaving again saves nothing', () => {
      // the table keeps the saved numbers as the base until its rows are refreshed (`draft.sent`), and they are mine by then
      const sent: EditBase = { price: 6900, scu: 50, priceIsOwn: true };
      expect(resolveCellEdit({ price: null, scu: null }, sent)).toEqual({ kind: 'unchanged' });
      expect(resolveCellEdit({ price: '6900', scu: '50' }, sent)).toEqual({ kind: 'unchanged' });
      expect(resolveCellEdit({ price: '6900', scu: null }, sent)).toEqual({ kind: 'unchanged' });
      expect(resolveCellEdit({ price: null, scu: '60' }, sent)).toEqual({ kind: 'save', price: 6900, scu: 60 });
    });
  });

  describe('on Enter: "I see this now"', () => {
    it('saves what stands in the fields although nothing was typed: a price of UEX is confirmed as mine', () => {
      expect(resolveCellEdit({ price: null, scu: null }, uex, 'enter')).toEqual({ kind: 'save', price: 6900, scu: null });
    });
    it('saves my own price again although nothing was typed: it is refreshed', () => {
      expect(resolveCellEdit({ price: null, scu: null }, base, 'enter')).toEqual({ kind: 'save', price: 6120, scu: null });
    });
    it('saves my own price typed without a change, which leaving the cell would not', () => {
      expect(resolveCellEdit({ price: '6120', scu: null }, base, 'leave')).toEqual({ kind: 'unchanged' });
      expect(resolveCellEdit({ price: '6120', scu: null }, base, 'enter')).toEqual({ kind: 'save', price: 6120, scu: null });
    });
    it('does not send the quantity that merely stands in its field (spec 14.6: no quantity in this reading)', () => {
      // `base.scu` is mine and stands in the input, but it was not typed now
      expect(resolveCellEdit({ price: null, scu: null }, base, 'enter')).toEqual({ kind: 'save', price: 6120, scu: null });
    });
    it('sends the quantity that was typed, also when it equals the one in the field', () => {
      expect(resolveCellEdit({ price: null, scu: '340' }, base, 'enter')).toEqual({ kind: 'save', price: 6120, scu: 340 });
      expect(resolveCellEdit({ price: null, scu: '0' }, uex, 'enter')).toEqual({ kind: 'save', price: 6900, scu: 0 });
    });
    it('sends no quantity for an emptied one: that is no reading either', () => {
      expect(resolveCellEdit({ price: null, scu: '' }, base, 'enter')).toEqual({ kind: 'save', price: 6120, scu: null });
    });
    it('saves a corrected price and a quantity as typed', () => {
      expect(resolveCellEdit({ price: '6890', scu: '50' }, uex, 'enter')).toEqual({ kind: 'save', price: 6890, scu: 50 });
    });
    it('asks for the price when the row has none at all, typed or not', () => {
      expect(resolveCellEdit({ price: null, scu: null }, none, 'enter')).toEqual({ kind: 'invalid', price: true, scu: false });
      expect(resolveCellEdit({ price: null, scu: '50' }, none, 'enter')).toEqual({ kind: 'invalid', price: true, scu: false });
      expect(resolveCellEdit({ price: '', scu: null }, none, 'enter')).toEqual({ kind: 'invalid', price: true, scu: false });
    });
    it('marks an unparsable or emptied price and an unparsable quantity, and saves nothing', () => {
      expect(resolveCellEdit({ price: 'abc', scu: null }, uex, 'enter')).toEqual({ kind: 'invalid', price: true, scu: false });
      expect(resolveCellEdit({ price: '', scu: null }, base, 'enter')).toEqual({ kind: 'invalid', price: true, scu: false });
      expect(resolveCellEdit({ price: null, scu: '3x0' }, base, 'enter')).toEqual({ kind: 'invalid', price: false, scu: true });
      expect(resolveCellEdit({ price: '-', scu: 'q' }, base, 'enter')).toEqual({ kind: 'invalid', price: true, scu: true });
    });
  });
});

describe('resolveTrade', () => {
  it('reads a quantity and a price', () => {
    expect(resolveTrade('96', '6 120')).toEqual({ ok: true, scu: 96, price: 6120 });
  });
  it('marks a quantity that is empty, zero or not a number: a trade moves at least one SCU', () => {
    expect(resolveTrade('', '6120')).toEqual({ ok: false, scu: true, price: false });
    expect(resolveTrade('0', '6120')).toEqual({ ok: false, scu: true, price: false });
    expect(resolveTrade('9x', '6120')).toEqual({ ok: false, scu: true, price: false });
  });
  it('marks a price that is empty, zero or not a number', () => {
    expect(resolveTrade('96', '')).toEqual({ ok: false, scu: false, price: true });
    expect(resolveTrade('96', '0')).toEqual({ ok: false, scu: false, price: true });
  });
  it('marks both fields when both are wrong', () => {
    expect(resolveTrade('x', 'y')).toEqual({ ok: false, scu: true, price: true });
  });
});

describe('rejectedFields', () => {
  it('names the fields that were refused, in the order of the form, and nothing of what was typed', () => {
    expect(rejectedFields({ price: false, scu: true })).toEqual(['scu']);
    expect(rejectedFields({ price: true, scu: false })).toEqual(['price']);
    expect(rejectedFields({ price: true, scu: true })).toEqual(['price', 'scu']);
    expect(rejectedFields({ price: false, scu: false })).toEqual([]);
  });
});
