import { describe, expect, it } from 'vitest';
import { createLogger, memorySink } from '../../src/data/logger';
import { MIGRATIONS, migrate } from '../../src/data/migrations';
import { migratedDb, testDb } from '../helpers/test-db';

describe('migrations', () => {
  it('creates all tables and reports version 1', async () => {
    const db = testDb();
    const log = createLogger(memorySink());
    expect(await migrate(db, log)).toBe(1);
    const names = (await db.select<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'")).map(
      (r) => r.name,
    );
    for (const t of [
      'uex_star_system',
      'uex_terminal',
      'uex_commodity',
      'uex_vehicle',
      'uex_price',
      'uex_distance',
      'uex_meta',
      'observation',
      'run',
      'run_event',
      'setting',
    ])
      expect(names).toContain(t);
  });

  it('stores the schema version in PRAGMA user_version', async () => {
    const db = await migratedDb();
    expect(await db.select('PRAGMA user_version')).toEqual([{ user_version: 1 }]);
  });

  it('is a no-op when run twice', async () => {
    const db = testDb();
    const log = createLogger(memorySink());
    await migrate(db, log);
    expect(await migrate(db, log)).toBe(1);
  });

  it('can be re-run after a migration was interrupted half-way', async () => {
    // Migrations run without a transaction, so an interrupted run leaves some tables behind.
    const db = testDb();
    for (const sql of MIGRATIONS[0].statements.slice(0, 3)) await db.execute(sql);
    expect(await migrate(db, createLogger(memorySink()))).toBe(1);
    const tables = await db.select<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'");
    expect(tables.map((r) => r.name)).toContain('setting');
  });

  it('numbers migrations consecutively from 1', () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(MIGRATIONS.map((_, i) => i + 1));
  });

  it('gives uex_price a buy and a sell block of statistics', async () => {
    const db = await migratedDb();
    const cols = (await db.select<{ name: string }>('PRAGMA table_info(uex_price)')).map((c) => c.name);
    const block = (side: string) =>
      ['last', 'min_week', 'max_week', 'avg_week', 'min_month', 'max_month', 'avg_month', 'min', 'max', 'avg'].map(
        (s) => `${side}_${s}`,
      );
    expect(cols).toEqual([
      'terminal_id',
      'commodity_id',
      ...block('buy'),
      ...block('sell'),
      'scu_buy',
      'scu_sell',
      'date_modified',
      'synced_at',
    ]);
  });

  it('allows only one active run', async () => {
    const db = await migratedDb();
    const ins = "INSERT INTO run (scu_capacity, started_at, status) VALUES (696, 1000, 'active')";
    await db.execute(ins);
    await expect(db.execute(ins)).rejects.toThrow();
  });

  it('rejects an unknown observation side and an unordered distance pair', async () => {
    const db = await migratedDb();
    await expect(
      db.execute("INSERT INTO observation (ts, terminal_id, commodity_id, side, price) VALUES (1,1,1,'x',1)"),
    ).rejects.toThrow();
    await expect(db.execute('INSERT INTO uex_distance VALUES (5, 2, 10)')).rejects.toThrow();
  });

  it('remembers an unknown distance as NULL', async () => {
    const db = await migratedDb();
    await db.execute('INSERT INTO uex_distance VALUES (?, ?, ?)', [2, 5, null]);
    expect(await db.select('SELECT distance_gm FROM uex_distance')).toEqual([{ distance_gm: null }]);
  });

  it('reports lastInsertId and rowsAffected', async () => {
    const db = await migratedDb();
    const obs = "INSERT INTO observation (ts, terminal_id, commodity_id, side, price) VALUES (1, 1, 1, 'buy', 1)";
    const a = await db.execute(obs);
    const b = await db.execute(obs);
    expect(a.rowsAffected).toBe(1);
    expect(b.lastInsertId).toBe(a.lastInsertId + 1);
  });

  it('logs each applied migration', async () => {
    const sink = memorySink();
    await migrate(testDb(), createLogger(sink));
    expect(sink.lines.some((l) => l.line.startsWith('[db] migration applied'))).toBe(true);
  });

  it('logs nothing as applied when the schema is already current', async () => {
    const db = await migratedDb();
    const sink = memorySink();
    await migrate(db, createLogger(sink));
    expect(sink.lines.some((l) => l.line.startsWith('[db] migration applied'))).toBe(false);
  });

  it('logs and rethrows a failing statement without bumping the version', async () => {
    const real = testDb();
    const sink = memorySink();
    const broken: typeof real = {
      select: (sql, params) => real.select(sql, params),
      execute: (sql, params) =>
        sql.includes('uex_vehicle') ? Promise.reject(new Error('disk full')) : real.execute(sql, params),
    };
    await expect(migrate(broken, createLogger(sink))).rejects.toThrow('disk full');
    expect(sink.lines.some((l) => l.level === 'error' && l.line.startsWith('[db] migration failed'))).toBe(true);
    expect(await real.select('PRAGMA user_version')).toEqual([{ user_version: 0 }]);
  });
});
