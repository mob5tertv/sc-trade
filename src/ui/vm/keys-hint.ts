import type { Settings } from '../../core/settings';

// The one-time hint after the first run is closed (version 1.1): the cursor is not in the flight, so the player is told that the marks
// "Взлетел" and "Прилетел" can have keys of their own. Pure; the state decides when it is said (`app.#announceClosed`) and keeps the flag
// `keysHintShown` (shown, or a key was assigned: never again).

/** The sentence that follows the result of the run in the notice line. */
export const KEYS_HINT = 'В полёте курсора нет: назначь клавиши «Взлетел» и «Прилетел»';

/**
 * How long the notice that carries the hint stays on the screen (version 1.1.1): no time of its own (`null`). At the last sale the player
 * looks at the kiosk, not at the corner of the window, and the hint is given once in a lifetime, so it waits there until the cross or
 * "Настроить" is pressed, or another notice takes its place. Folding the window does not take it away: it is there at the next expansion.
 */
export const KEYS_HINT_STAY_MS: number | null = null;

type HintSettings = Pick<Settings, 'keysHintShown' | 'hotkeyDepart' | 'hotkeyArrive'>;

/** What a closed run does about the hint: put it on the screen (`show`), only write the flag because the keys are there (`remember`), or nothing. */
export type KeysHintStep = 'show' | 'remember' | 'none';

/**
 * What the closing of a run does about the hint, by the message about it (`closesRun`: a sale without a purchase closes no run; `kind`: an error
 * is a cargo that was lost or a run at a loss), the settings and whether the window is expanded (the notice line is where it is read and the button
 * is pressed):
 *  - the flag is set already: nothing, ever;
 *  - a key of either mark is assigned (the key of the panel opens the window and marks nothing, so it does not count): the player knows the keys,
 *    so the flag is written quietly and no hint ever comes, whatever the window and the tone of the result are;
 *  - no key: the hint, but only on a result that is no error (it is not hung on bad news) and only in the expanded window; otherwise it waits for
 *    the next closed run, and nothing is remembered.
 */
export function keysHintStep(notice: { closesRun: boolean; kind: 'info' | 'error' }, s: HintSettings, expanded: boolean): KeysHintStep {
  if (!notice.closesRun || s.keysHintShown) return 'none';
  if (s.hotkeyDepart.trim() !== '' || s.hotkeyArrive.trim() !== '') return 'remember';
  return notice.kind === 'info' && expanded ? 'show' : 'none';
}

/**
 * Carries out a step in the one order that cannot lose the hint: `show` puts the hint on the screen (and says whether it got there: the notice
 * may be another one by now, or the window folded), and only then `remember` writes the flag. A hint that did not get on the screen is not
 * remembered. `remember` must not fail loudly (it says nothing to the player if the write fails: the hint may then simply come once more).
 */
export async function carryOutKeysHint(step: KeysHintStep, effects: { show: () => boolean; remember: () => Promise<void> }): Promise<void> {
  if (step === 'show') {
    if (effects.show()) await effects.remember();
  } else if (step === 'remember') {
    await effects.remember();
  }
}

/** The result of the run and the hint after it, one sentence after another (a full stop that stands at the end of the result is not doubled). */
export function withKeysHint(text: string): string {
  return `${text.replace(/\.$/, '')}. ${KEYS_HINT}`;
}

/** A key written into the field of "Взлетел" or "Прилетел": the player knows the keys, so the hint is never needed. A key taken off is not one. */
export function assignsMarkKey(key: keyof Settings, value: unknown): boolean {
  return (key === 'hotkeyDepart' || key === 'hotkeyArrive') && typeof value === 'string' && value.trim() !== '';
}
