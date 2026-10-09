// The author's page: /admin/. Here the author reads the messages, finds one, downloads its files and deletes —
// one message, the ones he ticked, or everything a search found.
//
//   /admin/login                 the password; a session begins
//   /admin/                      the list, newest first; ?q= searches, ?page= turns the pages
//   /admin/m/<id>                one message
//   /admin/m/<id>/file/<n>       its n-th file, as a download
//   /admin/m/<id>/delete  POST   deletes it with its files
//   /admin/delete         POST   deletes the messages ticked on the list
//   /admin/delete-found          asks whether everything a search found is to be deleted; POST does it
//   /admin/logout         POST   ends the session
//   /admin/assets/admin.css      the look of the pages
//
// Without a session there is the login page and the style sheet, nothing else: every other address answers with a
// redirect to the login, whether it exists or not. Whatever changes something is a POST that brings the token of
// the session. A path is never built from what a request says: an address either has the shape of one of the lines
// above — an id of 32 hex digits, a number — or it is not found.
import { createReadStream, readFileSync } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { pipeline } from 'node:stream';
import { deleteFoundPage, listPage, loginPage, messagePage, notePage } from './admin-pages.mjs';
import { clientAddress } from './address.mjs';
import { answer, errorWord } from './http.mjs';
import { verifyPassword } from './password.mjs';
import { cookieFor, createSessions, sameToken, sessionIdFrom } from './sessions.mjs';

/**
 * @typedef {import('./http.mjs').Request} Request
 * @typedef {import('./http.mjs').Response} Response
 */

const STYLES = readFileSync(new URL('./assets/admin.css', import.meta.url));

const ID = /^[0-9a-f]{32}$/;
const MESSAGE = /^\/admin\/m\/([0-9a-f]{32})$/;
const FILE = /^\/admin\/m\/([0-9a-f]{32})\/file\/([1-9])$/;
const DELETE = /^\/admin\/m\/([0-9a-f]{32})\/delete$/;

const PAGE_SIZE = 20;
/** A form of the author's page is a password, a token, the boxes of one page of the list: nothing bigger is read. */
const FORM_BYTES = 8 * 1024;
const FORM_MS = 10_000;
/** How many logins may wait for their password to be checked (one is checked at a time). */
const LOGIN_QUEUE = 32;
/** The list says so when the storage is fuller than this. */
const STORAGE_WARNING = 0.8;

/** What every answer of the author's page carries: kept by no browser, shown by no search engine, framed by no site. */
const COMMON = Object.freeze({
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
});
// The web server in front puts the policy of the site on every answer; these are for the day the service is
// reached without it.
const PAGE_POLICY = "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
const FILE_POLICY = "default-src 'none'; sandbox";

const TEXTS = Object.freeze({
  wrong: 'Неверный пароль.',
  locked: 'Слишком много неверных паролей с этого адреса. Попробуй через 15 минут.',
  busy: 'Сервер занят. Попробуй ещё раз через минуту.',
  forbidden: 'Действие отклонено: страница устарела или запрос пришёл не с неё. Вернись к списку, открой страницу заново и повтори.',
  unsure: 'Поставь галочку, которая подтверждает удаление, и нажми кнопку ещё раз.',
  nothing: 'Ничего не отмечено: поставь галочки у обращений, которые надо удалить.',
  noWords: 'Сначала найди то, что надо удалить: впиши слова в поиск на странице списка.',
  missing: 'Такой страницы нет.',
  method: 'Так к этой странице не обращаются.',
  form: 'Запрос не похож на форму этой страницы.',
});

/** An answer decided deep inside the reading of a form: it travels up as an error. */
class Halt extends Error {
  /** @param {number} status @param {string} title @param {string} text @param {string} [why] a word for the log */
  constructor(status, title, text, why = 'form') {
    super(title);
    this.status = status;
    this.title = title;
    this.text = text;
    this.why = why;
  }
}

/**
 * The fields of a small form. Nothing bigger than a password and a token is read, and not for long.
 * @param {Request} req
 * @returns {Promise<URLSearchParams>}
 */
function readForm(req) {
  const type = req.headers['content-type'];
  if (typeof type !== 'string' || !/^application\/x-www-form-urlencoded\s*(;|$)/i.test(type)) return Promise.reject(new Halt(415, 'Не принято', TEXTS.form));
  if (Number(req.headers['content-length']) > FORM_BYTES) return Promise.reject(new Halt(413, 'Не принято', TEXTS.form));
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let bytes = 0;
    const stop = (/** @type {() => void} */ settle) => {
      clearTimeout(timer);
      req.off('data', onData);
      settle();
    };
    const onData = (/** @type {Buffer} */ chunk) => {
      bytes += chunk.length;
      if (bytes > FORM_BYTES) return stop(() => reject(new Halt(413, 'Не принято', TEXTS.form)));
      chunks.push(chunk);
    };
    const timer = setTimeout(() => stop(() => reject(new Halt(408, 'Не принято', TEXTS.form))), FORM_MS);
    req.on('data', onData);
    req.on('end', () => stop(() => resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8')))));
    req.on('error', () => stop(() => reject(new Halt(400, 'Не принято', TEXTS.form))));
  });
}

