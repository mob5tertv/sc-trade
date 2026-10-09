// The password of the author's page. The service never holds the password itself: the settings carry its scrypt
// hash, made with a salt of its own, and a typed password is checked against it in constant time.
//
// A hash is one line: scrypt$N=32768,r=8,p=3$<salt, base64>$<key, base64>
import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';

/** @typedef {{ N: number, r: number, p: number }} Work how much work a hash takes to compute */

/** The work a new hash is made with: 32 MB of memory, three passes. */
const DEFAULT_WORK = Object.freeze({ N: 32768, r: 8, p: 3 });

/** The least and the most work the service accepts in a hash it is given. */
const N_MIN = 16384;
const N_MAX = 1048576;

const SALT_BYTES = 16;
const KEY_BYTES = 32;

export const PASSWORD_MIN = 12;
/** Nobody types a password longer than this; a longer one is not looked at. */
const PASSWORD_MAX_BYTES = 1024;

const SHAPE = /^scrypt\$N=(\d{1,8}),r=(\d{1,3}),p=(\d{1,3})\$([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2})$/;

/** scrypt needs 128·N·r bytes; Node refuses more than `maxmem` unless told. */
const options = (/** @type {Work} */ work) => ({ ...work, maxmem: 256 * work.N * work.r });

/**
 * @param {string} hash
 * @returns {Work & { salt: Buffer, key: Buffer }}
 */
export function parseHash(hash) {
  const match = typeof hash === 'string' ? SHAPE.exec(hash) : null;
  if (match === null) throw new Error('not a hash of a password: it must look like scrypt$N=32768,r=8,p=3$<salt>$<hash> (setup.sh makes it)');
  const [N, r, p] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if ((N & (N - 1)) !== 0) throw new Error('not a hash the service takes: N must be a power of two');
  if (N < N_MIN || N > N_MAX) throw new Error(`not a hash the service takes: N must be from ${N_MIN} to ${N_MAX}`);
  if (r < 8 || r > 32) throw new Error('not a hash the service takes: r must be from 8 to 32');
  if (p < 1 || p > 16) throw new Error('not a hash the service takes: p must be from 1 to 16');
  const salt = Buffer.from(match[4], 'base64');
  const key = Buffer.from(match[5], 'base64');
  if (salt.length < SALT_BYTES) throw new Error(`not a hash the service takes: the salt must be at least ${SALT_BYTES} bytes`);
  if (key.length < KEY_BYTES || key.length > 64) throw new Error(`not a hash the service takes: the hash itself must be from ${KEY_BYTES} to 64 bytes`);
  return { N, r, p, salt, key };
}

/**
 * The hash of a new password, with a salt made for it.
 * @param {string} password
 * @param {Work} [work]
 * @returns {string}
 */
export function hashPassword(password, work = DEFAULT_WORK) {
  if (Array.from(password).length < PASSWORD_MIN) throw new Error(`the password must be at least ${PASSWORD_MIN} characters long`);
  if (Buffer.byteLength(password) > PASSWORD_MAX_BYTES) throw new Error(`the password is too long (${PASSWORD_MAX_BYTES} bytes at the most)`);
  const salt = randomBytes(SALT_BYTES);
  const key = scryptSync(password, salt, KEY_BYTES, options(work));
  return `scrypt$N=${work.N},r=${work.r},p=${work.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/**
 * Is this the password the hash was made of? The answer takes the same time whether the password is nearly right
 * or not at all.
 * @param {string} password what was typed
 * @param {string} hash the hash of the settings
 * @returns {Promise<boolean>}
 */
export function verifyPassword(password, hash) {
  /** @type {ReturnType<typeof parseHash>} */
  let parsed;
  try {
    parsed = parseHash(hash);
  } catch {
    return Promise.resolve(false);
  }
  if (Buffer.byteLength(password) > PASSWORD_MAX_BYTES) return Promise.resolve(false);
  const { salt, key, ...work } = parsed;
  return new Promise((resolve, reject) => {
    scrypt(password, salt, key.length, options(work), (err, derived) => {
      if (err) return reject(err);
      resolve(derived.length === key.length && timingSafeEqual(derived, key));
    });
  });
}
