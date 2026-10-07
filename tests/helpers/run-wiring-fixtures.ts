import type { Run, RunEvent, RunWithEvents } from '../../src/core/types';
import { ev, run } from './factories';
import { GOLD, TITA } from './strip-fixtures';

// ---------------------------------------------------------------------------
// Runs of task 15c, built event by event. Terminals come from the shared reference: 1=ARC-L1, 2=TDD Area 18,
// 3=CRU-L1. Commodities: Gold=10 (GOLD), Titanium=20 (TITA).
//
// Every time is a number of seconds from `T0`, the start of the run (the first purchase).
// ---------------------------------------------------------------------------

export { GOLD, TITA };

/** The moment the first purchase of a run was made. */
export const T0 = 1_000_000;

let nextId = 1;

/** A purchase `at` seconds after `T0`; terminal 1, price 6120 unless said. */
export function bought(at: number, commodityId = GOLD, scu = 96, price = 6120, terminalId = 1): RunEvent {
  return ev({ id: nextId++, runId: 1, ts: T0 + at, type: 'buy', terminalId, commodityId, scu, price });
}

/** A sale `at` seconds after `T0`; terminal 2. */
export function sold(at: number, commodityId = GOLD, scu = 96, price = 6900, terminalId = 2): RunEvent {
  return ev({ id: nextId++, runId: 1, ts: T0 + at, type: 'sell', terminalId, commodityId, scu, price });
}

/** The take-off or the arrival mark `at` seconds after `T0`. */
export function marked(at: number, type: 'depart' | 'arrive'): RunEvent {
  return ev({ id: nextId++, runId: 1, ts: T0 + at, type });
}

/** An active run that began at `T0`, with these events. */
export function runOf(...events: RunEvent[]): RunWithEvents {
  const r: Run = run({ id: 1, scuCapacity: 696, startedAt: T0 });
  return { run: r, events };
}
