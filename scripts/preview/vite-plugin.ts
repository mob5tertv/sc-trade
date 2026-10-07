import { createReadStream, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { findBackdrop } from './backdrop.ts';
import { createSqlService, type SqlRequest } from './sql-service.ts';

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
    async configureServer(server) {
      // loaded here, not at the top: `vite build` reads this config too and has no use for a native module
      const { default: Database } = await import('better-sqlite3');
      const service = createSqlService({
        open: () => new Database(':memory:'),
        // the dataset is written by the module of the project, loaded through Vite: the same code the tests run
        prepare: async (db, dataset, now) => {
          const seed = (await server.ssrLoadModule('/src/preview/seed.ts')) as typeof import('../../src/preview/seed.ts');
          await seed.prepareDataset(db, dataset, now);
        },
        now: () => Math.floor(Date.now() / 1000),
      });
      server.httpServer?.once('close', () => service.closeAll());

      server.middlewares.use('/__preview', (req, res, next) => {
        const route = (req.url ?? '/').split('?')[0];

        if (route === '/sql' && req.method === 'POST') {
          void (async () => {
            try {
              const request = JSON.parse(await readBody(req)) as SqlRequest;
              sendJson(res, { ok: true, result: await service.handle(request) });
            } catch (err) {
              sendJson(res, { ok: false, error: err instanceof Error ? err.message : String(err) });
            }
          })();
          return;
        }

        if (route === '/info' || route === '/backdrop') {
          const picture = findBackdrop(server.config.root);
          if (route === '/info') return sendJson(res, { backdrop: picture !== null });
          if (picture === null) {
            res.statusCode = 404;
            res.end();
            return;
          }
          res.statusCode = 200;
          res.setHeader('content-type', 'image/png');
          res.setHeader('content-length', statSync(picture).size);
          res.setHeader('cache-control', 'no-store');
          createReadStream(picture).pipe(res);
          return;
        }

        next();
      });
    },
  };
}
