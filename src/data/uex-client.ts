// Client for the public UEX price API. No Tauri imports: the transport is injected
// (`FetchJson`), so the same code runs in the app and in Node tests.

import type { Commodity, StarSystem, Terminal, UexPrice, UexSideStats, Vehicle } from '../core/types';
import type { Logger } from './logger';

export type FetchJson = (url: string) => Promise<{ status: number; body: unknown }>;

export type UexErrorKind = 'network' | 'http' | 'status' | 'shape';

export class UexError extends Error {
  readonly kind: UexErrorKind;
  /** The HTTP status of an answer that was refused (kind `http`); `null` for every other kind. */
  readonly httpStatus: number | null;

  constructor(kind: UexErrorKind, message: string, options?: ErrorOptions & { httpStatus?: number }) {
    super(message, options);
    this.name = 'UexError';
    this.kind = kind;
    this.httpStatus = options?.httpStatus ?? null;
  }
}

/**
 * Whether `err` says that UEX could not be reached (the connection failed or the request timed out), as opposed to an
 * answer that was refused or could not be read.
 */
export const isNetworkFailure = (err: unknown): boolean => err instanceof UexError && err.kind === 'network';

const HTTP_TOO_MANY_REQUESTS = 429;

/** Whether UEX answered "too many requests" (HTTP 429): it asks us to wait. */
export const isRateLimit = (err: unknown): boolean => err instanceof UexError && err.httpStatus === HTTP_TOO_MANY_REQUESTS;

/**
 * Whether the next request of a series would meet the same fate: the network failed, or UEX asked to wait (429). A series
 * of requests that meets this has no use in asking on, and a batch that failed this way is not worth splitting.
 */
export const isUnreachable = (err: unknown): boolean => isNetworkFailure(err) || isRateLimit(err);

export const UEX_BASE = 'https://api.uexcorp.uk/2.0';

/** UEX allows 120 requests a minute: a request starts no sooner than this after the start of the previous one. */
export const UEX_MIN_GAP_MS = 500;

/** What the client needs to keep its distance between requests: the wait is handed in, the client never sets a timer itself. */
export interface UexPacing {
  /** Resolves after `ms` milliseconds. */
  sleep: (ms: number) => Promise<void>;
  /** The least time between the STARTS of two requests; `UEX_MIN_GAP_MS` when absent, no gap at 0. */
  minGapMs?: number;
}

/** UEX allows at most ten terminals per `commodities_prices` request. */
const MAX_PRICE_TERMINALS = 10;

export interface UexClient {
  starSystems(): Promise<StarSystem[]>;
  terminals(starSystemId: number): Promise<Terminal[]>; // terminals?type=commodity&id_star_system=<id>
  commodities(): Promise<Commodity[]>;
  vehicleManufacturers(): Promise<number[]>; // company ids from companies?is_vehicle_manufacturer=1
  vehicles(companyId: number): Promise<Vehicle[]>; // vehicles?id_company=<id>
  prices(terminalIds: number[]): Promise<UexPrice[]>; // 1–10 ids, otherwise RangeError
  distancesFrom(terminalId: number): Promise<Array<{ destId: number; gm: number }>>; // commodities_routes
  distance(a: number, b: number): Promise<number | null>; // terminals_distances
}

type Row = Record<string, unknown>;

const isRow = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);

