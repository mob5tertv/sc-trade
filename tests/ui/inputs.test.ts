import { describe, expect, it } from 'vitest';
import { baseTexts, cellEditBase, resolveCellEdit, resolveTrade } from '../../src/ui/vm/inputs';
import type { Cell } from '../../src/ui/vm/terminal-rows';

const cell = (partial: Partial<Cell> = {}): Cell => ({
  own: null, ownScu: null, ownScuBase: null, ownScuRate: null, hint: null, hintScu: null,
  badge: null, uexRange: null, range: { kind: 'none' }, ownLast: null, trend: null, warn: false, ...partial,
});

describe('cellEditBase', () => {
  it('is what the inputs show: my own price and my own quantity', () => {
    expect(cellEditBase(cell({ own: 6120, ownScu: 340 }))).toEqual({ price: 6120, scu: 340 });
    expect(cellEditBase(cell({ own: 6120, ownScu: 0 }))).toEqual({ price: 6120, scu: 0 });
  });
  it('shows nothing for a hint, and never takes an estimate for something I typed', () => {
    expect(cellEditBase(cell({ hint: 6900, hintScu: 500 }))).toEqual({ price: null, scu: null });
    // an estimated stock is shown as text next to an empty input
    expect(cellEditBase(cell({ own: 6120, ownScu: 250, ownScuBase: { scu: 40, age: '20 мин' } }))).toEqual({ price: 6120, scu: null });
  });
});

describe('baseTexts', () => {
  it('is the plain digits of the base, empty for what is unknown', () => {
    expect(baseTexts({ price: 6120, scu: 0 })).toEqual({ price: '6120', scu: '0' });
    expect(baseTexts({ price: null, scu: null })).toEqual({ price: '', scu: '' });
  });
});

// `null` in an edit is a field the player did not touch in this edit; a text, even an empty one, was typed.
describe('resolveCellEdit', () => {
  const base = { price: 6120, scu: 340 };
  const none = { price: null, scu: null };

  it('has nothing to save when nothing was typed', () => {
    expect(resolveCellEdit({ price: null, scu: null }, base)).toEqual({ kind: 'unchanged' });
    expect(resolveCellEdit({ price: null, scu: null }, none)).toEqual({ kind: 'unchanged' });
  });
  it('has nothing to save when what was typed equals what is there, however it is written', () => {
    expect(resolveCellEdit({ price: '6120', scu: '340' }, base)).toEqual({ kind: 'unchanged' });
    expect(resolveCellEdit({ price: ' 6 120 ', scu: null }, base)).toEqual({ kind: 'unchanged' });
    expect(resolveCellEdit({ price: null, scu: '340' }, base)).toEqual({ kind: 'unchanged' });
  });

  it('saves a price typed alone with no quantity: the quantity that is shown was not typed now', () => {
    expect(resolveCellEdit({ price: '6200', scu: null }, base)).toEqual({ kind: 'save', price: 6200, scu: null });
  });
  it('saves both when both were typed', () => {
    expect(resolveCellEdit({ price: '6200', scu: '300' }, base)).toEqual({ kind: 'save', price: 6200, scu: 300 });
  });
  it('saves a quantity typed alone together with my own price', () => {
    expect(resolveCellEdit({ price: null, scu: '300' }, base)).toEqual({ kind: 'save', price: 6120, scu: 300 });
    expect(resolveCellEdit({ price: null, scu: '0' }, base)).toEqual({ kind: 'save', price: 6120, scu: 0 });
  });
  it('sends a quantity that was typed even when the price changed and the quantity is the one shown', () => {
    expect(resolveCellEdit({ price: '6200', scu: '340' }, base)).toEqual({ kind: 'save', price: 6200, scu: 340 });
    expect(resolveCellEdit({ price: '6120', scu: '300' }, base)).toEqual({ kind: 'save', price: 6120, scu: 300 });
  });
  it('reads the current values it is given, not the ones from when the typing began', () => {
    // the same typed quantity pairs with whichever own price the cell has now
    expect(resolveCellEdit({ price: null, scu: '300' }, { price: 6120, scu: 340 })).toMatchObject({ price: 6120 });
    expect(resolveCellEdit({ price: null, scu: '300' }, { price: 6400, scu: 340 })).toMatchObject({ price: 6400 });
  });
  it('saves a price typed over a hint, with no quantity', () => {
    expect(resolveCellEdit({ price: '6200', scu: null }, none)).toEqual({ kind: 'save', price: 6200, scu: null });
  });
  it('has nothing to delete when an emptied price had nothing behind it', () => {
    expect(resolveCellEdit({ price: '', scu: null }, none)).toEqual({ kind: 'unchanged' });
  });
  it('treats an emptied quantity as no reading, not as a change', () => {
    expect(resolveCellEdit({ price: null, scu: '' }, base)).toEqual({ kind: 'unchanged' });
    expect(resolveCellEdit({ price: '6200', scu: '' }, base)).toEqual({ kind: 'save', price: 6200, scu: null });
  });

  it('does not save a quantity typed alone when there is no own price, and asks for the price', () => {
    expect(resolveCellEdit({ price: null, scu: '50' }, none)).toEqual({ kind: 'invalid', price: true, scu: false });
  });
  it('marks an unparsable price and saves nothing', () => {
    expect(resolveCellEdit({ price: 'abc', scu: null }, base)).toEqual({ kind: 'invalid', price: true, scu: false });
    expect(resolveCellEdit({ price: '0', scu: null }, base)).toEqual({ kind: 'invalid', price: true, scu: false });
  });
  it('marks an emptied price: a price cannot be deleted from here', () => {
    expect(resolveCellEdit({ price: '', scu: null }, base)).toEqual({ kind: 'invalid', price: true, scu: false });
    expect(resolveCellEdit({ price: '', scu: '300' }, base)).toEqual({ kind: 'invalid', price: true, scu: false });
  });
  it('marks an unparsable quantity', () => {
    expect(resolveCellEdit({ price: null, scu: '3x0' }, base)).toEqual({ kind: 'invalid', price: false, scu: true });
  });
  it('marks both when both are wrong', () => {
    expect(resolveCellEdit({ price: '-', scu: 'q' }, base)).toEqual({ kind: 'invalid', price: true, scu: true });
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
