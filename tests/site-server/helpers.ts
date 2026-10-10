import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { afterAll, afterEach, expect } from 'vitest';
import { readSettings, type Settings } from '../../site/server/src/config.mjs';
import { hashPassword } from '../../site/server/src/password.mjs';
import { createService } from '../../site/server/src/service.mjs';
import { MARKER } from '../../site/server/src/store.mjs';

// The service has two packages of its own (site/server/node_modules). Without them nothing here can run: said in
// plain words, with the command that installs them.
if (!existsSync(resolve(__dirname, '..', '..', 'site', 'server', 'node_modules', 'busboy', 'package.json'))) {
  throw new Error('the service of the site is not installed (site/server/node_modules is missing): run  npm run site:server:install  and start the tests again');
}

/** The site the service of the tests believes it belongs to. Nothing here is a real name or a real address. */
export const DOMAIN = 'site.example.test';
export const ORIGIN = `https://${DOMAIN}`;

/** The address the tests send from, as the web server in front would report it (a block reserved for examples). */
export const SENDER = '203.0.113.77';

/** The password of the author in the tests, and its hash with the cheapest work the service accepts. */
export const PASSWORD = 'a password of the tests only';
export const PASSWORD_HASH = hashPassword(PASSWORD, { N: 16384, r: 8, p: 1 });

/** The moment every test starts at. */
export const START = Date.parse('2026-10-10T12:00:00.000Z');
export const DAY_MS = 86_400_000;

// ---- pictures and texts to send

/** A real picture of one pixel. */
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
/** The beginning and the end of a JPEG: enough for a file to be one by its signature. */
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1'), Buffer.from([0xff, 0xd9])]);
/** The envelope of a WebP. */
export const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1a, 0, 0, 0]), Buffer.from('WEBPVP8L'), Buffer.from([0x0d, 0, 0, 0, 0x2f, 0, 0, 0, 0x10, 0x07, 0x10, 0x11, 0x11, 0x88, 0x88, 0xfe, 0x07, 0])]);
export const LOG_TEXT = '[2026-10-10 12:00:00][INFO][app] started\n[2026-10-10 12:00:01][WARN][uex] нет ответа\n';

// ---- temp folders

const folders: string[] = [];
afterAll(() => {
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

/** A folder of its own for a test; removed when the tests of the file are over. */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sc-trade-site-server-'));
  folders.push(dir);
  return dir;
}

/** Every file under a folder, as paths with forward slashes, sorted. */
export function rawListFiles(dir: string): string[] {
  const walk = (folder: string): string[] =>
    readdirSync(folder).flatMap((name) => {
      const path = join(folder, name);
      return statSync(path).isDirectory() ? walk(path) : [relative(dir, path).replaceAll('\\', '/')];
    });
  return walk(dir).sort();
}

/**
 * What a folder of the data holds: every file under it but the mark the storage puts into a folder it makes
 * (store.test.ts is where that mark is looked at).
 */
export function listFiles(dir: string): string[] {
  return rawListFiles(dir).filter((file) => file.split('/').at(-1) !== MARKER);
}

/** Every folder under a folder, sorted. */
export function listFolders(dir: string): string[] {
  const walk = (folder: string): string[] =>
    readdirSync(folder).flatMap((name) => {
      const path = join(folder, name);
      return statSync(path).isDirectory() ? [relative(dir, path).replaceAll('\\', '/'), ...walk(path)] : [];
    });
  return walk(dir).sort();
}

/** The bytes of everything a folder holds, joined: to look for something that must not be there. */
export function everythingIn(dir: string): Buffer {
  return Buffer.concat(listFiles(dir).flatMap((file) => [Buffer.from(`\n${file}\n`), readFileSync(join(dir, file))]));
}

// ---- the service

export interface Running {
  port: number;
  /** The folder of the data. */
  dir: string;
  /** What the service wrote to its log. */
  lines: string[];
  /** The clock of the service: a test moves it. */
  clock: { now: number };
  /** Every wait the service asked for, in milliseconds. A wait takes no time here: it moves the clock on by itself. */
  sleeps: number[];
  settings: Settings;
  service: ReturnType<typeof createService>;
  stop: () => Promise<void>;
}

const running: Running[] = [];
afterEach(async () => {
  for (const one of running.splice(0)) await one.stop();
});

/** The settings of a service of the tests: the defaults, with the limits a test names changed. */
export function settingsFor(dir: string, limits: Partial<Settings['limits']> = {}): Settings {
  const settings = readSettings({ domain: DOMAIN, port: 8787, dataDir: dir, passwordHash: PASSWORD_HASH });
  return { ...settings, limits: { ...settings.limits, ...limits } };
}

/**
 * Starts the service on 127.0.0.1, on a port the system picks, with its data in a temp folder. It is stopped when
 * the test is over.
 */
export async function start(options: { limits?: Partial<Settings['limits']>; dir?: string; now?: number; onLine?: (line: string) => void } = {}): Promise<Running> {
  const dir = options.dir ?? tempDir();
  const clock = { now: options.now ?? START };
  const lines: string[] = [];
  const sleeps: number[] = [];
  const settings = settingsFor(dir, options.limits);
  const sleep = async (ms: number) => {
    sleeps.push(ms);
    clock.now += ms;
  };
  const log = (line: string) => {
    lines.push(line);
    options.onLine?.(line);
  };
  const service = createService({ settings, now: () => clock.now, log, sleep });
  const port = await service.listen(0);
  let stopped = false;
  const one: Running = {
    port,
    dir,
    lines,
    clock,
    sleeps,
    settings,
    service,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await service.close();
    },
  };
  running.push(one);
  return one;
}

