import { estimate } from './estimate';
import { travelSec } from './routes';
import type { RouteCtx } from './routes';
import { distKey, pairKey } from './types';
import type { CargoLine, Estimate, Market } from './types';

const SEC_PER_HOUR = 3600;
const MAX_ALTERNATIVES = 3;

export interface SellHere {
  /** The whole cargo line: what a terminal reports holding already never limits a sale. */
  qty: number; profit: number; roi: number;
  /** Profit over the time already spent; `null` when no time has passed. */
  uecPerHour: number | null;
}

export interface SellAlternative {
  /** `sell.scu` is what the buyer already holds (information only); `qty` is the whole cargo line. */
  destId: number; sell: Estimate; qty: number;
  /** The profit of the whole run when the cargo is sold there. */
  expectedProfit: number;
  /** What flying on adds to selling here: the cargo at the price there less the same cargo at the price here. Negative when it pays less. */
  extraProfit: number;
  /**
   * The same at the low end of the price range there. `null` when the price there is one number (a price of my own, a single
   * report of UEX): it has no low end, and repeating the expectation would claim more than is known.
   */
  extraProfitLow: number | null;
  /** The way there from here, flight and unloading (`legSec`); `null` when neither my own runs nor the distance tell. */
  extraSec: number | null;
  /** Where `extraSec` comes from; `null` without a time. */
  extraSource: 'own' | 'estimate' | null;
  /** `extraProfit` per hour of `extraSec`: what the further leg alone earns. `null` when `extraSec` is unknown. */
  extraUecPerHour: number | null;
}

const perHour = (profit: number, sec: number): number | null => (sec > 0 ? (profit * SEC_PER_HOUR) / sec : null);

/** The flight from `fromId` to `toId`: my own median for the pair, else the estimate from the distance, else unknown. */
export function flightSec(ctx: RouteCtx, fromId: number, toId: number): number | null {
  const ownSec = ctx.ownMedian.get(pairKey(fromId, toId));
  if (ownSec !== undefined && ownSec > 0) return ownSec;
  const distanceGm = ctx.distances.get(distKey(fromId, toId)) ?? null;
  return distanceGm === null ? null : travelSec(distanceGm, ctx.settings.quantumSpeedKkms, ctx.settings.overheadMin);
}

/**
 * The way from `fromId` to `toId` with the cargo already aboard: flight and unloading by my own runs of the pair (`ctx.ownLeg`),
 * else the estimate from the distance, else unknown. The median of whole runs (`ctx.ownMedian`) is not taken: it holds the
 * loading too, which is behind the player by now.
 */
export function legSec(ctx: RouteCtx, fromId: number, toId: number): { sec: number | null; source: SellAlternative['extraSource'] } {
  const ownSec = ctx.ownLeg?.get(pairKey(fromId, toId));
  if (ownSec !== undefined && ownSec > 0) return { sec: ownSec, source: 'own' };
  const distanceGm = ctx.distances.get(distKey(fromId, toId)) ?? null;
  if (distanceGm === null) return { sec: null, source: null };
  return { sec: travelSec(distanceGm, ctx.settings.quantumSpeedKkms, ctx.settings.overheadMin), source: 'estimate' };
}

/** 0: pays more and the time is known; 1: pays more, time unknown; 2: pays no more than here. */
const gainRank = (a: SellAlternative): number => (a.extraProfit <= 0 ? 2 : a.extraUecPerHour === null ? 1 : 0);

/**
 * The places worth the flight first, by what the further leg earns per hour; then those that pay more but have no time, by what
 * they add; then those that pay no more than here, the least bad first.
 */
function byGain(a: SellAlternative, b: SellAlternative): number {
  const rank = gainRank(a) - gainRank(b);
  if (rank !== 0) return rank;
  if (a.extraUecPerHour !== null && b.extraUecPerHour !== null && gainRank(a) === 0) {
    return b.extraUecPerHour - a.extraUecPerHour || b.extraProfit - a.extraProfit;
  }
  return b.extraProfit - a.extraProfit;
}

/**
 * One commodity in the hold, the player standing at `hereId` where the real price is `actualPrice`
 * and `elapsedSec` have gone since the run began. `here` is selling the whole cargo now. `alternatives`
 * are up to three other terminals that buy the commodity, each for the whole cargo too: the quantity shown at a
 * terminal is what it already holds, not what it would buy (spec 14.5), so it limits no sale.
 *
 * The choice is the marginal one (spec 14.19): the time already spent is spent whatever the player does, so an alternative
 * is judged by what it ADDS to selling here (`extraProfit`) over the time the way there takes (`extraSec`), and the list is
 * ordered by that rate (`byGain`). The terminal that adds the most is always among the three, last when the rates left it out. The system filter and terminals missing from the reference work as in `routesFrom`;
 * an alternative may pay less than here, and the whole run may lose money, because so may selling here.
 */
export function sellOrContinue(
  m: Market, line: CargoLine, hereId: number, actualPrice: number, elapsedSec: number, ctx: RouteCtx,
): { here: SellHere; alternatives: SellAlternative[] } {
  const elapsed = Math.max(0, elapsedSec);
  const margin = actualPrice - line.avgBuyPrice;

  const hereProfit = line.scu * margin;
  const here: SellHere = {
    qty: line.scu, profit: hereProfit,
    roi: line.avgBuyPrice > 0 ? margin / line.avgBuyPrice : 0,
    uecPerHour: perHour(hereProfit, elapsed),
  };

  const { starSystemId } = ctx.settings;
  const hereTerminal = ctx.terminals.get(hereId);
  const found: SellAlternative[] = [];
  for (const destId of m.byCommodity.get(line.commodityId) ?? []) {
    if (destId === hereId) continue;
    const dest = ctx.terminals.get(destId);
    if (!hereTerminal || !dest) continue;
    if (starSystemId !== null && (hereTerminal.starSystemId !== starSystemId || dest.starSystemId !== starSystemId)) continue;
    const sell = estimate(m, destId, line.commodityId, 'sell', ctx);
    if (!sell) continue;

    const qty = line.scu;
    const { sec: extraSec, source: extraSource } = legSec(ctx, hereId, destId);
    const extraProfit = qty * (sell.price - actualPrice);
    found.push({
      destId, sell, qty,
      expectedProfit: qty * (sell.price - line.avgBuyPrice),
      extraProfit,
      extraProfitLow: sell.low < sell.price ? qty * (sell.low - actualPrice) : null,
      extraSec, extraSource,
      extraUecPerHour: extraSec === null ? null : perHour(extraProfit, extraSec),
    });
  }
  found.sort((a, b) => byGain(a, b) || a.destId - b.destId);
  const top = found.slice(0, MAX_ALTERNATIVES);
  // the place that adds the MOST is never cut off by three better rates: a far terminal, or one with no known way, may pay much
  // more than three near ones, and the player is the one to decide whether the way is worth it
  const richest = found.reduce<SellAlternative | null>((best, a) => (a.extraProfit > 0 && (best === null || a.extraProfit > best.extraProfit) ? a : best), null);
  if (richest !== null && !top.includes(richest)) top[top.length - 1] = richest;
  return { here, alternatives: top };
}
