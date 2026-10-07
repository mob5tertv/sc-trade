import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { previewPlugin } from '../../scripts/preview/vite-plugin';

// `better-sqlite3` is a native module that can be broken on a machine (a wrong Node, a missing build). The plugin
// is part of vite.config.ts, so it is loaded by the plain dev server (`npm run dev`, `tauri dev`) as well: it must not
// need the module until somebody asks for SQL.
const sqlite = vi.hoisted(() => ({ loads: 0 }));
vi.mock('better-sqlite3', () => {
  sqlite.loads++;
  throw new Error('the native binary is broken');
});

type Middleware = (req: unknown, res: unknown, next: () => void) => void;

function startPlugin(root: string): Middleware {
  let middleware: Middleware | undefined;
  const server = {
    middlewares: { use: (_path: string, handler: Middleware) => { middleware = handler; } },
    httpServer: null,
    config: { root },
    ssrLoadModule: () => Promise.reject(new Error('not needed here')),
  };
  const hook = previewPlugin().configureServer as (server: unknown) => void;
  hook(server);
  if (!middleware) throw new Error('the plugin did not register its middleware');
  return middleware;
}

interface Reply { status: number; headers: Map<string, unknown>; body: string }

/** Sends a request through the middleware and waits for the reply to end. */
function send(middleware: Middleware, method: string, url: string, body = ''): Promise<Reply> {
  const req = Object.assign(Readable.from(body === '' ? [] : [Buffer.from(body)]), { method, url });
  const headers = new Map<string, unknown>();
  const chunks: Buffer[] = [];
  const res = Object.assign(
    new Writable({ write(chunk: Buffer, _encoding, done) { chunks.push(chunk); done(); } }),
    {
      statusCode: 200,
      headersSent: false,
      setHeader: (name: string, value: unknown) => { headers.set(name.toLowerCase(), value); },
      removeHeader: (name: string) => { headers.delete(name.toLowerCase()); },
    },
  );
  return new Promise((resolve) => {
    res.on('finish', () => resolve({ status: res.statusCode, headers, body: Buffer.concat(chunks).toString('utf8') }));
    middleware(req, res, () => resolve({ status: -1, headers, body: 'next() was called' }));
  });
}

let root: string;
let previousBackdropDir: string | undefined;

beforeEach(() => {
  sqlite.loads = 0;
  root = mkdtempSync(join(tmpdir(), 'sc-plugin-test-'));
  previousBackdropDir = process.env.PREVIEW_BACKDROP_DIR;
  delete process.env.PREVIEW_BACKDROP_DIR;
});

afterEach(() => {
  if (previousBackdropDir === undefined) delete process.env.PREVIEW_BACKDROP_DIR;
  else process.env.PREVIEW_BACKDROP_DIR = previousBackdropDir;
  rmSync(root, { recursive: true, force: true });
});

describe('the preview plugin of the dev server', () => {
  it('does not load better-sqlite3 when the server starts, so a broken binary cannot stop the plain dev server', () => {
    startPlugin(root);
    expect(sqlite.loads).toBe(0);
  });

  it('loads it on the first SQL request, and says what is wrong when it cannot', async () => {
    const middleware = startPlugin(root);
    const reply = await send(middleware, 'POST', '/sql', JSON.stringify({ sid: 'a', dataset: 'default', op: 'load' }));
    expect(sqlite.loads).toBe(1);
    // (vitest words the failure of a mocked module in its own way; a real broken binary gives its own message)
    const answer = JSON.parse(reply.body) as { ok: boolean; error: string };
    expect(answer.ok).toBe(false);
    expect(answer.error).not.toBe('');
  });

  it('does not remember a failed load: the next request tries again', async () => {
    const middleware = startPlugin(root);
    const request = JSON.stringify({ sid: 'a', dataset: 'default', op: 'load' });
    await send(middleware, 'POST', '/sql', request);
    await send(middleware, 'POST', '/sql', request);
    expect(sqlite.loads).toBe(2);
  });

  it('leaves every other address of the server alone', async () => {
    const middleware = startPlugin(root);
    expect((await send(middleware, 'GET', '/nothing-here')).status).toBe(-1);
  });
});

describe('the picture of the game', () => {
  it('is announced by /info and is not there without a Screenshot folder', async () => {
    const middleware = startPlugin(root);
    expect(JSON.parse((await send(middleware, 'GET', '/info')).body)).toEqual({ backdrop: false });
    expect((await send(middleware, 'GET', '/backdrop')).status).toBe(404);
  });

  it('a file that cannot be read answers 404 and does not crash the server', async () => {
    // a folder named like a picture: it is listed and has a size, but reading it fails (EISDIR) on the stream
    const dir = join(root, 'Screenshot');
    mkdirSync(join(dir, 'broken.png'), { recursive: true });
    const middleware = startPlugin(root);
    const unhandled = vi.fn();
    process.on('uncaughtException', unhandled);
    try {
      expect(JSON.parse((await send(middleware, 'GET', '/info')).body)).toEqual({ backdrop: true });
      const reply = await send(middleware, 'GET', '/backdrop');
      expect(reply.status).toBe(404);
      expect(reply.headers.has('content-length')).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('uncaughtException', unhandled);
    }
  });
});
