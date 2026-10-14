import Database from '@tauri-apps/plugin-sql';
import type { Db } from '../data/db';
import type { Logger } from '../data/logger';
import { withSlowQueryLog } from '../data/slow-query';

// tauri-plugin-sql resolves this relative to the app config directory
// (%APPDATA%\com.sctrade.app on Windows); src-tauri/src/backup.rs copies the same file.
const DB_URL = 'sqlite:sctrade.db';
/**
 * The database of the demo trip (version 1.3), next to the player's own: filled anew at each demo and emptied after it. The plugin
 * makes a file of every address (it has no database in memory), so the demo has a file of its own and never touches the player's.
 */
const DEMO_DB_URL = 'sqlite:demo.db';

async function load(url: string, log: Logger): Promise<Database> {
  log.info('db', 'opening database', { url });
  try {
    const raw = await Database.load(url);
    log.info('db', 'database opened', { url });
    return raw;
  } catch (err) {
    log.error('db', 'failed to open database', { url, err });
    throw err;
  }
}

function wrap(raw: Database, log: Logger): Db {
  const db: Db = {
    select: <T>(sql: string, params?: unknown[]) => raw.select<T[]>(sql, params),
    async execute(sql, params) {
      const result = await raw.execute(sql, params);
      // lastInsertId is optional in the plugin typings (not set for Postgres); SQLite always sets it.
      return { rowsAffected: result.rowsAffected, lastInsertId: result.lastInsertId ?? 0 };
    },
  };
  return withSlowQueryLog(db, log);
}

/**
 * Opens (creating it if needed) the app database; slow and failing queries are logged.
 * `log` is the app's shared logger, so a level change made at runtime applies to the database too.
 */
export async function openTauriDb(log: Logger): Promise<Db> {
  return wrap(await load(DB_URL, log), log);
}

/** Opens the database of the demo trip; `close` lets its connections go when the demo is over. */
export async function openDemoDb(log: Logger): Promise<{ db: Db; close: () => Promise<void> }> {
  const raw = await load(DEMO_DB_URL, log);
  return { db: wrap(raw, log), close: async () => void (await raw.close()) };
}
