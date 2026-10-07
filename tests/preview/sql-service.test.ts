import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { createSqlService, type SqlRequest } from '../../scripts/preview/sql-service';
import type { Db } from '../../src/data/db';

function service(options: { keep?: number; now?: number } = {}) {
  const prepared: Array<{ dataset: string; now: number }> = [];
  const opened: Database.Database[] = [];
  const svc = createSqlService({
    open: () => {
      const sqlite = new Database(':memory:');
      opened.push(sqlite);
      return sqlite;
    },
    prepare: async (db: Db, dataset, now) => {
      prepared.push({ dataset, now });
      await db.execute('CREATE TABLE marker (dataset TEXT, now INTEGER)');
      await db.execute('INSERT INTO marker VALUES (?, ?)', [dataset, now]);
    },
    now: () => options.now ?? 1_800_000_000,
    keep: options.keep,
  });
  return { svc, prepared, opened };
}

const req = (sid: string, op: string, extra: Partial<SqlRequest> = {}): SqlRequest =>
  ({ sid, dataset: 'default', op, db: 'sqlite:sctrade.db', ...extra });

describe('sql service', () => {
  it('opens a new database for a session and fills it with the dataset, with the time of the load', async () => {
    const { svc, prepared } = service({ now: 1_800_000_123 });
    expect(await svc.handle(req('a', 'load'))).toBe('sqlite:sctrade.db');
    expect(prepared).toEqual([{ dataset: 'default', now: 1_800_000_123 }]);
    expect(await svc.handle(req('a', 'select', { query: 'SELECT dataset, now FROM marker', values: [] })))
      .toEqual([{ dataset: 'default', now: 1_800_000_123 }]);
  });

  it('answers execute with [rowsAffected, lastInsertId] and select with the rows', async () => {
    const { svc } = service();
    await svc.handle(req('a', 'load'));
    await svc.handle(req('a', 'execute', { query: 'CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)', values: [] }));
    expect(await svc.handle(req('a', 'execute', { query: 'INSERT INTO t (v) VALUES (?), (?)', values: ['x', 'y'] }))).toEqual([2, 2]);
    expect(await svc.handle(req('a', 'execute', { query: 'UPDATE t SET v = ? WHERE id = ?', values: ['z', 1] }))).toEqual([1, 2]);
    expect(await svc.handle(req('a', 'select', { query: 'SELECT * FROM t ORDER BY id', values: [] })))
      .toEqual([{ id: 1, v: 'z' }, { id: 2, v: 'y' }]);
    expect(await svc.handle(req('a', 'close'))).toBe(true);
  });

  it('binds booleans as 0 and 1 and a missing values list as no values', async () => {
    const { svc } = service();
    await svc.handle(req('a', 'load'));
    await svc.handle(req('a', 'execute', { query: 'CREATE TABLE f (a INTEGER, b INTEGER)' }));
    await svc.handle(req('a', 'execute', { query: 'INSERT INTO f VALUES (?, ?)', values: [true, false] }));
    expect(await svc.handle(req('a', 'select', { query: 'SELECT a, b FROM f' }))).toEqual([{ a: 1, b: 0 }]);
  });

  it('reads PRAGMA user_version and writes it, as the migrations do', async () => {
    const { svc } = service();
    await svc.handle(req('a', 'load'));
    expect(await svc.handle(req('a', 'select', { query: 'PRAGMA user_version', values: [] }))).toEqual([{ user_version: 0 }]);
    await svc.handle(req('a', 'execute', { query: 'PRAGMA user_version = 2', values: [] }));
    expect(await svc.handle(req('a', 'select', { query: 'PRAGMA user_version', values: [] }))).toEqual([{ user_version: 2 }]);
  });

  it('keeps the sessions apart', async () => {
    const { svc } = service();
    await svc.handle(req('a', 'load'));
    await svc.handle(req('b', 'load'));
    await svc.handle(req('a', 'execute', { query: 'CREATE TABLE only_a (x INTEGER)' }));
    await expect(svc.handle(req('b', 'select', { query: 'SELECT * FROM only_a' }))).rejects.toThrow(/only_a/);
  });

  it('loads a session once: a second load of the same session finds the same database', async () => {
    const { svc, prepared } = service();
    await svc.handle(req('a', 'load'));
    await svc.handle(req('a', 'execute', { query: 'INSERT INTO marker VALUES (?, ?)', values: ['again', 1] }));
    await svc.handle(req('a', 'load'));
    expect(prepared).toHaveLength(1);
    expect(await svc.handle(req('a', 'select', { query: 'SELECT COUNT(*) AS n FROM marker' }))).toEqual([{ n: 2 }]);
  });

  it('keeps only the last few sessions and closes the oldest', async () => {
    const { svc, opened } = service({ keep: 2 });
    await svc.handle(req('a', 'load'));
    await svc.handle(req('b', 'load'));
    await svc.handle(req('c', 'load'));
    expect(svc.sessions()).toBe(2);
    expect(opened[0].open).toBe(false);
    await expect(svc.handle(req('a', 'select', { query: 'SELECT 1' }))).rejects.toThrow(/session/i);
    expect(await svc.handle(req('c', 'select', { query: 'SELECT 1 AS one' }))).toEqual([{ one: 1 }]);
  });

  it('says what is wrong: an unknown session, an unknown dataset, an unknown operation', async () => {
    const { svc } = service();
    await expect(svc.handle(req('ghost', 'select', { query: 'SELECT 1' }))).rejects.toThrow(/ghost/);
    await expect(svc.handle({ ...req('a', 'load'), dataset: 'nonsense' })).rejects.toThrow(/nonsense/);
    await svc.handle(req('a', 'load'));
    await expect(svc.handle(req('a', 'dance'))).rejects.toThrow(/dance/);
    await expect(svc.handle(req('a', 'select', {}))).rejects.toThrow(/query/);
  });

  it('does not keep a session whose dataset failed to load', async () => {
    const svc = createSqlService({
      open: () => new Database(':memory:'),
      prepare: vi.fn().mockRejectedValue(new Error('seed is broken')),
      now: () => 1,
    });
    await expect(svc.handle(req('a', 'load'))).rejects.toThrow('seed is broken');
    expect(svc.sessions()).toBe(0);
  });

  it('closeAll closes every database', async () => {
    const { svc, opened } = service();
    await svc.handle(req('a', 'load'));
    await svc.handle(req('b', 'load'));
    svc.closeAll();
    expect(opened.every((db) => !db.open)).toBe(true);
    expect(svc.sessions()).toBe(0);
  });
});