/** The words of a search: one short line. @param {string | null} raw */
function cleanQuery(raw) {
  return Array.from((raw ?? '').replace(/[\u0000-\u001F\u007F-\u009F]+/g, ' ').trim()).slice(0, 100).join('');
}

/** The address of the list for a search: made here from the words, never taken from a request as an address. */
const listAddress = (/** @type {string} */ q) => (q === '' ? '/admin/' : `/admin/?q=${encodeURIComponent(q)}`);

/**
 * @param {{
 *   settings: import('./config.mjs').Settings,
 *   store: import('./store.mjs').Store,
 *   logins: import('./limiter.mjs').Limiter,
 *   now: () => number,
 *   log: (text: string) => void,
 *   sleep: (ms: number) => Promise<unknown>,
 * }} parts `logins` counts wrong passwords and nothing else: nothing the form of the site does reaches that table
 * @returns {(req: Request, res: Response, path: string, query: string) => Promise<void>}
 */
export function createAdmin({ settings, store, logins, now, log, sleep }) {
  const { limits } = settings;
  const sessions = createSessions({ now, lifeMs: limits.sessionMs });
  /** The logins whose password is being checked or waits to be: one after another. */
  let waiting = 0;
  /** @type {Promise<unknown>} */
  let turn = Promise.resolve();
  /** When a password was last looked at. */
  let lastCheck = -Infinity;

  /** @param {Request} req @param {Response} res @param {number} status @param {string} body @param {Record<string, string>} [headers] */
  const html = (req, res, status, body, headers = {}) =>
    answer(req, res, limits.lingerMs, status, { ...COMMON, 'Content-Security-Policy': PAGE_POLICY, 'Content-Type': 'text/html; charset=utf-8', ...headers }, body);
  /** @param {Request} req @param {Response} res @param {number} status @param {string} location @param {Record<string, string>} [headers] */
  const redirect = (req, res, status, location, headers = {}) =>
    answer(req, res, limits.lingerMs, status, { ...COMMON, 'Content-Security-Policy': PAGE_POLICY, Location: location, ...headers });

  /** The moment a message came, from its id (the id is made by the service; what the file says is not asked). */
  const isoOf = (/** @type {string} */ id) => new Date(store.timeOf(id)).toISOString();

  /** A request that changes something must come from the site itself: a browser says where a request was made. */
  const fromTheSite = (/** @type {Request} */ req) => req.headers.origin === undefined || req.headers.origin === settings.origin;

  /**
   * The ids of the messages a search finds, newest first; without words: of all of them. The words are looked for
   * in the text, the contact, the names of the files and the day (2026-10-10 or 10.10.2026).
   * @param {string} q
   * @returns {Promise<string[]>}
   */
  const find = async (q) => {
    const ids = await store.ids();
    if (q === '') return ids;
    const needle = q.toLowerCase();
    /** @type {string[]} */
    const found = [];
    for (const id of ids) {
      const record = await store.read(id);
      if (record === null) continue;
      const iso = isoOf(id);
      const day = `${iso.slice(0, 10)} ${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
      const text = [record.message, record.contact, ...record.files.map((file) => file.name), day].join('\n').toLowerCase();
      if (text.includes(needle)) found.push(id);
    }
    return found;
  };

  /** @param {Request} req @param {Response} res @param {string | undefined} oldSession the session the browser came with */
  const login = async (req, res, oldSession) => {
    if (!fromTheSite(req)) {
      log('admin refused status=403 why=origin');
      return html(req, res, 403, notePage({ title: 'Отклонено', text: TEXTS.forbidden }));
    }
    const key = `login:${logins.addressKey(clientAddress(req.headers['x-forwarded-for']))}`;
    // shut out: five wrong passwords from this very address within the window
    const shutOut = () => logins.count(key, limits.loginWindowMs) >= limits.loginFailures;
    const refuse = (/** @type {'locked' | 'busy' | 'wrong'} */ why, /** @type {number} */ status) => {
      log(`admin login ${why} status=${status}`);
      html(req, res, status, loginPage({ error: TEXTS[why] }));
    };
    if (shutOut()) return refuse('locked', 429);
    const password = (await readForm(req)).get('password') ?? '';
    if (waiting >= LOGIN_QUEUE) return refuse('busy', 503);

    // one password is checked at a time, and the count of wrong ones is looked at again when its turn comes: of
    // many sent at the same moment no more are checked than the limit allows
    waiting++;
    const mine = turn.then(async () => {
      if (shutOut()) return 'locked';
      // Wrong passwords from many addresses are braked for everybody, not answered with a closed door: after so
      // many of them within the window, one password is looked at in a second, whoever sends it. The author waits
      // that second like everybody else and gets in; strangers cannot shut him out, and cannot guess fast.
      if (logins.count('wrong:all', limits.loginWindowMs) >= limits.loginSlowAfter) {
        const pause = lastCheck + limits.loginSlowMs - now();
        if (pause > 0) await sleep(pause);
      }
      lastCheck = now();
      if (await verifyPassword(password, settings.passwordHash)) return 'ok';
      logins.mark(key, limits.loginWindowMs);
      logins.mark('wrong:all', limits.loginWindowMs);
      return 'wrong';
    });
    turn = mine.catch(() => {});
    /** @type {string} */
    let result;
    try {
      result = await mine;
    } finally {
      waiting--;
    }
    if (result === 'locked') return refuse('locked', 429);
    if (result !== 'ok') return refuse('wrong', 401);

    // a new session with a new id, whatever the browser came with
    sessions.close(oldSession);
    const session = sessions.open();
    log('admin login ok status=303');
    redirect(req, res, 303, '/admin/', { 'Set-Cookie': cookieFor(session.id, Math.floor(limits.sessionMs / 1000)) });
  };

  /** @param {Request} req @param {Response} res @param {string} csrf @param {string} query */
  const list = async (req, res, csrf, query) => {
    const params = new URLSearchParams(query);
    const q = cleanQuery(params.get('q'));
    const ids = await find(q);
    const pages = Math.max(1, Math.ceil(ids.length / PAGE_SIZE));
    const asked = params.get('page') ?? '';
    const page = /^\d{1,20}$/.test(asked) ? Math.min(Math.max(Number(asked), 1), pages) : 1;
    const items = [];
    for (const id of ids.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)) {
      const record = await store.read(id);
      if (record !== null) items.push({ record, iso: isoOf(id) });
    }
    const used = store.usedBytes();
    const storage = used > limits.storageBytes * STORAGE_WARNING ? { used, limit: limits.storageBytes } : undefined;
    html(req, res, 200, listPage({ csrf, q, page, pages, total: ids.length, items, storage }));
  };

  /** @param {Response} res @param {string} id @param {number} number @param {boolean} headOnly */
  const file = async (res, id, number, headOnly) => {
    const record = await store.read(id);
    const entry = record?.files[number - 1];
    const path = entry === undefined ? null : store.filePath(id, entry.stored);
    const info = path === null ? null : await lstat(path).catch(() => null);
    if (entry === undefined || path === null || info === null || !info.isFile()) return false;
    // the type is the one the content was found to be when it came; the name is made here — neither is the sender's
    const iso = isoOf(id);
    const name = `sc-trade-${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}-${number}.${entry.stored.split('.')[1]}`;
    res.writeHead(200, {
      ...COMMON,
      'Content-Security-Policy': FILE_POLICY,
      'Content-Type': entry.type,
      'Content-Length': String(info.size),
      'Content-Disposition': `attachment; filename="${name}"`,
    });
    if (headOnly) res.end();
    else pipeline(createReadStream(path), res, (err) => (err ? res.destroy() : undefined));
    return true;
  };

  /** @param {Request} req @param {Response} res @param {string} path @param {string} query */
  const handle = async (req, res, path, query) => {
    const method = req.method ?? 'GET';
    const reading = method === 'GET' || method === 'HEAD';
    /** @param {number} status @param {string} title @param {string} text @param {string} [csrf] */
    const note = (status, title, text, csrf) => html(req, res, status, notePage({ title, text, csrf }));
    /** @param {string} allow @param {string} [csrf] */
    const notAllowed = (allow, csrf) => html(req, res, 405, notePage({ title: 'Не принято', text: TEXTS.method, csrf }), { Allow: allow });

    if (path === '/admin') return redirect(req, res, 308, '/admin/');

    const sessionId = sessionIdFrom(req.headers.cookie);
    const session = sessions.find(sessionId);

    if (path === '/admin/login') {
      if (method === 'POST') return login(req, res, sessionId);
      if (!reading) return notAllowed('GET, HEAD, POST');
      return session === null ? html(req, res, 200, loginPage({})) : redirect(req, res, 303, '/admin/');
    }
    if (path === '/admin/assets/admin.css' && reading) return answer(req, res, limits.lingerMs, 200, { ...COMMON, 'Content-Type': 'text/css; charset=utf-8' }, STYLES);

    // ---- from here on, only with a session
    if (session === null) return redirect(req, res, 303, '/admin/login');
    const { csrf } = session;

    if (path === '/admin/') return reading ? list(req, res, csrf, query) : notAllowed('GET, HEAD', csrf);

    /** The form of a request that changes something, once it is known to come from the pages of this session. */
    const trustedForm = async () => {
      if (!fromTheSite(req)) throw new Halt(403, 'Отклонено', TEXTS.forbidden, 'origin');
      const form = await readForm(req);
      if (!sameToken(form.get('csrf'), csrf)) throw new Halt(403, 'Отклонено', TEXTS.forbidden, 'token');
      return form;
    };
    /** Deletes several messages with their files and says in the log how many there were. @param {string[]} ids */
    const removeAll = async (ids) => {
      let count = 0;
      for (const id of ids) if (await store.remove(id)) count++;
      log(`admin delete ok status=303 count=${count}`);
    };

    if (path === '/admin/logout') {
      if (method !== 'POST') return notAllowed('POST', csrf);
      await trustedForm();
      sessions.close(sessionId);
      log('admin logout ok status=303');
      return redirect(req, res, 303, '/admin/login', { 'Set-Cookie': cookieFor('', 0) });
    }

    // the messages ticked on the list
    if (path === '/admin/delete') {
      if (method !== 'POST') return notAllowed('POST', csrf);
      const form = await trustedForm();
      const ids = form.getAll('id');
      // one box that does not hold an id, or more boxes than a page has: the whole request is not the list's
      if (ids.length > PAGE_SIZE || ids.some((id) => !ID.test(id))) return note(400, 'Не удалено', TEXTS.form, csrf);
      if (ids.length === 0) return note(400, 'Не удалено', TEXTS.nothing, csrf);
      if (form.get('confirm') !== 'yes') return note(400, 'Не удалено', TEXTS.unsure, csrf);
      await removeAll(ids);
      return redirect(req, res, 303, listAddress(cleanQuery(form.get('q'))));
    }

    // everything a search found: first a page that says how many and asks, then the deed
    if (path === '/admin/delete-found') {
      if (!reading && method !== 'POST') return notAllowed('GET, HEAD, POST', csrf);
      const form = reading ? new URLSearchParams(query) : await trustedForm();
      const q = cleanQuery(form.get('q'));
      // without words "everything found" would be everything there is: that is never one form away
      if (q === '') return note(400, 'Не удалено', TEXTS.noWords, csrf);
      if (!reading && form.get('confirm') !== 'yes') return note(400, 'Не удалено', TEXTS.unsure, csrf);
      const ids = await find(q);
      // done only for the very number the page showed: what came or went since is shown first
      if (reading || ids.length === 0 || form.get('count') !== String(ids.length)) {
        return html(req, res, reading ? 200 : 409, deleteFoundPage({ csrf, q, count: ids.length, changed: !reading }));
      }
      await removeAll(ids);
      return redirect(req, res, 303, '/admin/');
    }

    const message = MESSAGE.exec(path);
    if (message !== null) {
      if (!reading) return notAllowed('GET, HEAD', csrf);
      const record = await store.read(message[1]);
      if (record === null) return note(404, 'Не найдено', TEXTS.missing, csrf);
      return html(req, res, 200, messagePage({ csrf, record, iso: isoOf(record.id) }));
    }

    const attachment = FILE.exec(path);
    if (attachment !== null) {
      if (!reading) return notAllowed('GET, HEAD', csrf);
      if (await file(res, attachment[1], Number(attachment[2]), method === 'HEAD')) return;
      return note(404, 'Не найдено', TEXTS.missing, csrf);
    }

    const removal = DELETE.exec(path);
    if (removal !== null) {
      if (method !== 'POST') return notAllowed('POST', csrf);
      const form = await trustedForm();
      if (form.get('confirm') !== 'yes') return note(400, 'Не удалено', TEXTS.unsure, csrf);
      if (!(await store.remove(removal[1]))) return note(404, 'Не найдено', TEXTS.missing, csrf);
      log('admin delete ok status=303 count=1');
      return redirect(req, res, 303, '/admin/');
    }

    return note(404, 'Не найдено', TEXTS.missing, csrf);
  };

  return async function admin(req, res, path, query) {
    try {
      await handle(req, res, path, query);
    } catch (err) {
      if (res.headersSent) return void res.destroy();
      if (err instanceof Halt) {
        log(`admin refused status=${err.status} why=${err.why}`);
        html(req, res, err.status, notePage({ title: err.title, text: err.text }));
      } else {
        log(`error admin ${errorWord(err)}`);
        html(req, res, 500, notePage({ title: 'Ошибка', text: 'На сервере что-то пошло не так. Подробности — в журнале службы.' }));
      }
    }
  };
}
