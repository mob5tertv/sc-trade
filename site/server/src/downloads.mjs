// The count of the downloads of the program (the author: «как мне узнать, сколько людей скачали программу»). The buttons «Скачать» of
// the site tell the service, as they are pressed, which version they give and in which language the page is: a beacon to
// POST /api/download. The service keeps how many presses there were per day (UTC), per version and per language of the page, in one
// small file of its folder — and nothing of who pressed: no address, no browser, no cookie. The file itself, opened by a link from
// elsewhere, is not counted: only the buttons of the site are.
//
// One address is counted three times an hour at the most (a double click, a page opened twice), by the HMAC of the address in the memory
// of the limiter, as the form is: the page «О данных» promises no more than that.
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { clientAddress } from './address.mjs';
import { answer, errorWord, JSON_HEADERS } from './http.mjs';
import { HOUR } from './limiter.mjs';

/** The name of the file of the counts in the folder of the data. */
export const DOWNLOADS_FILE = 'downloads.json';
/** A beacon is a few dozen bytes; a longer body is no beacon. */
const BODY_BYTES = 256;
/** How long the body of a beacon may take to arrive. */
const BODY_MS = 5_000;
/** How many presses of one address an hour count. */
export const PER_ADDRESS_HOUR = 3;
const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const LANGS = new Set(['ru', 'en']);
/** How many days the author's page lists one by one. */
const DAYS_SHOWN = 30;

const BAD = '{"ok":false,"error":"bad_request"}';

/**
 * The counts: day (YYYY-MM-DD, UTC) → version → language of the page → presses.
 * @typedef {Record<string, Record<string, Record<string, number>>>} Days
 */

/** Takes from a file only what has the shape of counts: a broken file is no reason for the service to stop. @param {unknown} data @returns {Days} */
function cleanDays(data) {
  /** @type {Days} */
  const days = {};
  const source = /** @type {{ days?: unknown } | null} */ (data)?.days;
  if (source === null || typeof source !== 'object') return days;
  for (const [day, versions] of Object.entries(source)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || versions === null || typeof versions !== 'object') continue;
    for (const [version, langs] of Object.entries(versions)) {
      if (!VERSION.test(version) || langs === null || typeof langs !== 'object') continue;
      for (const [lang, count] of Object.entries(langs)) {
        if (!LANGS.has(lang) || !Number.isInteger(count) || count <= 0) continue;
        ((days[day] ??= {})[version] ??= {})[lang] = count;
      }
    }
  }
  return days;
}

/** The body of a request, up to `BODY_BYTES`; `null` when it is longer or does not come in time. @param {import('./http.mjs').Request} req */
function readBody(req) {
  return new Promise((resolve) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (/** @type {string | null} */ value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), BODY_MS);
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_BYTES) return finish(null);
      chunks.push(chunk);
    });
    req.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => finish(null));
  });
}

/**
 * @param {{
 *   dir: string,
 *   limiter: import('./limiter.mjs').Limiter,
 *   now: () => number,
 *   log: (line: string) => void,
 *   lingerMs: number,
 * }} options
 */
export function createDownloads({ dir, limiter, now, log, lingerMs }) {
  const path = join(dir, DOWNLOADS_FILE);
  /** @type {Days} */
  let days = {};
  /** The writes of the file, one after another. */
  let writing = Promise.resolve();

  const save = () => {
    writing = writing
      .then(async () => {
        const draft = `${path}.tmp`;
        await writeFile(draft, `${JSON.stringify({ days })}\n`, { mode: 0o600 });
        await rename(draft, path);
      })
      .catch((err) => log(`download save failed why=${errorWord(err)}`));
    return writing;
  };

  return {
    /** Reads the counts that are kept. A file that cannot be read is said in the log and counting starts anew. */
    async load() {
      try {
        days = cleanDays(JSON.parse(await readFile(path, 'utf8')));
      } catch (err) {
        if (/** @type {{ code?: string }} */ (err).code !== 'ENOENT') log(`download load failed why=${errorWord(err)}`);
        days = {};
      }
    },

    /**
     * POST /api/download: one press of a button «Скачать». The answer says nothing of whether it was counted (an address that pressed
     * too often is not told so): 204 for a beacon of the right shape, 400 for any other.
     * @param {import('./http.mjs').Request} req
     * @param {import('./http.mjs').Response} res
     */
    async count(req, res) {
      if (req.method !== 'POST') return answer(req, res, lingerMs, 405, { ...JSON_HEADERS, Allow: 'POST' }, BAD);
      const body = await readBody(req);
      /** @type {{ version?: unknown, lang?: unknown }} */
      let beacon = {};
      try {
        beacon = body === null ? {} : JSON.parse(body);
      } catch {
        beacon = {};
      }
      const version = typeof beacon?.version === 'string' ? beacon.version : '';
      const lang = typeof beacon?.lang === 'string' ? beacon.lang : '';
      if (!VERSION.test(version) || !LANGS.has(lang)) return answer(req, res, lingerMs, 400, JSON_HEADERS, BAD);

      const key = limiter.addressKey(clientAddress(req.headers['x-forwarded-for']));
      if (limiter.count(key, HOUR) < PER_ADDRESS_HOUR) {
        limiter.mark(key, HOUR);
        const day = new Date(now()).toISOString().slice(0, 10);
        const versions = (days[day] ??= {});
        const langs = (versions[version] ??= {});
        langs[lang] = (langs[lang] ?? 0) + 1;
        log(`download counted version=${version} lang=${lang}`);
        await save();
      }
      answer(req, res, lingerMs, 204, JSON_HEADERS);
    },

    /**
     * What the author's page shows: every press in all, per version (the newest first), and the last `DAYS_SHOWN` days one by one
     * (the newest first; a day without a press is left out).
     */
    summary() {
      let total = 0;
      /** @type {Record<string, number>} */
      const perVersion = {};
      /** @type {Record<string, number>} */
      const perLang = {};
      const perDay = [];
      for (const day of Object.keys(days).sort().reverse()) {
        let dayTotal = 0;
        for (const [version, langs] of Object.entries(days[day])) {
          for (const [lang, count] of Object.entries(langs)) {
            total += count;
            dayTotal += count;
            perVersion[version] = (perVersion[version] ?? 0) + count;
            perLang[lang] = (perLang[lang] ?? 0) + count;
          }
        }
        if (perDay.length < DAYS_SHOWN) perDay.push({ day, count: dayTotal });
      }
      const byNumber = (/** @type {string} */ v) => v.split('.').map((part) => part.padStart(3, '0')).join('.');
      const versions = Object.entries(perVersion)
        .sort(([a], [b]) => byNumber(b).localeCompare(byNumber(a)))
        .map(([version, count]) => ({ version, count }));
      return { total, versions, langs: perLang, days: perDay };
    },

    /** The writes that are going, for a stop that waits for them. */
    settled: () => writing,
  };
}

/** @typedef {ReturnType<typeof createDownloads>} Downloads */
