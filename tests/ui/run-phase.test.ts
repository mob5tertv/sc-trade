import { describe, expect, it } from 'vitest';
import { phases } from '../../src/core/run';
import { cardMarks, goesOnward, markRefusal, nextMarkOf, phaseCaps, phaseLine, runPhases } from '../../src/ui/vm/run-phase';
import { bought, marked, runOf, sold, T0, TITA } from '../helpers/run-wiring-fixtures';

/** `runPhases` of a run with these events, `at` seconds after the first purchase. */
const at = (sec: number, ...events: Parameters<typeof runOf>) => {
  const active = runOf(...events);
  return runPhases(active.run, active.events, T0 + sec);
};

describe('runPhases', () => {
  it('is loading from the first purchase until the take-off, and counts from the start of the run', () => {
    expect(at(192, bought(0))).toEqual({
      phase: 'loading', sinceSec: 192, totalSec: 192, slots: { loading: 192, flight: null, unloading: null },
    });
  });
  it('keeps loading when more is bought, and does not start it again', () => {
    expect(at(300, bought(0), bought(120, TITA, 40, 2500))).toMatchObject({ phase: 'loading', sinceSec: 300 });
  });
  it('is flying from the take-off until the arrival, the loading time stays fixed', () => {
    expect(at(700, bought(0), marked(180, 'depart'))).toEqual({
      phase: 'flight', sinceSec: 520, totalSec: 700, slots: { loading: 180, flight: 520, unloading: null },
    });
  });
  it('is unloading from the arrival, the two earlier phases stay fixed', () => {
    expect(at(900, bought(0), marked(180, 'depart'), marked(700, 'arrive'))).toEqual({
      phase: 'unloading', sinceSec: 200, totalSec: 900, slots: { loading: 180, flight: 520, unloading: 200 },
    });
  });
  it('does not change the phase with a sale', () => {
    expect(at(900, bought(0), marked(180, 'depart'), marked(700, 'arrive'), sold(750, undefined, 50)))
      .toMatchObject({ phase: 'unloading', sinceSec: 200 });
    // a sale at the place of loading is not a flight either
    expect(at(60, bought(0), sold(30, undefined, 10))).toMatchObject({ phase: 'loading', sinceSec: 60 });
  });
  it('flies again on a second take-off with the cargo still aboard, the unloading of the first leg is forgotten', () => {
    const events = [bought(0), marked(180, 'depart'), marked(700, 'arrive'), sold(740, undefined, 50), marked(800, 'depart')];
    expect(at(1000, ...events)).toEqual({
      phase: 'flight', sinceSec: 200, totalSec: 1000, slots: { loading: 180, flight: 200, unloading: null },
    });
  });
  it('loads again when something is bought after the arrival; the flight and the unloading of the earlier leg are forgotten', () => {
    const events = [bought(0), marked(180, 'depart'), marked(700, 'arrive'), bought(760, TITA, 40, 2500)];
    expect(at(900, ...events)).toEqual({
      phase: 'loading', sinceSec: 140, totalSec: 900, slots: { loading: 140, flight: null, unloading: null },
    });
  });
  it('ignores a purchase made in flight and a take-off that repeats', () => {
    expect(at(900, bought(0), marked(180, 'depart'), bought(300, TITA, 5, 1), marked(400, 'depart')))
      .toMatchObject({ phase: 'flight', sinceSec: 720, slots: { loading: 180, flight: 720, unloading: null } });
  });
  it('lets an arrival come without a take-off', () => {
    expect(at(500, bought(0), marked(300, 'arrive'))).toMatchObject({ phase: 'unloading', sinceSec: 200, slots: { loading: 300, flight: null, unloading: 200 } });
  });
  it('is loading since the start of a run that has no events yet, and never counts backwards', () => {
    expect(at(40)).toMatchObject({ phase: 'loading', sinceSec: 40 });
    expect(at(-30, bought(0))).toMatchObject({ phase: 'loading', sinceSec: 0, totalSec: 0 });
  });

  it('adds up to what the core says of a finished simple run', () => {
    // 96 Gold bought at terminal 1, one take-off, one arrival, sold at terminal 2: the rules of `phases` in core/run.ts
    const events = [bought(0), marked(360, 'depart'), marked(1500, 'arrive'), sold(1590)];
    const core = phases(events);
    expect(core).toEqual({ loadingSec: 360, flightSec: 1140, unloadingSec: 90 });
    expect(at(1590, ...events).slots).toEqual({ loading: core?.loadingSec, flight: core?.flightSec, unloading: core?.unloadingSec });
  });
});

describe('runPhases of a finished run', () => {
  const finished = (now: number) => {
    const active = runOf(bought(0), marked(180, 'depart'), marked(700, 'arrive'), sold(750));
    const run = { ...active.run, status: 'done' as const, endedAt: T0 + 750 };
    return runPhases(run, active.events, T0 + now);
  };

  it('counts to the end of the run: every number stops there and does not grow with the clock', () => {
    const expected = {
      phase: 'unloading', sinceSec: 50, totalSec: 750, slots: { loading: 180, flight: 520, unloading: 50 },
    };
    expect(finished(750)).toEqual(expected);
    expect(finished(5000)).toEqual(expected);
  });
  it('stops a run that was lost in flight at the moment it was lost', () => {
    const active = runOf(bought(0), marked(180, 'depart'));
    const run = { ...active.run, status: 'lost' as const, endedAt: T0 + 400 };
    expect(runPhases(run, active.events, T0 + 9999)).toMatchObject({ phase: 'flight', sinceSec: 220, totalSec: 400, slots: { loading: 180, flight: 220, unloading: null } });
  });
});

