import { estimate } from '../../core/estimate';
import type { RouteCtx } from '../../core/routes';
import { flightSec } from '../../core/sell';
import type { CargoLine, Estimate, Market, RunEvent } from '../../core/types';

// The arithmetic of "what does this run earn per hour" that the screens of a run share: the mini line («≈ 273k/ч»), the
// expected result on the card of the run and the choice "sell here or fly on" count the rate the same way, from here.

const SEC_PER_HOUR = 3600;

/** A line of the hold with what the target terminal pays for it; `null` when nothing is known there. */
export interface PricedLine { line: CargoLine; sell: Estimate | null }

/** What the target pays for each line of the hold (an estimate of the SALE side, the one the strip shows as «ждём»). */
export function priceAtTarget(cargo: CargoLine[], m: Market, targetId: number, ctx: RouteCtx): PricedLine[] {
  return cargo.map((line): PricedLine => ({ line, sell: estimate(m, targetId, line.commodityId, 'sell', ctx) }));
}

/**
 * The flight from the place of the first purchase to the target: my own median for the pair, else the estimate from the
 * distance; `null` when neither is known, or when nothing was bought yet.
 */
export function routeSecOf(events: RunEvent[], targetId: number, ctx: RouteCtx): number | null {
  const originId = events.find((e) => e.type === 'buy')?.terminalId ?? null;
  return originId === null ? null : flightSec(ctx, originId, targetId);
}

/** The time a run is counted over: at least what has passed and at least the flight to the target. */
export const wholeRunSec = (elapsedSec: number, routeSec: number | null): number => Math.max(elapsedSec, routeSec ?? 0);

/** UEC per hour of a profit over `sec` seconds; `null` when there is no time. */
export const ratePerHour = (profit: number, sec: number): number | null => (sec > 0 ? (profit * SEC_PER_HOUR) / sec : null);