// UEX sends some numbers as strings ("59") and uses null for missing values, so every
// field goes through these coercions and a bad value never throws.
function toNumberOrNull(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const num = (v: unknown): number => toNumberOrNull(v) ?? 0;
const flag = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 'true';
const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const textOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function mapStarSystem(r: Row): StarSystem | null {
  const id = toNumberOrNull(r.id);
  if (id === null) return null;
  return { id, name: text(r.name), code: text(r.code), isAvailableLive: flag(r.is_available_live) };
}

function mapTerminal(r: Row): Terminal | null {
  const id = toNumberOrNull(r.id);
  if (id === null) return null;
  return {
    id,
    starSystemId: num(r.id_star_system),
    planetId: num(r.id_planet),
    orbitId: num(r.id_orbit),
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
    hasDockingPort: flag(r.has_docking_port),
    maxContainerScu: positiveOrNull(r.max_container_size),
  };
}

/** A size or a count of UEX where zero, an empty value and a non-number all mean "not said". */
function positiveOrNull(v: unknown): number | null {
  const n = toNumberOrNull(v);
  return n !== null && n > 0 ? n : null;
}

/** '1,2,4,8' → [1, 2, 4, 8]; anything that is not such a list is an empty one ("not said"). */
function containerSizes(v: unknown): number[] {
  if (typeof v !== 'string') return [];
  return v.split(',').map((part) => Number(part.trim())).filter((n) => Number.isFinite(n) && n > 0);
}

function mapCommodity(r: Row): Commodity | null {
  const id = toNumberOrNull(r.id);
  if (id === null) return null;
  return {
    id,
    name: text(r.name),
    code: text(r.code),
    isIllegal: flag(r.is_illegal),
    isBuyable: flag(r.is_buyable),
    isSellable: flag(r.is_sellable),
    isAvailableLive: flag(r.is_available_live),
  };
}

// Only the id of a company is needed: it selects the vehicles to request.
const mapCompanyId = (r: Row): number | null => toNumberOrNull(r.id);

function mapVehicle(r: Row): Vehicle | null {
  const id = toNumberOrNull(r.id);
  if (id === null) return null;
  return {
    id, name: text(r.name), nameFull: text(r.name_full), scu: num(r.scu),
    containerScu: containerSizes(r.container_sizes),
    isLoadingDock: flag(r.is_loading_dock), isDocking: flag(r.is_docking),
    padType: typeof r.pad_type === 'string' && r.pad_type !== '' ? r.pad_type : null,
  };
}

// `price_buy` is what the player pays the terminal, `price_sell` what the terminal pays the player.
function mapSide(r: Row, side: 'buy' | 'sell'): UexSideStats {
  const p = `price_${side}`;
  return {
    last: num(r[p]),
    minWeek: num(r[`${p}_min_week`]),
    maxWeek: num(r[`${p}_max_week`]),
    avgWeek: num(r[`${p}_avg_week`]),
    minMonth: num(r[`${p}_min_month`]),
    maxMonth: num(r[`${p}_max_month`]),
    avgMonth: num(r[`${p}_avg_month`]),
    min: num(r[`${p}_min`]),
    max: num(r[`${p}_max`]),
    avg: num(r[`${p}_avg`]),
  };
}

// The largest stock UEX has seen at a terminal on one side: the week's value, and when the week has
// none (zero) the all-time one. Zero stays "unknown".
function mapStockMax(r: Row, side: 'buy' | 'sell'): number {
  return num(r[`scu_${side}_max_week`]) || num(r[`scu_${side}_max`]);
}

function mapPrice(r: Row): UexPrice | null {
  const terminalId = toNumberOrNull(r.id_terminal);
  const commodityId = toNumberOrNull(r.id_commodity);
  if (terminalId === null || commodityId === null) return null;
  return {
    terminalId,
    commodityId,
    buy: mapSide(r, 'buy'),
    sell: mapSide(r, 'sell'),
    scuBuy: num(r.scu_buy),
    scuSell: num(r.scu_sell),
    scuBuyMax: mapStockMax(r, 'buy'),
    scuSellMax: mapStockMax(r, 'sell'),
    dateModified: num(r.date_modified),
  };
}

// A route row carries the distance to its destination; `gm` is null when UEX does not know it.
function mapRoute(r: Row): { destId: number; gm: number | null } | null {
  const destId = toNumberOrNull(r.id_terminal_destination);
  if (destId === null) return null;
  return { destId, gm: toNumberOrNull(r.distance) };
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * `pacing` keeps the requests a gap apart (`UEX_MIN_GAP_MS` by default): a request starts at least that long after the
 * start of the previous one, and at once when the previous one itself took longer. Without `pacing` there is no gap
 * (tests, and the preview, whose network is a fake). The client never retries a request by itself.
 */
export function createUexClient(fetchJson: FetchJson, log: Logger, clockMs: () => number = Date.now, pacing?: UexPacing): UexClient {
  const minGapMs = pacing === undefined ? 0 : (pacing.minGapMs ?? UEX_MIN_GAP_MS);
  let lastStartMs: number | null = null;
  /** The starts wait in line: requests asked for at the same moment still start a gap apart. */
  let turn: Promise<unknown> = Promise.resolve();

  /** Waits until a request may start and returns the time it starts at. */
  function startTime(): Promise<number> {
    if (pacing === undefined || minGapMs <= 0) return Promise.resolve(clockMs());
    const mine = turn.then(async () => {
      if (lastStartMs !== null) {
        // never longer than the gap: a clock that was set back must not make the application wait for an hour
        const wait = Math.min(minGapMs, lastStartMs + minGapMs - clockMs());
        if (wait > 0) await pacing.sleep(wait);
      }
      lastStartMs = clockMs();
      return lastStartMs;
    });
    turn = mine.then(() => undefined, () => undefined);
    return mine;
  }

  /**
   * Runs one request: fetch, check HTTP status and the UEX envelope, then let `extract` pull the
   * payload out of `data`. Every request ends in exactly one log line: `request` at info level,
   * or `request failed` at warn level with the error kind.
   */
  async function run<T>(
    path: string,
    extract: (data: unknown) => { value: T; rows: number; skipped?: number },
  ): Promise<T> {
    const url = `${UEX_BASE}/${path}`;
    const startedAt = await startTime();
    let status: number | undefined;
    try {
      let response: Awaited<ReturnType<FetchJson>>;
      try {
        response = await fetchJson(url);
      } catch (err) {
        throw new UexError('network', `request failed: ${errorMessage(err)}`, { cause: err });
      }
      status = response.status;
      if (status < 200 || status >= 300) {
        const message = status === HTTP_TOO_MANY_REQUESTS ? `HTTP ${status}: UEX request limit reached` : `HTTP ${status}`;
        throw new UexError('http', message, { httpStatus: status });
      }

      const body = response.body;
      if (!isRow(body) || typeof body.status !== 'string') {
        throw new UexError('shape', 'response is not a UEX envelope');
      }
      if (body.status !== 'ok') throw new UexError('status', `UEX status "${body.status}"`);

      let extracted: ReturnType<typeof extract>;
      try {
        extracted = extract(body.data);
      } catch (err) {
        throw err instanceof UexError ? err : new UexError('shape', `unexpected payload: ${errorMessage(err)}`, { cause: err });
      }
      if (extracted.skipped) log.warn('uex', 'skipped malformed rows', { url, skipped: extracted.skipped });
      log.info('uex', 'request', { url, status, ms: elapsed(startedAt), rows: extracted.rows });
      return extracted.value;
    } catch (err) {
      // Fetch and extraction errors are already wrapped; anything else means the transport returned something unusable.
      const error = err instanceof UexError ? err : new UexError('shape', errorMessage(err), { cause: err });
      log.warn('uex', 'request failed', { url, kind: error.kind, status, ms: elapsed(startedAt), message: error.message });
      throw error;
    }
  }

  function elapsed(startedAt: number): number {
    return Math.max(0, Math.round(clockMs() - startedAt));
  }

  /** A request whose `data` is an array of rows; rows without a usable id are dropped. */
  function list<T>(path: string, map: (row: Row) => T | null): Promise<T[]> {
    return run(path, (data) => {
      if (!Array.isArray(data)) throw new UexError('shape', 'data is not an array');
      const value: T[] = [];
      for (const row of data) {
        const mapped = isRow(row) ? map(row) : null;
        if (mapped !== null) value.push(mapped);
      }
      return { value, rows: data.length, skipped: data.length - value.length };
    });
  }

  return {
    starSystems: () => list('star_systems', mapStarSystem),
    // Terminals and vehicles are never requested as one unfiltered list: on a throttled network
    // such a response stalls. Terminals come per star system, vehicles per manufacturer.
    terminals: (starSystemId) => list(`terminals?type=commodity&id_star_system=${starSystemId}`, mapTerminal),
    commodities: () => list('commodities', mapCommodity),
    vehicleManufacturers: () => list('companies?is_vehicle_manufacturer=1', mapCompanyId),
    vehicles: (companyId) => list(`vehicles?id_company=${companyId}`, mapVehicle),

    async prices(terminalIds) {
      if (terminalIds.length < 1 || terminalIds.length > MAX_PRICE_TERMINALS) {
        throw new RangeError(`prices() takes 1 to ${MAX_PRICE_TERMINALS} terminal ids, got ${terminalIds.length}`);
      }
      return list(`commodities_prices?id_terminal=${terminalIds.join(',')}`, mapPrice);
    },

    async distancesFrom(terminalId) {
      const routes = await list(`commodities_routes?id_terminal_origin=${terminalId}`, mapRoute);
      // The same destination appears once per commodity; keep the first known distance.
      const byDest = new Map<number, number>();
      for (const { destId, gm } of routes) {
        if (gm !== null && !byDest.has(destId)) byDest.set(destId, gm);
      }
      return [...byDest].map(([destId, gm]) => ({ destId, gm }));
    },

    distance(a, b) {
      return run(`terminals_distances?id_terminal_origin=${a}&id_terminal_destination=${b}`, (data) => {
        // UEX answers `data: false` for a pair it has no distance for.
        if (data === false || data === null) return { value: null, rows: 0 };
        if (!isRow(data)) throw new UexError('shape', 'data is not an object');
        return { value: toNumberOrNull(data.distance), rows: 1 };
      });
    },
  };
}
