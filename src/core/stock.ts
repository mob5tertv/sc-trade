import type { StockEstimate } from './types';

// The stock refill timer (spec 14.3): the quantity at a terminal changes with time, so the app
// estimates "how much is there now" from the last own reading, the rate the stock refills at
// and the largest quantity it can hold. The same model serves the stock at a purchase
// terminal and the demand at a selling one. Pure: the clock is a parameter.

/** Two readings closer than this say nothing about the rate: the game refills in steps of about a minute. */
export const MIN_LEARN_GAP_SEC = 120;

/** Minutes a stock needs to refill from empty to its maximum until a rate is learned; the setting `refillFullMin` overrides it. */
export const DEFAULT_REFILL_FULL_MIN = 75;

const SEC_PER_MIN = 60;

/** The largest quantity among the readings; a known zero counts, `null` when no reading has a quantity. */
export function maxSeenScu(history: Array<{ ts: number; scu: number | null }>): number | null {
  let max: number | null = null;
  for (const { scu } of history) {
    if (scu !== null && (max === null || scu > max)) max = scu;
  }
  return max;
}

/**
 * The fastest refill seen in the readings, per minute. `history` is ordered by time, oldest first.
 * Only two neighbouring readings that both have a quantity count, at least `MIN_LEARN_GAP_SEC` apart,
 * with the quantity grown between them. Other buyers can only make the growth look smaller, so the
 * largest rate of all pairs is the best guess. `null` when no pair qualifies.
 */
export function learnRatePerMin(history: Array<{ ts: number; scu: number | null }>): number | null {
  let best: number | null = null;
  for (let i = 1; i < history.length; i++) {
    const before = history[i - 1];
    const after = history[i];
    if (before.scu === null || after.scu === null) continue;
    const gapSec = after.ts - before.ts;
    const grown = after.scu - before.scu;
    if (gapSec < MIN_LEARN_GAP_SEC || grown <= 0) continue;
    const rate = grown / (gapSec / SEC_PER_MIN);
    if (best === null || rate > best) best = rate;
  }
  return best;
}

/**
 * The quantity now, starting from a reading `baseScu` taken at `baseTs`. It grows at the learned rate; with no
 * learned rate and a known maximum it grows by `maxScu / refillFullMin` per minute; with neither it stays at the
 * base. It never passes the maximum, and a base above the known maximum is the new maximum. A clock running
 * backwards counts as no time passed. The result is rounded down to a whole number.
 */
export function estimateStock(i: {
  baseScu: number; baseTs: number; now: number; maxScu: number | null; learnedRatePerMin: number | null; refillFullMin: number;
}): StockEstimate {
  const baseAgeSec = Math.max(0, i.now - i.baseTs);
  const maxScu = i.maxScu === null ? null : Math.max(i.maxScu, i.baseScu);

  let ratePerMin = 0;
  let rateSource: StockEstimate['rateSource'] = 'none';
  if (i.learnedRatePerMin !== null) {
    ratePerMin = i.learnedRatePerMin; rateSource = 'learned';
  } else if (maxScu !== null && i.refillFullMin > 0) {
    ratePerMin = maxScu / i.refillFullMin; rateSource = 'default';
  }

  const grown = i.baseScu + ratePerMin * (baseAgeSec / SEC_PER_MIN);
  const scu = Math.floor(maxScu === null ? grown : Math.min(maxScu, grown));
  return { scu, baseScu: i.baseScu, baseAgeSec, ratePerMin, rateSource, maxScu };
}
