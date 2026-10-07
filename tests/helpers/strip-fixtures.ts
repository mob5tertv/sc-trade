import { buildMarket } from '../../src/core/market';
import type { RouteCtx } from '../../src/core/routes';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import type { Settings } from '../../src/core/settings';
import { distKey } from '../../src/core/types';
import type { Market, RunWithEvents } from '../../src/core/types';
import { ev, obs, px, ref, run } from './factories';
import { previousOf } from './previous-price-fixtures';
import { quantitiesOf, readingsOf } from './quantity-fixtures';

// ---------------------------------------------------------------------------
// The live-strip scenario of task 15. Terminals come from the shared reference: 1=ARC-L1, 2=TDD Area 18.
// Commodities: Gold=10 (GOLD), Titanium=20 (TITA).
//
//   active run   96 SCU Gold bought at 6120 at terminal 1, 872 s ago
//   market       terminal 2 buys Gold: UEX SELL 6900 (week 6400–7100); nothing else
//   distances    1–2 59 Gm, so the whole flight is 12 min + 59 Gm at 200 kkm/s = 1015 s
//   mixedRun     the same Gold plus 40 SCU Titanium bought at 2500 at terminal 1
// ---------------------------------------------------------------------------

export const GOLD = 10;
export const TITA = 20;
export const NOW = 1_000_000;

export const s: Settings = { ...DEFAULT_SETTINGS, vehicleId: 7, scuCapacity: 696, starSystemId: 68 };

export const ctx: RouteCtx = {
  now: NOW,
  thresholds: { hotMin: 60, warmMin: 180, coolingMin: 240 },
  serverChangedAt: null,
  settings: { starSystemId: 68, budget: null, quantumSpeedKkms: 200, overheadMin: 12, overheadEmptyMin: 5, topN: 5, sort: 'uecPerHour' },
  freeScu: 696,
  terminals: ref.terminals,
  distances: new Map<string, number | null>([[distKey(1, 2), 59]]),
  ownMedian: new Map<string, number>(),
};

/** The UEX SELL side with the weekly range around `price`. */
export function withUexSell(m: Market, terminalId: number, commodityId: number, price: number, low = price, high = price): Market {
  const row = px(terminalId, commodityId, { sell: { last: price, avgWeek: price, minWeek: low, maxWeek: high }, dateModified: NOW - 3600 });
  return buildMarket([...m.uex.values(), row], [...m.own.values()], undefined, quantitiesOf(m), previousOf(m));
}

export const market: Market = withUexSell(buildMarket([], []), 2, GOLD, 6900, 6400, 7100);

/**
 * Copy of the market with my own SELL observation made at `ts`; `scu` is the buyer's inventory recorded with it (0 is
 * "out of stock"). An observation without a quantity leaves the reading of the stock as it was.
 */
export function withOwnSell(m: Market, terminalId: number, commodityId: number, price: number, ts: number, scu: number | null = null): Market {
  const next = obs({ id: m.own.size + 1, ts, terminalId, commodityId, side: 'sell', price, scu });
  return buildMarket([...m.uex.values()], [...m.own.values(), next], undefined, [...quantitiesOf(m), ...readingsOf(next)], previousOf(m));
}

const buy = (id: number, commodityId: number, scu: number, price: number) => (
  ev({ id, runId: 1, ts: NOW - 872, type: 'buy', terminalId: 1, commodityId, scu, price })
);

export const active: RunWithEvents = {
  run: run({ id: 1, scuCapacity: 696, startedAt: NOW - 872 }),
  events: [buy(1, GOLD, 96, 6120)],
};

export const mixedRun: RunWithEvents = {
  run: active.run,
  events: [buy(1, GOLD, 96, 6120), buy(2, TITA, 40, 2500)],
};