describe('cardMarks', () => {
  // the header of the section offers the NEXT mark (take-off while loading, arrival in flight); the card keeps the rest
  it('offers nothing while loading and in flight: the header has the one mark that comes', () => {
    expect(cardMarks('loading')).toEqual([]);
    expect(cardMarks('flight')).toEqual([]);
  });
  it('offers the take-off of another leg while unloading, when the header offers no mark', () => {
    expect(cardMarks('unloading')).toEqual(['depart']);
  });
  it('never offers what the header offers', () => {
    for (const phase of ['loading', 'flight', 'unloading'] as const) {
      const active = { loading: runOf(bought(0)), flight: runOf(bought(0), marked(10, 'depart')), unloading: runOf(bought(0), marked(10, 'depart'), marked(20, 'arrive')) }[phase];
      const next = nextMarkOf(active, T0 + 30);
      expect(cardMarks(phase).filter((mark) => mark === next)).toEqual([]);
    }
  });
});

describe('nextMarkOf', () => {
  it('has none without a run', () => {
    expect(nextMarkOf(null, T0)).toBeNull();
  });
  it('is the take-off while loading', () => {
    expect(nextMarkOf(runOf(bought(0)), T0 + 60)).toBe('depart');
  });
  it('is the arrival in flight', () => {
    expect(nextMarkOf(runOf(bought(0), marked(60, 'depart')), T0 + 120)).toBe('arrive');
  });
  it('is none while unloading: the sale ends it', () => {
    expect(nextMarkOf(runOf(bought(0), marked(60, 'depart'), marked(600, 'arrive')), T0 + 700)).toBeNull();
  });
  it('follows a second flight, and loading after a purchase at a stop', () => {
    const leg2 = runOf(bought(0), marked(60, 'depart'), marked(600, 'arrive'), marked(700, 'depart'));
    expect(nextMarkOf(leg2, T0 + 800)).toBe('arrive');
    const rebought = runOf(bought(0), marked(60, 'depart'), marked(600, 'arrive'), bought(900, TITA, 10, 1));
    expect(nextMarkOf(rebought, T0 + 1000)).toBe('depart');
  });
  it('is the take-off again once the target is somewhere else after the arrival: the stop before the next leg is loading', () => {
    // version 1.4: the player did not sell where it did not pay and set the next target; the window kept «ВЫГРУЗКА» and no button
    const stop = runOf(bought(0), marked(60, 'depart'), marked(600, 'arrive'));
    expect(nextMarkOf(stop, T0 + 700, true)).toBe('depart');
    expect(runPhases(stop.run, stop.events, T0 + 700, true)).toMatchObject({ phase: 'loading', sinceSec: 100, slots: { loading: 100, flight: null, unloading: null } });
    // an arrival with no take-off before it: the loading simply goes on
    const unmarked = runOf(bought(0), marked(600, 'arrive'));
    expect(runPhases(unmarked.run, unmarked.events, T0 + 700, true)).toMatchObject({ phase: 'loading', sinceSec: 700 });
    // in flight the target changes nothing
    expect(nextMarkOf(runOf(bought(0), marked(60, 'depart')), T0 + 120, true)).toBe('arrive');
  });
  it('knows the target is elsewhere when it is set and is not the place where the ship stands', () => {
    expect(goesOnward({ targetTerminalId: 7, currentTerminalId: 3 })).toBe(true);
    expect(goesOnward({ targetTerminalId: 3, currentTerminalId: 3 })).toBe(false);
    expect(goesOnward({ targetTerminalId: null, currentTerminalId: 3 })).toBe(false);
  });
});

describe('markRefusal', () => {
  it('refuses without a run', () => {
    expect(markRefusal('depart', null)).toBe('Нет активного рейса');
    expect(markRefusal('arrive', null)).toBe('Нет активного рейса');
  });
  it('takes the first mark of either kind', () => {
    expect(markRefusal('depart', runOf(bought(0)))).toBeNull();
    expect(markRefusal('arrive', runOf(bought(0)))).toBeNull();
  });
  it('refuses a mark that repeats the one before it', () => {
    expect(markRefusal('depart', runOf(bought(0), marked(60, 'depart')))).toBe('Взлёт уже отмечен');
    expect(markRefusal('arrive', runOf(bought(0), marked(60, 'depart'), marked(600, 'arrive')))).toBe('Прилёт уже отмечен');
  });
  it('takes the same kind again after the other one (several flights)', () => {
    expect(markRefusal('depart', runOf(bought(0), marked(60, 'depart'), marked(600, 'arrive')))).toBeNull();
    expect(markRefusal('arrive', runOf(bought(0), marked(60, 'depart'), marked(600, 'arrive'), marked(700, 'depart')))).toBeNull();
  });
});

describe('phaseCaps and phaseLine', () => {
  it('names the phases for the mini line in capitals', () => {
    expect([phaseCaps('loading'), phaseCaps('flight'), phaseCaps('unloading')]).toEqual(['ПОГРУЗКА', 'ПОЛЁТ', 'ВЫГРУЗКА']);
  });
  it('lists the phases of the leg: the finished ones fixed, the running one marked, the future ones as a dash', () => {
    expect(phaseLine(at(700, bought(0), marked(180, 'depart')))).toEqual({
      items: [
        { phase: 'loading', name: 'Погрузка', text: '3:00', state: 'done' },
        { phase: 'flight', name: 'Полёт', text: '8:40', state: 'running' },
        { phase: 'unloading', name: 'Выгрузка', text: '—', state: 'future' },
      ],
      total: '11:40',
    });
  });
  it('has only the running phase in the first minutes', () => {
    expect(phaseLine(at(30, bought(0))).items.map(i => [i.state, i.text])).toEqual([['running', '0:30'], ['future', '—'], ['future', '—']]);
  });
});
