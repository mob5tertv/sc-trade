import type { Db } from '../../src/data/db.ts';
import { isDatasetName, type DatasetName } from '../../src/preview/datasets.ts';

// The server side of `plugin:sql`: one in-memory SQLite database per page load (a "session"), made from a named
// dataset, answering `load / execute / select / close` in the shapes `@tauri-apps/plugin-sql` expects.
// The driver and the data are injected: the dev server passes `better-sqlite3` and the seed it loads through Vite,
// the tests pass the same ones directly.

/** The part of a `better-sqlite3` database that is used. */
export interface SqliteLike {
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  };
  close(): unknown;
}

/** What the page sends. It comes over the network, so every field is checked. */
export interface SqlRequest {
  sid: string;
  dataset: string;
  op: string;
  db?: string;
  query?: string;
  values?: unknown[];
}

export interface SqlServiceDeps {
  open: () => SqliteLike;
  /** Writes the dataset into a fresh database; `now` is the moment the database was made. */
  prepare: (db: Db, dataset: DatasetName, now: number) => Promise<void>;
  now: () => number;
  /** How many sessions are kept; the oldest one is closed when a new one comes. */
  keep?: number;
}

export interface SqlService {
  handle(request: SqlRequest): Promise<unknown>;
  /** How many sessions are open. */
  sessions(): number;
  closeAll(): void;
}

const DEFAULT_KEEP = 8;

/** Booleans are not bindable in better-sqlite3; SQLite has none, it stores 0 and 1. */
const bindable = (values: unknown[] | undefined): unknown[] =>
  (values ?? []).map((v) => (typeof v === 'boolean' ? Number(v) : v));

function dbOf(sqlite: SqliteLike): Db {
  return {
    async select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      return sqlite.prepare(sql).all(...bindable(params)) as T[];
    },
    async execute(sql: string, params: unknown[] = []) {
      const result = sqlite.prepare(sql).run(...bindable(params));
      return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) };
    },
  };
}

export function createSqlService(deps: SqlServiceDeps): SqlService {
  const keep = deps.keep ?? DEFAULT_KEEP;
  // A Map keeps the order of insertion: the first entry is the oldest session.
  const sessions = new Map<string, SqliteLike>();

  function evictOld(): void {
    while (sessions.size >= keep) {
      const [oldest, sqlite] = sessions.entries().next().value as [string, SqliteLike];
      sessions.delete(oldest);
      sqlite.close();
    }
  }

  async function load(request: SqlRequest): Promise<string> {
    const path = request.db ?? 'sqlite:preview.db';
    if (sessions.has(request.sid)) return path; // the app opens its database once; a retry finds it
    if (!isDatasetName(request.dataset)) throw new Error(`Unknown preview dataset "${request.dataset}"`);

    evictOld();
    const sqlite = deps.open();
    try {
      await deps.prepare(dbOf(sqlite), request.dataset, deps.now());
    } catch (err) {
      sqlite.close();
      throw err;
    }
    sessions.set(request.sid, sqlite);
    return path;
  }

  return {
    async handle(request) {
      if (request.op === 'load') return load(request);

      const sqlite = sessions.get(request.sid);
      if (sqlite === undefined) {
        throw new Error(`Unknown preview database session "${request.sid}" (the dev server was restarted, or the session is too old): reload the page`);
      }
      switch (request.op) {
        case 'execute': {
          if (typeof request.query !== 'string') throw new Error('plugin:sql|execute needs a query');
          const result = await dbOf(sqlite).execute(request.query, request.values);
          return [result.rowsAffected, result.lastInsertId];
        }
        case 'select':
          if (typeof request.query !== 'string') throw new Error('plugin:sql|select needs a query');
          return dbOf(sqlite).select(request.query, request.values);
        case 'close':
          return true; // the database lives as long as its session
        default:
          throw new Error(`Unknown preview SQL operation "${request.op}"`);
      }
    },
    sessions: () => sessions.size,
    closeAll() {
      for (const sqlite of sessions.values()) sqlite.close();
      sessions.clear();
    },
  };
}
