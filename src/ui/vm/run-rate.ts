import { estimate } from '../../core/estimate';
import type { RouteCtx } from '../../core/routes';
import { cargoOf, runTotals } from '../../core/run';
import type { CargoLine, Estimate, Market, RunWithEvents } from '../../core/types';

// The arithmetic of "what does this run bring" that the screens of a run share: the mini line («≈ +66 720») and the expected
// result on the card of the run both take their number from `expectedRun`, so they cannot differ. A rate per hour is no
// longer shown for a run (plan item 17: the profit and the time, which the timers of the run already say); only the choice
// "sell here or fly on" of «Подробные расчёты» still counts one (`ratePerHour`).

const SEC_PER_HOUR = 3600;

/** A line of the hold with what the target terminal pays for it; `null` when nothing is known there. */
export interface PricedLine { line: CargoLine; sell: Estimate | null }

/** What the target pays for each line of the hold (an estimate of the SALE side, the one the strip shows as «ждём»). */
export function priceAtTarget(cargo: CargoLine[], m: Market, targetId: number, ctx: RouteCtx): PricedLine[] {
  return cargo.map((line): PricedLine => ({ line, sell: estimate(m, targetId, line.commodityId, 'sell', ctx) }));
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
}

/**
 * The expected result of the whole run of the player: the profit is everything sold so far plus what is aboard at the
 * price the TARGET is expected to pay, less what was put in. It needs a price at the target for EVERYTHING aboard (a sum over part of the hold is not the result of the
 * run) and a target when anything is aboard: `null` otherwise. With the hold empty nothing is left to price, and the
 * result is the one in hand (`targetId` may then be `null`).
 */
export function expectedRun(active: RunWithEvents, m: Market, targetId: number | null, ctx: RouteCtx): ExpectedRun | null {
  const { run, events } = active;
  const { invested, revenue } = runTotals(run, events, ctx.now);
  const cargo = cargoOf(events);

  let aboard = 0;
  if (cargo.length > 0) {
    if (targetId === null) return null;
    for (const { line, sell } of priceAtTarget(cargo, m, targetId, ctx)) {
      if (sell === null) return null;
      aboard += line.scu * sell.price;
    }
  }

  return { invested, revenue, profit: revenue + aboard - invested };
}
