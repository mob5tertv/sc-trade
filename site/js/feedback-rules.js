// The rules of the feedback form, the same the server applies (the contract: POST multipart/form-data with
// `message`, `contact`, `shots[]`, `log`, `lang`, `website`, `started`; the answer is JSON `{ ok: true }` or
// `{ ok: false, error: <code> }`). No page here: plain functions, so that the tests can call them.

/** @typedef {{ name: string, size: number, type: string }} FileLike what the rules read of a chosen file */
/** @typedef {'too_short' | 'too_long' | 'too_many_files' | 'file_too_big' | 'bad_file_type' | 'rate_limited' | 'spam' | 'server'} ErrorCode */

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

/** @type {readonly ErrorCode[]} */
export const ERROR_CODES = Object.freeze(['too_short', 'too_long', 'too_many_files', 'file_too_big', 'bad_file_type', 'rate_limited', 'spam', 'server']);

const SHOT_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** How many characters a person sees: a character that takes two code units is one. */
export function countChars(/** @type {string} */ text) {
  return Array.from(text).length;
}

/** A picture: the name says PNG, JPEG or WebP, and the browser, when it knows the type, says the same. */
function isShot(/** @type {FileLike} */ file) {
  return /\.(png|jpe?g|webp)$/i.test(file.name) && (file.type === '' || SHOT_TYPES.includes(file.type));
}

function isLog(/** @type {FileLike} */ file) {
  return /\.(log|txt)$/i.test(file.name);
}

/**
 * What is wrong with a message before it is sent, as the code the server would answer with; `null`: nothing.
 * The text is judged first, then the number of files, their kind, their size.
 * @param {{ message: string, contact: string, shots: FileLike[], logs: FileLike[] }} input
 * @returns {ErrorCode | null}
 */
export function checkFeedback(input) {
  const length = countChars(input.message.trim());
  if (length < LIMITS.messageMin) return 'too_short';
  if (length > LIMITS.messageMax || countChars(input.contact.trim()) > LIMITS.contactMax) return 'too_long';
  if (input.shots.length > LIMITS.shotsMax || input.logs.length > LIMITS.logsMax) return 'too_many_files';
  if (!input.shots.every(isShot) || !input.logs.every(isLog)) return 'bad_file_type';
  if (input.shots.some((file) => file.size > LIMITS.shotBytes) || input.logs.some((file) => file.size > LIMITS.logBytes)) return 'file_too_big';
  return null;
}

/**
 * What the server answered. Anything that is not the contract is `server`: a page of the web server instead of
 * JSON, a code nobody knows, a success under an error status.
 * @param {number} status the HTTP status
 * @param {string} body the text of the answer
 * @returns {{ ok: true } | { ok: false, error: ErrorCode }}
 */
export function readReply(status, body) {
  /** @type {unknown} */
  let reply = null;
  try {
    reply = JSON.parse(body);
  } catch {
    // not JSON: judged by the status below
  }
  if (reply !== null && typeof reply === 'object') {
    const { ok, error } = /** @type {{ ok?: unknown, error?: unknown }} */ (reply);
    if (ok === true && status >= 200 && status < 300) return { ok: true };
    const known = ERROR_CODES.find((code) => code === error);
    if (ok === false && known !== undefined) return { ok: false, error: known };
  }
  // the web server in front of the service refuses a body that is too big, or too many requests, by itself
  if (status === 413) return { ok: false, error: 'file_too_big' };
  if (status === 429) return { ok: false, error: 'rate_limited' };
  return { ok: false, error: 'server' };
}

/** How much has been sent, as a whole percent. */
export function progressPercent(/** @type {number} */ loaded, /** @type {number} */ total) {
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(100, Math.floor((loaded / total) * 100)));
}
