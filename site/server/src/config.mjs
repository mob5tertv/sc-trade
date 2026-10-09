// The settings of the service: a JSON file on the server (/etc/sc-trade-site/config.json), written by setup.sh and
// read once, when the service starts. It is not in the repository and is not part of the site. A file that is
// missing, is not whole or is wrong stops the service with a phrase that names every setting to fix.
//
// The file never holds the password of the author's page: only its hash (password.mjs).
import { readFileSync } from 'node:fs';
import { isAbsolute, parse, resolve } from 'node:path';
import { parseHash } from './password.mjs';

export const DEFAULT_CONFIG_PATH = '/etc/sc-trade-site/config.json';

const MEGABYTE = 1024 * 1024;

/**
 * @typedef {{
 *   bodyBytes: number,
 *   requestMs: number,
 *   idleMs: number,
 *   lingerMs: number,
 *   perAddressHour: number,
 *   perAddressDay: number,
 *   globalHour: number,
 *   perAddressDayBytes: number,
 *   globalHourBytes: number,
 *   attemptsPerAddressHour: number,
 *   uploadsAtOnce: number,
 *   limiterKeys: number,
 *   storageBytes: number,
 *   retentionDays: number,
 *   loginFailures: number,
 *   loginWindowMs: number,
 *   loginSlowAfter: number,
 *   loginSlowMs: number,
 *   sessionMs: number,
 * }} Limits
 *
 * @typedef {{ domain: string, origin: string, port: number, dataDir: string, passwordHash: string, limits: Limits }} Settings
 *   `origin` is the site as a browser names it in the Origin header.
 */

/** The limits nobody sets in the file: they follow from the form of the page and from the size of the server. */
const FIXED = Object.freeze({
  // three pictures of 5 MB, a log of 2 MB, the text and the envelope of the form
  bodyBytes: 18 * MEGABYTE,
  // a body that brings nothing for this long is cut: a sender that is silent does not keep a place
  idleMs: 15_000,
  // how long the rest of a refused body is thrown away before the line is cut, so that the sender can read the answer
  lingerMs: 2000,
  // bodies one address may make the service read in an hour, whatever became of them
  attemptsPerAddressHour: 30,
  // bodies read at the same time, each from another address
  uploadsAtOnce: 4,
  // how many keys a table of the limiter holds; a full table lets the key marked longest ago go
  limiterKeys: 20_000,
  // wrong passwords one address may send within the window before it is shut out for the rest of it
  loginFailures: 5,
  loginWindowMs: 15 * 60_000,
  // wrong passwords of everybody together within the window, after which one password is looked at in `loginSlowMs`:
  // a delay for all, never a closed door — strangers cannot shut the author out
  loginSlowAfter: 30,
  loginSlowMs: 1000,
  sessionMs: 12 * 3_600_000,
});

/**
 * The limits the owner of the server may change, with what each may be. `retentionDays` has a ceiling of 180: the
 * page «О данных» promises that messages are kept no longer.
 * @type {Record<string, { min: number, max: number, default: number }>}
 */
const CHANGEABLE = Object.freeze({
  requestSeconds: { min: 10, max: 600, default: 120 },
  perAddressHour: { min: 1, max: 1000, default: 5 },
  perAddressDay: { min: 1, max: 10_000, default: 20 },
  globalHour: { min: 1, max: 100_000, default: 120 },
  // what is kept of one address in a day, and of everybody in an hour: so that the storage is not filled within
  // the hour by full messages (two full messages fit into the day of one address)
  perAddressDayBytes: { min: FIXED.bodyBytes, max: 1024 * 1024 * MEGABYTE, default: 40 * MEGABYTE },
  globalHourBytes: { min: FIXED.bodyBytes, max: 1024 * 1024 * MEGABYTE, default: 200 * MEGABYTE },
  storageBytes: { min: 32 * MEGABYTE, max: 1024 * 1024 * MEGABYTE, default: 1024 * MEGABYTE },
  retentionDays: { min: 2, max: 180, default: 180 },
});

const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const KEYS = ['domain', 'port', 'dataDir', 'passwordHash', 'limits'];

const isWhole = (/** @type {unknown} */ value, /** @type {number} */ min, /** @type {number} */ max) =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

/**
 * The settings, checked. What is wrong is said without repeating what stands in the file.
 * @param {unknown} value what the file holds
 * @returns {Settings}
 */
