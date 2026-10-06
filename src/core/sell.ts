import { estimate } from './estimate';
import { quantity, travelSec } from './routes';
import type { RouteCtx } from './routes';
import { distKey, pairKey } from './types';
import type { CargoLine, Estimate, Market } from './types';

const SEC_PER_HOUR = 3600;
const MAX_ALTERNATIVES = 3;

export interface SellHere {
  qty: number; profit: number; roi: number;
  /** Profit over the time already spent; `null` when no time has passed. */
  uecPerHour: number | null;
}

export interface SellAlternative {
  destId: number; sell: Estimate; qty: number; expectedProfit: number;
  /** The flight from here; `null` when neither my own median nor the distance is known. */
  extraSec: number | null;
  /** Rate of the whole run: the time already spent plus `extraSec`. `null` when `extraSec` is unknown. */
  expectedUecPerHour: number | null;
  /** The same at the low end of the price range. */
  worstUecPerHour: number | null;
}

const perHour = (profit: number, sec: number): number | null => (sec > 0 ? (profit * SEC_PER_HOUR) / sec : null);

/** The flight from `fromId` to `toId`: my own median for the pair, else the estimate from the distance, else unknown. */
function flightSec(ctx: RouteCtx, fromId: number, toId: number): number | null {
  const ownSec = ctx.ownMedian.get(pairKey(fromId, toId));
  if (ownSec !== undefined && ownSec > 0) return ownSec;
  const distanceGm = ctx.distances.get(distKey(fromId, toId)) ?? null;
  return distanceGm === null ? null : travelSec(distanceGm, ctx.settings.quantumSpeedKkms, ctx.settings.overheadMin);
}

/** Higher expected UEC per hour first, options without a flight time after all the others. */
function byExpectedRate(a: SellAlternative, b: SellAlternative): number {
  if (a.expectedUecPerHour === null || b.expectedUecPerHour === null) {
    return Number(a.expectedUecPerHour === null) - Number(b.expectedUecPerHour === null);
  }
  return b.expectedUecPerHour - a.expectedUecPerHour;
}

/**
 * One commodity in the hold, the player standing at `hereId` where the real price is `actualPrice`
 * and `elapsedSec` have gone since the run began. `here` is selling now (at most `hereDemand` SCU when
 * that is known). `alternatives` are up to three other terminals that buy the commodity, best expected
 * UEC per hour of the whole run first and those without a flight time last. The system filter and
 * terminals missing from the reference work as in `routesFrom`; an alternative may lose money, because
 * so may selling here.
 */
export function sellOrContinue(
  m: Market, line: CargoLine, hereId: number, actualPrice: number, hereDemand: number | null, elapsedSec: number, ctx: RouteCtx,
): { here: SellHere; alternatives: SellAlternative[] } {
  const elapsed = Math.max(0, elapsedSec);
  const margin = actualPrice - line.avgBuyPrice;

  const hereQty = quantity({ freeScu: line.scu, stockScu: null, demandScu: hereDemand, budget: null, buyPrice: line.avgBuyPrice });
  const hereProfit = hereQty * margin;
  const here: SellHere = {
    qty: hereQty, profit: hereProfit,
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

    const qty = quantity({ freeScu: line.scu, stockScu: null, demandScu: sell.scu, budget: null, buyPrice: line.avgBuyPrice });
    if (qty === 0) continue;
    const extraSec = flightSec(ctx, hereId, destId);
    const totalSec = extraSec === null ? null : elapsed + extraSec;
    const expectedProfit = qty * (sell.price - line.avgBuyPrice);
    found.push({
      destId, sell, qty, expectedProfit, extraSec,
      expectedUecPerHour: totalSec === null ? null : perHour(expectedProfit, totalSec),
      worstUecPerHour: totalSec === null ? null : perHour(qty * (sell.low - line.avgBuyPrice), totalSec),
    });
  }
  found.sort((a, b) => byExpectedRate(a, b) || b.expectedProfit - a.expectedProfit || a.destId - b.destId);
  return { here, alternatives: found.slice(0, MAX_ALTERNATIVES) };
}
