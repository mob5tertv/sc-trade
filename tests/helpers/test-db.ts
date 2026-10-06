import Database from 'better-sqlite3';
import type { Db } from '../../src/data/db';
import { createLogger, memorySink } from '../../src/data/logger';
import { migrate } from '../../src/data/migrations';

/** An empty in-memory SQLite database behind the same `Db` interface the app uses. */
export function testDb(): Db {
  const sqlite = new Database(':memory:');
  return {
    async select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
      return sqlite.prepare(sql).all(...params) as T[];
    },
    async execute(sql: string, params: unknown[] = []) {
      const result = sqlite.prepare(sql).run(...params);
      return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) };
    },
  };
}

/** An in-memory database with the full schema applied. */
export async function migratedDb(): Promise<Db> {
  const db = testDb();
  await migrate(db, createLogger(memorySink()));
  return db;
}
