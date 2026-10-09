// Counts what a sender does, so that nobody does it too often: messages sent, bodies the service was made to read,
// wrong passwords. All of it lives in the memory of the running service and nowhere else — a restart forgets it.
//
// The page «О данных» promises that the address of a sender is remembered here for a day at the most. So: an address
// is never kept as it is, only as its HMAC under a secret that is made when the service starts and is written
// nowhere; and no mark is kept longer than a day, whatever it was asked for.
import { createHmac, randomBytes } from 'node:crypto';

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

/** How many keys the limiter holds at the most: a flood of addresses cannot fill the memory of the service. */
const MAX_KEYS = 20_000;

/**
 * @param {{ now: () => number, maxKeys?: number }} options
 */
export function createLimiter({ now, maxKeys = MAX_KEYS }) {
  const secret = randomBytes(32);
  /** @type {Map<string, { ttl: number, times: number[] }>} the times of the marks of every key, oldest first */
  const marks = new Map();

  /** Drops the marks of a key that have outlived their time; the key itself when none is left. */
  const refresh = (/** @type {string} */ key) => {
    const entry = marks.get(key);
    if (entry === undefined) return undefined;
    const oldest = now() - entry.ttl;
    while (entry.times.length > 0 && entry.times[0] <= oldest) entry.times.shift();
    if (entry.times.length === 0) {
      marks.delete(key);
      return undefined;
    }
    return entry;
  };

  const prune = () => {
    for (const key of [...marks.keys()]) refresh(key);
  };

  return {
    /** What stands for an address in a key: its HMAC. @param {string} address @returns {string} */
    addressKey: (address) => createHmac('sha256', secret).update(address).digest('hex'),

    /** How many marks a key got within the last `windowMs`. @param {string} key @param {number} windowMs */
    count(key, windowMs) {
      const entry = refresh(key);
      if (entry === undefined) return 0;
      const since = now() - windowMs;
      return entry.times.filter((time) => time > since).length;
    },

    /** Could this key be marked right now? `false`: it is not known and there is no room for it. @param {string} key */
    hasRoom(key) {
      if (refresh(key) !== undefined) return true;
      if (marks.size >= maxKeys) prune();
      return marks.size < maxKeys;
    },

    /**
     * Marks a key now; the mark is forgotten after `ttlMs`, and after a day at the latest.
     * @param {string} key
     * @param {number} ttlMs
     * @returns {boolean} `false`: the limiter is full and has no room for a key it does not know — the caller refuses
     */
    mark(key, ttlMs) {
      let entry = refresh(key);
      if (entry === undefined) {
        if (marks.size >= maxKeys) prune();
        if (marks.size >= maxKeys) return false;
        entry = { ttl: Math.min(ttlMs, DAY), times: [] };
        marks.set(key, entry);
      }
      entry.times.push(now());
      return true;
    },

    prune,
    size: () => marks.size,
    keys: () => [...marks.keys()],
  };
}

/** @typedef {ReturnType<typeof createLimiter>} Limiter */
