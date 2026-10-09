import { describe, expect, it } from 'vitest';
import {
  arrivalAsksWhere, locationFieldTitle, locationPlaceholder, pickEffect, WHERE_ARRIVED_PLACEHOLDER,
} from '../../src/ui/vm/terminal-pick';

const ARC_L1 = 1;

describe('pickEffect: what choosing a terminal in the field of the location does', () => {
  it('with no run going the chosen terminal is viewed AND becomes the current location, as "Я здесь" does', () => {
    expect(pickEffect({ runGoing: false, ctrl: false, askingWhere: false })).toBe('here');
  });

  it('while a run goes the terminal is only viewed: the player looks at the prices of a far station and keeps his "from"', () => {
    expect(pickEffect({ runGoing: true, ctrl: false, askingWhere: false })).toBe('view');
  });

  it('Ctrl+Enter is "Я здесь" always: in a run too, and with no run', () => {
    expect(pickEffect({ runGoing: true, ctrl: true, askingWhere: false })).toBe('here');
    expect(pickEffect({ runGoing: false, ctrl: true, askingWhere: false })).toBe('here');
  });

  it('the field that asks "Где прилетел?" makes the chosen terminal the location although the run goes on', () => {
    expect(pickEffect({ runGoing: true, ctrl: false, askingWhere: true })).toBe('here');
    expect(pickEffect({ runGoing: true, ctrl: true, askingWhere: true })).toBe('here');
  });
});

describe('arrivalAsksWhere: the field of the location is asked to say where the ship has landed', () => {
  it('an arrival WITHOUT a target does: nothing else tells where the ship is', () => {
    expect(arrivalAsksWhere('arrive', null)).toBe(true);
  });

  it('an arrival with a target does not: the target is set as the location by itself', () => {
    expect(arrivalAsksWhere('arrive', ARC_L1)).toBe(false);
  });

  it('a take-off does not, with a target or without one', () => {
    expect(arrivalAsksWhere('depart', null)).toBe(false);
    expect(arrivalAsksWhere('depart', ARC_L1)).toBe(false);
  });
});

describe('the words of the field of the location', () => {
  it('the placeholder is "Локация…", and "Где прилетел?" while the field asks', () => {
    expect(locationPlaceholder(false)).toBe('Локация…');
    expect(locationPlaceholder(true)).toBe(WHERE_ARRIVED_PLACEHOLDER);
    expect(WHERE_ARRIVED_PLACEHOLDER).toBe('Где прилетел?');
  });

  const base = 'TDD Area 18\nStanton · ArcCorp';

  it('with no run the tooltip says what Enter does and what Ctrl+Enter adds', () => {
    const title = locationFieldTitle(base, { runGoing: false, askingWhere: false });
    expect(title.startsWith(`${base}\n`)).toBe(true);
    expect(title).toContain('Enter');
    expect(title).toContain('Ctrl+Enter');
    expect(title).toContain('«Я здесь»');
  });

  it('in a run the tooltip says that Enter only looks, and Ctrl+Enter is "Я здесь"', () => {
    const title = locationFieldTitle(base, { runGoing: true, askingWhere: false });
    expect(title).toContain('только посмотреть');
    expect(title).toContain('Ctrl+Enter');
    expect(title).not.toBe(locationFieldTitle(base, { runGoing: false, askingWhere: false }));
  });

  it('while the field asks "Где прилетел?" the tooltip is the question and the way to answer it: the old name has no place there', () => {
    const title = locationFieldTitle(base, { runGoing: true, askingWhere: true });
    expect(title.startsWith('Где прилетел?')).toBe(true);
    expect(title).not.toContain('TDD Area 18');
  });

  it('a field with nothing in it gets the hint after the usual words', () => {
    expect(locationFieldTitle('Выбери локацию: три буквы и Enter', { runGoing: false, askingWhere: false }))
      .toMatch(/^Выбери локацию: три буквы и Enter\n.*Ctrl\+Enter/);
  });
});
