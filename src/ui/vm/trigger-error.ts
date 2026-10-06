// What the settings screen prints next to a trigger key. `bindTriggers` hands over, per key, either
// the Russian reason of the keyboard layer ("неизвестная клавиша: Banana", "нужен Ctrl или Alt") or,
// when the keyboard hook could not be installed, the raw English text of the failure
// ("SetWindowsHookExW failed: ...", "cannot start the hook thread: ..."). Only the first kind may reach
// the screen; the raw text stays in the log.

export const TRIGGERS_FAILED = 'Не удалось включить клавиши. Подробности в логе.';

const STARTS_WITH_CYRILLIC = /^\s*[Ѐ-ӿ]/;

/**
 * The text to show for one trigger key: `null` when it has no error, the reason itself when it is one of
 * the Russian per-key reasons, otherwise a fixed Russian sentence. A reason is recognised by starting with
 * a Cyrillic letter: a Windows error message can be localized, so Cyrillic somewhere after an English
 * prefix is not enough.
 */
export function triggerErrorText(raw: string | null): string | null {
  if (raw === null) return null;
  return STARTS_WITH_CYRILLIC.test(raw) ? raw : TRIGGERS_FAILED;
}
