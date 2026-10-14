import { formatUec } from '../../core/format';
import type { RouteCtx } from '../../core/routes';
import { cargoOf, runTotals } from '../../core/run';
import type { Settings } from '../../core/settings';
import type { Market, Reference, RunWithEvents } from '../../core/types';
import { formatRoi } from './route-rows';
import { expectedRun } from './run-rate';
import { tr } from '../../i18n';

// What the card of a run that is still going says about its money. A run that has not ended is not a loss: what is put in and
// what is already sold are facts; profit and ROI are the EXPECTED result of the whole run (marked with «≈»), from what
// the target is expected to pay for what is still aboard. The profit is THE number of the mini line (`expectedRun` in `run-rate.ts`).

const NONE = '—';
const NO_TARGET = (): string => tr('выбери цель');
const NO_PRICE = (): string => tr('нет цены в точке цели');

export interface ExpectedResult {
  /** '≈ 74 880'. */
  profit: string;
  /** The expected profit is negative: the only case the number is red. */
  profitLoss: boolean;
  /** '≈ 13%', through `formatRoi` as the lists have it; a dash when nothing was invested. */
  roi: string;
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
 * The expected profit of a run as the screens write it, the one place that does: '≈ 74 880' on the card of the run; the mini line asks for
 * the sign of a gain too ('≈ +74 880': it stands among other numbers of the line). A loss carries the minus of its number, a zero none.
 */
export function expectedProfitText(profit: number, signed = false): string {
  const text = formatUec(profit);
  return approx(signed && Math.round(profit) > 0 ? `+${text}` : text);
}

/**
 * Where the cargo aboard is expected to be sold: the target, or, with a target in two steps (spec 14.19, item 7), its SECOND step. The
 * first step is where the next cargo is bought; a cargo already aboard when such a target was chosen goes on to the sale (known limit of
 * 1.2, fixed in 1.3: the mini line priced it at the place of the purchase until something was bought there).
 */
export function saleTerminalId(s: Settings, ref: Reference): number | null {
  if (s.targetThenId !== null && ref.terminals.has(s.targetThenId)) return s.targetThenId;
  return s.targetTerminalId !== null && ref.terminals.has(s.targetTerminalId) ? s.targetTerminalId : null;
}

/**
 * Expected profit = what is sold so far + what is aboard at the price the TARGET is expected to pay − what is put in
 * (`expectedRun`, which the mini line asks too). It needs a target and a price there for EVERYTHING aboard: a sum over
 * part of the hold is not the result of the run. With the hold empty nothing is left to price, and the result is the one
 * in hand. The profit and the ROI are shown whenever they can be counted.
 */
export function runOutlook(active: RunWithEvents, m: Market, ref: Reference, s: Settings, ctx: RouteCtx): RunOutlook {
  const { invested, revenue } = runTotals(active.run, active.events, ctx.now);
  const facts = { invested: formatUec(invested), revenue: formatUec(revenue) };

  const saleId = saleTerminalId(s, ref);
  if (saleId === null && cargoOf(active.events).length > 0) return { ...facts, expected: null, why: NO_TARGET() };
  const result = expectedRun(active, m, saleId, ctx);
  if (result === null) return { ...facts, expected: null, why: NO_PRICE() };

  return {
    ...facts,
    expected: {
      profit: expectedProfitText(result.profit),
      profitLoss: result.profit < 0,
      roi: invested > 0 ? approx(formatRoi(result.profit / invested)) : NONE,
    },
    why: null,
  };
}
