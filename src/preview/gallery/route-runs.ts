import type { RunEvent, RunWithEvents } from '../../core/types';

// The runs behind the table of routes of the gallery. The dataset of the gallery has only one finished route, which cannot show
// what a sort does; these are finished runs of other routes, with numbers that put the routes in a different order by every
// column (the rate, the number of runs, the time, the profit, the ROI). They are not written to the database: only the table of routes
// is made of them, by the real `routeStats` and `routeRows`, together with the runs of the dataset.

interface Leg {
  from: number; to: number; code: string; scu: number;
  /** The price per SCU the cargo was bought for and sold for. */
  buy: number; sell: number;
  /** From the purchase to the sale, in minutes. */
  minutes: number;
}

// Terminals: 1 ARC-L1, 2 CRU-L1, 3 HUR-L1, 4 MIC-L1, 5 Area 18, 6 Lorville, 9 Everus Harbor, 10 Baijini Point.
const LEGS: readonly Leg[] = [
  // Stims HUR-L1 → MIC-L1: three runs, the best rate (about 260k/h) and the most runs
  { from: 3, to: 4, code: 'STIM', scu: 300, buy: 2800, sell: 3150, minutes: 24.17 },
  { from: 3, to: 4, code: 'STIM', scu: 300, buy: 2810, sell: 3140, minutes: 26.58 },
  { from: 3, to: 4, code: 'STIM', scu: 300, buy: 2790, sell: 3150, minutes: 22.83 },
  // Tungsten Lorville → Area 18: two runs, a middle rate
  { from: 6, to: 5, code: 'TUNG', scu: 320, buy: 3600, sell: 3950, minutes: 29 },
  { from: 6, to: 5, code: 'TUNG', scu: 320, buy: 3620, sell: 3960, minutes: 31 },
  // Laranite ARC-L1 → HUR-L1: one run, the smallest ROI
  { from: 1, to: 3, code: 'LARA', scu: 400, buy: 3100, sell: 3200, minutes: 31 },
  // Diamond Everus Harbor → CRU-L1: one long run with the biggest profit
  { from: 9, to: 2, code: 'DIAM', scu: 180, buy: 7000, sell: 7900, minutes: 130 },
  // Agricultural supplies Baijini Point → Area 18: one run at a loss
  { from: 10, to: 5, code: 'AGRI', scu: 300, buy: 2650, sell: 2550, minutes: 14 },
];

/** Finished runs of `LEGS`, one after another before `now`. `commodityOf` gives the id of a commodity by its code. */
export function routeRuns(now: number, commodityOf: (code: string) => number): RunWithEvents[] {
  let eventId = 90_000;
  return LEGS.map((leg, index): RunWithEvents => {
    const endedAt = now - (index + 1) * 7200;
    const startedAt = Math.round(endedAt - leg.minutes * 60);
    const runId = 9000 + index;
    const commodityId = commodityOf(leg.code);
    const trade = (type: 'buy' | 'sell', ts: number, terminalId: number, price: number): RunEvent => (
      { id: eventId++, runId, ts, type, terminalId, commodityId, scu: leg.scu, price }
    );
    return {
      run: { id: runId, vehicleId: null, scuCapacity: leg.scu, startedAt, endedAt, status: 'done' },
      events: [trade('buy', startedAt, leg.from, leg.buy), trade('sell', endedAt, leg.to, leg.sell)],
    };
  });
}
