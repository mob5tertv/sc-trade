import { distKey, type Commodity, type Reference, type StarSystem, type Terminal, type UexPrice, type UexSideStats, type Vehicle } from '../../core/types';
import type { Db } from '../db';

// The local copy of UEX data: reference lists, last prices, distances and sync marks.
// Writes are multi-row `INSERT ... ON CONFLICT DO UPDATE` with at most ROWS_PER_STATEMENT rows,
// one statement per call and no explicit transactions (see db.ts).

const ROWS_PER_STATEMENT = 100;

type Row = Record<string, unknown>;

function* chunks<T>(items: readonly T[], size = ROWS_PER_STATEMENT): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

const int = (v: boolean): number => (v ? 1 : 0);

/** Inserts the rows, or updates every non-key column of a row that already exists. */
async function upsertRows(db: Db, table: string, columns: string[], key: string[], rows: unknown[][]): Promise<void> {
  const placeholders = `(${columns.map(() => '?').join(', ')})`;
  const updates = columns.filter((c) => !key.includes(c)).map((c) => `${c} = excluded.${c}`).join(', ');
  for (const part of chunks(rows)) {
    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${part.map(() => placeholders).join(', ')} `
      + `ON CONFLICT(${key.join(', ')}) DO UPDATE SET ${updates}`;
    await db.execute(sql, part.flat());
  }
}

/** Deletes the rows of a table whose `id` is not in `keep`. */
async function deleteMissing(db: Db, table: string, keep: number[]): Promise<void> {
  const keepIds = new Set(keep);
  const stored = await db.select<{ id: number }>(`SELECT id FROM ${table}`);
  const gone = stored.map((r) => r.id).filter((id) => !keepIds.has(id));
  for (const part of chunks(gone)) {
    await db.execute(`DELETE FROM ${table} WHERE id IN (${part.map(() => '?').join(', ')})`, part);
  }
}

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

const STAR_SYSTEM = { table: 'uex_star_system', columns: ['id', 'name', 'code', 'is_available_live'] };
const TERMINAL = {
  table: 'uex_terminal',
  columns: [
    'id', 'star_system_id', 'planet_id', 'orbit_id', 'name', 'nickname', 'displayname', 'code',
    'star_system_name', 'planet_name', 'orbit_name', 'moon_name', 'space_station_name', 'outpost_name', 'city_name',
    'has_freight_elevator', 'has_loading_dock', 'is_auto_load', 'is_available_live',
  ],
};
const COMMODITY = {
  table: 'uex_commodity',
  columns: ['id', 'name', 'code', 'is_illegal', 'is_buyable', 'is_sellable', 'is_available_live'],
};
const VEHICLE = { table: 'uex_vehicle', columns: ['id', 'name', 'name_full', 'scu'] };

const upsertStarSystems = (db: Db, list: StarSystem[]) => upsertRows(db, STAR_SYSTEM.table, STAR_SYSTEM.columns, ['id'],
  list.map((s) => [s.id, s.name, s.code, int(s.isAvailableLive)]));

const upsertTerminals = (db: Db, list: Terminal[]) => upsertRows(db, TERMINAL.table, TERMINAL.columns, ['id'],
  list.map((t) => [
    t.id, t.starSystemId, t.planetId, t.orbitId, t.name, t.nickname, t.displayname, t.code,
    t.starSystemName, t.planetName, t.orbitName, t.moonName, t.spaceStationName, t.outpostName, t.cityName,
    int(t.hasFreightElevator), int(t.hasLoadingDock), int(t.isAutoLoad), int(t.isAvailableLive),
  ]));

const upsertCommodities = (db: Db, list: Commodity[]) => upsertRows(db, COMMODITY.table, COMMODITY.columns, ['id'],
  list.map((c) => [c.id, c.name, c.code, int(c.isIllegal), int(c.isBuyable), int(c.isSellable), int(c.isAvailableLive)]));

/** Adds and updates vehicles but never deletes: for a vehicle list that is known to be incomplete. */
export const upsertVehicles = (db: Db, list: Vehicle[]) => upsertRows(db, VEHICLE.table, VEHICLE.columns, ['id'],
  list.map((v) => [v.id, v.name, v.nameFull, v.scu]));

/**
 * Stores the lists that are present in `part`: each one is upserted, then the rows whose id is not
 * in it any more are deleted. A list that is absent from `part` is left as it is.
 */
export async function saveReference(
  db: Db,
  part: { starSystems?: StarSystem[]; terminals?: Terminal[]; commodities?: Commodity[]; vehicles?: Vehicle[] },
): Promise<void> {
  if (part.starSystems) {
    await upsertStarSystems(db, part.starSystems);
    await deleteMissing(db, STAR_SYSTEM.table, part.starSystems.map((s) => s.id));
  }
  if (part.terminals) {
    await upsertTerminals(db, part.terminals);
    await deleteMissing(db, TERMINAL.table, part.terminals.map((t) => t.id));
  }
  if (part.commodities) {
    await upsertCommodities(db, part.commodities);
    await deleteMissing(db, COMMODITY.table, part.commodities.map((c) => c.id));
  }
  if (part.vehicles) {
    await upsertVehicles(db, part.vehicles);
    await deleteMissing(db, VEHICLE.table, part.vehicles.map((v) => v.id));
  }
}

const text = (v: unknown): string => String(v);
const textOrNull = (v: unknown): string | null => (v === null ? null : String(v));
const flag = (v: unknown): boolean => Number(v) !== 0;

function toTerminal(r: Row): Terminal {
  return {
    id: Number(r.id),
    starSystemId: Number(r.star_system_id),
    planetId: Number(r.planet_id),
    orbitId: Number(r.orbit_id),
    name: text(r.name),
    nickname: text(r.nickname),
    displayname: text(r.displayname),
    code: text(r.code),
    starSystemName: textOrNull(r.star_system_name),
    planetName: textOrNull(r.planet_name),
    orbitName: textOrNull(r.orbit_name),
    moonName: textOrNull(r.moon_name),
    spaceStationName: textOrNull(r.space_station_name),
    outpostName: textOrNull(r.outpost_name),
    cityName: textOrNull(r.city_name),
    hasFreightElevator: flag(r.has_freight_elevator),
    hasLoadingDock: flag(r.has_loading_dock),
    isAutoLoad: flag(r.is_auto_load),
    isAvailableLive: flag(r.is_available_live),
  };
}

export async function loadReference(db: Db): Promise<Reference> {
  const starSystems = (await db.select<Row>('SELECT * FROM uex_star_system ORDER BY id')).map((r): StarSystem => (
    { id: Number(r.id), name: text(r.name), code: text(r.code), isAvailableLive: flag(r.is_available_live) }
  ));
  const terminals = (await db.select<Row>('SELECT * FROM uex_terminal ORDER BY id')).map(toTerminal);
  const commodities = (await db.select<Row>('SELECT * FROM uex_commodity ORDER BY id')).map((r): Commodity => ({
    id: Number(r.id),
    name: text(r.name),
    code: text(r.code),
    isIllegal: flag(r.is_illegal),
    isBuyable: flag(r.is_buyable),
    isSellable: flag(r.is_sellable),
    isAvailableLive: flag(r.is_available_live),
  }));
  const vehicles = (await db.select<Row>('SELECT * FROM uex_vehicle ORDER BY id')).map((r): Vehicle => (
    { id: Number(r.id), name: text(r.name), nameFull: text(r.name_full), scu: Number(r.scu) }
  ));
  return {
    starSystems,
    terminals: new Map(terminals.map((t) => [t.id, t])),
    commodities: new Map(commodities.map((c) => [c.id, c])),
    vehicles,
  };
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

// UexSideStats field -> column suffix; the columns are `buy_<suffix>` and `sell_<suffix>`.
const STATS: Array<[keyof UexSideStats, string]> = [
  ['last', 'last'],
  ['minWeek', 'min_week'], ['maxWeek', 'max_week'], ['avgWeek', 'avg_week'],
  ['minMonth', 'min_month'], ['maxMonth', 'max_month'], ['avgMonth', 'avg_month'],
  ['min', 'min'], ['max', 'max'], ['avg', 'avg'],
];
const SIDES = ['buy', 'sell'] as const;

const PRICE_COLUMNS = [
  'terminal_id', 'commodity_id',
  ...SIDES.flatMap((side) => STATS.map(([, suffix]) => `${side}_${suffix}`)),
  'scu_buy', 'scu_sell', 'scu_buy_max', 'scu_sell_max', 'date_modified', 'synced_at',
];

/**
 * Stores the prices that were fetched for `terminalIds`, then removes the rows of those terminals
 * that this fetch did not touch (`synced_at < syncedAt`): a commodity that a terminal stopped
 * trading disappears, a terminal that was not part of the fetch keeps everything.
 */
export async function upsertPrices(db: Db, terminalIds: number[], rows: UexPrice[], syncedAt: number): Promise<void> {
  await upsertRows(db, 'uex_price', PRICE_COLUMNS, ['terminal_id', 'commodity_id'], rows.map((p) => [
    p.terminalId, p.commodityId,
    ...SIDES.flatMap((side) => STATS.map(([field]) => p[side][field])),
    p.scuBuy, p.scuSell, p.scuBuyMax, p.scuSellMax, p.dateModified, syncedAt,
  ]));
  for (const part of chunks(terminalIds)) {
    await db.execute(
      `DELETE FROM uex_price WHERE synced_at < ? AND terminal_id IN (${part.map(() => '?').join(', ')})`,
      [syncedAt, ...part],
    );
  }
}

function toPrice(r: Row): UexPrice {
  const side = (s: (typeof SIDES)[number]): UexSideStats => {
    const stats = {} as UexSideStats;
    for (const [field, suffix] of STATS) stats[field] = Number(r[`${s}_${suffix}`]);
    return stats;
  };
  return {
    terminalId: Number(r.terminal_id),
    commodityId: Number(r.commodity_id),
    buy: side('buy'),
    sell: side('sell'),
    scuBuy: Number(r.scu_buy),
    scuSell: Number(r.scu_sell),
    scuBuyMax: Number(r.scu_buy_max),
    scuSellMax: Number(r.scu_sell_max),
    dateModified: Number(r.date_modified),
  };
}

/**
 * The cached prices, except those of a terminal that the reference says is NOT live (`is_available_live = 0`): the price sync asks
 * only live terminals, so such a terminal would keep its last prices for ever and go on being offered. The rows stay in the table
 * (the terminal may be marked live again); the player's own records of that terminal are not touched here. A terminal the
 * reference does not list at all keeps its rows in the result: the routes leave out a terminal they do not know.
 */
export async function loadUexPrices(db: Db): Promise<UexPrice[]> {
  return (await db.select<Row>(
    'SELECT p.* FROM uex_price p '
    + 'WHERE NOT EXISTS (SELECT 1 FROM uex_terminal t WHERE t.id = p.terminal_id AND t.is_available_live = 0) '
    + 'ORDER BY p.terminal_id, p.commodity_id',
  )).map(toPrice);
}

// ---------------------------------------------------------------------------
// Distances
// ---------------------------------------------------------------------------

/** The table keeps one row per pair with the smaller id first; `gm` null means UEX does not know the distance. */
export async function putDistances(db: Db, rows: Array<{ a: number; b: number; gm: number | null }>): Promise<void> {
  const pairs = rows
    .filter(({ a, b }) => a !== b) // a terminal has no distance to itself; the table forbids such a row
    .map(({ a, b, gm }) => [Math.min(a, b), Math.max(a, b), gm]);
  await upsertRows(db, 'uex_distance', ['terminal_a_id', 'terminal_b_id', 'distance_gm'], ['terminal_a_id', 'terminal_b_id'], pairs);
}

/** Every known pair, keyed by `distKey`; the value is null for a pair UEX has no distance for. */
export async function loadDistances(db: Db): Promise<Map<string, number | null>> {
  const rows = await db.select<{ terminal_a_id: number; terminal_b_id: number; distance_gm: number | null }>(
    'SELECT terminal_a_id, terminal_b_id, distance_gm FROM uex_distance',
  );
  return new Map(rows.map((r) => [distKey(r.terminal_a_id, r.terminal_b_id), r.distance_gm]));
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

export async function getMeta(db: Db, key: string): Promise<string | null> {
  const rows = await db.select<{ value: string }>('SELECT value FROM uex_meta WHERE key = ?', [key]);
  return rows[0]?.value ?? null;
}

export async function setMeta(db: Db, key: string, value: string): Promise<void> {
  await db.execute(
    'INSERT INTO uex_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
  );
}
