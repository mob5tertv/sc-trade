import { describe, expect, it } from 'vitest';
import {
  BADGE_HINT, BADGE_TEXT, GONE_HINT, GONE_SIGN_MS, GONE_TEXT, indicatorClick, indicatorFace, keyboardSign, SIGN_GUARD_MS,
} from '../../src/ui/vm/keyboard-badge';
import { KEYBOARD_IDLE_MS } from '../../src/ui/vm/keyboard-idle';

// the indicator of UEX as the header model gives it (`windowHeader`): the text is not part of what the face decides
const quiet = { text: 'UEX 12 мин', title: 'Цены UEX: 12 мин назад\nНажми, чтобы обновить цены сейчас', stale: false, busy: false };
const offline = { text: 'UEX офлайн 12 мин', title: 'UEX недоступен', stale: true, busy: false };
const syncing = { text: 'UEX 23/57', title: 'Цены UEX обновляются: 23 из 57', stale: false, busy: true };

describe('the words of the sign', () => {
  it('say what to press and where the keyboard goes, and the hint says the sign is a button too', () => {
    expect(BADGE_TEXT()).toBe('Esc — в игру');
    expect(BADGE_HINT()).toContain('Esc');
    expect(BADGE_HINT()).toContain('клик');
  });
});

/** A no-break space, by its number: an invisible character is not written into the source. */
const NO_BREAK_SPACE = String.fromCharCode(0xa0);

describe('the words of the sign that the keyboard went back by itself (task 54)', () => {
  it('say where the keyboard is now; the hint says why it went and how to type again', () => {
    expect(GONE_TEXT().replaceAll(NO_BREAK_SPACE, ' ')).toBe('Клавиатура у игры');
    expect(GONE_HINT()).toContain(`${KEYBOARD_IDLE_MS / 1000} секунд`);
    expect(GONE_HINT()).toContain('кликни в поле');
  });

  it('break in one place only, after «Клавиатура»: in the narrow slot of the header no line ends with «у»', () => {
    expect(GONE_TEXT()).toBe(`Клавиатура у${NO_BREAK_SPACE}игры`);
    expect(GONE_TEXT().split(' ')).toEqual(['Клавиатура', `у${NO_BREAK_SPACE}игры`]);
    expect(GONE_TEXT()).toHaveLength('Клавиатура у игры'.length);
  });

  it('stays for six seconds', () => {
    expect(GONE_SIGN_MS).toBe(6000);
  });
});

describe('keyboardSign, which sign stands where the sign of the keyboard stands', () => {
  it('is «Esc — в игру» while the window holds the keyboard, whatever was said before', () => {
    expect(keyboardSign(true, false)).toBe('held');
    // the player pressed a field while «Клавиатура у игры» was still on: the keyboard is with the window, and the sign says that
    expect(keyboardSign(true, true)).toBe('held');
  });

  it('is «Клавиатура у игры» after the keyboard went back by itself, for as long as the listeners say so', () => {
    expect(keyboardSign(false, true)).toBe('gone');
  });

  it('is none otherwise: the keyboard is with the game by the player\'s own hand (Esc, a click on the game), or was never taken', () => {
    expect(keyboardSign(false, false)).toBeNull();
  });
});

