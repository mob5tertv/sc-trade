import { afterEach, describe, expect, it } from 'vitest';
import { decimal, lang, langOf, ruForm, setLang, tr, trn } from '../../src/i18n';

afterEach(() => setLang('ru'));

describe('tr and trn', () => {
  it('speaks Russian until told otherwise', () => {
    expect(lang()).toBe('ru');
  });

  it('gives the Russian phrase itself in Russian, with its places filled and its context dropped', () => {
    expect(tr('Свободно только {n} SCU', { n: 12 })).toBe('Свободно только 12 SCU');
    expect(tr('@column:Время')).toBe('Время');
    expect(tr('{a} и {a}, но не {b}', { a: 'x' })).toBe('x и x, но не {b}');
  });

  it('picks the Russian form by the number', () => {
    expect([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 111, 1.5].map(ruForm)).toEqual([0, 1, 1, 2, 2, 2, 2, 0, 1, 2, 2, 1]);
    expect(trn(21, '{n} рейс|{n} рейса|{n} рейсов')).toBe('21 рейс');
    expect(trn(3, '{n} рейс|{n} рейса|{n} рейсов')).toBe('3 рейса');
    expect(trn(5, 'за {count} рейс|за {count} рейса|за {count} рейсов', { count: '5' })).toBe('за 5 рейсов');
  });

  it('falls back to the Russian phrase in English when the dictionary has no such phrase', () => {
    setLang('en');
    expect(tr('Фразы, которой нет в словаре, {n}', { n: 1 })).toBe('Фразы, которой нет в словаре, 1');
    expect(trn(2, 'нет|нет|нет')).toBe('нет');
  });

  it('writes a decimal with a comma in Russian and a point in English', () => {
    expect(decimal(1.5)).toBe('1,5');
    setLang('en');
    expect(decimal(1.5)).toBe('1.5');
  });

  it('takes Russian for a Russian Windows and English for any other', () => {
    expect(['ru', 'ru-RU', 'RU_ru', 'en-US', 'uk-UA', 'de', '', undefined, null, 'rus'].map(langOf))
      .toEqual(['ru', 'ru', 'ru', 'en', 'en', 'en', 'en', 'en', 'en', 'en']);
  });
});
