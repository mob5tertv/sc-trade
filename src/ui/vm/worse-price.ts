import { formatDuration, formatUec } from '../../core/format';
import type { SellAlternative } from '../../core/sell';
import type { Reference } from '../../core/types';
import { terminalLabel } from './terminal-name';
import { tr } from '../../i18n';

// «Цена на месте хуже — куда лететь» (spec 14.19, item 8). The player arrives, types in what the terminal really pays, and it is
// clearly less than was expected. He "often sells cheaper and never minds", so the window speaks only when the price is worse by
// the threshold of the settings AND some other place would really pay more for this cargo. Pure.

/** The threshold as the settings hold it: whole percents; 0 switches the notice off. */
export const WORSE_PRICE_RANGE = { min: 0, max: 90 };

export interface WorsePrice {
  /** By how many whole percents the price typed in is below the expected one. */
  pct: number;
  /** The place that is worth the flight most (the first of `sellOrContinue` that pays more than here). */
  best: SellAlternative;
}

/**
 * `expected` is what the place was expected to pay BEFORE the player typed `actual` (`null`: nothing was known). `alternatives`
 * are those of `sellOrContinue` for the price typed in, in its order. `null` when there is nothing to say: the price is not
 * worse by the threshold, the notice is switched off, or no other place pays more.
 */
export function worsePrice(expected: number | null, actual: number, thresholdPct: number, alternatives: SellAlternative[]): WorsePrice | null {
  if (expected === null || !(expected > 0) || !(thresholdPct > 0)) return null;
  const drop = ((expected - actual) / expected) * 100;
  if (drop < thresholdPct) return null;
  const best = alternatives.find((a) => a.extraProfit > 0);
  return best === undefined ? null : { pct: Math.round(drop), best };
}

/** 'Цена ниже ожидаемой на 18 % · лучше: TDD Area 18, +212 000, ≈ 9:10': the notice; the time is left out when it is not known. */
export function worsePriceText(w: WorsePrice, ref: Reference): string {
  const time = w.best.extraSec === null ? null : `${w.best.extraSource === 'estimate' ? '≈ ' : ''}${formatDuration(w.best.extraSec)}`;
  const better = [terminalLabel(ref, w.best.destId), `+${formatUec(w.best.extraProfit)}`, time].filter((part) => part !== null).join(', ');
  return tr('Цена ниже ожидаемой на {pct} % · лучше: {better}', { pct: w.pct, better });
}

/** The button of the notice: it opens the reference on this commodity, on the side of the sale. */
export const WORSE_PRICE_ACTION = (): string => tr('Куда ещё?');
