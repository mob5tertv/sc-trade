// The settings of the site (site/site.config.json) and its two dictionaries (site/i18n/ru.json, en.json): reading
// and checking. A build that would put an empty author, a broken link or a text of one language only on the page
// stops here, with a phrase that says what to fix.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const projectRoot = resolve(import.meta.dirname, '..', '..');
export const siteDir = resolve(projectRoot, 'site');

/** The languages of the site. The first one lives in the root, the others in a folder of their own name. */
export const LANGUAGES = /** @type {const} */ (['ru', 'en']);

/**
 * @typedef {(typeof LANGUAGES)[number]} Lang
 * @typedef {{ [key: string]: DictionaryValue }} Dictionary
 * @typedef {string | Array<string | Dictionary> | Dictionary} DictionaryValue a text, a list of texts or of groups, or a group
 * @typedef {Record<Lang, Dictionary>} Dictionaries
 *
 * @typedef {{
 *   author: string,
 *   year: number,
 *   domain: string,
 *   links: { twitch: string, boosty: string, donationalerts: string, uex: string },
 *   analytics: { ga4Id: string },
 *   feedback: { endpoint: string },
 *   server: { root: string, service: string },
 * }} SiteConfig
 */

/** A JSON file, read; a file that is missing or broken is named in the error. @param {string} file @returns {unknown} */
export function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`cannot read ${file}: ${err instanceof Error ? err.message : err}`, { cause: err });
  }
}

const isText = (/** @type {unknown} */ value) => typeof value === 'string' && value.trim() !== '';

/**
 * @param {unknown} value what site.config.json holds
 * @returns {asserts value is SiteConfig}
 */
export function validateConfig(value) {
  const fail = (/** @type {string} */ message) => new Error(`site.config.json: ${message}`);
  const config = /** @type {Partial<SiteConfig> | null} */ (value);
  if (config === null || typeof config !== 'object') throw fail('it is not an object');

  if (!isText(config.author)) throw fail('the author is empty');
  if (!Number.isInteger(config.year) || Number(config.year) < 2000 || Number(config.year) > 2100) throw fail('"year" must be a year, like 2026');
  if (typeof config.domain !== 'string' || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(config.domain)) {
    throw fail('"domain" must be a host name, like sc-trade.space (no https://, no slash)');
  }

  const links = /** @type {Partial<SiteConfig['links']>} */ (config.links ?? {});
  if (!isText(links.twitch)) throw fail('the Twitch link is empty');
  for (const name of /** @type {const} */ (['twitch', 'boosty', 'donationalerts', 'uex'])) {
    const link = links[name];
    if (typeof link !== 'string' || !/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[\w\-./~%]*)?$/i.test(link)) {
      throw fail(`"links.${name}" must be an https:// address`);
    }
  }

  const ga4Id = config.analytics?.ga4Id;
  if (typeof ga4Id !== 'string' || !(ga4Id === '' || /^G-[A-Z0-9]{4,20}$/.test(ga4Id))) {
    throw fail('"analytics.ga4Id" must be empty (no analytics) or look like G-XXXXXXXXXX');
  }
  const endpoint = config.feedback?.endpoint;
  if (typeof endpoint !== 'string' || !/^\/[\w\-./]+$/.test(endpoint) || endpoint.includes('//')) {
    throw fail('"feedback.endpoint" must be a path of the site, like /api/feedback');
  }
  const root = config.server?.root;
  if (typeof root !== 'string' || !/^(\/[\w.-]+)+$/.test(root) || root.includes('..')) {
    throw fail('"server.root" must be a full path on the server, like /var/www/sc-trade.space');
  }
  const service = config.server?.service;
  if (typeof service !== 'string' || !/^127\.0\.0\.1:\d{2,5}$/.test(service)) {
    throw fail('"server.service" must be an address on the server itself, like 127.0.0.1:8787');
  }
}

/** @param {string} dir the folder of the site @returns {SiteConfig} */
export function loadConfig(dir) {
  const config = readJson(resolve(dir, 'site.config.json'));
  validateConfig(config);
  return config;
}

/** @param {string} dir the folder of the site @returns {Dictionaries} */
export function loadDictionaries(dir) {
  return /** @type {Dictionaries} */ (Object.fromEntries(LANGUAGES.map((lang) => [lang, readJson(resolve(dir, 'i18n', `${lang}.json`))])));
}

/**
 * Every text of a dictionary by its full key (`a.b.0`), and the keys whose text is empty or not a text.
 * @param {unknown} value
 * @param {string} prefix
 * @param {{ keys: Set<string>, empty: string[] }} into
 */
function collect(value, prefix, into) {
  if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) collect(inner, prefix === '' ? key : `${prefix}.${key}`, into);
    return;
  }
  into.keys.add(prefix);
  if (!isText(value)) into.empty.push(prefix);
}

/**
 * What is wrong with the pair of dictionaries: keys only one of them has, and empty texts. Nothing wrong: `[]`.
 * @param {Record<Lang, unknown>} dictionaries
 * @returns {string[]}
 */
export function compareDictionaries(dictionaries) {
  const read = LANGUAGES.map((lang) => {
    const into = { keys: /** @type {Set<string>} */ (new Set()), empty: /** @type {string[]} */ ([]) };
    collect(dictionaries[lang], '', into);
    return { lang, ...into };
  });
  /** @type {string[]} */
  const problems = [];
  for (const one of read) {
    const others = read.filter((other) => other !== one);
    const alone = [...one.keys].filter((key) => others.some((other) => !other.keys.has(key))).sort();
    problems.push(...alone.map((key) => `only in ${one.lang}.json: ${key}`));
    problems.push(...one.empty.filter((key) => !alone.includes(key)).map((key) => `empty in ${one.lang}.json: ${key}`));
  }
  return problems;
}

/**
 * The dictionaries, checked. A build never goes on with dictionaries that differ.
 * @param {Dictionaries} dictionaries
 */
export function assertSameKeys(dictionaries) {
  const problems = compareDictionaries(dictionaries);
  if (problems.length > 0) throw new Error(`the dictionaries differ (site/i18n): ${problems.join('; ')}`);
}
