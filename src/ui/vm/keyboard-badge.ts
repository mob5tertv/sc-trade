import { KEYBOARD_IDLE_MS } from './keyboard-idle';
import type { WindowHeader } from './window-header';

// The signs of the keyboard. «Esc — в игру»: the window holds the keyboard while the player types into a field, and the sign says how to
// give it back. «Клавиатура у игры»: the keyboard went back by itself (nobody used it for a while, `vm/keyboard-idle.ts`), and the player,
// who may be looking at another monitor, is told that his keys go to the game again. Only the display lives here; who holds the keyboard,
// how it goes back, and for how long the second sign is said to stand, is `keyboard.ts` and `vm/keyboard-holds.ts`.
//
// In the header of the main screen «Esc — в игру» stands in the place of the indicator of UEX (`Header.svelte`): the header has no room to
// spare, and the sign moves and shrinks nothing. `indicatorFace` and `indicatorClick` put «Клавиатура у игры» into the same slot when they
// are told that the keyboard went by itself (their last argument); the header does not tell them so yet, so the main screen shows only
// the first sign. In the header of the settings, which has free space, both signs are a badge of their own (`KeyboardBadge.svelte`).

/** The sign, as the player reads it. */
export const BADGE_TEXT = 'Esc — в игру';

/** The tooltip of the sign: it is a button too, and the key does the same. */
export const BADGE_HINT = 'Клавиатура у окна: Esc или клик сюда возвращают её игре';

/** A no-break space, by its number: an invisible character is not written into the source. */
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

/**
 * The sign that the keyboard went back to the game by itself, as the player reads it: «Клавиатура у игры». The space before «игры» is a
 * no-break one: in the slot of the header, which is narrower than the three words (93,7 px against 64 and up, measured in the preview),
 * the sign would stand in two lines, and they are «Клавиатура» (58,2 px) and «у игры», never a line that ends with «у».
 */
export const GONE_TEXT = `Клавиатура у${NO_BREAK_SPACE}игры`;

/** The tooltip of that sign: why the keyboard went, and how to type again. */
export const GONE_HINT = `Клавиатура вернулась игре сама: ${KEYBOARD_IDLE_MS / 1000} секунд не было ни одной клавиши. Чтобы печатать снова, кликни в поле`;

/** How long, ms, the sign «Клавиатура у игры» stands, unless the player presses a field first (then it goes at once). */
export const GONE_SIGN_MS = 6000;

/**
 * Which sign stands where the sign of the keyboard stands. `held`: «Esc — в игру», the window holds the keyboard. `gone`: «Клавиатура у
 * игры», the keyboard went back by itself and the listeners still say so (`goneByItself`: for `GONE_SIGN_MS`, or until a field is
 * pressed). `null`: no sign. The keyboard given back by the player's own hand (Esc, a click on the game, a click on the sign) leaves none:
 * he knows where it is.
 */
export function keyboardSign(keyboardHeld: boolean, goneByItself: boolean): 'held' | 'gone' | null {
  if (keyboardHeld) return 'held';
  return goneByItself ? 'gone' : null;
}

/** What the slot of the indicator of UEX shows: a sign of the keyboard, or the indicator with the states it has. */
export interface IndicatorFace {
  /** A sign stands in the slot; the text and the mark of the indicator are not shown. */
  sign: boolean;
  /** The words of the sign; empty when there is none. */
  text: string;
  /** The sign only tells («Клавиатура у игры»): it is drawn muted, not in the colour of the accent, and it is no button. */
  muted: boolean;
  title: string;
  /** The warning colour of the indicator; never under a sign. */
  stale: boolean;
  /** The refresh that is going, in the colour of the accent, `aria-busy`; never under a sign (a refresh that is going keeps going). */
  busy: boolean;
}

/**
 * While the window holds the keyboard the slot says so, and has no state of the indicator; after the keyboard went back by itself the same
 * slot says that, muted, for as long as `goneByItself` is said; otherwise it shows the indicator as it is then.
 */
export function indicatorFace(keyboardHeld: boolean, uex: WindowHeader['uex'], goneByItself = false): IndicatorFace {
  const sign = keyboardSign(keyboardHeld, goneByItself);
  if (sign === 'held') return { sign: true, text: BADGE_TEXT, muted: false, title: BADGE_HINT, stale: false, busy: false };
  if (sign === 'gone') return { sign: true, text: GONE_TEXT, muted: true, title: GONE_HINT, stale: false, busy: false };
  return { sign: false, text: '', muted: false, title: uex.title, stale: uex.stale, busy: uex.busy };
}

/**
 * How long, ms, a click on the slot is ignored after the sign went away. The click that gives the keyboard back flips the state at once,
 * so the second click of a double click lands on the restored indicator, and that would start a price sync nobody asked for. A double
 * click of Windows is up to half a second, and the sign goes a moment after the first click.
 */
export const SIGN_GUARD_MS = 700;

/**
 * What a click on the slot does: `give-back` while the sign «Esc — в игру» is shown, `ignore` for `SIGN_GUARD_MS` after it went away
 * (`signGoneAt`, the time on the same clock as `now`; `-Infinity` when it never was shown), `refresh` (the sync of the prices) otherwise.
 * A clock that went back (the sign "went away" later than now) does not silence the indicator. While «Клавиатура у игры» stands in the
 * slot (`goneByItself`) a click does nothing: that sign only tells, and a click on it must not start a price sync nobody asked for.
 */
export function indicatorClick(keyboardHeld: boolean, now: number, signGoneAt: number, goneByItself = false): 'give-back' | 'ignore' | 'refresh' {
  if (keyboardHeld) return 'give-back';
  if (goneByItself) return 'ignore';
  const since = now - signGoneAt;
  return since >= 0 && since < SIGN_GUARD_MS ? 'ignore' : 'refresh';
}
