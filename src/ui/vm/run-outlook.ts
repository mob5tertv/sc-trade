import { formatCompact, formatUec } from '../../core/format';
import type { RouteCtx } from '../../core/routes';
import { cargoOf, runTotals } from '../../core/run';
import type { Settings } from '../../core/settings';
import type { Market, Reference, RunWithEvents } from '../../core/types';
import { formatRoi } from './route-rows';
import { priceAtTarget, ratePerHour, routeSecOf, wholeRunSec } from './run-rate';

// What the card of a run that is still going says about its money. A run that has not ended is not a loss: what is put in and
// what is already sold are facts; profit, ROI and rate are the EXPECTED result of the whole run (marked with «≈»), from what
// the target is expected to pay for what is still aboard. The rate is counted as the mini line counts it (`run-rate.ts`).

const NONE = '—';
const NO_TARGET = 'выбери цель';
const NO_PRICE = 'нет цены в точке цели';

export interface ExpectedResult {
  /** '≈ 74 880'. */
  profit: string;
  /** The expected profit is negative: the only case the number is red. */
  profitLoss: boolean;
  /** '≈ 13%', through `formatRoi` as the lists have it; a dash when nothing was invested. */
  roi: string;
  /** '≈ 266k', without the unit (the caption says UEC/ч); a dash when no time is known yet. */
  rate: string;
}

export interface RunOutlook {
  /** What is put in, and what is already sold: facts. */
  invested: string;
  revenue: string;
  /** The expected result of the whole run; `null` when it cannot be said (the card shows dashes and `why`). */
  expected: ExpectedResult | null;
  /** Why `expected` is `null`, for the tooltip of the dashes; `null` otherwise. */
  why: string | null;
}

const approx = (text: string): string => `≈ ${text}`;

/**
 * Expected profit = what is sold so far + what is aboard at the price the TARGET is expected to pay − what is put in.
 * It needs a target and a price there for EVERYTHING aboard: a sum over part of the hold is not the result of the run.
 * With the hold empty nothing is left to price, and the result is the one in hand.
 */
export function runOutlook(active: RunWithEvents, m: Market, ref: Reference, s: Settings, ctx: RouteCtx): RunOutlook {
  const { run, events } = active;
  const { invested, revenue, durationSec } = runTotals(run, events, ctx.now);
  const facts = { invested: formatUec(invested), revenue: formatUec(revenue) };

  const cargo = cargoOf(events);
  let aboard = 0;
  let routeSec: number | null = null;
  if (cargo.length > 0) {
    const target = s.targetTerminalId === null ? undefined : ref.terminals.get(s.targetTerminalId);
    if (!target) return { ...facts, expected: null, why: NO_TARGET };
    for (const { line, sell } of priceAtTarget(cargo, m, target.id, ctx)) {
      if (sell === null) return { ...facts, expected: null, why: NO_PRICE };
      aboard += line.scu * sell.price;
    }
    routeSec = routeSecOf(events, target.id, ctx);
  }

  const profit = revenue + aboard - invested;
  const rate = ratePerHour(profit, wholeRunSec(durationSec, routeSec));
  return {
    ...facts,
    expected: {
      profit: approx(formatUec(profit)),
      profitLoss: profit < 0,
      roi: invested > 0 ? approx(formatRoi(profit / invested)) : NONE,
      rate: rate === null ? NONE : approx(formatCompact(rate)),
    },
    why: null,
  };
}
