import { estimate } from './estimate';
import type { EstimateCtx } from './estimate';
import type { Estimate, Market } from './types';

// The goods of ONE pair of terminals (spec 14.19, item 16): what the origin sells and the destination buys, and the set
// of them that fills a hold. Unlike the search of trips (routes.ts) nothing is ranked against other places and nothing is
// cut to the best N: the player has chosen both ends himself.

export interface PairGood {
  commodityId: number;
  /** The purchase at the origin; `buy.scu` is its stock (`null`: unknown, 0: known empty). */
  buy: Estimate;
  /** The sale at the destination; what it already holds limits nothing (spec 14.5). */
  sell: Estimate;
  /** What one SCU brings, and the same over what it costs. Always positive: goods that would lose are not goods of the pair. */
  margin: number; roi: number;
}

/**
 * Every commodity that is bought at `originId` and sold at `destId` for more, the one that brings most per SCU first.
 * A purchase price of zero means "unknown", as everywhere. The same terminal at both ends has no goods.
 */
export function pairGoods(m: Market, originId: number, destId: number, ctx: EstimateCtx): PairGood[] {
  if (originId === destId) return [];
  const goods: PairGood[] = [];
  for (const commodityId of m.byTerminal.get(originId) ?? []) {
    const buy = estimate(m, originId, commodityId, 'buy', ctx);
    if (buy === null || !(buy.price > 0)) continue;
    const sell = estimate(m, destId, commodityId, 'sell', ctx);
    if (sell === null || sell.price <= buy.price) continue;
    const margin = sell.price - buy.price;
    goods.push({ commodityId, buy, sell, margin, roi: margin / buy.price });
  }
  return goods.sort((a, b) => b.margin - a.margin || a.commodityId - b.commodityId);
}

/** What stopped a commodity of the set from taking more: the room left in the hold, the stock of the origin, or the money left. */
export type PickLimit = 'space' | 'stock' | 'budget';

export interface HoldPick {
  commodityId: number; scu: number; invested: number; profit: number;
  limit: PickLimit;
  /** `false` when the stock of the origin is not known: the amount was counted without it. */
  stockKnown: boolean;
}

export interface HoldFill {
  /** The goods of the set in the order they were taken. */
  picks: HoldPick[];
  scu: number; invested: number; profit: number;
  /** `null` when nothing is taken. */
  roi: number | null;
  /** Why the hold is not full: the stock of the origin ran out, or the money did; `null` when it is full (or nothing fits at all). */
  short: 'stock' | 'budget' | null;
}

type Order = (a: PairGood, b: PairGood) => number;

const byMargin: Order = (a, b) => b.margin - a.margin || a.commodityId - b.commodityId;
const byRoi: Order = (a, b) => b.roi - a.roi || a.commodityId - b.commodityId;

/**
 * Takes the goods one after another in the given order, each as much as fits: the room left, its stock, the money left.
 * The goods whose stock is known go first, whatever the order: a commodity counted at the whole hold on a stock nobody
 * knows must not push out what is certainly there (the same rule as in the list of trips).
 */
function fillBy(goods: PairGood[], freeScu: number, budget: number | null, order: Order): HoldFill {
  const known = goods.filter((g) => g.buy.scu !== null).sort(order);
  const unknown = goods.filter((g) => g.buy.scu === null).sort(order);
  let space = Math.max(0, Math.floor(freeScu));
  let money = budget ?? Number.POSITIVE_INFINITY;
  const picks: HoldPick[] = [];
  let moneyRanOut = false;

  for (const g of [...known, ...unknown]) {
    if (space <= 0) break;
    const byStock = g.buy.scu ?? Number.POSITIVE_INFINITY;
    const byMoney = Math.floor(money / g.buy.price);
    const scu = Math.floor(Math.min(space, byStock, byMoney));
    if (byMoney < Math.min(space, byStock)) moneyRanOut = true;
    if (scu <= 0) continue;
    const limit: PickLimit = scu === space ? 'space' : byStock <= byMoney ? 'stock' : 'budget';
    picks.push({ commodityId: g.commodityId, scu, invested: scu * g.buy.price, profit: scu * g.margin, limit, stockKnown: g.buy.scu !== null });
    space -= scu;
    money -= scu * g.buy.price;
  }

  const scu = picks.reduce((sum, p) => sum + p.scu, 0);
  const invested = picks.reduce((sum, p) => sum + p.invested, 0);
  const profit = picks.reduce((sum, p) => sum + p.profit, 0);
  return {
    picks, scu, invested, profit,
    roi: invested > 0 ? profit / invested : null,
    short: space <= 0 || goods.length === 0 ? null : moneyRanOut ? 'budget' : 'stock',
  };
}

/**
 * The set of goods of a pair that fills `freeScu` of the hold within `budget` (`null`: no limit) and the stocks of the origin.
 * Two ways of taking are tried and the one that brings more is returned: the most per SCU first (right when the hold is what
 * runs out) and the most per UEC first (right when the money is). It is a good set, not a proof of the best one.
 */
export function fillHold(goods: PairGood[], freeScu: number, budget: number | null): HoldFill {
  const perScu = fillBy(goods, freeScu, budget, byMargin);
  if (budget === null) return perScu;
  const perUec = fillBy(goods, freeScu, budget, byRoi);
  return perUec.profit > perScu.profit ? perUec : perScu;
}
