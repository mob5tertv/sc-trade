// Where the messages are kept: a folder outside the root of the site (/var/lib/sc-trade-site), which only the
// service can read.
//
//   messages/<id>.json      a message: what the sender typed, and the list of its files
//   files/<id>/<name>.<ext> the files of a message, under names the service made
//   tmp/                    work in progress; emptied when the service starts
//
// A message exists from the moment its JSON file is in `messages`, and it gets there whole: it is written under
// `tmp` and moved. No name here ever comes from a sender: an id and a file name are made by the service and are
// checked against their shape again every time one is turned into a path.
import { randomBytes } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { MIME } from './sniff.mjs';

/**
 * @typedef {{ kind: 'shot' | 'log', stored: string, type: string, bytes: number, name: string }} StoredFile
 *   `stored`: the name on the disk; `name`: what the sender called the file, as text to show.
 * @typedef {{ id: string, receivedAt: string, lang: '' | 'ru' | 'en', message: string, contact: string, files: StoredFile[] }} MessageRecord
 */

const ID = /^[0-9a-f]{32}$/;
const STORED = /^[0-9a-f]{32}\.(png|jpg|webp|txt)$/;
/** @type {readonly string[]} */
const TYPES = Object.values(MIME);

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The check for messages past their term runs once a day (service.mjs); see `isDue`. */
export const SWEEP_EVERY_MS = DAY;

/** The bytes a message takes on the disk: its JSON and its files. @param {MessageRecord} record */
export function recordBytes(record) {
  return Buffer.byteLength(JSON.stringify(record)) + record.files.reduce((total, file) => total + file.bytes, 0);
}

/** There is no room left under the ceiling of the storage. */
export class StorageFull extends Error {
  constructor() {
    super('the storage is full');
    this.name = 'StorageFull';
  }
}

/** @param {unknown} value @param {string} id @returns {value is MessageRecord} is this what the service writes for this id? */
function isRecord(value, id) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = /** @type {Record<string, unknown>} */ (value);
  if (record.id !== id || typeof record.receivedAt !== 'string' || typeof record.message !== 'string' || typeof record.contact !== 'string') return false;
  if (record.lang !== '' && record.lang !== 'ru' && record.lang !== 'en') return false;
  if (!Array.isArray(record.files)) return false;
  return record.files.every((file) => {
    if (file === null || typeof file !== 'object') return false;
    const { kind, stored, type, bytes, name } = /** @type {Record<string, unknown>} */ (file);
    if (kind !== 'shot' && kind !== 'log') return false;
    if (typeof stored !== 'string' || !STORED.test(stored) || typeof type !== 'string' || !TYPES.includes(type)) return false;
    return typeof bytes === 'number' && Number.isInteger(bytes) && bytes >= 0 && typeof name === 'string';
  });
}

