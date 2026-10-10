// The contract of the feedback form as the service applies it. The page checks a message with site/js/feedback-rules.js
// before it sends it; nothing of that is trusted here: every rule is applied again to what really arrived.
// (tests/site-server/rules.test.ts keeps the numbers and the codes of the two files the same.)

const MEGABYTE = 1024 * 1024;

export const LIMITS = Object.freeze({
  messageMin: 10,
  messageMax: 4000,
  contactMax: 200,
  shotsMax: 3,
  shotBytes: 5 * MEGABYTE,
  logsMax: 1,
  logBytes: 2 * MEGABYTE,
});

/** @typedef {'too_short' | 'too_long' | 'too_many_files' | 'file_too_big' | 'bad_file_type' | 'rate_limited' | 'spam' | 'server'} ErrorCode */

/** The HTTP status each refusal goes out with. The page reads the code of the JSON, not the status. */
export const STATUS = Object.freeze({
  too_short: 400,
  too_long: 400,
  too_many_files: 400,
  file_too_big: 413,
  bad_file_type: 415,
  rate_limited: 429,
  spam: 403,
  server: 500,
});

/** @type {readonly ErrorCode[]} */
export const ERROR_CODES = Object.freeze(/** @type {ErrorCode[]} */ (Object.keys(STATUS)));

/** A form filled in faster than this, from the moment it was shown, was not filled in by a person. */
export const MIN_FILL_MS = 3000;

/** How long the name of a file, as the sender called it, is kept in a message (characters). */
export const FILE_NAME_MAX = 100;

/** A refusal of a message: it travels as an error from wherever it is found to the place that answers. */
export class Refusal extends Error {
  /**
   * @param {ErrorCode} code
   * @param {{ status?: number, why?: string }} [more] `why`: a word for the log of the service, never a text of a sender
   */
  constructor(code, more = {}) {
    super(code);
    this.name = 'Refusal';
    this.code = code;
    this.status = more.status ?? STATUS[code];
    this.why = more.why ?? '';
  }
}

/** How many characters a person sees: a character that takes two code units is one. */
export function countChars(/** @type {string} */ text) {
  let count = 0;
  for (const _char of text) count++;
  return count;
}

/** @param {string} text @param {number} max @returns {string} the first `max` characters, never half of one */
function firstChars(text, max) {
  return countChars(text) <= max ? text : Array.from(text).slice(0, max).join('');
}

// Characters that are not text: the C0 and C1 controls and DEL. A line break and a tab are kept where a text may
// have several lines.
const CONTROLS_BUT_BREAKS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const CONTROLS = /[\u0000-\u001F\u007F-\u009F]/g;
// (built from a string: the two separators of lines beyond U+2000 must not stand in the source of an expression)
const LINE_BREAKS = new RegExp('[\\t\\n\\r\\u2028\\u2029]+', 'g');
// Marks that turn the direction of the text around: in a name or a contact they only serve to show one thing and
// mean another.
const DIRECTION_MARKS = /[؜‎‏‪-‮⁦-⁩]/g;

/**
 * The text of a message as it is judged and kept: browsers send a line break as CR LF, the page counts it as one
 * character; what is not text is dropped; the spaces around are cut.
 * @param {string} raw
 */
export function cleanMessage(raw) {
  return raw.replace(/\r\n?/g, '\n').replace(CONTROLS_BUT_BREAKS, '').trim();
}

/** A contact is one line. @param {string} raw */
export function cleanContact(raw) {
  return raw.replace(LINE_BREAKS, ' ').replace(CONTROLS, '').replace(DIRECTION_MARKS, '').trim();
}

/**
 * The name the sender gave a file, as a piece of text to show to the author — it is never a path and never part of
 * one: without controls, without what stood before a slash, cut to a length.
 * @param {unknown} raw
 */
export function cleanFileName(raw) {
  if (typeof raw !== 'string') return '';
  const base = (raw.replace(CONTROLS, '').replace(DIRECTION_MARKS, '').split(/[\\/]/).pop() ?? '').trim();
  return base === '.' || base === '..' ? '' : firstChars(base, FILE_NAME_MAX);
}

/** @param {string} message cleaned @returns {ErrorCode | null} */
export function checkMessage(message) {
  const length = countChars(message);
  if (length < LIMITS.messageMin) return 'too_short';
  if (length > LIMITS.messageMax) return 'too_long';
  return null;
}

/** @param {string} contact cleaned @returns {ErrorCode | null} */
export function checkContact(contact) {
  return countChars(contact) > LIMITS.contactMax ? 'too_long' : null;
}

/**
 * Was the form sent sooner after it was shown than a person can fill it in? `started` is the clock of the visitor,
 * so only one answer is certain: "less than three seconds ago". A clock that runs ahead (a time in the future), a
 * page left open for days, a value that is missing or is not a number — none of them is a sign of a robot.
 * @param {string | undefined} started what the form sent: milliseconds since 1970, as digits
 * @param {number} now the clock of the service when the request arrived
 */
export function isTooFast(started, now) {
  if (started === undefined || !/^\d{1,16}$/.test(started)) return false;
  const elapsed = now - Number(started);
  return elapsed >= 0 && elapsed < MIN_FILL_MS;
}

/** The language of the page the form was on: one of the two the site has, or nothing. @param {string | undefined} raw */
export function cleanLang(raw) {
  return raw === 'ru' || raw === 'en' ? raw : '';
}
