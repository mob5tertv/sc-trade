import { describe, expect, it } from 'vitest';
import { shouldCollapse, type IdleInput } from '../../src/ui/vm/idle';

/** Expanded, 40 s limit, the player was last active 40 s ago, cursor away: the one case that collapses. */
const READY: IdleInput = {
  mode: 'expanded',
  idleSec: 40,
  now: 1000,
  lastActivityAt: 960,
  pointerInside: false,
  keyboardHeld: false,
  busy: false,
};

const withInput = (change: Partial<IdleInput>): IdleInput => ({ ...READY, ...change });

describe('shouldCollapse', () => {
  it('collapses an expanded window that nobody touched for the whole time', () => {
    expect(shouldCollapse(READY)).toBe(true);
  });

  it('never collapses what is already the mini bar', () => {
    expect(shouldCollapse(withInput({ mode: 'mini' }))).toBe(false);
  });

  it('does not collapse by itself when the time is 0', () => {
    expect(shouldCollapse(withInput({ idleSec: 0 }))).toBe(false);
    expect(shouldCollapse(withInput({ idleSec: 0, now: 1_000_000 }))).toBe(false);
  });

  it('does not collapse while the cursor is over the window', () => {
    expect(shouldCollapse(withInput({ pointerInside: true }))).toBe(false);
    expect(shouldCollapse(withInput({ pointerInside: true, now: 1_000_000 }))).toBe(false);
  });

  it('waits for the whole time since the last activity, to the second', () => {
    expect(shouldCollapse(withInput({ now: 999 }))).toBe(false); // 39 s
    expect(shouldCollapse(withInput({ now: 1000 }))).toBe(true); // exactly 40 s
    expect(shouldCollapse(withInput({ now: 1001 }))).toBe(true);
  });

  it('counts from the latest activity', () => {
    expect(shouldCollapse(withInput({ lastActivityAt: 990 }))).toBe(false);
    expect(shouldCollapse(withInput({ lastActivityAt: 990, now: 1030 }))).toBe(true);
  });

  it('does not collapse while the keyboard is with the window', () => {
    expect(shouldCollapse(withInput({ keyboardHeld: true }))).toBe(false);
    expect(shouldCollapse(withInput({ keyboardHeld: true, now: 1_000_000 }))).toBe(false);
  });

  it('does not collapse while something keeps the window busy (a dialog, the settings)', () => {
    expect(shouldCollapse(withInput({ busy: true }))).toBe(false);
    expect(shouldCollapse(withInput({ busy: true, now: 1_000_000 }))).toBe(false);
  });

  it('works with a short and with a long limit', () => {
    expect(shouldCollapse(withInput({ idleSec: 2, lastActivityAt: 998 }))).toBe(true);
    expect(shouldCollapse(withInput({ idleSec: 2, lastActivityAt: 999 }))).toBe(false);
    expect(shouldCollapse(withInput({ idleSec: 3600, now: 4559 }))).toBe(false);
    expect(shouldCollapse(withInput({ idleSec: 3600, now: 4560 }))).toBe(true);
  });

  it('reads a negative limit like 0: never', () => {
    expect(shouldCollapse(withInput({ idleSec: -5 }))).toBe(false);
  });
});