/** @param {string} dir @returns {Promise<number>} the bytes of every file under a folder; a folder that is not there holds none */
async function bytesUnder(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) total += await bytesUnder(path);
    else total += (await stat(path).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

/**
 * @param {{ dir: string, now: () => number, storageBytes: number, retentionMs: number }} options
 *   `storageBytes`: the ceiling of everything kept; `retentionMs`: how long a message may be kept
 */
export function createStore({ dir, now, storageBytes, retentionMs }) {
  const messagesDir = join(dir, 'messages');
  const filesDir = join(dir, 'files');
  const tmpDir = join(dir, 'tmp');
  let used = 0;

  /** The moment an id was made: its first twelve digits. @param {string} id */
  const timeOf = (id) => parseInt(id.slice(0, 12), 16);
  /** A message is not shown and not handed out once it is as old as it may get. @param {string} id */
  const isLive = (id) => ID.test(id) && timeOf(id) + retentionMs > now();
  /**
   * The daily check removes a message a day before its term: it would not look again before the term has passed.
   * @param {string} id
   */
  const isDue = (id) => timeOf(id) + retentionMs - SWEEP_EVERY_MS <= now();

  /** @type {Promise<unknown>} */
  let line = Promise.resolve();
  /**
   * One change of the storage at a time: a message being kept and the count of what is kept never see half of
   * each other's work.
   * @template T
   * @param {() => Promise<T>} change
   * @returns {Promise<T>}
   */
  const alone = (change) => {
    const result = line.then(change);
    line = result.catch(() => {});
    return result;
  };

  const measure = async () => {
    used = (await bytesUnder(messagesDir)) + (await bytesUnder(filesDir));
  };

  /** @param {string} id of the right shape @returns {Promise<boolean>} was there such a message */
  const erase = async (id) => {
    const size = (await stat(join(messagesDir, `${id}.json`)).catch(() => ({ size: 0 }))).size + (await bytesUnder(join(filesDir, id)));
    // the JSON first: from this moment the message is gone, whatever happens to the rest
    const existed = await rm(join(messagesDir, `${id}.json`)).then(
      () => true,
      () => false,
    );
    await rm(join(filesDir, id), { recursive: true, force: true });
    used = Math.max(0, used - size);
    return existed;
  };

  /** @param {string} folder @returns {Promise<string[]>} */
  const names = (folder) => readdir(folder).catch(() => []);

  return {
    /** Makes the folders, throws away the work of a run that was killed, counts what is kept. */
    async open() {
      for (const folder of [dir, messagesDir, filesDir]) await mkdir(folder, { recursive: true, mode: 0o700 });
      await rm(tmpDir, { recursive: true, force: true });
      await mkdir(tmpDir, { mode: 0o700 });
      await measure();
    },

    /** A new id: the time in its first twelve digits (so that names sort by age), the rest is chance. */
    newId: () => now().toString(16).padStart(12, '0').slice(-12) + randomBytes(10).toString('hex'),
    timeOf,
    usedBytes: () => used,

    /** The folder the files of a message are written into before the message is kept. @param {string} id */
    async workDir(id) {
      if (!ID.test(id)) throw new Error('not an id');
      const work = join(tmpDir, id);
      await mkdir(work, { recursive: true, mode: 0o700 });
      return work;
    },

    /** Throws away the work folder of a message that is not kept after all. @param {string} id */
    async discard(id) {
      if (!ID.test(id)) return;
      await rm(join(tmpDir, id), { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      await rm(join(tmpDir, `${id}.json`), { force: true });
    },

    /**
     * Keeps a message. Its files are expected in its work folder, under the names the record gives them.
     * @param {MessageRecord} record
     * @returns {Promise<number>} the bytes it takes
     */
    save(record) {
      const { id } = record;
      if (!ID.test(id) || !isRecord(record, id)) return Promise.reject(new Error('not a message'));
      const json = JSON.stringify(record);
      const bytes = recordBytes(record);
      return alone(async () => {
        if (used + bytes > storageBytes) throw new StorageFull();
        const draft = join(tmpDir, `${id}.json`);
        try {
          if (record.files.length > 0) await rename(join(tmpDir, id), join(filesDir, id));
          const handle = await open(draft, 'wx', 0o600);
          try {
            await handle.writeFile(json);
            await handle.sync();
          } finally {
            await handle.close();
          }
          await rename(draft, join(messagesDir, `${id}.json`));
        } catch (err) {
          await rm(join(filesDir, id), { recursive: true, force: true }).catch(() => {});
          await rm(draft, { force: true }).catch(() => {});
          throw err;
        }
        used += bytes;
        return bytes;
      });
    },

    /** The ids of the messages, newest first. */
    async ids() {
      return (await names(messagesDir))
        .filter((name) => name.endsWith('.json'))
        .map((name) => name.slice(0, -'.json'.length))
        .filter(isLive)
        .sort()
        .reverse();
    },

    /** @param {string} id @returns {Promise<MessageRecord | null>} `null`: no such message, or a file that is not one */
    async read(id) {
      if (typeof id !== 'string' || !isLive(id)) return null;
      try {
        const value = JSON.parse(await readFile(join(messagesDir, `${id}.json`), 'utf8'));
        return isRecord(value, id) ? value : null;
      } catch {
        return null;
      }
    },

    /** Deletes a message with its files. @param {string} id @returns {Promise<boolean>} was there such a message */
    remove(id) {
      if (typeof id !== 'string' || !ID.test(id)) return Promise.resolve(false);
      return alone(() => erase(id));
    },

    /**
     * Where a file of a message lies; `null` unless both names have the shape the service gives them.
     * @param {string} id
     * @param {string} stored
     */
    filePath: (id, stored) => (typeof id === 'string' && typeof stored === 'string' && isLive(id) && STORED.test(stored) ? join(filesDir, id, stored) : null),

    /**
     * Removes the messages that have reached their term, and files that belong to no message: folders without a
     * message and work nobody came back for (older than an hour — a younger one may be a message that is being
     * received right now), and anything under a name the service never gives. Then counts what is kept.
     * @returns {Promise<{ expired: number, strays: number }>}
     */
    sweep() {
      return alone(async () => {
        let expired = 0;
        let strays = 0;
        const kept = new Set();
        for (const name of await names(messagesDir)) {
          const id = name.endsWith('.json') ? name.slice(0, -'.json'.length) : '';
          if (!ID.test(id)) continue;
          if (!isDue(id)) kept.add(id);
          else if (await erase(id)) expired++;
        }
        const old = (/** @type {string} */ id) => timeOf(id) + HOUR <= now();
        for (const name of await names(filesDir)) {
          if (kept.has(name) || (ID.test(name) && !old(name))) continue;
          await rm(join(filesDir, name), { recursive: true, force: true });
          strays++;
        }
        for (const name of await names(tmpDir)) {
          const id = name.endsWith('.json') ? name.slice(0, -'.json'.length) : name;
          if (ID.test(id) && !old(id)) continue;
          await rm(join(tmpDir, name), { recursive: true, force: true });
          strays++;
        }
        await measure();
        return { expired, strays };
      });
    },
  };
}

/** @typedef {ReturnType<typeof createStore>} Store */
