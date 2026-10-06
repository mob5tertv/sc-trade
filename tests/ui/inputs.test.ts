import { describe, expect, it } from 'vitest';
import { baseTexts, cellEditBase, resolveCellEdit, resolveTrade } from '../../src/ui/vm/inputs';
import type { Cell } from '../../src/ui/vm/terminal-rows';

const cell = (partial: Partial<Cell> = {}): Cell => ({
  own: null, ownScu: null, ownScuBase: null, ownScuRate: null, hint: null, hintScu: null,
  badge: null, uexRange: null, ownLast: null, warn: false, ...partial,
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

describe('resolveCellEdit', () => {
  const base = { price: 6120, scu: 340 };

  it('is unchanged when the texts parse to the same numbers, however they are written', () => {
    expect(resolveCellEdit('6120', '340', base)).toEqual({ kind: 'unchanged' });
    expect(resolveCellEdit(' 6 120 ', '340', base)).toEqual({ kind: 'unchanged' });
    expect(resolveCellEdit('', '', { price: null, scu: null })).toEqual({ kind: 'unchanged' });
  });

  it('saves a new price with the quantity as it stands', () => {
    expect(resolveCellEdit('6200', '340', base)).toEqual({ kind: 'save', price: 6200, scu: 340 });
  });
  it('saves a new quantity with the price as it stands', () => {
    expect(resolveCellEdit('6120', '300', base)).toEqual({ kind: 'save', price: 6120, scu: 300 });
    expect(resolveCellEdit('6120', '0', base)).toEqual({ kind: 'save', price: 6120, scu: 0 });
  });
  it('saves a price typed over a hint with no quantity', () => {
    expect(resolveCellEdit('6200', '', { price: null, scu: null })).toEqual({ kind: 'save', price: 6200, scu: null });
  });
  it('leaves the quantity unknown when it is emptied', () => {
    expect(resolveCellEdit('6120', '', base)).toEqual({ kind: 'save', price: 6120, scu: null });
  });

  it('marks an unparsable price and saves nothing', () => {
    expect(resolveCellEdit('abc', '340', base)).toEqual({ kind: 'invalid', price: true, scu: false });
    expect(resolveCellEdit('0', '340', base)).toEqual({ kind: 'invalid', price: true, scu: false });
  });
  it('marks an emptied price: a price cannot be deleted from here', () => {
    expect(resolveCellEdit('', '340', base)).toEqual({ kind: 'invalid', price: true, scu: false });
  });
  it('asks for a price when only a quantity is typed over a hint', () => {
    expect(resolveCellEdit('', '50', { price: null, scu: null })).toEqual({ kind: 'invalid', price: true, scu: false });
  });
  it('marks an unparsable quantity', () => {
    expect(resolveCellEdit('6120', '3x0', base)).toEqual({ kind: 'invalid', price: false, scu: true });
  });
  it('marks both when both are wrong', () => {
    expect(resolveCellEdit('-', 'q', base)).toEqual({ kind: 'invalid', price: true, scu: true });
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
