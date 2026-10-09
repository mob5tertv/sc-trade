import type { RunWithEvents } from '../../src/core/types';
import { ev, run } from './factories';

// ---------------------------------------------------------------------------
// Task 51: runs of several commodities between two terminals. Commodities of `ref` (factories.ts): Gold 10, Titanium 20, Tungsten 30;
// terminals 1 (where the cargo is bought), 2 and 3 (where it is sold).
//
//   MIX1  done  1→2  Gold + Titanium  1000–3000   invested 900 000, revenue 1 000 000: profit 100 000, ROI 0.1111, 2000 s
//   MIX2  done  1→2  Titanium + Gold  10000–11000 (bought and sold in the other order) invested 720 000, revenue 776 000: profit 56 000, ROI 0.0778, 1000 s
//   MIX3  done  1→2  Gold + Tungsten  20000–21200 invested 400 000, revenue 435 000: profit 35 000, ROI 0.0875, 1200 s
// ---------------------------------------------------------------------------

export const GOLD = 10;
export const TITA = 20;
export const TUNG = 30;

/** One commodity of the cargo: bought at `buy` per SCU, sold at `sell` per SCU. */
export interface MixedLeg { commodityId: number; scu: number; buy: number; sell: number }

export interface MixedSpec {
  id: number;
  startedAt: number;
  endedAt: number;
  legs: readonly MixedLeg[];
  from?: number;
  to?: number;
  status?: 'done' | 'lost';
  /** Seconds from the first purchase to the departure, and from the departure to the arrival; no marks when absent. */
  marks?: readonly [loadingSec: number, flightSec: number];
}

/**
 * A run that buys every leg at `from` (the first purchase at the start, the next ones a minute after each other) and sells every
 * leg at `to` at its end. The events come in the order of the legs; the ids are `id * 100 + n`.
 */
export function mixedRun(spec: MixedSpec): RunWithEvents {
  const { id, startedAt, endedAt, legs, from = 1, to = 2, status = 'done', marks } = spec;
  let n = 0;
  const event = (e: Parameters<typeof ev>[0]) => ev({ id: id * 100 + ++n, runId: id, ...e });
  const events = [
    ...legs.map((leg, i) => event({ ts: startedAt + i * 60, type: 'buy', terminalId: from, commodityId: leg.commodityId, scu: leg.scu, price: leg.buy })),
    ...(marks === undefined ? [] : [
      event({ ts: startedAt + marks[0], type: 'depart' }),
      event({ ts: startedAt + marks[0] + marks[1], type: 'arrive' }),
    ]),
    ...legs.map((leg, i) => event({ ts: endedAt - (legs.length - 1 - i) * 10, type: 'sell', terminalId: to, commodityId: leg.commodityId, scu: leg.scu, price: leg.sell })),
  ];
  return { run: run({ id, scuCapacity: 400, startedAt, endedAt, status }), events };
}

const gold = (scu: number, buy: number, sell: number): MixedLeg => ({ commodityId: GOLD, scu, buy, sell });
const tita = (scu: number, buy: number, sell: number): MixedLeg => ({ commodityId: TITA, scu, buy, sell });
const tung = (scu: number, buy: number, sell: number): MixedLeg => ({ commodityId: TUNG, scu, buy, sell });

export const MIX1 = mixedRun({ id: 11, startedAt: 1000, endedAt: 3000, legs: [gold(100, 5000, 5600), tita(50, 8000, 8800)] });
export const MIX2 = mixedRun({ id: 12, startedAt: 10_000, endedAt: 11_000, legs: [tita(40, 8000, 8400), gold(80, 5000, 5500)] });
export const MIX3 = mixedRun({ id: 13, startedAt: 20_000, endedAt: 21_200, legs: [gold(50, 5000, 5400), tung(50, 3000, 3300)] });
