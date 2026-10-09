import { describe, expect, it } from 'vitest';
import { BADGE_HINT, BADGE_TEXT, indicatorClick, indicatorFace, SIGN_GUARD_MS } from '../../src/ui/vm/keyboard-badge';

// the indicator of UEX as the header model gives it (`windowHeader`): the text is not part of what the face decides
const quiet = { text: 'UEX 12 мин', title: 'Цены UEX: 12 мин назад\nНажми, чтобы обновить цены сейчас', stale: false, busy: false };
const offline = { text: 'UEX офлайн 12 мин', title: 'UEX недоступен', stale: true, busy: false };
const syncing = { text: 'UEX 23/57', title: 'Цены UEX обновляются: 23 из 57', stale: false, busy: true };

describe('the words of the sign', () => {
  it('say what to press and where the keyboard goes, and the hint says the sign is a button too', () => {
    expect(BADGE_TEXT).toBe('Esc — в игру');
    expect(BADGE_HINT).toContain('Esc');
    expect(BADGE_HINT).toContain('клик');
  });
});

describe('indicatorFace, what the slot of the UEX indicator shows (task 44)', () => {
  it('is the indicator as it is while the window does not hold the keyboard', () => {
    expect(indicatorFace(false, quiet)).toEqual({ sign: false, title: quiet.title, stale: false, busy: false });
    expect(indicatorFace(false, offline)).toEqual({ sign: false, title: offline.title, stale: true, busy: false });
    expect(indicatorFace(false, syncing)).toEqual({ sign: false, title: syncing.title, stale: false, busy: true });
  });

  it('is the sign with its own tooltip while it does, whatever the indicator was', () => {
    for (const uex of [quiet, offline, syncing]) {
      expect(indicatorFace(true, uex)).toEqual({ sign: true, title: BADGE_HINT, stale: false, busy: false });
    }
  });

  it('shows none of the states of the indicator under the sign: no warning colour, no busy mark', () => {
    const face = indicatorFace(true, { ...offline, busy: true });
    expect(face.stale).toBe(false);
    expect(face.busy).toBe(false);
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
});