// ---- requests

export interface Part {
  name: string;
  value?: string | Buffer;
  /** Makes the part a file. */
  filename?: string;
  type?: string;
  /** The whole Content-Disposition line, for what a browser would never send. */
  disposition?: string | Buffer;
}

/** A body of multipart/form-data, built by hand so that a test decides every byte of it. */
export function multipart(parts: Part[], boundary = '----sctradetest7MA4YWxkTrZu0gW'): { body: Buffer; type: string } {
  const pieces: Buffer[] = [];
  for (const part of parts) {
    const disposition = part.disposition ?? `Content-Disposition: form-data; name="${part.name}"${part.filename === undefined ? '' : `; filename="${part.filename}"`}`;
    pieces.push(Buffer.from(`--${boundary}\r\n`), Buffer.from(disposition), Buffer.from('\r\n'));
    if (part.type !== undefined) pieces.push(Buffer.from(`Content-Type: ${part.type}\r\n`));
    pieces.push(Buffer.from('\r\n'), Buffer.isBuffer(part.value) ? part.value : Buffer.from(part.value ?? ''), Buffer.from('\r\n'));
  }
  pieces.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(pieces), type: `multipart/form-data; boundary=${boundary}` };
}

/** The text fields of the form as the page sends them; a test changes or removes (`undefined`) what it is about. */
export function fields(clock: { now: number }, changed: Record<string, string | undefined> = {}): Part[] {
  const all: Record<string, string | undefined> = {
    message: 'The price of quantanium at Area 18 looks wrong.',
    contact: 'someone#1234',
    lang: 'ru',
    website: '',
    started: String(clock.now - 60_000),
    ...changed,
  };
  return Object.entries(all).flatMap(([name, value]) => (value === undefined ? [] : [{ name, value }]));
}

export const shot = (value: Buffer | string = PNG, filename = 'shot.png', type = 'image/png'): Part => ({ name: 'shots[]', value, filename, type });
export const logFile = (value: Buffer | string = LOG_TEXT, filename = 'sctrade.log', type = 'text/plain'): Part => ({ name: 'log', value, filename, type });

export interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
  /** The body, byte for byte. */
  bytes: Buffer;
  /** The body as JSON, or `undefined` when it is not JSON. */
  json: unknown;
}

/** Every answer the tests of a file got from /api/feedback: none of them may set a cookie. */
export const feedbackReplies: Reply[] = [];

