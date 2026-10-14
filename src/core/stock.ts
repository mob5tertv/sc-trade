import type { StockEstimate } from './types';

// The stock refill timer (spec 14.3): the quantity at a terminal changes with time, so the app
// estimates "how much is there now" from the last own reading, the rate the stock refills at
// and the largest quantity it can hold. It serves only the stock at a purchase terminal: the
// quantity on the sell side is what the buyer already holds (spec 14.5), shown as recorded,
// with no timer. Pure: the clock is a parameter.

/**
 * Two readings closer than this say nothing about the rate: the game refills in steps of about a minute. The same
 * gap separates a new price reading from a correction of a typo, so `market.ts` exports it as `MIN_READING_GAP_SEC`.
 */
export const MIN_LEARN_GAP_SEC = 120;

/**
 * Two neighbouring readings farther apart than this say nothing about the rate either: in that time the stock may have reached
 * its ceiling and stood there, other players may have bought, the server may be another one.
 */
export const MAX_LEARN_GAP_SEC = 30 * 60;

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
 * The AVERAGE refill seen in the readings, per minute. `history` is ordered by time, oldest first.
 *
 * It was the FASTEST pair of neighbouring readings until 14.10.2026 ("other buyers can only make the growth look smaller").
 * The author's measurement at an outpost showed why that is wrong: the game refills in steps, and a short pair that happens to
 * hold a step reads three times the real rate (158 → 318 in five minutes is 35 a minute; over the whole half hour the terminal
 * gave 12). So the rate is all the growth over all the time of the STRETCHES in which the stock only grew or stood:
 *  - a reading closer than `MIN_LEARN_GAP_SEC` to the one before it is a correction of that reading: it replaces its quantity;
 *  - a stretch ends where the quantity falls (somebody bought, the player among them), where a reading has no quantity, and
 *    where two readings are farther apart than `MAX_LEARN_GAP_SEC`;
 *  - the time of a stretch runs from its first reading to the LAST reading that grew: the readings that stand still after it
 *    are a full store (or a wait for the next step that nobody saw end), and the stands between two steps are counted.
 * `null` when nothing grew.
 */
export function learnRatePerMin(history: Array<{ ts: number; scu: number | null }>): number | null {
  // corrections first: a reading that follows another within two minutes is that reading typed again
  const readings: Array<{ ts: number; scu: number | null }> = [];
  for (const reading of history) {
    const last = readings[readings.length - 1];
    if (last !== undefined && reading.ts - last.ts < MIN_LEARN_GAP_SEC) last.scu = reading.scu;
    else readings.push({ ...reading });
  }

  let grown = 0;
  let sec = 0;
  let start: { ts: number; scu: number } | null = null;   // the first reading of the stretch
  let stretchGrown = 0;
  let lastGrowthTs = 0;
  const close = (): void => {
    if (start !== null && stretchGrown > 0) {
      grown += stretchGrown;
      sec += lastGrowthTs - start.ts;
    }
    start = null;
    stretchGrown = 0;
  };
  let before: { ts: number; scu: number | null } | null = null;
  for (const after of readings) {
    const goesOn = before !== null && before.scu !== null && after.scu !== null
      && after.scu >= before.scu && after.ts - before.ts <= MAX_LEARN_GAP_SEC;
    if (!goesOn) close();
    if (after.scu !== null) {
      if (start === null) start = { ts: after.ts, scu: after.scu };
      else if (before !== null && before.scu !== null && after.scu > before.scu) {
        stretchGrown += after.scu - before.scu;
        lastGrowthTs = after.ts;
      }
    }
    before = after;
  }
  close();
  return grown > 0 && sec > 0 ? grown / (sec / SEC_PER_MIN) : null;
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
