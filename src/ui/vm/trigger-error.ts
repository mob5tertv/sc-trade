// What the settings screen prints next to a trigger key. `bindTriggers` hands over, per key, either
// the Russian reason of the keyboard layer ("неизвестная клавиша: Banana", "нужен Ctrl или Alt") or,
// when the keyboard hook could not be installed, the raw English text of the failure
// ("SetWindowsHookExW failed: ...", "cannot start the hook thread: ..."). Only the first kind may reach
// the screen; the raw text stays in the log.

import { tr } from '../../i18n';

export const TRIGGERS_FAILED = (): string => tr('Не удалось включить клавиши. Подробности в логе.');

const STARTS_WITH_CYRILLIC = /^\s*[Ѐ-ӿ]/;

/**
 * The reasons of the keyboard layer (`src-tauri/src/keys.rs`), which speaks Russian, in the language of the window. A reason that
 * is not one of them is shown as it came.
 */
const RUST_REASONS: ReadonlyArray<readonly [RegExp, (m: RegExpMatchArray) => string]> = [
  [/^нужен Ctrl или Alt$/, () => tr('нужен Ctrl или Alt')],
  [/^не указана клавиша$/, () => tr('не указана клавиша')],
  [/^лишний «\+» в «(.*)»$/, (m) => tr('лишний «+» в «{text}»', { text: m[1] })],
  [/^неизвестный модификатор: (.*)$/, (m) => tr('неизвестный модификатор: {name}', { name: m[1] })],
  [/^модификатор «(.*)» указан дважды$/, (m) => tr('модификатор «{name}» указан дважды', { name: m[1] })],
  [/^неизвестная клавиша: (.*)$/, (m) => tr('неизвестная клавиша: {name}', { name: m[1] })],
];

function inLanguage(reason: string): string {
  for (const [pattern, say] of RUST_REASONS) {
    const m = reason.match(pattern);
    if (m !== null) return say(m);
  }
  return reason;
}

/**
 * The text to show for one trigger key: `null` when it has no error, the reason itself when it is one of
 * the Russian per-key reasons, otherwise a fixed Russian sentence. A reason is recognised by starting with
 * a Cyrillic letter: a Windows error message can be localized, so Cyrillic somewhere after an English
 * prefix is not enough.
 */
export function triggerErrorText(raw: string | null): string | null {
  if (raw === null) return null;
  return STARTS_WITH_CYRILLIC.test(raw) ? inLanguage(raw) : TRIGGERS_FAILED();
}
