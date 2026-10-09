// Counts what a sender does, so that nobody does it too often: messages sent, bytes kept, bodies the service was
// made to read, wrong passwords. All of it lives in the memory of the running service and nowhere else — a restart
// forgets it.
//
// The page «О данных» promises that the address of a sender is remembered here for a day at the most. So: an address
// is never kept as it is, only as its HMAC under a secret that is made when the service starts and is written
// nowhere; and no mark is kept longer than a day, whatever it was asked for.
//
// A table holds a number of keys and no more. When it is full, a new key is not turned away — that would let a flood
// of addresses shut everybody else out — but takes the place of the key that was marked longest ago. Nothing in a
// request ever makes the whole table be looked through: marks that have run out go when their key is looked at, and
// the rest by the clock (`prune`, which the service calls every few minutes).
import { createHmac, randomBytes } from 'node:crypto';

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

/** How many keys a table holds unless told otherwise. */
const MAX_KEYS = 20_000;

/**
 * @param {{ now: () => number, maxKeys?: number }} options
 */
export function createLimiter({ now, maxKeys = MAX_KEYS }) {
  const secret = randomBytes(32);
  /**
   * The marks of every key, oldest first: when each was made and what it weighs. The keys stand in the order they
   * were last marked in, the one marked longest ago first.
   * @type {Map<string, { ttl: number, times: number[], weights: number[] }>}
   */
  const marks = new Map();

  /** Drops the marks of a key that have outlived their time; the key itself when none is left. */
  const refresh = (/** @type {string} */ key) => {
    const entry = marks.get(key);
    if (entry === undefined) return undefined;
    const oldest = now() - entry.ttl;
    let gone = 0;
    while (gone < entry.times.length && entry.times[gone] <= oldest) gone++;
    if (gone > 0) {
      entry.times.splice(0, gone);
      entry.weights.splice(0, gone);
    }
    if (entry.times.length === 0) {
      marks.delete(key);
      return undefined;
    }
    return entry;
  };

  return {
    /** What stands for an address in a key: its HMAC. @param {string} address @returns {string} */
    addressKey: (address) => createHmac('sha256', secret).update(address).digest('hex'),

    /** How many marks a key got within the last `windowMs`. Asking makes no key. @param {string} key @param {number} windowMs */
    count(key, windowMs) {
      const entry = refresh(key);
      if (entry === undefined) return 0;
      const since = now() - windowMs;
      return entry.times.filter((time) => time > since).length;
    },

    /** What the marks of a key within the last `windowMs` weigh together. @param {string} key @param {number} windowMs */
    sum(key, windowMs) {
      const entry = refresh(key);
      if (entry === undefined) return 0;
      const since = now() - windowMs;
      return entry.times.reduce((total, time, at) => (time > since ? total + entry.weights[at] : total), 0);
    },

    /**
     * Marks a key now; the mark is forgotten after `ttlMs`, and after a day at the latest.
     * @param {string} key
     * @param {number} ttlMs
     * @param {number} [weight] what the mark counts for in `sum` (bytes, for a budget of bytes)
     */
    mark(key, ttlMs, weight = 1) {
      let entry = refresh(key);
      if (entry === undefined) {
        // a full table: the key marked longest ago makes room — one step, whatever the size of the table
        while (marks.size >= maxKeys) marks.delete(/** @type {string} */ (marks.keys().next().value));
        entry = { ttl: Math.min(ttlMs, DAY), times: [], weights: [] };
      } else {
        marks.delete(key);
      }
      // put in again: it is now the key marked last
      marks.set(key, entry);
      entry.times.push(now());
      entry.weights.push(weight);
    },

    /** Drops every mark that has run out. By the clock, never for a request. */
    prune() {
      for (const key of [...marks.keys()]) refresh(key);
    },
    size: () => marks.size,
    keys: () => [...marks.keys()],
  };
}

/** @typedef {ReturnType<typeof createLimiter>} Limiter */
