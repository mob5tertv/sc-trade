import type { WindowHeader } from './window-header';

// The sign «Esc — в игру»: the window holds the keyboard while the player types into a field, and the sign says how to give it back. Only the
// display lives here; who holds the keyboard, and how it goes back, is `keyboard.ts` and `vm/keyboard-holds.ts`.
//
// In the header of the main screen the sign stands in the place of the indicator of UEX (`Header.svelte`): the header has no room to spare,
// and the sign moves and shrinks nothing. In the header of the settings, which has free space, it is a badge of its own (`KeyboardBadge.svelte`).

/** The sign, as the player reads it. */
export const BADGE_TEXT = 'Esc — в игру';

/** The tooltip of the sign: it is a button too, and the key does the same. */
export const BADGE_HINT = 'Клавиатура у окна: Esc или клик сюда возвращают её игре';

/** What the slot of the indicator of UEX shows: the sign, or the indicator with the states it has. */
export interface IndicatorFace {
  /** The sign stands in the slot; the text and the mark of the indicator are not shown. */
  sign: boolean;
  title: string;
  /** The warning colour of the indicator; never under the sign. */
  stale: boolean;
  /** The refresh that is going, in the colour of the accent, `aria-busy`; never under the sign (a refresh that is going keeps going). */
  busy: boolean;
}

/** While the window holds the keyboard the slot says so, and has no state of the indicator; when the keyboard goes back it shows what is true then. */
export function indicatorFace(keyboardHeld: boolean, uex: WindowHeader['uex']): IndicatorFace {
  return keyboardHeld
    ? { sign: true, title: BADGE_HINT, stale: false, busy: false }
    : { sign: false, title: uex.title, stale: uex.stale, busy: uex.busy };
}

/**
 * How long, ms, a click on the slot is ignored after the sign went away. The click that gives the keyboard back flips the state at once,
 * so the second click of a double click lands on the restored indicator, and that would start a price sync nobody asked for. A double
 * click of Windows is up to half a second, and the sign goes a moment after the first click.
 */
export const SIGN_GUARD_MS = 700;

/**
 * What a click on the slot does: `give-back` while the sign is shown, `ignore` for `SIGN_GUARD_MS` after it went away (`signGoneAt`, the
 * time on the same clock as `now`; `-Infinity` when it never was shown), `refresh` (the sync of the prices) otherwise. A clock that went
 * back (the sign "went away" later than now) does not silence the indicator.
 */
export function indicatorClick(keyboardHeld: boolean, now: number, signGoneAt: number): 'give-back' | 'ignore' | 'refresh' {
  if (keyboardHeld) return 'give-back';
  const since = now - signGoneAt;
  return since >= 0 && since < SIGN_GUARD_MS ? 'ignore' : 'refresh';
}
