import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../../src/i18n';
import { referenceLoadText, shipLoadText } from '../../src/ui/vm/boot-status';

// The start of 1.3 says how far the download of the reference is and how long it has gone (the author: «нужно дать понять, что он
// не завис»).

afterEach(() => setLang('ru'));

const at = 1_800_000_000;

describe('the download of the reference on the screen', () => {
  it('names the stage, the count of a long stage and the time it has gone', () => {
    expect(referenceLoadText({ stage: 'systems', done: 0, total: 1, startedAt: at }, at + 2)).toBe('звёздные системы · 0:02');
    expect(referenceLoadText({ stage: 'terminals', done: 1, total: 3, startedAt: at }, at + 5)).toBe('терминалы: 1 из 3 систем · 0:05');
    expect(referenceLoadText({ stage: 'ships', done: 12, total: 40, startedAt: at }, at + 23)).toBe('корабли: 12 из 40 производителей · 0:23');
    expect(referenceLoadText({ stage: 'ships', done: 0, total: 0, startedAt: at }, at + 9)).toBe('корабли · 0:09');
    setLang('en');
    expect(referenceLoadText({ stage: 'ships', done: 12, total: 40, startedAt: at }, at + 23)).toBe('ships: 12 of 40 manufacturers · 0:23');
  });

  it('gives the field of the ship the count of the ships while that is the stage', () => {
    expect(shipLoadText({ stage: 'ships', done: 12, total: 40, startedAt: at })).toBe('Загружаю список кораблей из UEX: 12 из 40');
    expect(shipLoadText({ stage: 'terminals', done: 1, total: 3, startedAt: at })).toBe('Загружаю список кораблей из UEX');
    expect(shipLoadText(null)).toBe('Загружаю список кораблей из UEX');
  });
});
