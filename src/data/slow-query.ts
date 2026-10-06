import type { Db } from './db';
import type { Logger } from './logger';

const SLOW_QUERY_MS = 200;
const MAX_SQL_LENGTH = 300;

// Statements are written over several lines; the log wants one short line.
function compactSql(sql: string): string {
  const flat = sql.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_SQL_LENGTH ? `${flat.slice(0, MAX_SQL_LENGTH)}...` : flat;
}

/**
 * Wraps a Db: queries taking `thresholdMs` or more are logged as warnings, failed queries as
 * errors (and rethrown unchanged). `clockMs` is injectable so tests control the time.
 */
export function withSlowQueryLog(
  db: Db,
  log: Logger,
  clockMs: () => number = () => performance.now(),
  thresholdMs: number = SLOW_QUERY_MS,
): Db {
  async function timed<T>(sql: string, params: unknown[] | undefined, run: () => Promise<T>): Promise<T> {
    const start = clockMs();
    let result: T;
    try {
      result = await run();
    } catch (err) {
      log.error('db', 'query failed', { ms: Math.round(clockMs() - start), sql: compactSql(sql), params, err });
      throw err;
    }
    const ms = clockMs() - start;
    if (ms >= thresholdMs) {
      log.warn('db', 'slow query', { ms: Math.round(ms), sql: compactSql(sql), params });
    }
    return result;
  }

  return {
    select: <T>(sql: string, params?: unknown[]) => timed(sql, params, () => db.select<T>(sql, params)),
    execute: (sql, params) => timed(sql, params, () => db.execute(sql, params)),
  };
}
