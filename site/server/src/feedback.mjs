// POST /api/feedback: takes a message of the form of the site — the text, a contact, up to three pictures, a log.
//
// Every request is read as if it were an attack. Nothing is believed that the sender says about what he sends: the
// sizes are counted while the body arrives and the reading stops at the limit; what a file is is told from its
// bytes; the name of a file is kept as a piece of text and never touches the disk. The answer is always the JSON of
// the contract — {"ok":true} or {"ok":false,"error":<code>} — never a text of the sender, never a cookie.
//
// The address of the sender is used for one thing, the limit of sending, and only as an HMAC (limiter.mjs). It is
// not written into the message, into any file or into the log.
import { randomBytes } from 'node:crypto';
import { open, rename } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { clientAddress } from './address.mjs';
import { answer, errorWord, JSON_HEADERS } from './http.mjs';
import { DAY, HOUR } from './limiter.mjs';
import { checkContact, checkMessage, cleanContact, cleanFileName, cleanLang, cleanMessage, isTooFast, LIMITS, Refusal } from './rules.mjs';
import { createTextChecker, IMAGE_HEAD_BYTES, imageType, MIME } from './sniff.mjs';
import { recordBytes, StorageFull } from './store.mjs';

/**
 * @typedef {import('./http.mjs').Request} Request
 * @typedef {import('./http.mjs').Response} Response
 * @typedef {import('./store.mjs').StoredFile} StoredFile
 * @typedef {import('./store.mjs').MessageRecord} MessageRecord
 *
 * What the service uses of busboy, the one library it has (the parser of multipart/form-data):
 * @typedef {import('node:stream').Readable & { truncated: boolean }} FileStream
 * @typedef {{
 *   on(event: 'file', listener: (name: string | undefined, stream: FileStream, info: { filename: string | undefined }) => void): void,
 *   on(event: 'field', listener: (name: string | undefined, value: string, info: { valueTruncated: boolean }) => void): void,
 *   on(event: 'filesLimit' | 'fieldsLimit' | 'partsLimit' | 'close', listener: () => void): void,
 *   on(event: 'error', listener: (err: unknown) => void): void,
 *   once(event: 'drain', listener: () => void): void,
 *   write(chunk: Buffer): boolean,
 *   end(): void,
 *   destroy(): void,
 * }} Parser
 */

/** @type {(options: { headers: { 'content-type': string }, defParamCharset: string, limits: Record<string, number> }) => Parser} */
const busboy = createRequire(import.meta.url)('busboy');

/** The text fields of the form. Any other field, or one of these twice, is not the form of the page. */
const FIELDS = ['message', 'contact', 'lang', 'website', 'started'];

/** No text of the form is bigger on the wire: 4000 characters of four bytes each make 16 000. */
const FIELD_BYTES = 32 * 1024;

/** What a body may hold besides what is kept of it: the heads of its parts. */
const ENVELOPE_BYTES = 64 * 1024;

const notTheForm = () => new Refusal('server', { status: 400, why: 'form' });

/**
 * @param {{
 *   settings: import('./config.mjs').Settings,
 *   store: import('./store.mjs').Store,
 *   limiter: import('./limiter.mjs').Limiter,
 *   everybody: import('./limiter.mjs').Limiter,
 *   now: () => number,
 *   log: (text: string) => void,
 * }} parts `limiter` counts what each address does, `everybody` what all of them do together (a table of its own,
 *   so that no flood of addresses pushes that count out); `log` writes one line of the log of the service — nothing a
 *   sender sent ever goes into it
 * @returns {(req: Request, res: Response) => void}
 */
