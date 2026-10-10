// The service of the site: a small HTTP server that listens on the server itself only (127.0.0.1) — every request
// reaches it through the web server in front (Caddy), which passes /api and /admin on to it.
//
//   POST /api/feedback    a message of the form of the site (feedback.mjs)
//   /api, /api/           "the service is up"
//   /admin/…              the author's page, behind a password (admin.mjs)
//
// It sends nothing anywhere: it calls no other server and makes no connection of its own. What it is given, it keeps.
import { createServer } from 'node:http';
import { createAdmin } from './admin.mjs';
import { createFeedback } from './feedback.mjs';
import { answer, errorWord, JSON_HEADERS, splitUrl } from './http.mjs';
import { createLimiter } from './limiter.mjs';
import { createStore, SWEEP_EVERY_MS } from './store.mjs';

const DAY = 86_400_000;
/** How often the limiter drops the marks that have run out. */
const PRUNE_EVERY_MS = 10 * 60_000;

const UP = '{"ok":true}';
const NOT_FOUND = '{"ok":false,"error":"server"}';

/** @param {number} ms */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {{
 *   settings: import('./config.mjs').Settings,
 *   now?: () => number,
 *   log?: (line: string) => void,
 *   sleep?: (ms: number) => Promise<unknown>,
 * }} options `now`, `log` and `sleep` are the clock, the log and the waiting of the service; the tests give their own.
 */
export function createService({ settings, now = Date.now, log = console.log, sleep = wait }) {
  const { limits } = settings;
  /** One line of the log: the time, then what happened. Never a text, a name or an address of a sender. */
  const say = (/** @type {string} */ text) => log(`${new Date(now()).toISOString()} ${text}`);

  const store = createStore({ dir: settings.dataDir, now, storageBytes: limits.storageBytes, retentionMs: limits.retentionDays * DAY });
  // Three tables, so that a flood in one never spills into another: what each address does with the form; what
  // all addresses together do with it (two keys, which no flood of addresses can push out); and the wrong
  // passwords of the author's page (a key is made there only by a password that was checked, one at a time).
  const limiter = createLimiter({ now, maxKeys: limits.limiterKeys });
  const everybody = createLimiter({ now });
  const loginLimiter = createLimiter({ now, maxKeys: limits.limiterKeys });
  const feedback = createFeedback({ settings, store, limiter, everybody, now, log: say });
  const admin = createAdmin({ settings, store, logins: loginLimiter, now, log: say, sleep });

  /** @param {import('./http.mjs').Request} req @param {import('./http.mjs').Response} res */
  const route = (req, res) => {
    const { path, query } = splitUrl(req.url);
    if (path === '/api/feedback') return feedback(req, res);
    if (path === '/admin' || path.startsWith('/admin/')) return void admin(req, res, path, query);
    const up = path === '/api' || path === '/api/';
    answer(req, res, limits.lingerMs, up ? 200 : 404, JSON_HEADERS, up ? UP : NOT_FOUND);
  };

  const server = createServer({ maxHeaderSize: 16 * 1024 }, (req, res) => {
    // a line that breaks while an answer is being written is the sender's trouble, never a reason for the service to stop
    res.on('error', () => {});
    try {
      route(req, res);
    } catch (err) {
      say(`error request ${errorWord(err)}`);
      if (res.headersSent) res.destroy();
      else answer(req, res, limits.lingerMs, 500, JSON_HEADERS, NOT_FOUND);
    }
  });
  // a sender that is slow on purpose is not waited for
  server.headersTimeout = 15_000;
  server.requestTimeout = limits.requestMs + 30_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;
  server.maxConnections = 256;
  server.on('error', (err) => say(`error server ${errorWord(err)}`));

  /** Removes the messages past their term and what belongs to no message; says what it did. */
  const sweep = async () => {
    try {
      const { expired, strays } = await store.sweep();
      say(`sweep ok expired=${expired} strays=${strays} used=${store.usedBytes()}`);
    } catch (err) {
      say(`sweep failed why=${errorWord(err)}`);
    }
  };

  /** @type {NodeJS.Timeout[]} */
  let timers = [];

  return {
    limiter,
    everybody,
    loginLimiter,
    /** How many logins wait for their password to be looked at. */
    loginsWaiting: admin.waiting,
    sweep,

    /**
     * Opens the storage, removes what is past its term, and starts to listen — on 127.0.0.1 and nowhere else.
     * @param {number} [port] 0: a port the system picks
     * @returns {Promise<number>} the port
     */
    async listen(port = settings.port) {
      await store.open();
      await sweep();
      const prune = () => [limiter, everybody, loginLimiter].forEach((table) => table.prune());
      timers = [setInterval(sweep, SWEEP_EVERY_MS), setInterval(prune, PRUNE_EVERY_MS)];
      for (const timer of timers) timer.unref();
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => {
          server.off('error', reject);
          resolve(undefined);
        });
      });
      const address = server.address();
      return address !== null && typeof address === 'object' ? address.port : port;
    },

    /** Where the service listens. @returns {{ address: string, port: number } | null} */
    address() {
      const address = server.address();
      return address !== null && typeof address === 'object' ? { address: address.address, port: address.port } : null;
    },

    /** Stops listening and cuts every open line. */
    async close() {
      for (const timer of timers) clearInterval(timer);
      await new Promise((resolve) => {
        server.close(() => resolve(undefined));
        server.closeAllConnections();
      });
    },
  };
}
