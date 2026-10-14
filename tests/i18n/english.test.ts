import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { formatAge, formatCompact, formatPct } from '../../src/core/format';
import { setLang, tr } from '../../src/i18n';
import { clearedText, historyStatus, pluralRuns } from '../../src/ui/vm/history-clearing';
import { validateSetting } from '../../src/ui/vm/settings-validation';
import { triggerErrorText } from '../../src/ui/vm/trigger-error';

// The window in English (version 1.3): what the dictionary gives, read through the code that uses it. The Russian of the same
// code is what the other tests check, unchanged.

afterEach(() => setLang('ru'));

describe('the window in English', () => {
  it('writes the age of a price and the decimals the English way', () => {
    setLang('en');
    expect([formatAge(30), formatAge(40 * 60), formatAge(90 * 60), formatAge(3 * 86_400)]).toEqual(['now', '40 min', '1.5 h', '3 d']);
    expect(formatPct(0.127)).toBe('12.7%');
    expect(formatCompact(1_250_000)).toBe('1.25M');
  });

  it('says the number of trips with the English form of the noun', () => {
    setLang('en');
    expect([1, 2, 5, 21].map(pluralRuns)).toEqual(['trip', 'trips', 'trips', 'trips']);
    expect(clearedText(1)).toBe('Deleted 1 trip');
    expect(clearedText(21)).toBe('Deleted 21 trips');
    expect(historyStatus({ finished: 57, old: 0, since: Date.UTC(2026, 7, 3, 12) / 1000 })).toMatch(/^History: 57 trips, since \d\d\.\d\d\.2026$/);
  });

  it('says the reasons of the keyboard layer, which speaks Russian, in the language of the window', () => {
    expect(triggerErrorText('неизвестная клавиша: Banana')).toBe('неизвестная клавиша: Banana');
    setLang('en');
    expect(triggerErrorText('неизвестная клавиша: Banana')).toBe('unknown key: Banana');
    expect(triggerErrorText('нужен Ctrl или Alt')).toBe('needs Ctrl or Alt');
    expect(triggerErrorText('модификатор «Ctrl» указан дважды')).toBe('modifier "Ctrl" is given twice');
    expect(triggerErrorText('лишний «+» в «Ctrl++»')).toBe('an extra "+" in "Ctrl++"');
    expect(triggerErrorText('SetWindowsHookExW failed: 5')).toBe('Could not turn the keys on. Details are in the log.');
  });

  it('keeps the language a setting: Russian, English, or not chosen yet', () => {
    expect(DEFAULT_SETTINGS.language).toBe('');
    for (const lang of ['', 'ru', 'en'] as const) expect(validateSetting('language', lang, DEFAULT_SETTINGS)).toBeNull();
    expect(validateSetting('language', 'de' as never, DEFAULT_SETTINGS)).toBe('Неизвестный язык');
    setLang('en');
    expect(validateSetting('language', 'de' as never, DEFAULT_SETTINGS)).toBe('Unknown language');
  });

  it('has the words of the tray menu in both languages', () => {
    expect([tr('Показать панель'), tr('Выход')]).toEqual(['Показать панель', 'Выход']);
    setLang('en');
    expect([tr('Показать панель'), tr('Выход')]).toEqual(['Show the panel', 'Quit']);
  });
});