describe('indicatorFace, what the slot of the UEX indicator shows (task 44)', () => {
  it('is the indicator as it is while the window does not hold the keyboard', () => {
    expect(indicatorFace(false, quiet)).toEqual({ sign: false, text: '', muted: false, title: quiet.title, stale: false, busy: false });
    expect(indicatorFace(false, offline)).toEqual({ sign: false, text: '', muted: false, title: offline.title, stale: true, busy: false });
    expect(indicatorFace(false, syncing)).toEqual({ sign: false, text: '', muted: false, title: syncing.title, stale: false, busy: true });
  });

  it('is the sign with its own tooltip while it does, whatever the indicator was', () => {
    for (const uex of [quiet, offline, syncing]) {
      expect(indicatorFace(true, uex)).toEqual({ sign: true, text: BADGE_TEXT(), muted: false, title: BADGE_HINT(), stale: false, busy: false });
    }
  });

  it('shows none of the states of the indicator under the sign: no warning colour, no busy mark', () => {
    const face = indicatorFace(true, { ...offline, busy: true });
    expect(face.stale).toBe(false);
    expect(face.busy).toBe(false);
  });

  it('is the muted sign «Клавиатура у игры» in the same slot after the keyboard went back by itself, whatever the indicator was', () => {
    for (const uex of [quiet, offline, syncing]) {
      expect(indicatorFace(false, uex, true)).toEqual({ sign: true, text: GONE_TEXT(), muted: true, title: GONE_HINT(), stale: false, busy: false });
    }
  });

  it('is «Esc — в игру», not muted, as soon as the window holds the keyboard again', () => {
    expect(indicatorFace(true, quiet, true)).toEqual({ sign: true, text: BADGE_TEXT(), muted: false, title: BADGE_HINT(), stale: false, busy: false });
  });

  it('with nothing said about the keyboard having gone by itself, there is no such sign', () => {
    expect(indicatorFace(false, quiet)).toEqual(indicatorFace(false, quiet, false));
    expect(indicatorFace(true, quiet)).toEqual(indicatorFace(true, quiet, false));
  });
});

describe('indicatorClick, what a click on the slot does', () => {
  const NEVER = Number.NEGATIVE_INFINITY;

  it('gives the keyboard back while the sign is shown, and starts no price sync', () => {
    expect(indicatorClick(true, 5_000, NEVER)).toBe('give-back');
    expect(indicatorClick(true, 5_000, 4_999)).toBe('give-back');
  });

  it('refreshes the prices when the sign has not been shown for a while, or never', () => {
    expect(indicatorClick(false, 5_000, NEVER)).toBe('refresh');
    expect(indicatorClick(false, 10_000, 10_000 - SIGN_GUARD_MS)).toBe('refresh');
    expect(indicatorClick(false, 60_000, 1_000)).toBe('refresh');
  });

  it('ignores a click right after the sign went away: the second click of a double click lands on the restored indicator', () => {
    expect(indicatorClick(false, 10_000, 10_000)).toBe('ignore');
    expect(indicatorClick(false, 10_000 + 120, 10_000)).toBe('ignore');
    expect(indicatorClick(false, 10_000 + SIGN_GUARD_MS - 1, 10_000)).toBe('ignore');
  });

  it('is quiet for a moment only: a double click is fast, a player who wants a refresh waits less than a second', () => {
    expect(SIGN_GUARD_MS).toBeGreaterThanOrEqual(500);
    expect(SIGN_GUARD_MS).toBeLessThanOrEqual(1000);
  });

  it('does not stay quiet when the clock says the sign went away in the future (a clock that was set back)', () => {
    expect(indicatorClick(false, 1_000, 9_000)).toBe('refresh');
  });

  it('does nothing while «Клавиатура у игры» stands in the slot: that sign only tells, and a click on it must start no price sync', () => {
    // the keyboard went back by itself at 10 000; the sign stands for six seconds, well past the guard of a double click
    expect(indicatorClick(false, 10_000 + 100, 10_000, true)).toBe('ignore');
    expect(indicatorClick(false, 10_000 + SIGN_GUARD_MS, 10_000, true)).toBe('ignore');
    expect(indicatorClick(false, 10_000 + GONE_SIGN_MS - 1, 10_000, true)).toBe('ignore');
  });

  it('refreshes again once that sign has gone', () => {
    expect(indicatorClick(false, 10_000 + GONE_SIGN_MS, 10_000, false)).toBe('refresh');
  });

  it('gives the keyboard back when the window holds it, whatever was said about the other sign', () => {
    expect(indicatorClick(true, 10_000, 9_000, true)).toBe('give-back');
  });
});
