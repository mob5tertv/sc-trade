import type { RunWithEvents } from '../../src/core/types';
import { ev, run } from './factories';

// ---------------------------------------------------------------------------
// The finished-trade history of task 16. Gold=10; terminals 1 (origin), 2 and 3 (destinations).
//
//   R1  done    1→2 Gold  1000–3400   bought 400 SCU for 2 440 000, sold for 2 785 000: profit 345 000, ROI 0.14139
//   R2  done    1→2 Gold  10000–11800 bought 200 SCU for 2 000 000, sold for 2 200 000: profit 200 000, ROI 0.1
//   R3  done    1→3 Gold  20000–21000 bought 100 SCU for   500 000, sold for   550 000: profit  50 000
//   R4  lost    1→? Gold  12000–12500 bought 20 SCU for     100 000, never sold: profit -100 000
//   R5  done    sells at two terminals (2 and 3): not a simple route
//   R6  active  1→2 Gold  50000–…     bought and sold, but not finished yet
// ---------------------------------------------------------------------------

const buy = (id: number, runId: number, ts: number, scu: number, price: number) => (
  ev({ id, runId, ts, type: 'buy', terminalId: 1, commodityId: 10, scu, price })
);
const sell = (id: number, runId: number, ts: number, terminalId: number, scu: number, price: number) => (
  ev({ id, runId, ts, type: 'sell', terminalId, commodityId: 10, scu, price })
);

export const R1: RunWithEvents = {
  run: run({ id: 1, scuCapacity: 400, startedAt: 1000, endedAt: 3400, status: 'done' }),
  events: [buy(11, 1, 1000, 400, 6100), sell(12, 1, 3400, 2, 200, 7000), sell(13, 1, 3400, 2, 200, 6925)],
};

export const R2: RunWithEvents = {
  run: run({ id: 2, scuCapacity: 200, startedAt: 10000, endedAt: 11800, status: 'done' }),
  events: [buy(21, 2, 10000, 200, 10000), sell(22, 2, 11800, 2, 200, 11000)],
};

export const R3: RunWithEvents = {
  run: run({ id: 3, scuCapacity: 100, startedAt: 20000, endedAt: 21000, status: 'done' }),
  events: [buy(31, 3, 20000, 100, 5000), sell(32, 3, 21000, 3, 100, 5500)],
};

export const R4: RunWithEvents = {
  run: run({ id: 4, scuCapacity: 20, startedAt: 12000, endedAt: 12500, status: 'lost' }),
  events: [buy(41, 4, 12000, 20, 5000)],
};

export const R5: RunWithEvents = {
  run: run({ id: 5, scuCapacity: 100, startedAt: 40000, endedAt: 41000, status: 'done' }),
  events: [buy(51, 5, 40000, 100, 5000), sell(52, 5, 41000, 2, 50, 5600), sell(53, 5, 41000, 3, 50, 5600)],
};

export const R6: RunWithEvents = {
  run: run({ id: 6, scuCapacity: 100, startedAt: 50000, endedAt: null, status: 'active' }),
  events: [buy(61, 6, 50000, 100, 5000), sell(62, 6, 50500, 2, 100, 5600)],
};

/**
 * Copy of a run with a departure `loadingSec` after its start (the first purchase) and an arrival
 * `flightSec` after that; the remaining `unloadingSec` is the time up to the last sale.
 * The caller keeps the three numbers consistent with the run's last sale.
 */
export function withMarks(r: RunWithEvents, loadingSec: number, flightSec: number, unloadingSec: number): RunWithEvents {
  const base = r.run.startedAt;
  const nextId = Math.max(...r.events.map(e => e.id)) + 1;
  const lastSell = Math.max(...r.events.filter(e => e.type === 'sell').map(e => e.ts));
  if (base + loadingSec + flightSec + unloadingSec !== lastSell) throw new Error('withMarks: phases do not add up to the last sale');
  return {
    run: r.run,
    events: [
      ...r.events,
      ev({ id: nextId, runId: r.run.id, ts: base + loadingSec, type: 'depart' }),
      ev({ id: nextId + 1, runId: r.run.id, ts: base + loadingSec + flightSec, type: 'arrive' }),
    ],
  };
}
