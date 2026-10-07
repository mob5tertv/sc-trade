import { createReadStream, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { findBackdrop } from './backdrop.ts';
import { createSqlService, type SqlRequest, type SqlService } from './sql-service.ts';

// The dev-server half of the browser preview: a real SQLite database per page load behind `plugin:sql`, and the
// picture of the game for the desktop page. It exists for `vite` (serve) only: a production build never loads it.

const MAX_BODY = 5 * 1024 * 1024;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('the request is too big'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, body: unknown): void {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

export function previewPlugin(): Plugin {
  return {
    name: 'sc-trade-preview',
    apply: 'serve',
    configureServer(server) {
      // `better-sqlite3` is a native module. It is loaded by the first SQL request, not here: the plain dev server
      // (`npm run dev`, `tauri dev`) loads this plugin too, and a broken binary must never stop it. A failed load
      // is not remembered, so the next request tries again and says the same thing.
      let service: Promise<SqlService> | undefined;
      const sqlService = (): Promise<SqlService> => {
        service ??= (async () => {
          const { default: Database } = await import('better-sqlite3');
          return createSqlService({
            open: () => new Database(':memory:'),
            // the dataset is written by the module of the project, loaded through Vite: the same code the tests run
            prepare: async (db, dataset, now) => {
              const seed = (await server.ssrLoadModule('/src/preview/seed.ts')) as typeof import('../../src/preview/seed.ts');
              await seed.prepareDataset(db, dataset, now);
            },
            now: () => Math.floor(Date.now() / 1000),
          });
        })().catch((err: unknown) => {
          service = undefined;
          throw err;
        });
        return service;
      };
      server.httpServer?.once('close', () => void service?.then((started) => started.closeAll(), () => {}));

      server.middlewares.use('/__preview', (req, res, next) => {
        const route = (req.url ?? '/').split('?')[0];

        if (route === '/sql' && req.method === 'POST') {
          void (async () => {
            try {
              const request = JSON.parse(await readBody(req)) as SqlRequest;
              sendJson(res, { ok: true, result: await (await sqlService()).handle(request) });
            } catch (err) {
              sendJson(res, { ok: false, error: err instanceof Error ? err.message : String(err) });
            }
          })();
          return;
        }

        if (route === '/info' || route === '/backdrop') {
          const picture = findBackdrop(server.config.root);
          if (route === '/info') return sendJson(res, { backdrop: picture !== null });
          const notFound = (): void => {
            res.statusCode = 404;
            res.removeHeader('content-length'); // may have been set for the picture that is gone
            res.end();
          };
          if (picture === null) return notFound();
          try {
            const size = statSync(picture).size;
            const stream = createReadStream(picture);
            // the file may vanish between the listing and the reading; that must never crash the dev server
            stream.on('error', () => (res.headersSent ? res.destroy() : notFound()));
            res.statusCode = 200;
            res.setHeader('content-type', 'image/png');
            res.setHeader('content-length', size);
            res.setHeader('cache-control', 'no-store');
            stream.pipe(res);
          } catch {
            notFound();
          }
          return;
        }

        next();
      });
    },
  };
}