/** One request to the service; the path goes out exactly as written. */
export function request(port: number, options: { method?: string; path: string; headers?: Record<string, string | string[]>; body?: Buffer | string }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? undefined : Buffer.isBuffer(options.body) ? options.body : Buffer.from(options.body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method: options.method ?? 'GET',
        path: options.path,
        agent: false,
        headers: { ...(body === undefined ? {} : { 'Content-Length': String(body.length) }), ...options.headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const bytes = Buffer.concat(chunks);
          const text = bytes.toString('utf8');
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text, bytes, json });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

/** Sends the form to /api/feedback the way the page does: from the site itself, through the web server in front. */
export async function send(run: Running, parts: Part[], headers: Record<string, string | undefined> = {}): Promise<Reply> {
  const { body, type } = multipart(parts);
  const all: Record<string, string | undefined> = { 'Content-Type': type, Origin: ORIGIN, 'X-Forwarded-For': SENDER, ...headers };
  const sent = Object.fromEntries(Object.entries(all).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const reply = await request(run.port, { method: 'POST', path: '/api/feedback', headers: sent, body });
  feedbackReplies.push(reply);
  // whatever the answer is, it is the JSON of the contract and nothing else
  expect(reply.headers['content-type']).toBe('application/json; charset=utf-8');
  expect(reply.headers['set-cookie']).toBeUndefined();
  expect(reply.headers['x-content-type-options']).toBe('nosniff');
  return reply;
}

// ---- the author's page

/** The address the author of the tests comes from. */
export const AUTHOR = '198.51.100.200';

/** The name of the cookie of the author's page. */
export const COOKIE = '__Secure-sctrade-admin';

/** A request of the author's page, the way a browser on the site makes it. */
export function admin(run: Running, path: string, options: { cookie?: string; method?: string; form?: Record<string, string>; headers?: Record<string, string | undefined>; body?: string } = {}): Promise<Reply> {
  const body = options.body ?? (options.form === undefined ? undefined : new URLSearchParams(options.form).toString());
  const method = options.method ?? (body === undefined ? 'GET' : 'POST');
  const all: Record<string, string | undefined> = {
    'X-Forwarded-For': AUTHOR,
    ...(options.cookie === undefined ? {} : { Cookie: options.cookie }),
    ...(method === 'GET' || method === 'HEAD' ? {} : { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' }),
    ...options.headers,
  };
  const headers = Object.fromEntries(Object.entries(all).filter((entry): entry is [string, string] => entry[1] !== undefined));
  return request(run.port, { method, path, headers, body });
}

/** The cookie an answer sets, as a browser would send it back (`name=value`); `undefined`: none was set. */
export function cookieOf(reply: Reply): string | undefined {
  return reply.headers['set-cookie']?.[0]?.split(';')[0];
}

/** Logs in with the password of the tests; gives the cookie of the session. */
export async function login(run: Running, headers: Record<string, string | undefined> = {}): Promise<string> {
  const reply = await admin(run, '/admin/login', { form: { password: PASSWORD }, headers });
  expect(reply.status).toBe(303);
  expect(reply.headers.location).toBe('/admin/');
  const cookie = cookieOf(reply);
  if (cookie === undefined) throw new Error('the login set no cookie');
  return cookie;
}

/** The token a page of the author carries in its forms against requests forged by another site. */
export function csrfOf(html: string): string {
  const token = /<input type="hidden" name="csrf" value="([^"]+)">/.exec(html)?.[1];
  if (token === undefined) throw new Error('the page has no token');
  return token;
}

export const OK = { ok: true };
export const refused = (error: string) => ({ ok: false, error });

/** The messages the service keeps, as it wrote them. */
export function stored(dir: string): Array<Record<string, unknown> & { id: string; files: Array<{ kind: string; stored: string; type: string; bytes: number; name: string }> }> {
  const folder = join(dir, 'messages');
  return readdirSync(folder)
    .sort()
    .map((name) => JSON.parse(readFileSync(join(folder, name), 'utf8')));
}

export interface RawResult {
  /** Everything the service wrote back, head and body. */
  response: string;
  /** How many bytes of the body went out before the line was closed. */
  sent: number;
  /** The service closed the line, not the sender. */
  cutByService: boolean;
}

/**
 * A request written to the socket by hand: the head, then `piece` again and again, `pieces` times at the most, for as
 * long as the service takes it. Then the sender does `then`: goes away at once ('leave'), or stays silent on an open
 * line until the service closes it ('wait').
 */
export function rawSend(port: number, head: string, options: { first?: Buffer; piece?: Buffer; pieces?: number; then: 'leave' | 'wait' }): { done: Promise<RawResult>; leave: () => void } {
  const socket = net.connect({ host: '127.0.0.1', port });
  const piece = options.piece ?? Buffer.alloc(0);
  let left = options.pieces ?? 0;
  const chunks: Buffer[] = [];
  let sent = 0;
  let left_ = false;
  const leave = () => {
    left_ = true;
    socket.destroy();
  };
  const done = new Promise<RawResult>((resolve) => {
    const pump = () => {
      while (!socket.destroyed && left > 0) {
        left--;
        sent += piece.length;
        if (!socket.write(piece)) return void socket.once('drain', pump);
      }
      if (!socket.destroyed && options.then === 'leave') leave();
    };
    socket.on('connect', () => {
      socket.write(head);
      if (options.first !== undefined) {
        sent += options.first.length;
        socket.write(options.first);
      }
      pump();
    });
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.on('error', () => {});
    socket.on('close', () => resolve({ response: Buffer.concat(chunks).toString('latin1'), sent, cutByService: !left_ }));
  });
  return { done, leave };
}

/** Waits until something is true (the service does part of its work after it has answered). */
export async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('waited too long');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
