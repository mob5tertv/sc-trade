import { sessions, type Session } from '../../src/core/stats';
import type { RunWithEvents } from '../../src/core/types';
import { ev, run } from './factories';

// ---------------------------------------------------------------------------
// The scenarios of tasks 30 and 33: the session of the play that is going now.
// Gold = 10; the runs are 100 SCU bought at terminal 1 for 5 000 and sold (or not) at terminal 2.
// ---------------------------------------------------------------------------

/** The clock of these scenarios, Unix seconds. */
export const CLOCK = 1_800_000_000;
export const MINUTE = 60;
export const HOUR = 3600;

const GOLD = 10;
const SCU = 100;
const BUY_PRICE = 5000;

/** A run that is done: bought at `start`, sold half an hour later, `profit` UEC richer. */
export function doneRun(id: number, start: number, profit: number): RunWithEvents {
  return {
    run: run({ id, scuCapacity: SCU, startedAt: start, endedAt: start + 30 * MINUTE, status: 'done' }),
    events: [
      ev({ id: id * 10 + 1, runId: id, ts: start, type: 'buy', terminalId: 1, commodityId: GOLD, scu: SCU, price: BUY_PRICE }),
      ev({ id: id * 10 + 2, runId: id, ts: start + 30 * MINUTE, type: 'sell', terminalId: 2, commodityId: GOLD, scu: SCU, price: BUY_PRICE + profit / SCU }),
    ],
  };
}

/** A run whose cargo was lost: only the purchase, so the loss is what was paid (500 000). */
export function lostRun(id: number, start: number): RunWithEvents {
  return {
    run: run({ id, scuCapacity: SCU, startedAt: start, endedAt: start + 20 * MINUTE, status: 'lost' }),
    events: [ev({ id: id * 10 + 1, runId: id, ts: start, type: 'buy', terminalId: 1, commodityId: GOLD, scu: SCU, price: BUY_PRICE })],
  };
}

/** A run that has not ended: it is bought, and nothing is sold yet. */
export function goingRun(id: number, start: number): RunWithEvents {
  return {
    run: run({ id, scuCapacity: SCU, startedAt: start, endedAt: null, status: 'active' }),
    events: [ev({ id: id * 10 + 1, runId: id, ts: start, type: 'buy', terminalId: 1, commodityId: GOLD, scu: SCU, price: BUY_PRICE })],
  };
}

/** The sessions the statistics hold: cut from the times of the records, the newest first. */
export const sessionsOf = (recordTs: number[], runs: RunWithEvents[]): Session[] => sessions(recordTs, runs);

/**
 * The latest session of a play that began three hours before `CLOCK` and last wrote something `lastAgoSec` before
 * it; one run of `profit` is done in it (a negative `profit` is a run that sold below what it paid).
 */
export function sessionEndedAgo(lastAgoSec: number, profit = 1_240_000): Session[] {
  const start = CLOCK - 3 * HOUR - lastAgoSec;
  const records = [start, start + HOUR, start + 2 * HOUR, CLOCK - lastAgoSec];
  return sessionsOf(records, [doneRun(1, start + 10 * MINUTE, profit)]);
}
