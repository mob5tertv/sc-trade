import type { RunWithEvents } from '../../src/core/types';
import type { TradeInput } from '../../src/data/trade';
import { ev, run } from './factories';

// ---------------------------------------------------------------------------
// Task 32: a sale of goods that were never bought through the application. Terminal 2 is the buyer; the goods are
// Titanium (20), a commodity the Gold runs of `trade-fixtures` never carry.
// ---------------------------------------------------------------------------

export const TITA = 20;

/** A sale of Titanium at terminal 2 that no purchase stands behind. */
export const incomeIn = (scu: number, price: number, over: Partial<TradeInput> = {}): TradeInput => (
  { terminalId: 2, commodityId: TITA, scu, price, ...over }
);

/**
 * The run an income sale leaves, as the history reads it: finished at the moment of the sale, one sale event and no purchase.
 * `at` is the time of the sale, `id` the run id (the event gets `id * 10`).
 */
export function incomeRun(id: number, at: number, scu: number, price: number, status: 'done' | 'lost' = 'done'): RunWithEvents {
  return {
    run: run({ id, scuCapacity: 696, startedAt: at, endedAt: at, status }),
    events: [ev({ id: id * 10, runId: id, ts: at, type: 'sell', terminalId: 2, commodityId: TITA, scu, price })],
  };
}
