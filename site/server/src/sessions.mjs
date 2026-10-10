// The sessions of the author's page. They live in the memory of the running service and nowhere else: a restart
// ends them all, and the author logs in again.
//
// A session is a random id, which the browser keeps in a cookie, and a random token, which every form of the pages
// carries: a request that changes something must bring both (a page of another site can make a browser send the
// cookie, but cannot read the token).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** `__Secure-`: a browser takes such a cookie only over https and only with the Secure mark. */
export const COOKIE_NAME = '__Secure-sctrade-admin';

/** How many sessions are open at the same time at the most; the author needs one or two. */
const MAX_SESSIONS = 8;

const ID = /^[A-Za-z0-9_-]{43}$/;

const random = () => randomBytes(32).toString('base64url');
const hash = (/** @type {string} */ value) => createHash('sha256').update(value).digest();

/**
 * The cookie of a session: for /admin and nothing else of the site, hidden from scripts, sent over https only and
 * never with a request that another site started.
 * @param {string} id the id of the session; empty with `maxAgeSeconds` 0 takes the cookie back
 * @param {number} maxAgeSeconds
 */
export function cookieFor(id, maxAgeSeconds) {
  return `${COOKIE_NAME}=${id}; Path=/admin; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Strict`;
}

/**
 * The id of a session out of the Cookie header of a request; `undefined` unless there is one of the right shape.
 * @param {string | undefined} header
 * @returns {string | undefined}
 */
export function sessionIdFrom(header) {
  if (typeof header !== 'string') return undefined;
  for (const pair of header.split(';')) {
    const cut = pair.indexOf('=');
    if (cut === -1 || pair.slice(0, cut).trim() !== COOKIE_NAME) continue;
    const value = pair.slice(cut + 1).trim();
    return ID.test(value) ? value : undefined;
  }
  return undefined;
}

/**
 * Is what a form brought the token of the session? Compared in constant time.
 * @param {unknown} given
 * @param {string} token
 */
export function sameToken(given, token) {
  return typeof given === 'string' && timingSafeEqual(hash(given), hash(token));
}

/**
 * @param {{ now: () => number, lifeMs: number, max?: number }} options
 */
export function createSessions({ now, lifeMs, max = MAX_SESSIONS }) {
  // under the hash of the id: what lies here is not what a browser sends, and finding a session compares hashes
  /** @type {Map<string, { csrf: string, expires: number }>} oldest first */
  const open = new Map();
  const keyOf = (/** @type {string} */ id) => hash(id).toString('hex');

  const dropExpired = () => {
    for (const [key, session] of open) if (session.expires <= now()) open.delete(key);
  };

  return {
    /** A new session. @returns {{ id: string, csrf: string }} */
    open() {
      dropExpired();
      while (open.size >= max) open.delete(/** @type {string} */ (open.keys().next().value));
      const id = random();
      const csrf = random();
      open.set(keyOf(id), { csrf, expires: now() + lifeMs });
      return { id, csrf };
    },

    /** @param {string | undefined} id @returns {{ csrf: string } | null} the session, while it lasts */
    find(id) {
      if (typeof id !== 'string' || !ID.test(id)) return null;
      const session = open.get(keyOf(id));
      if (session === undefined) return null;
      if (session.expires <= now()) {
        open.delete(keyOf(id));
        return null;
      }
      return { csrf: session.csrf };
    },

    /** @param {string | undefined} id */
    close(id) {
      if (typeof id === 'string') open.delete(keyOf(id));
    },

    size() {
      dropExpired();
      return open.size;
    },
  };
}

/** @typedef {ReturnType<typeof createSessions>} Sessions */
