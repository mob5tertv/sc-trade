import { EN } from './en';

// The language of the window (version 1.3). The Russian text stays in the code, where it is used, and every phrase the window
// shows goes through `tr` (or `trn` for a number with its noun): in Russian it is the phrase itself, in English the phrase is
// looked up in `EN` (`src/i18n/en.ts`), which is keyed by the Russian phrase. `tests/i18n/dictionary.test.ts` reads the code
// and holds the three rules that make this work: no Russian text outside `tr` / `trn`; the phrase is always a literal, never a
// variable (so the test can find it); and `EN` has every phrase, no phrase that is gone, and the same `{placeholders}`.
//
// A phrase that is computed before the language is known stays in the language of that moment: `tr` is called when the text is
// needed, never at the top of a module (the test holds that too). The window is drawn anew when the language changes (`App.svelte`).

export type Lang = 'ru' | 'en';
export const LANGS: readonly Lang[] = ['ru', 'en'];

/** Each language by its own name: the list of the settings and the buttons of the first start show them so, in any language. */
export const LANG_NAMES: Readonly<Record<Lang, string>> = { ru: 'Русский', en: 'English' };

/** The first screen asks before the player has said which language he reads: its two lines are in both. */
export const LANGUAGE_SCREEN = {
  title: 'Язык · Language',
  note: 'Сменить можно в настройках · You can change it in the settings',
} as const;

let current: Lang = 'ru';

export function setLang(next: Lang): void {
  current = next;
}

export const lang = (): Lang => current;

/** The language of a locale of the system: Russian for a Russian Windows, English for any other. */
export function langOf(locale: string | null | undefined): Lang {
  return /^ru(?:-|_|$)/i.test(locale ?? '') ? 'ru' : 'en';
}

/** Values put into the `{name}` places of a phrase. */
export type TrParams = Readonly<Record<string, string | number>>;

/**
 * Two phrases that read the same in Russian and differently in English get a context before the phrase: '@column:Время'. The
 * Russian text is what follows the first ':'.
 */
const CONTEXT = /^@[\w-]+:/;

function fill(text: string, params: TrParams | undefined): string {
  if (params === undefined) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : whole));
}

/** The phrase in the language of the window, with `params` put into its `{name}` places. */
export function tr(phrase: string, params?: TrParams): string {
  const russian = phrase.replace(CONTEXT, '');
  return fill(current === 'ru' ? russian : EN[phrase] ?? russian, params);
}

/** The Russian form of a noun for `n`: 1 рейс, 2 рейса, 5 рейсов, 21 рейс, 11 рейсов. */
export function ruForm(n: number): 0 | 1 | 2 {
  const whole = Math.abs(Math.trunc(n));
  if (!Number.isInteger(n)) return 1; // 1,5 рейса
  const ten = whole % 10;
  const hundred = whole % 100;
  if (ten === 1 && hundred !== 11) return 0;
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return 1;
  return 2;
}

/**
 * A phrase with a number: `forms` are the three Russian forms for 1, 2 and 5, separated by '|' ('{n} рейс|{n} рейса|{n} рейсов');
 * the English one in `EN` has two, for 1 and for any other number ('{n} trip|{n} trips'). `{n}` is the number itself unless
 * `params` says otherwise.
 */
export function trn(n: number, forms: string, params?: TrParams): string {
  const all = { n, ...params };
  if (current === 'ru') return fill(forms.replace(CONTEXT, '').split('|')[ruForm(n)] ?? forms, all);
  const english = (EN[forms] ?? '').split('|');
  if (english.length !== 2) return fill(forms.replace(CONTEXT, '').split('|')[ruForm(n)] ?? forms, all);
  return fill(english[n === 1 ? 0 : 1], all);
}

/** The decimal separator of the language: '1,5 ч' in Russian, '1.5 h' in English. */
export const decimal = (n: number | string): string => (current === 'ru' ? String(n).replace('.', ',') : String(n));
