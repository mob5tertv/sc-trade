import { formatCompact, formatUec } from '../../core/format';
import type { RouteCtx } from '../../core/routes';
import { cargoOf, runTotals } from '../../core/run';
import type { Settings } from '../../core/settings';
import type { Market, Reference, RunWithEvents } from '../../core/types';
import { formatRoi } from './route-rows';
import { expectedRun } from './run-rate';

// What the card of a run that is still going says about its money. A run that has not ended is not a loss: what is put in and
// what is already sold are facts; profit, ROI and rate are the EXPECTED result of the whole run (marked with «≈»), from what
// the target is expected to pay for what is still aboard. The rate is THE number of the mini line (`expectedRun` in `run-rate.ts`).

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
 * Expected profit = what is sold so far + what is aboard at the price the TARGET is expected to pay − what is put in
 * (`expectedRun`, which the mini line asks too). It needs a target and a price there for EVERYTHING aboard: a sum over
 * part of the hold is not the result of the run. With the hold empty nothing is left to price, and the result is the one
 * in hand. The profit and the ROI are shown whenever they can be counted; the rate only when the time of the run is known.
 */
export function runOutlook(active: RunWithEvents, m: Market, ref: Reference, s: Settings, ctx: RouteCtx): RunOutlook {
  const { invested, revenue } = runTotals(active.run, active.events, ctx.now);
  const facts = { invested: formatUec(invested), revenue: formatUec(revenue) };

  const target = s.targetTerminalId === null ? undefined : ref.terminals.get(s.targetTerminalId);
  if (!target && cargoOf(active.events).length > 0) return { ...facts, expected: null, why: NO_TARGET };
  const result = expectedRun(active, m, target?.id ?? null, ctx);
  if (result === null) return { ...facts, expected: null, why: NO_PRICE };

  return {
    ...facts,
    expected: {
      profit: approx(formatUec(result.profit)),
      profitLoss: result.profit < 0,
      roi: invested > 0 ? approx(formatRoi(result.profit / invested)) : NONE,
      rate: result.rate === null ? NONE : approx(formatCompact(result.rate)),
    },
    why: null,
  };
}
