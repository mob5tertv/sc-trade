import { describe, expect, it } from 'vitest';
import { EN } from '../../src/i18n/en';
import { CYRILLIC, phrases, placeholders, readings, sources } from '../helpers/i18n-scan';

// The rules of the dictionary of version 1.3 (see `src/i18n/index.ts`), read from the code itself:
//  1. no Russian text in the code of the window (`src/ui`, `src/core`, `src/data`, `src/platform`) outside `tr` and `trn`; a
//     comment may be in any language;
//  2. the phrase of `tr` / `trn` is a literal, so that this test can see it;
//  3. a `.ts` module never calls them at its top (the text would stay in the language of the moment the module was loaded);
//  4. `EN` has an English phrase for every phrase of the code, none that the code no longer has, and the same `{placeholders}`;
//     a phrase with a number has three Russian forms and two English ones.

describe('the dictionary of the window', () => {
  it('reads the code of the window', () => {
    expect(sources.length).toBeGreaterThan(130);
  });

  it('finds no Russian text outside tr() and trn(), no phrase that is not a literal, and no call at the top of a module', () => {
    expect(readings.flatMap((reading) => reading.problems)).toEqual([]);
  });

  it('has an English phrase for every phrase of the code', () => {
    const missing = [...new Set(phrases.filter((p) => !Object.hasOwn(EN, p.key)).map((p) => `${p.where} ${p.key}`))];
    expect(missing).toEqual([]);
  });

  it('has no English phrase that the code no longer has', () => {
    const used = new Set(phrases.map((p) => p.key));
    expect(Object.keys(EN).filter((key) => !used.has(key))).toEqual([]);
  });

  it('has the same placeholders in both languages, three Russian forms and two English ones for a number, and no Russian in the English', () => {
    const wrong: string[] = [];
    for (const p of new Map(phrases.map((phrase) => [phrase.key, phrase])).values()) {
      const english = EN[p.key];
      if (english === undefined) continue;
      if (CYRILLIC.test(english)) wrong.push(`${p.key}: Russian in the English`);
      const russian = p.key.replace(/^@[\w-]+:/, '');
      if (p.kind === 'trn' && (russian.split('|').length !== 3 || english.split('|').length !== 2)) wrong.push(`${p.key}: forms`);
      const same = p.kind === 'tr'
        ? placeholders(russian).join() === placeholders(english).join()
        : russian.split('|').every((form) => placeholders(form).join() === placeholders(russian).join())
          && english.split('|').every((form) => placeholders(form).join() === placeholders(russian).join());
      if (!same) wrong.push(`${p.key}: placeholders`);
    }
    expect(wrong).toEqual([]);
  });
});