export function createFeedback({ settings, store, limiter, everybody, now, log }) {
  const { limits } = settings;
  /** How many messages are being read right now. */
  let uploads = 0;
  /** The senders a body of which is being read right now: one body at a time for each. */
  const reading = new Set();

  return function feedback(req, res) {
    const arrived = now();
    let received = 0;
    let fileCount = 0;

    /** @param {string} result @param {number} status @param {number} [kept] @param {string} [why] */
    const say = (result, status, kept = 0, why = '') => log(`feedback ${result} status=${status} bytes=${received} files=${fileCount} kept=${kept}${why === '' ? '' : ` why=${why}`}`);

    /** @param {number} status @param {string} body @param {Record<string, string>} [headers] */
    const reply = (status, body, headers = {}) => {
      if (!res.destroyed && !res.headersSent) answer(req, res, limits.lingerMs, status, { ...JSON_HEADERS, ...headers }, body);
    };

    /** A refusal: the answer and a line of the log. A sender that goes on sending after it is cut off soon. */
    const refuse = (/** @type {Refusal} */ refusal, /** @type {Record<string, string>} */ headers = {}) => {
      reply(refusal.status, JSON.stringify({ ok: false, error: refusal.code }), headers);
      say(refusal.code, refusal.status, 0, refusal.why);
    };

    // ---- what can be told from the head of the request alone; not a byte of the body is read for it

    if (req.method !== 'POST') return refuse(new Refusal('server', { status: 405, why: 'method' }), { Allow: 'POST' });

    const type = req.headers['content-type'];
    if (typeof type !== 'string' || !/^multipart\/form-data\s*;.*\bboundary=/i.test(type)) return refuse(new Refusal('server', { status: 415, why: 'type' }));

    // a browser names the site a request was made from: a form or a script of another site is not let in
    const { origin } = req.headers;
    if (origin !== undefined && origin !== settings.origin) return refuse(new Refusal('spam', { why: 'origin' }));

    const announced = Number(req.headers['content-length']);
    if (announced > limits.bodyBytes) return refuse(new Refusal('file_too_big'));

    const who = limiter.addressKey(clientAddress(req.headers['x-forwarded-for']));
    const sentKey = `sent:${who}`;
    const bytesKey = `bytes:${who}`;
    const triedKey = `tried:${who}`;
    const tooOften = (/** @type {string} */ why) => new Refusal('rate_limited', { why });
    // one address has one body open at a time: with one address nobody takes every place there is
    if (reading.has(who)) return refuse(tooOften('open'));
    const sentTooOften = () =>
      limiter.count(sentKey, HOUR) >= limits.perAddressHour || limiter.count(sentKey, DAY) >= limits.perAddressDay || everybody.count('sent', HOUR) >= limits.globalHour;
    /** Would so many more bytes be more than this address may have kept in a day, or everybody in an hour? */
    const overBudget = (/** @type {number} */ more) =>
      limiter.sum(bytesKey, DAY) + more > limits.perAddressDayBytes || everybody.sum('bytes', HOUR) + more > limits.globalHourBytes;
    if (sentTooOften()) return refuse(tooOften('often'));
    if (limiter.count(triedKey, HOUR) >= limits.attemptsPerAddressHour) return refuse(tooOften('tried'));
    // a body that says it is bigger than what is left of the budget is not read at all (what it would keep is at
    // least what it holds without the heads of its parts)
    if (overBudget(Math.max(1, announced > 0 ? announced - ENVELOPE_BYTES : 1))) return refuse(tooOften('bytes'));

    if (uploads >= limits.uploadsAtOnce) return refuse(new Refusal('server', { status: 503, why: 'busy' }));
    if (announced > 0 && store.usedBytes() + announced > limits.storageBytes + ENVELOPE_BYTES) return refuse(new Refusal('server', { status: 503, why: 'storage_full' }));

    /** @type {Parser} */
    let parser;
    try {
      parser = busboy({
        headers: { 'content-type': type },
        defParamCharset: 'utf8',
        limits: {
          fieldSize: FIELD_BYTES,
          fields: FIELDS.length,
          // one more than the form may hold: the one too many is told apart from a body that is merely broken
          files: LIMITS.shotsMax + LIMITS.logsMax + 1,
          parts: FIELDS.length + LIMITS.shotsMax + LIMITS.logsMax + 1,
          fileSize: Math.max(LIMITS.shotBytes, LIMITS.logBytes) + 1,
        },
      });
    } catch {
      return refuse(notTheForm());
    }

    // ---- the body, as it arrives

    // every body the service is made to read is counted, whatever becomes of it
    limiter.mark(triedKey, HOUR);
    uploads++;
    reading.add(who);
    const id = store.newId();
    /** @type {Map<string, string>} */
    const texts = new Map();
    /** @type {Promise<StoredFile>[]} */
    const jobs = [];
    let shots = 0;
    let logs = 0;
    let over = false;

    /** @type {Promise<string> | null} */
    let work = null;
    const workDir = () => (work ??= store.workDir(id));

    /**
     * Ends the work on this request, once: answers, stops the reading, throws away what is not kept.
     * @param {Refusal | 'aborted' | number} outcome a refusal; the sender went away; or the bytes that were kept
     */
    const finish = (outcome) => {
      if (over) return;
      over = true;
      clearTimeout(deadline);
      clearTimeout(silence);
      uploads--;
      reading.delete(who);
      if (outcome === 'aborted') say('aborted', 0);
      else if (typeof outcome === 'number') {
        reply(200, '{"ok":true}');
        say('ok', 200, outcome);
      } else refuse(outcome);
      parser.destroy();
      // the files being written are let go first: a folder cannot be removed from under an open file
      void Promise.allSettled(jobs)
        .then(() => store.discard(id))
        .catch((err) => log(`error discard ${errorWord(err)}`));
    };

    /** @param {unknown} err */
    const fail = (err) => {
      if (err instanceof Refusal) return finish(err);
      if (err instanceof StorageFull) return finish(new Refusal('server', { status: 503, why: 'storage_full' }));
      finish(new Refusal('server', { why: errorWord(err) }));
    };

    const deadline = setTimeout(() => fail(new Refusal('server', { status: 408, why: 'deadline' })), limits.requestMs);

    // A sender that falls silent does not keep its place until the deadline: a body that brings nothing for
    // `idleMs` is cut. The clock runs only while the service is waiting for the sender — not while it has itself
    // asked the sender to wait, and not once the body is all here.
    /** @type {NodeJS.Timeout | undefined} */
    let silence;
    const listen = () => {
      clearTimeout(silence);
      silence = setTimeout(() => fail(new Refusal('server', { status: 408, why: 'idle' })), limits.idleMs);
    };
    listen();

    /**
     * Writes one file of the form into the work folder, judging it on the way: its size, and whether it is what
     * the form takes — a picture by its signature, a log by being text.
     * @param {'shot' | 'log'} kind
     * @param {FileStream} stream
     * @param {string | undefined} givenName
     * @returns {Promise<StoredFile>}
     */
    const receive = async (kind, stream, givenName) => {
      const limit = kind === 'shot' ? LIMITS.shotBytes : LIMITS.logBytes;
      const text = kind === 'log' ? createTextChecker() : null;
      /** @type {import('./sniff.mjs').Kind | null} */
      let ext = kind === 'log' ? 'txt' : null;
      let head = Buffer.alloc(0);
      let bytes = 0;
      const judge = new Transform({
        transform(chunk, _encoding, done) {
          bytes += chunk.length;
          if (bytes > limit) return done(new Refusal('file_too_big'));
          if (text !== null) return text.push(chunk) ? done(null, chunk) : done(new Refusal('bad_file_type'));
          if (ext !== null) return done(null, chunk);
          // a picture: nothing of it is written until its first bytes say what it is
          head = Buffer.concat([head, chunk]);
          if (head.length < IMAGE_HEAD_BYTES) return done();
          ext = imageType(head);
          return ext === null ? done(new Refusal('bad_file_type')) : done(null, head);
        },
        flush(done) {
          if (bytes === 0 || ext === null || (text !== null && !text.end())) return done(new Refusal('bad_file_type'));
          done();
        },
      });

      const folder = await workDir();
      const draft = join(folder, `${randomBytes(16).toString('hex')}.part`);
      const handle = await open(draft, 'wx', 0o600);
      try {
        await pipeline(stream, judge, async (pieces) => {
          for await (const piece of pieces) await handle.appendFile(piece);
        });
        if (stream.truncated || ext === null) throw new Refusal('file_too_big');
        await handle.sync();
      } finally {
        await handle.close();
      }
      // the name on the disk is made here; the extension is the kind the content was found to be
      const stored = `${randomBytes(16).toString('hex')}.${ext}`;
      await rename(draft, join(folder, stored));
      return { kind, stored, type: MIME[ext], bytes, name: cleanFileName(givenName) };
    };

    /** The body is all here and every file is written: the last look at the texts, and the message is kept. */
    const keep = async () => {
      const files = await Promise.all(jobs);
      if (over) return;
      const message = cleanMessage(texts.get('message') ?? '');
      const contact = cleanContact(texts.get('contact') ?? '');
      const problem = checkMessage(message) ?? checkContact(contact);
      if (problem !== null) throw new Refusal(problem);
      /** @type {MessageRecord} */
      const record = { id, receivedAt: new Date(store.timeOf(id)).toISOString(), lang: cleanLang(texts.get('lang')), message, contact, files };
      // the limits of sending are looked at again at the very moment of keeping, and the message is counted before
      // the first wait: of several messages sent at the same instant only as many get through as the limits allow
      const bytes = recordBytes(record);
      if (sentTooOften()) throw tooOften('often');
      if (overBudget(bytes)) throw tooOften('bytes');
      limiter.mark(sentKey, DAY);
      limiter.mark(bytesKey, DAY, bytes);
      everybody.mark('sent', HOUR);
      everybody.mark('bytes', HOUR, bytes);
      finish(await store.save(record));
    };

    parser.on('field', (name, value, info) => {
      if (over) return;
      if (name === undefined || !FIELDS.includes(name) || texts.has(name)) return fail(notTheForm());
      texts.set(name, value);
      // the trap: a field a person does not see and leaves empty
      if (name === 'website') return value === '' ? undefined : fail(new Refusal('spam', { why: 'trap' }));
      if (info.valueTruncated) return fail(name === 'message' || name === 'contact' ? new Refusal('too_long') : notTheForm());
      if (name === 'started' && isTooFast(value, arrived)) return fail(new Refusal('spam', { why: 'fast' }));
      // the texts come before the files: a message that is refused for its text is refused before its files are read
      const problem = name === 'message' ? checkMessage(cleanMessage(value)) : name === 'contact' ? checkContact(cleanContact(value)) : null;
      if (problem !== null) fail(new Refusal(problem));
    });

    parser.on('file', (name, stream, info) => {
      // an error of the stream is handled where the file is written; without a listener of its own it would stop the service
      stream.on('error', () => {});
      const kind = name === 'shots[]' ? 'shot' : name === 'log' ? 'log' : null;
      const tooMany = kind === 'shot' ? ++shots > LIMITS.shotsMax : kind === 'log' ? ++logs > LIMITS.logsMax : false;
      if (over || kind === null || tooMany) {
        stream.resume();
        if (kind === null) fail(notTheForm());
        else if (tooMany) fail(new Refusal('too_many_files'));
        return;
      }
      fileCount++;
      const job = receive(kind, stream, info.filename);
      job.catch(fail);
      jobs.push(job);
    });

    parser.on('filesLimit', () => fail(new Refusal('too_many_files')));
    parser.on('partsLimit', () => fail(new Refusal('too_many_files')));
    parser.on('fieldsLimit', () => fail(notTheForm()));
    parser.on('error', () => fail(notTheForm()));
    parser.on('close', () => {
      if (!over) keep().catch(fail);
    });

    req.on('data', (chunk) => {
      received += chunk.length;
      if (over) return;
      listen();
      // the limit of the whole body, counted as it is read: what the head of the request said about it is not believed
      if (received > limits.bodyBytes) return fail(new Refusal('file_too_big'));
      // whatever a body is made of, the worst it can do is not be the form: an error the parser throws at it is a
      // refusal of this one request, never the end of the service
      try {
        if (!parser.write(chunk)) {
          // the service is behind, not the sender: the sender is asked to wait, and its silence is not counted
          req.pause();
          clearTimeout(silence);
          parser.once('drain', () => {
            if (over) return;
            listen();
            req.resume();
          });
        }
      } catch {
        fail(notTheForm());
      }
    });
    req.on('end', () => {
      clearTimeout(silence);
      if (over) return;
      try {
        parser.end();
      } catch {
        fail(notTheForm());
      }
    });
    req.on('error', () => finish('aborted'));
    // the sender went away before the answer
    res.on('close', () => finish('aborted'));
  };
}
