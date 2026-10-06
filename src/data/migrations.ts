import type { Db } from './db';
import type { Logger } from './logger';

export interface Migration {
  version: number;
  statements: string[];
}

// Migrations run without a transaction (tauri-plugin-sql uses a connection pool), so a run
// interrupted half-way leaves some objects behind while `user_version` is still old. Every
// statement of a migration must therefore be safe to run again: the version 1 statements
// use IF NOT EXISTS for that reason, version 2 rebuilds a cache table with DROP / CREATE IF [NOT] EXISTS.
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS uex_star_system (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL, is_available_live INTEGER NOT NULL)`,

      `CREATE TABLE IF NOT EXISTS uex_terminal (
        id INTEGER PRIMARY KEY, star_system_id INTEGER NOT NULL, planet_id INTEGER NOT NULL, orbit_id INTEGER NOT NULL,
        name TEXT NOT NULL, nickname TEXT NOT NULL, displayname TEXT NOT NULL, code TEXT NOT NULL,
        star_system_name TEXT, planet_name TEXT, orbit_name TEXT, moon_name TEXT, space_station_name TEXT,
        outpost_name TEXT, city_name TEXT,
        has_freight_elevator INTEGER NOT NULL, has_loading_dock INTEGER NOT NULL, is_auto_load INTEGER NOT NULL,
        is_available_live INTEGER NOT NULL)`,

      `CREATE TABLE IF NOT EXISTS uex_commodity (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL,
        is_illegal INTEGER NOT NULL, is_buyable INTEGER NOT NULL, is_sellable INTEGER NOT NULL,
        is_available_live INTEGER NOT NULL)`,

      `CREATE TABLE IF NOT EXISTS uex_vehicle (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_full TEXT NOT NULL, scu INTEGER NOT NULL)`,

      `CREATE TABLE IF NOT EXISTS uex_price (
        terminal_id INTEGER NOT NULL, commodity_id INTEGER NOT NULL,
        buy_last REAL NOT NULL, buy_min_week REAL NOT NULL, buy_max_week REAL NOT NULL, buy_avg_week REAL NOT NULL,
        buy_min_month REAL NOT NULL, buy_max_month REAL NOT NULL, buy_avg_month REAL NOT NULL,
        buy_min REAL NOT NULL, buy_max REAL NOT NULL, buy_avg REAL NOT NULL,
        sell_last REAL NOT NULL, sell_min_week REAL NOT NULL, sell_max_week REAL NOT NULL, sell_avg_week REAL NOT NULL,
        sell_min_month REAL NOT NULL, sell_max_month REAL NOT NULL, sell_avg_month REAL NOT NULL,
        sell_min REAL NOT NULL, sell_max REAL NOT NULL, sell_avg REAL NOT NULL,
        scu_buy REAL NOT NULL, scu_sell REAL NOT NULL, date_modified INTEGER NOT NULL, synced_at INTEGER NOT NULL,
        PRIMARY KEY (terminal_id, commodity_id))`,

      // distance_gm is NULL when UEX does not know the distance: that fact is remembered too.
      `CREATE TABLE IF NOT EXISTS uex_distance (
        terminal_a_id INTEGER NOT NULL, terminal_b_id INTEGER NOT NULL, distance_gm REAL,
        PRIMARY KEY (terminal_a_id, terminal_b_id), CHECK (terminal_a_id < terminal_b_id))`,

      `CREATE TABLE IF NOT EXISTS uex_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,

      `CREATE TABLE IF NOT EXISTS observation (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, terminal_id INTEGER NOT NULL,
        commodity_id INTEGER NOT NULL, side TEXT NOT NULL CHECK (side IN ('buy','sell')),
        price REAL NOT NULL, scu INTEGER)`,

      `CREATE INDEX IF NOT EXISTS observation_lookup ON observation (terminal_id, commodity_id, side, ts)`,

      `CREATE TABLE IF NOT EXISTS run (
        id INTEGER PRIMARY KEY AUTOINCREMENT, vehicle_id INTEGER, scu_capacity INTEGER NOT NULL,
        started_at INTEGER NOT NULL, ended_at INTEGER,
        status TEXT NOT NULL CHECK (status IN ('active','done','lost')))`,

      // At most one active run: the partial unique index admits a single row with status 'active'.
      `CREATE UNIQUE INDEX IF NOT EXISTS run_one_active ON run (status) WHERE status = 'active'`,

      `CREATE TABLE IF NOT EXISTS run_event (
        id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER NOT NULL REFERENCES run(id), ts INTEGER NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('buy','sell','depart','arrive')),
        terminal_id INTEGER, commodity_id INTEGER, scu INTEGER, price REAL)`,

      `CREATE INDEX IF NOT EXISTS run_event_run ON run_event (run_id, ts)`,

      `CREATE TABLE IF NOT EXISTS setting (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    ],
  },
  {
    // The stock refill timer needs the largest stock UEX has seen. `uex_price` is only a cache of the
    // UEX answer, so instead of altering it the table is rebuilt with the two new columns and the
    // price sync mark is dropped: the prices are downloaded again on the next start.
    version: 2,
    statements: [
      `DROP TABLE IF EXISTS uex_price`,

      `CREATE TABLE IF NOT EXISTS uex_price (
        terminal_id INTEGER NOT NULL, commodity_id INTEGER NOT NULL,
        buy_last REAL NOT NULL, buy_min_week REAL NOT NULL, buy_max_week REAL NOT NULL, buy_avg_week REAL NOT NULL,
        buy_min_month REAL NOT NULL, buy_max_month REAL NOT NULL, buy_avg_month REAL NOT NULL,
        buy_min REAL NOT NULL, buy_max REAL NOT NULL, buy_avg REAL NOT NULL,
        sell_last REAL NOT NULL, sell_min_week REAL NOT NULL, sell_max_week REAL NOT NULL, sell_avg_week REAL NOT NULL,
        sell_min_month REAL NOT NULL, sell_max_month REAL NOT NULL, sell_avg_month REAL NOT NULL,
        sell_min REAL NOT NULL, sell_max REAL NOT NULL, sell_avg REAL NOT NULL,
        scu_buy REAL NOT NULL, scu_sell REAL NOT NULL,
        scu_buy_max REAL NOT NULL DEFAULT 0, scu_sell_max REAL NOT NULL DEFAULT 0,
        date_modified INTEGER NOT NULL, synced_at INTEGER NOT NULL,
        PRIMARY KEY (terminal_id, commodity_id))`,

      `DELETE FROM uex_meta WHERE key = 'prices_synced_at'`,
    ],
  },
];

async function readVersion(db: Db): Promise<number> {
  const rows = await db.select<{ user_version: number }>('PRAGMA user_version');
  return rows[0]?.user_version ?? 0;
}

/** Applies every migration newer than `PRAGMA user_version`; returns the schema version afterwards. */
export async function migrate(db: Db, log: Logger): Promise<number> {
  let version = await readVersion(db);
  for (const migration of MIGRATIONS) {
    if (migration.version <= version) continue;
    try {
      // One statement per call: the driver prepares a single statement at a time.
      for (const statement of migration.statements) await db.execute(statement);
      // PRAGMA takes no bound parameters, and the version is a number from our own table.
      await db.execute(`PRAGMA user_version = ${Math.trunc(migration.version)}`);
    } catch (err) {
      log.error('db', 'migration failed', { version: migration.version, from: version, err });
      throw err;
    }
    log.info('db', 'migration applied', { version: migration.version, statements: migration.statements.length });
    version = migration.version;
  }
  log.debug('db', 'schema ready', { version });
  return version;
}
