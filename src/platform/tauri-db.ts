import Database from '@tauri-apps/plugin-sql';
import type { Db } from '../data/db';
import type { Logger } from '../data/logger';
import { withSlowQueryLog } from '../data/slow-query';

// tauri-plugin-sql resolves this relative to the app config directory
// (%APPDATA%\com.sctrade.app on Windows); src-tauri/src/backup.rs copies the same file.
const DB_URL = 'sqlite:sctrade.db';

/**
 * Opens (creating it if needed) the app database; slow and failing queries are logged.
 * `log` is the app's shared logger, so a level change made at runtime applies to the database too.
 */
export async function openTauriDb(log: Logger): Promise<Db> {
  log.info('db', 'opening database', { url: DB_URL });
  let raw: Database;
  try {
    raw = await Database.load(DB_URL);
  } catch (err) {
    log.error('db', 'failed to open database', { url: DB_URL, err });
    throw err;
  }
  log.info('db', 'database opened', { url: DB_URL });

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
