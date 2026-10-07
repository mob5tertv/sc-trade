import { estimate } from '../../core/estimate';
import type { RouteCtx } from '../../core/routes';
import { cargoOf, runTotals } from '../../core/run';
import { flightSec } from '../../core/sell';
import type { CargoLine, Estimate, Market, RunEvent, RunWithEvents } from '../../core/types';

// The arithmetic of "what does this run earn per hour" that the screens of a run share: the mini line («≈ 273k/ч») and the
// expected result on the card of the run both take their number from `expectedRun`, so they cannot differ; the choice
// "sell here or fly on" counts the rate the same way (`ratePerHour`).

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

/**
 * The time a run is counted over, or `null` while it is not known (then there is no rate: the seconds that have passed
 * since the purchase say nothing about a flight that has not happened yet).
 *  - the flight is over (the last mark is the arrival), or there is nothing aboard to fly: the time that has passed;
 *  - else the flight to the target is what makes the run: at least what has passed and at least the flight, when that is
 *    known (`routeSec`); when it is not, nothing is known.
 */
export function runTimeSec(events: RunEvent[], elapsedSec: number, routeSec: number | null, cargoAboard: boolean): number | null {
  const lastMark = [...events].reverse().find((e) => e.type === 'depart' || e.type === 'arrive');
  if (lastMark?.type === 'arrive' || !cargoAboard) return elapsedSec;
  return routeSec === null ? null : Math.max(elapsedSec, routeSec);
}

/** UEC per hour of a profit over `sec` seconds; `null` when there is no time. */
export const ratePerHour = (profit: number, sec: number): number | null => (sec > 0 ? (profit * SEC_PER_HOUR) / sec : null);

/** The expected result of the whole run at its target. */
export interface ExpectedRun {
  /** What is put in, and what is already sold: facts. */
  invested: number;
  revenue: number;
  /** What is sold + what is aboard at the price of the target − what is put in. */
  profit: number;
  /** UEC per hour over the time of the whole run; `null` while that time is not known. */
  rate: number | null;
}

/**
 * The expected result of the whole run of the player, and the one place its rate is counted: the profit is everything
 * sold so far plus what is aboard at the price the TARGET is expected to pay, less what was put in; the time is
 * `runTimeSec`. It needs a price at the target for EVERYTHING aboard (a sum over part of the hold is not the result of the
 * run) and a target when anything is aboard: `null` otherwise. With the hold empty nothing is left to price, and the
 * result is the one in hand (`targetId` may then be `null`).
 */
export function expectedRun(active: RunWithEvents, m: Market, targetId: number | null, ctx: RouteCtx): ExpectedRun | null {
  const { run, events } = active;
  const { invested, revenue, durationSec } = runTotals(run, events, ctx.now);
  const cargo = cargoOf(events);

  let aboard = 0;
  let routeSec: number | null = null;
  if (cargo.length > 0) {
    if (targetId === null) return null;
    for (const { line, sell } of priceAtTarget(cargo, m, targetId, ctx)) {
      if (sell === null) return null;
      aboard += line.scu * sell.price;
    }
    routeSec = routeSecOf(events, targetId, ctx);
  }

  const profit = revenue + aboard - invested;
  const sec = runTimeSec(events, durationSec, routeSec, cargo.length > 0);
  return { invested, revenue, profit, rate: sec === null ? null : ratePerHour(profit, sec) };
}
