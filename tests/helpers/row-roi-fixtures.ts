import { buildMarket } from '../../src/core/market';
import type { RouteCtx, RouteSettings } from '../../src/core/routes';
import { distKey } from '../../src/core/types';
import type { Market, Observation } from '../../src/core/types';
import { obs, px, ref } from './factories';

// A small world for the ROI of a table row. Terminals come from the shared reference (`ref`): HERE = 1 (system 68),
// 2, 3, 5 and 6 are in system 68, 4 is in system 99. Commodities: Gold 10, Titanium 20, Tungsten 30.
// `settings.topN` is 1 on purpose: the best ROI of every commodity must not be cut by the number of options.

export const NOW = 1_000_000;
export const HERE = 1;
export const GOLD = 10;
export const TITA = 20;
export const TUNG = 30;

/** What a terminal asks (`buy`: it sells to the player) and pays (`sell`: it buys from him) for a commodity; 0 or missing: nothing. */
export interface Quote { terminalId: number; commodityId: number; buy?: number; sell?: number; scuBuy?: number }

const week = (price: number | undefined): { last: number; avgWeek: number; minWeek: number; maxWeek: number } => (
  { last: price ?? 0, avgWeek: price ?? 0, minWeek: price ?? 0, maxWeek: price ?? 0 }
);

/** UEX rows, an hour old, and the observations of the player on top of them. */
export function marketOf(quotes: Quote[], own: Observation[] = []): Market {
  return buildMarket(
    quotes.map((q) => px(q.terminalId, q.commodityId, { buy: week(q.buy), sell: week(q.sell), scuBuy: q.scuBuy ?? 0, dateModified: NOW - 3600 })),
    own,
  );
}

/** A price of the player's own, two minutes old (hot). `scu` is the stock reading that goes with it. */
export function ownPrice(terminalId: number, commodityId: number, side: 'buy' | 'sell', price: number, scu: number | null = null): Observation {
  return obs({ id: 1 + terminalId * 100 + commodityId, ts: NOW - 120, terminalId, commodityId, side, price, scu });
}

const settings: RouteSettings = {
  starSystemId: 68, budget: null, quantumSpeedKkms: 200, overheadMin: 12, overheadEmptyMin: 5, topN: 1, sort: 'profit',
};

export const ctx: RouteCtx = {
  now: NOW,
  thresholds: { hotMin: 60, warmMin: 180, coolingMin: 240 },
  serverChangedAt: null,
  settings,
  freeScu: 100,
  terminals: ref.terminals,
  distances: new Map(),
  ownMedian: new Map(),
};

export const withSettings = (part: Partial<RouteSettings>, base: RouteCtx = ctx): RouteCtx => ({ ...base, settings: { ...base.settings, ...part } });
export const withFreeScu = (freeScu: number, base: RouteCtx = ctx): RouteCtx => ({ ...base, freeScu });

/** Two origins of Gold at different distances from HERE, in Gm: terminal 3 is a short flight away, terminal 2 a very long one. */
export const NEAR = 3;
export const FAR = 2;
export const withDistances = (base: RouteCtx = ctx): RouteCtx => ({
  ...base,
  distances: new Map([[distKey(HERE, NEAR), 1], [distKey(HERE, FAR), 500]]),
});

/**
 * Gold is sold at 2 (6000), 3 (6400) and 5 (7000) and bought here at 8000: from 2 the trip pays 33,3 %.
 * Titanium is sold at 3 (4000) and bought here at 5000: 25 %. Tungsten is sold at 2 (3500) and bought here at 3000: no trip.
 * Here also SELLS Gold at 6000 (to 2 at 7500 and to 3 at 7000), Titanium at 4000 (to 3 at 4400) and Tungsten at 3000
 * (to 2 at 2800): the best trips from here pay 25 %, 10 % and none.
 */
export const quotes: Quote[] = [
  { terminalId: HERE, commodityId: GOLD, buy: 6000, sell: 8000, scuBuy: 500 },
  { terminalId: HERE, commodityId: TITA, buy: 4000, sell: 5000, scuBuy: 500 },
  { terminalId: HERE, commodityId: TUNG, buy: 3000, sell: 3000, scuBuy: 500 },
  { terminalId: 2, commodityId: GOLD, buy: 6000, sell: 7500, scuBuy: 500 },
  { terminalId: 3, commodityId: GOLD, buy: 6400, sell: 7000, scuBuy: 500 },
  { terminalId: 5, commodityId: GOLD, buy: 7000, scuBuy: 500 },
  { terminalId: 3, commodityId: TITA, buy: 4000, sell: 4400, scuBuy: 500 },
  { terminalId: 2, commodityId: TUNG, buy: 3500, sell: 2800, scuBuy: 500 },
];
