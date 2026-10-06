import { describe, expect, it } from 'vitest';
import { parsePrice, parseScu, priceWarning } from '../../src/core/input';

describe('parsePrice', () => {
  it.each([['6120', 6120], ['6 120', 6120], ['6,120', 6120], ['6.120', 6120], [' 318 ', 318], ['6 120', 6120],
    ['', null], ['abc', null], ['12abc', null], ['-5', null], ['0', null], ['999999999', null]])('parsePrice(%j)', (s, n) => expect(parsePrice(s)).toBe(n));

  it.each([['100000000', 100_000_000], ['100000001', null], [' , ', null], ['6 1 2 0', 6120], ['12e3', null], ['1 234', 1234]])('parsePrice(%j) at the edges', (s, n) => expect(parsePrice(s)).toBe(n));
});

describe('parseScu', () => {
  it.each([['340', 340], ['0', 0], ['', null], ['x', null]])('parseScu(%j)', (s, n) => expect(parseScu(s)).toBe(n));

  it.each([['   ', null], ['1 000', 1000], ['-1', null], ['100000001', null]])('parseScu(%j) at the edges', (s, n) => expect(parseScu(s)).toBe(n));
});

describe('priceWarning', () => {
  it.each([[3000, false], [2999, true], [14000, false], [14001, true]])('priceWarning(%i) against 6000–7000', (p, w) => expect(priceWarning(p, 6000, 7000)).toBe(w));
  it('never warns without UEX history', () => expect(priceWarning(5, 0, 0)).toBe(false));
  it('checks only the side that has history', () => {
    expect(priceWarning(5, 0, 7000)).toBe(false);
    expect(priceWarning(14001, 0, 7000)).toBe(true);
    expect(priceWarning(99999, 6000, 0)).toBe(false);
    expect(priceWarning(2999, 6000, 0)).toBe(true);
  });
});
