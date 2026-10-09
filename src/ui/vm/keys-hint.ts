import type { Settings } from '../../core/settings';

// The one-time hint after the first run is closed (version 1.1): the cursor is not in the flight, so the player is told that the marks
// "Взлетел" and "Прилетел" can have keys of their own. Pure; the state decides when it is said (`app.#announceClosed`) and keeps the flag
// `keysHintShown` (shown, or a key was assigned: never again).

/** The sentence that follows the result of the run in the notice line. */
export const KEYS_HINT = 'В полёте курсора нет: назначь клавиши «Взлетел» и «Прилетел»';

type HintSettings = Pick<Settings, 'keysHintShown' | 'hotkeyDepart' | 'hotkeyArrive'>;

/**
 * The hint for a message about a run that was closed (`closesRun`: a sale without a purchase closes no run), or `null`: it was shown once, or
 * one of the keys of the two marks is assigned (the key of the panel opens the window and marks nothing, so it does not count).
 */
export function keysHint(notice: { closesRun: boolean }, s: HintSettings): string | null {
  if (!notice.closesRun || s.keysHintShown) return null;
  return s.hotkeyDepart.trim() === '' && s.hotkeyArrive.trim() === '' ? KEYS_HINT : null;
}

/** The result of the run and the hint after it, one sentence after another (a full stop that stands at the end of the result is not doubled). */
export function withKeysHint(text: string): string {
  return `${text.replace(/\.$/, '')}. ${KEYS_HINT}`;
}

/** A key written into the field of "Взлетел" or "Прилетел": the player knows the keys, so the hint is never needed. A key taken off is not one. */
export function assignsMarkKey(key: keyof Settings, value: unknown): boolean {
  return (key === 'hotkeyDepart' || key === 'hotkeyArrive') && typeof value === 'string' && value.trim() !== '';
}