export function readSettings(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('the settings must be an object with "domain", "dataDir" and "passwordHash"');
  const file = /** @type {Record<string, unknown>} */ (value);
  /** @type {string[]} */
  const problems = [];

  for (const key of Object.keys(file)) {
    if (/^pass(word)?$/i.test(key)) problems.push(`"${key}" must not be in the settings: only the hash of the password belongs there, as "passwordHash" (setup.sh makes it)`);
    else if (!KEYS.includes(key)) problems.push(`"${key}" is not a setting (there are ${KEYS.map((name) => `"${name}"`).join(', ')})`);
  }

  const { domain, port = 8787, dataDir, passwordHash } = file;
  if (domain === undefined) problems.push('"domain" is missing: the host name of the site, like site.example');
  else if (typeof domain !== 'string' || !DOMAIN.test(domain)) problems.push('"domain" must be a host name, like site.example (no https://, no slash, small letters)');

  if (!isWhole(port, 1024, 65535)) problems.push('"port" must be a whole number from 1024 to 65535 (8787 unless the web server is told another)');

  if (dataDir === undefined) problems.push('"dataDir" is missing: the folder the messages are kept in, like /var/lib/sc-trade-site');
  else if (typeof dataDir !== 'string' || !isAbsolute(dataDir) || resolve(dataDir) === parse(resolve(dataDir)).root) {
    problems.push('"dataDir" must be the full path of a folder of its own, like /var/lib/sc-trade-site');
  }

  if (passwordHash === undefined) problems.push('"passwordHash" is missing: the hash of the password of the author\'s page (setup.sh makes it)');
  else {
    try {
      parseHash(/** @type {string} */ (passwordHash));
    } catch (err) {
      problems.push(`"passwordHash" is ${err instanceof Error ? err.message : 'not a hash'}`);
    }
  }

  /** @type {Record<string, number>} */
  const changed = {};
  const given = file.limits ?? {};
  if (given === null || typeof given !== 'object' || Array.isArray(given)) problems.push('"limits" must be an object');
  else {
    for (const [key, number] of Object.entries(given)) {
      const rule = CHANGEABLE[key];
      if (rule === undefined) problems.push(`"limits.${key}" is not a setting (there are ${Object.keys(CHANGEABLE).map((name) => `"${name}"`).join(', ')})`);
      else if (!isWhole(number, rule.min, rule.max)) problems.push(`"limits.${key}" must be a whole number from ${rule.min} to ${rule.max}`);
      else changed[key] = number;
    }
  }
  const limit = (/** @type {string} */ key) => changed[key] ?? CHANGEABLE[key].default;
  if (limit('perAddressDay') < limit('perAddressHour')) problems.push('"limits.perAddressDay" must not be less than "limits.perAddressHour"');

  if (problems.length > 0) throw new Error(problems.join('\n'));

  return {
    domain: /** @type {string} */ (domain),
    origin: `https://${domain}`,
    port: /** @type {number} */ (port),
    dataDir: /** @type {string} */ (dataDir),
    passwordHash: /** @type {string} */ (passwordHash),
    limits: {
      bodyBytes: FIXED.bodyBytes,
      requestMs: limit('requestSeconds') * 1000,
      idleMs: FIXED.idleMs,
      lingerMs: FIXED.lingerMs,
      perAddressHour: limit('perAddressHour'),
      perAddressDay: limit('perAddressDay'),
      globalHour: limit('globalHour'),
      perAddressDayBytes: limit('perAddressDayBytes'),
      globalHourBytes: limit('globalHourBytes'),
      attemptsPerAddressHour: FIXED.attemptsPerAddressHour,
      uploadsAtOnce: FIXED.uploadsAtOnce,
      limiterKeys: FIXED.limiterKeys,
      storageBytes: limit('storageBytes'),
      retentionDays: limit('retentionDays'),
      loginFailures: FIXED.loginFailures,
      loginWindowMs: FIXED.loginWindowMs,
      loginSlowAfter: FIXED.loginSlowAfter,
      loginSlowMs: FIXED.loginSlowMs,
      sessionMs: FIXED.sessionMs,
    },
  };
}

/**
 * The settings of a file. Every way it can fail names the file.
 * @param {string} path
 * @returns {Settings}
 */
export function loadSettings(path) {
  /** @type {string} */
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`the settings ${path} cannot be read (${/** @type {NodeJS.ErrnoException} */ (err).code ?? 'error'}): setup.sh makes the file, config.example.json shows what it holds`, { cause: err });
  }
  /** @type {unknown} */
  let value;
  try {
    value = JSON.parse(text);
  } catch (err) {
    throw new Error(`the settings ${path}: the file is not JSON`, { cause: err });
  }
  try {
    return readSettings(value);
  } catch (err) {
    throw new Error(`the settings ${path}:\n${err instanceof Error ? err.message : err}`, { cause: err });
  }
}
