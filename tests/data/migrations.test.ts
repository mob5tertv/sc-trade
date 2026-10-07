import { describe, expect, it } from 'vitest';
import type { Db } from '../../src/data/db';
import { createLogger, memorySink } from '../../src/data/logger';
import { MIGRATIONS, NewerDatabaseError, checkSchemaVersion, migrate } from '../../src/data/migrations';
import { migratedDb, testDb } from '../helpers/test-db';

describe('migrations', () => {
  it('creates all tables and reports the latest version', async () => {
    const db = testDb();
    const log = createLogger(memorySink());
    expect(await migrate(db, log)).toBe(2);
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

  it('stores the schema version in PRAGMA user_version (2)', async () => {
    const db = await migratedDb();
    expect(await db.select('PRAGMA user_version')).toEqual([{ user_version: 2 }]);
  });

  it('is a no-op when run twice', async () => {
    const db = testDb();
    const log = createLogger(memorySink());
    await migrate(db, log);
    expect(await migrate(db, log)).toBe(2);
  });

  it('can be re-run after a migration was interrupted half-way', async () => {
    // Migrations run without a transaction, so an interrupted run leaves some tables behind.
    const db = testDb();
    for (const sql of MIGRATIONS[0].statements.slice(0, 3)) await db.execute(sql);
    expect(await migrate(db, createLogger(memorySink()))).toBe(2);
    const tables = await db.select<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'");
    expect(tables.map((r) => r.name)).toContain('setting');
  });

  describe('a database from a newer version of the application', () => {
    const NEWEST = MIGRATIONS[MIGRATIONS.length - 1].version;

    /** The same database, with every statement that was executed recorded. */
    const spied = (inner: Db) => {
      const executed: string[] = [];
      const db: Db = {
        select: (sql, params) => inner.select(sql, params),
        execute: (sql, params) => { executed.push(sql); return inner.execute(sql, params); },
      };
      return { db, executed };
    };
    const tablesOf = async (db: Db) => (await db.select<{ name: string }>("SELECT name FROM sqlite_master ORDER BY name")).map((r) => r.name);

    it('is opened when it is at the newest version this build knows: nothing to do', async () => {
      const db = await migratedDb();
      const { db: spy, executed } = spied(db);
      expect(await migrate(spy, createLogger(memorySink()))).toBe(NEWEST);
      expect(executed).toEqual([]);
    });

    it('is refused one version above, with a message the start screen can show as it is, and nothing is written', async () => {
      const db = await migratedDb();
      await db.execute(`PRAGMA user_version = ${NEWEST + 1}`);
      const tablesBefore = await tablesOf(db);
      const { db: spy, executed } = spied(db);

      const err = await migrate(spy, createLogger(memorySink())).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(NewerDatabaseError);
      expect((err as Error).message).toBe(
        `База создана более новой версией программы (схема ${NEWEST + 1}, эта версия знает ${NEWEST}). Обнови программу.`,
      );
      expect(executed).toEqual([]);
      expect(await db.select('PRAGMA user_version')).toEqual([{ user_version: NEWEST + 1 }]);
      expect(await tablesOf(db)).toEqual(tablesBefore);
    });

    it('is refused far above as well, and an old migration is never replayed over it', async () => {
      const db = testDb();
      for (const sql of MIGRATIONS[0].statements) await db.execute(sql);
      await db.execute('PRAGMA user_version = 99');
      const tablesBefore = await tablesOf(db);

      await expect(migrate(db, createLogger(memorySink()))).rejects.toThrow('схема 99, эта версия знает 2');

      expect(await db.select('PRAGMA user_version')).toEqual([{ user_version: 99 }]);
      expect(await tablesOf(db)).toEqual(tablesBefore); // migration 2 did not run
    });

    it('is written to the log as an error with both versions', async () => {
      const db = testDb();
      await db.execute(`PRAGMA user_version = ${NEWEST + 1}`);
      const sink = memorySink();
      await migrate(db, createLogger(sink)).catch(() => {});
      expect(sink.lines.filter((l) => l.level === 'error').map((l) => l.line)).toEqual([
        `[db] database is from a newer version {"schema":${NEWEST + 1},"known":${NEWEST}}`,
      ]);
    });

    it('does not touch a fresh database: it is migrated as before', async () => {
      const db = testDb();
      expect(await migrate(db, createLogger(memorySink()))).toBe(NEWEST);
      expect(await db.select('PRAGMA user_version')).toEqual([{ user_version: NEWEST }]);
    });
  });

  describe('checkSchemaVersion: the check alone, for a start that must know before it touches anything', () => {
    const NEWEST = MIGRATIONS[MIGRATIONS.length - 1].version;
    const spied = (inner: Db) => {
      const statements: string[] = [];
      const db: Db = {
        select: (sql, params) => { statements.push(sql); return inner.select(sql, params); },
        execute: (sql, params) => { statements.push(sql); return inner.execute(sql, params); },
      };
      return { db, statements };
    };

    it('says the version of a database, and only reads it: a new, an old and a current one', async () => {
      const current = spied(await migratedDb());
      expect(await checkSchemaVersion(current.db, createLogger(memorySink()))).toBe(NEWEST);
      expect(current.statements).toEqual(['PRAGMA user_version']);

      const fresh = spied(testDb());
      expect(await checkSchemaVersion(fresh.db, createLogger(memorySink()))).toBe(0);
      expect(fresh.statements).toEqual(['PRAGMA user_version']);

      const old = testDb();
      for (const sql of MIGRATIONS[0].statements) await old.execute(sql);
      await old.execute('PRAGMA user_version = 1');
      expect(await checkSchemaVersion(old, createLogger(memorySink()))).toBe(1);
      expect(await old.select('PRAGMA user_version')).toEqual([{ user_version: 1 }]);   // not migrated
    });

    it('refuses a database from a newer version, with the same error and the same log line as migrate, and writes nothing', async () => {
      const db = testDb();
      await db.execute(`PRAGMA user_version = ${NEWEST + 1}`);
      const { db: spy, statements } = spied(db);
      const sink = memorySink();

      const err = await checkSchemaVersion(spy, createLogger(sink)).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(NewerDatabaseError);
      expect(err).toMatchObject({
        schema: NEWEST + 1, known: NEWEST,
        message: `База создана более новой версией программы (схема ${NEWEST + 1}, эта версия знает ${NEWEST}). Обнови программу.`,
      });
      expect(statements).toEqual(['PRAGMA user_version']);
      expect(sink.lines.map((l) => l.line)).toEqual([`[db] database is from a newer version {"schema":${NEWEST + 1},"known":${NEWEST}}`]);
    });

    it('is what migrate starts with: the refusal of migrate is the refusal of the check', async () => {
      const db = testDb();
      await db.execute(`PRAGMA user_version = ${NEWEST + 5}`);
      const viaCheck = await checkSchemaVersion(db, createLogger(memorySink())).catch((e: unknown) => e);
      const viaMigrate = await migrate(db, createLogger(memorySink())).catch((e: unknown) => e);
      expect(viaMigrate).toBeInstanceOf(NewerDatabaseError);
      expect((viaMigrate as Error).message).toBe((viaCheck as Error).message);
    });
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
      'scu_buy_max',
      'scu_sell_max',
      'date_modified',
      'synced_at',
    ]);
  });

  it('rebuilds the price cache with the stock maximum columns and forces a price re-sync', async () => {
    const db = testDb();
    const log = createLogger(memorySink());
    await migrate(db, log);
    const cols = (await db.select<{ name: string }>('PRAGMA table_info(uex_price)')).map((c) => c.name);
    expect(cols).toContain('scu_buy_max');
    expect(cols).toContain('scu_sell_max');
    expect(await db.select("SELECT 1 FROM uex_meta WHERE key = 'prices_synced_at'")).toEqual([]);
  });

  it('defaults the new stock maximum columns to zero', async () => {
    const db = await migratedDb();
    const cols = await db.select<{ name: string; notnull: number; dflt_value: string }>('PRAGMA table_info(uex_price)');
    for (const name of ['scu_buy_max', 'scu_sell_max']) {
      expect(cols.find((c) => c.name === name)).toMatchObject({ notnull: 1, dflt_value: '0' });
    }
  });

  it('upgrades a version 1 database: empty price cache with the new columns, no price sync mark, other data kept', async () => {
    const db = testDb();
    for (const sql of MIGRATIONS[0].statements) await db.execute(sql);
    await db.execute('PRAGMA user_version = 1');
    const oldCols = (await db.select<{ name: string }>('PRAGMA table_info(uex_price)')).map((c) => c.name);
    expect(oldCols).not.toContain('scu_buy_max');
    await db.execute(
      `INSERT INTO uex_price (${oldCols.join(', ')}) VALUES (${oldCols.map(() => '?').join(', ')})`,
      oldCols.map(() => 1),
    );
    await db.execute("INSERT INTO uex_meta (key, value) VALUES ('prices_synced_at', '123'), ('routes_fetched:1', 'ok')");
    await db.execute("INSERT INTO observation (ts, terminal_id, commodity_id, side, price, scu) VALUES (1, 1, 10, 'buy', 6000, 0)");

    expect(await migrate(db, createLogger(memorySink()))).toBe(2);

    expect(await db.select('PRAGMA user_version')).toEqual([{ user_version: 2 }]);
    const cols = (await db.select<{ name: string }>('PRAGMA table_info(uex_price)')).map((c) => c.name);
    expect(cols).toContain('scu_buy_max');
    expect(cols).toContain('scu_sell_max');
    expect(await db.select('SELECT * FROM uex_price')).toEqual([]);
    expect(await db.select("SELECT value FROM uex_meta WHERE key = 'prices_synced_at'")).toEqual([]);
    expect(await db.select("SELECT value FROM uex_meta WHERE key = 'routes_fetched:1'")).toEqual([{ value: 'ok' }]);
    expect(await db.select('SELECT scu FROM observation')).toEqual([{ scu: 0 }]);
  });

  it('can be re-run after migration 2 was interrupted half-way', async () => {
    const db = testDb();
    for (const sql of MIGRATIONS[0].statements) await db.execute(sql);
    await db.execute('PRAGMA user_version = 1');
    for (const sql of MIGRATIONS[1].statements.slice(0, 2)) await db.execute(sql);      // the table is rebuilt, the mark is still there
    await db.execute("INSERT INTO uex_meta (key, value) VALUES ('prices_synced_at', '123')");
    expect(await migrate(db, createLogger(memorySink()))).toBe(2);
    expect(await db.select("SELECT 1 FROM uex_meta WHERE key = 'prices_synced_at'")).toEqual([]);
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
