import { DEFAULT_SETTINGS, type Settings } from '../core/settings';
import type { Commodity, StarSystem, Terminal, UexPrice, UexSideStats, Vehicle } from '../core/types';
import type { Db } from '../data/db';
import { createLogger } from '../data/logger';
import { migrate } from '../data/migrations';
import { addObservation } from '../data/repo/diary';
import { saveSetting } from '../data/repo/settings';
import { putDistances, saveReference, setMeta, upsertPrices } from '../data/repo/uex-cache';
import { recordBuy, recordMark, recordSell, type TradeDeps } from '../data/trade';
import type { DatasetName } from './datasets';

// The test data of the preview. It runs on the dev server, against a database made by the REAL migrations and
// written by the REAL repository and trade functions, so a dataset cannot drift away from the schema.
// Every time is counted back from `now`, the moment the database was made, and lands a few seconds past a whole
// minute, so an age on the screen ("12 мин") stays the same for the first minute after the page loads.

const log = createLogger({ write() {} });

const MIN = 60;
const HOUR = 3600;
const DAY = 86_400;
/** Ages are a few seconds past the whole minute: "12 мин" keeps reading 12 for the next 55 seconds. */
const PAST = 5;

const STANTON = 68;
const PYRO = 99;
const NYX = 100;

const C2_HERCULES = 5;

// ---------------------------------------------------------------------------------------------------
// The reference
// ---------------------------------------------------------------------------------------------------

const STAR_SYSTEMS: StarSystem[] = [
  { id: STANTON, name: 'Stanton', code: 'STANTON', isAvailableLive: true },
  { id: PYRO, name: 'Pyro', code: 'PYRO', isAvailableLive: true },
  { id: NYX, name: 'Nyx', code: 'NYX', isAvailableLive: true },
];

/** A place a terminal stands at: its names and where it is, in Gm of its star system (for the distances). */
interface Place { planet: string | null; orbit: string | null; moon?: string; station?: string; outpost?: string; city?: string; x: number; y: number }

const HURSTON = { x: 11, y: 6 };
const CRUSADER = { x: -9, y: 16 };
const ARCCORP = { x: -18, y: -9 };
const MICROTECH = { x: 20, y: -33 };

const near = (planet: { x: number; y: number }, dx: number, dy: number) => ({ x: planet.x + dx, y: planet.y + dy });

interface TerminalSeed {
  id: number; system: number; nickname: string; displayname: string; name: string; code: string; place: Place;
  elevator?: boolean; dock?: boolean;
}

const TERMINALS: TerminalSeed[] = [
  { id: 1, system: STANTON, nickname: 'ARC-L1', displayname: 'ARC-L1 Wide Forest Station', name: 'Admin - ARC-L1', code: 'ARCL1', elevator: true,
    place: { planet: 'ArcCorp', orbit: 'ArcCorp Lagrange Point 1', station: 'ARC-L1 Wide Forest Station', ...near(ARCCORP, 2.0, 1.0) } },
  { id: 2, system: STANTON, nickname: 'CRU-L1', displayname: 'CRU-L1 Ambitious Dream Station', name: 'Admin - CRU-L1', code: 'CRUL1', elevator: true,
    place: { planet: 'Crusader', orbit: 'Crusader Lagrange Point 1', station: 'CRU-L1 Ambitious Dream Station', ...near(CRUSADER, 1.7, -1.0) } },
  { id: 3, system: STANTON, nickname: 'HUR-L1', displayname: 'HUR-L1 Green Glade Station', name: 'Admin - HUR-L1', code: 'HURL1', elevator: true,
    place: { planet: 'Hurston', orbit: 'Hurston Lagrange Point 1', station: 'HUR-L1 Green Glade Station', ...near(HURSTON, 1.6, 0.9) } },
  { id: 4, system: STANTON, nickname: 'MIC-L1', displayname: 'MIC-L1 Shallow Frontier Station', name: 'Admin - MIC-L1', code: 'MICL1', elevator: true,
    place: { planet: 'microTech', orbit: 'microTech Lagrange Point 1', station: 'MIC-L1 Shallow Frontier Station', ...near(MICROTECH, 3.4, -1.6) } },
  { id: 5, system: STANTON, nickname: 'TDD Area 18', displayname: 'Area 18 TDD', name: 'TDD - Area 18', code: 'A18TDD', dock: true,
    place: { planet: 'ArcCorp', orbit: 'ArcCorp', city: 'Area 18', ...near(ARCCORP, 0.2, 0.0) } },
  { id: 6, system: STANTON, nickname: 'TDD Lorville', displayname: 'Lorville TDD', name: 'TDD - Lorville', code: 'LORTDD', dock: true,
    place: { planet: 'Hurston', orbit: 'Hurston', city: 'Lorville', ...near(HURSTON, 0.1, 0.2) } },
  { id: 7, system: STANTON, nickname: 'TDD New Babbage', displayname: 'New Babbage TDD', name: 'TDD - New Babbage', code: 'NBTDD', dock: true,
    place: { planet: 'microTech', orbit: 'microTech', city: 'New Babbage', ...near(MICROTECH, 0.2, 0.1) } },
  { id: 8, system: STANTON, nickname: 'TDD Orison', displayname: 'Orison TDD', name: 'TDD - Orison', code: 'ORTDD', dock: true,
    place: { planet: 'Crusader', orbit: 'Crusader', city: 'Orison', ...near(CRUSADER, 0.2, 0.1) } },
  { id: 9, system: STANTON, nickname: 'Everus Harbor', displayname: 'Everus Harbor', name: 'Admin - Everus Harbor', code: 'EVHB', elevator: true,
    place: { planet: 'Hurston', orbit: 'Hurston', station: 'Everus Harbor', ...near(HURSTON, -0.3, 0.1) } },
  { id: 10, system: STANTON, nickname: 'Baijini Point', displayname: 'Baijini Point', name: 'Admin - Baijini Point', code: 'BAIJ', elevator: true,
    place: { planet: 'ArcCorp', orbit: 'ArcCorp', station: 'Baijini Point', ...near(ARCCORP, -0.3, 0.2) } },
  { id: 11, system: STANTON, nickname: 'Port Tressler', displayname: 'Port Tressler', name: 'Admin - Port Tressler', code: 'PTRS', elevator: true,
    place: { planet: 'microTech', orbit: 'microTech', station: 'Port Tressler', ...near(MICROTECH, -0.3, 0.2) } },
  { id: 12, system: STANTON, nickname: 'Seraphim Station', displayname: 'Seraphim Station', name: 'Admin - Seraphim Station', code: 'SERA', elevator: true,
    place: { planet: 'Crusader', orbit: 'Crusader', station: 'Seraphim Station', ...near(CRUSADER, -0.2, 0.3) } },
  { id: 13, system: STANTON, nickname: 'GrimHEX', displayname: 'GrimHEX', name: 'Admin - GrimHEX', code: 'GRIM', dock: true,
    place: { planet: 'Crusader', orbit: 'Yela', moon: 'Yela', outpost: 'GrimHEX', ...near(CRUSADER, 3.0, -1.2) } },
  { id: 14, system: PYRO, nickname: 'Ruin Station', displayname: 'Ruin Station', name: 'Admin - Ruin Station', code: 'RUIN', elevator: true,
    place: { planet: 'Pyro', orbit: 'Pyro', station: 'Ruin Station', x: 0, y: 0 } },
  { id: 15, system: PYRO, nickname: 'Checkmate', displayname: 'Checkmate Station', name: 'Admin - Checkmate', code: 'CHKM', elevator: true,
    place: { planet: 'Pyro', orbit: 'Pyro', station: 'Checkmate Station', x: 14, y: 6 } },
  { id: 16, system: PYRO, nickname: 'Orbituary', displayname: 'Orbituary', name: 'Admin - Orbituary', code: 'ORBI', elevator: true,
    place: { planet: 'Pyro', orbit: 'Pyro', station: 'Orbituary', x: -9, y: 11 } },
  { id: 17, system: NYX, nickname: 'Levski', displayname: 'Levski', name: 'Admin - Levski', code: 'LEVS', dock: true,
    place: { planet: 'Delamar', orbit: 'Delamar', outpost: 'Levski', x: 0, y: 0 } },
];

const PLANET_IDS: Record<string, number> = { Crusader: 2, Hurston: 3, ArcCorp: 4, microTech: 5, Pyro: 20, Delamar: 30 };

function toTerminal(t: TerminalSeed): Terminal {
  const systemName = STAR_SYSTEMS.find((s) => s.id === t.system)?.name ?? null;
  return {
    id: t.id, starSystemId: t.system, planetId: PLANET_IDS[t.place.planet ?? ''] ?? 0, orbitId: t.id,
    name: t.name, nickname: t.nickname, displayname: t.displayname, code: t.code,
    starSystemName: systemName, planetName: t.place.planet, orbitName: t.place.orbit, moonName: t.place.moon ?? null,
    spaceStationName: t.place.station ?? null, outpostName: t.place.outpost ?? null, cityName: t.place.city ?? null,
    hasFreightElevator: t.elevator ?? false, hasLoadingDock: t.dock ?? false, isAutoLoad: true, isAvailableLive: true,
  };
}

/** Name, code and the base price in UEC per SCU. */
const COMMODITY_TABLE: Array<[name: string, code: string, base: number]> = [
  ['Medical Supplies', 'MEDS', 2250], ['Gold', 'GOLD', 6100], ['Tungsten', 'TUNG', 3650], ['Laranite', 'LARA', 3150],
  ['Agricium', 'AGRI', 2650], ['Titanium', 'TITA', 8450], ['Diamond', 'DIAM', 7050], ['Stims', 'STIM', 3050],
  ['Quartz', 'QUAR', 1450], ['Hydrogen', 'HYDR', 450], ['Processed Food', 'PFOO', 1480], ['Scrap', 'SCRA', 1650],
  ['Waste', 'WAST', 120], ['Beryl', 'BERY', 4300], ['Aluminum', 'ALUM', 1200],
];

const COMMODITIES: Commodity[] = COMMODITY_TABLE.map(([name, code], i) => ({
  id: i + 1, name, code, isIllegal: false, isBuyable: true, isSellable: true, isAvailableLive: true,
}));
const commodityId = (code: string): number => {
  const found = COMMODITIES.find((c) => c.code === code);
  if (!found) throw new Error(`preview seed: unknown commodity code ${code}`);
  return found.id;
};
const basePrice = (id: number): number => COMMODITY_TABLE[id - 1][2];

const VEHICLES: Vehicle[] = [
  { id: 1, name: 'Cutlass Black', nameFull: 'Drake Cutlass Black', scu: 46 },
  { id: 2, name: 'Freelancer MAX', nameFull: 'MISC Freelancer MAX', scu: 120 },
  { id: 3, name: 'Freelancer', nameFull: 'MISC Freelancer', scu: 66 },
  { id: 4, name: 'Caterpillar', nameFull: 'Drake Caterpillar', scu: 576 },
  { id: C2_HERCULES, name: 'C2 Hercules', nameFull: 'Crusader C2 Hercules', scu: 696 },
  { id: 6, name: 'Constellation Andromeda', nameFull: 'RSI Constellation Andromeda', scu: 96 },
  { id: 7, name: 'Hull A', nameFull: 'MISC Hull A', scu: 64 },
  { id: 8, name: 'Mercury Star Runner', nameFull: 'Crusader Mercury Star Runner', scu: 114 },
];

// ---------------------------------------------------------------------------------------------------
// The market: what each terminal sells to the player ("buy" side in UEX terms) and what it buys from him
// ---------------------------------------------------------------------------------------------------

const MARKETS: Record<number, { sells: string; buys: string }> = {
  1: { sells: 'GOLD LARA QUAR AGRI', buys: 'MEDS STIM PFOO HYDR SCRA' },
  2: { sells: 'AGRI TITA PFOO WAST', buys: 'MEDS LARA DIAM SCRA' },
  3: { sells: 'MEDS STIM PFOO HYDR ALUM SCRA', buys: 'GOLD TUNG LARA DIAM' },
  4: { sells: 'TUNG BERY DIAM QUAR', buys: 'GOLD AGRI STIM PFOO HYDR' },
  5: { sells: 'MEDS STIM', buys: 'GOLD TUNG LARA TITA AGRI DIAM BERY' },
  6: { sells: 'GOLD TUNG SCRA QUAR', buys: 'MEDS STIM PFOO ALUM HYDR' },
  7: { sells: 'MEDS STIM PFOO', buys: 'AGRI LARA TITA SCRA WAST' },
  8: { sells: 'MEDS PFOO ALUM QUAR', buys: 'GOLD DIAM BERY HYDR' },
  9: { sells: 'DIAM MEDS STIM PFOO HYDR ALUM', buys: 'LARA AGRI SCRA' },
  10: { sells: 'LARA BERY TITA SCRA', buys: 'MEDS PFOO QUAR STIM' },
  11: { sells: 'GOLD AGRI TUNG QUAR', buys: 'MEDS STIM HYDR ALUM' },
  12: { sells: 'TITA WAST PFOO BERY', buys: 'GOLD DIAM LARA MEDS' },
  13: { sells: 'SCRA WAST STIM DIAM', buys: 'MEDS PFOO GOLD TITA' },
  14: { sells: 'TUNG AGRI LARA', buys: 'MEDS STIM PFOO GOLD' },
  15: { sells: 'BERY TITA QUAR', buys: 'MEDS STIM HYDR SCRA ALUM' },
  16: { sells: 'ALUM WAST SCRA', buys: 'PFOO STIM MEDS DIAM' },
  17: { sells: 'PFOO STIM SCRA', buys: 'GOLD AGRI TITA MEDS' },
};

/** Terminal and commodity whose UEX row has no modification date (UEX says 0 when it does not know). */
const UNDATED = new Set(['9:DIAM', '13:SCRA']);

/** A small deterministic random generator: the same terminal and commodity always get the same numbers. */
function randomOf(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const EMPTY_SIDE: UexSideStats = { last: 0, minWeek: 0, maxWeek: 0, avgWeek: 0, minMonth: 0, maxMonth: 0, avgMonth: 0, min: 0, max: 0, avg: 0 };

/** The statistics of one side around its last price: the week inside the month inside the whole history. */
function sideAround(last: number, rng: () => number): UexSideStats {
  const minWeek = Math.round(last * (0.92 + rng() * 0.05));
  const maxWeek = Math.round(last * (1.03 + rng() * 0.06));
  const minMonth = Math.round(minWeek * (0.9 + rng() * 0.07));
  const maxMonth = Math.round(maxWeek * (1.02 + rng() * 0.08));
  return {
    last, minWeek, maxWeek, avgWeek: Math.round((minWeek + maxWeek + last) / 3),
    minMonth, maxMonth, avgMonth: Math.round((minMonth + maxMonth + last) / 3),
    min: Math.round(minMonth * 0.9), max: Math.round(maxMonth * 1.1), avg: Math.round((minMonth + maxMonth) / 2),
  };
}

function uexRow(terminalId: number, code: string, role: 'sells' | 'buys', now: number): UexPrice {
  const id = commodityId(code);
  const rng = randomOf(terminalId * 1009 + id * 31);
  // a terminal that sells is a little cheaper than the base price, one that buys pays a little more
  const factor = role === 'sells' ? 0.82 + rng() * 0.2 : 1.02 + rng() * 0.2;
  const last = Math.round((basePrice(id) * factor) / 5) * 5 || 1;
  const stats = sideAround(last, rng);
  const empty = rng() < 0.1;
  const stock = empty ? 0 : Math.round(60 + rng() * 1300);
  const stockMax = stock === 0 ? Math.round(300 + rng() * 900) : Math.round(stock * (1.2 + rng() * 0.6) + 100);
  const ageSec = Math.round((10 + rng() * 7000) * MIN);
  const dateModified = UNDATED.has(`${terminalId}:${code}`) ? 0 : now - ageSec - PAST;
  const selling = role === 'sells';
  return {
    terminalId, commodityId: id,
    buy: selling ? stats : { ...EMPTY_SIDE }, sell: selling ? { ...EMPTY_SIDE } : stats,
    scuBuy: selling ? stock : 0, scuSell: selling ? 0 : stock,
    scuBuyMax: selling ? stockMax : 0, scuSellMax: selling ? 0 : stockMax,
    dateModified,
  };
}

function priceRows(now: number): UexPrice[] {
  const rows: UexPrice[] = [];
  for (const [id, market] of Object.entries(MARKETS)) {
    const seen = new Set<string>();
    for (const role of ['sells', 'buys'] as const) {
      for (const code of market[role].split(' ')) {
        if (seen.has(code)) throw new Error(`preview seed: terminal ${id} lists ${code} twice`);
        seen.add(code);
        rows.push(uexRow(Number(id), code, role, now));
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------------
// Distances
// ---------------------------------------------------------------------------------------------------

function distanceRows(): Array<{ a: number; b: number; gm: number | null }> {
  const rows: Array<{ a: number; b: number; gm: number | null }> = [];
  for (const a of TERMINALS) {
    for (const b of TERMINALS) {
      if (a.id >= b.id || a.system !== b.system) continue;
      const gm = Math.hypot(a.place.x - b.place.x, a.place.y - b.place.y);
      rows.push({ a: a.id, b: b.id, gm: Math.round(gm * 100) / 100 });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------------
// The player's own observations
// ---------------------------------------------------------------------------------------------------

/** How long ago, as a number of seconds (a few seconds past the whole unit). */
const ago = { m: (n: number) => n * MIN + PAST, h: (n: number) => n * HOUR + PAST, d: (n: number) => n * DAY + PAST };

interface OwnObservation { terminal: number; code: string; side: 'buy' | 'sell'; jitter: number; scu: number | null; age: number }

/** Hot, warm, cooling and cold; with a quantity, without one, and a known zero. `jitter` is against the UEX price. */
const OWN_OBSERVATIONS: OwnObservation[] = [
  // the stock of Medical Supplies at HUR-L1 over the last hours: the refill rate is learned from these
  { terminal: 3, code: 'MEDS', side: 'buy', jitter: 1.0, scu: 120, age: ago.h(9) },
  { terminal: 3, code: 'MEDS', side: 'buy', jitter: 1.01, scu: 260, age: ago.h(6) },
  { terminal: 3, code: 'MEDS', side: 'buy', jitter: 1.02, scu: 330, age: ago.h(3) },
  // hot
  { terminal: 3, code: 'MEDS', side: 'buy', jitter: 1.03, scu: 380, age: ago.m(7) },
  { terminal: 3, code: 'STIM', side: 'buy', jitter: 0.98, scu: null, age: ago.m(7) },
  { terminal: 1, code: 'GOLD', side: 'buy', jitter: 1.01, scu: 64, age: ago.m(22) },
  { terminal: 5, code: 'GOLD', side: 'sell', jitter: 1.04, scu: null, age: ago.m(38) },
  { terminal: 11, code: 'AGRI', side: 'buy', jitter: 0.97, scu: 0, age: ago.m(48) },
  // warm
  { terminal: 5, code: 'TUNG', side: 'sell', jitter: 1.02, scu: 210, age: ago.m(95) },
  { terminal: 9, code: 'DIAM', side: 'buy', jitter: 1.0, scu: 150, age: ago.m(140) },
  // cooling
  { terminal: 2, code: 'TITA', side: 'buy', jitter: 1.03, scu: 90, age: ago.m(205) },
  { terminal: 4, code: 'BERY', side: 'buy', jitter: 0.99, scu: null, age: ago.m(215) },
  // cold
  { terminal: 6, code: 'GOLD', side: 'buy', jitter: 1.06, scu: 55, age: ago.h(5) },
  { terminal: 7, code: 'AGRI', side: 'sell', jitter: 0.96, scu: null, age: ago.h(9) },
  { terminal: 10, code: 'LARA', side: 'buy', jitter: 1.02, scu: 300, age: ago.h(26) },
  { terminal: 8, code: 'DIAM', side: 'sell', jitter: 1.05, scu: null, age: ago.d(2) },
  { terminal: 12, code: 'TITA', side: 'buy', jitter: 0.95, scu: 0, age: ago.d(3) },
  { terminal: 13, code: 'STIM', side: 'buy', jitter: 1.08, scu: 40, age: ago.d(4) },

  // The same price seen again: the player's own sale prices at the places of the trips from HUR-L1 (Stims), each
  // after an earlier reading of it, hours before: it rose, fell, stayed
  { terminal: 4, code: 'STIM', side: 'sell', jitter: 1.03, scu: null, age: ago.m(18) }, // hot
  { terminal: 4, code: 'STIM', side: 'sell', jitter: 0.96, scu: null, age: ago.h(5) },
  { terminal: 11, code: 'STIM', side: 'sell', jitter: 0.97, scu: null, age: ago.m(75) }, // warm
  { terminal: 11, code: 'STIM', side: 'sell', jitter: 1.05, scu: null, age: ago.h(4) },
  { terminal: 6, code: 'STIM', side: 'sell', jitter: 1.01, scu: null, age: ago.m(33) }, // hot
  { terminal: 6, code: 'STIM', side: 'sell', jitter: 1.01, scu: null, age: ago.h(2) },
  // and the readings before two purchase prices above, those of the trips to HUR-L1: Diamond at Everus Harbor fell,
  // Gold at ARC-L1 rose
  { terminal: 9, code: 'DIAM', side: 'buy', jitter: 1.1, scu: null, age: ago.h(7) },
  { terminal: 1, code: 'GOLD', side: 'buy', jitter: 0.94, scu: null, age: ago.h(3) },
];

// ---------------------------------------------------------------------------------------------------
// The datasets
// ---------------------------------------------------------------------------------------------------

async function writeReference(db: Db, now: number): Promise<UexPrice[]> {
  await saveReference(db, {
    starSystems: STAR_SYSTEMS, terminals: TERMINALS.map(toTerminal), commodities: COMMODITIES, vehicles: VEHICLES,
  });
  const prices = priceRows(now);
  await upsertPrices(db, TERMINALS.map((t) => t.id), prices, now);
  await putDistances(db, distanceRows());
  // fresh marks: the background sync (it needs the network) must not start
  await setMeta(db, 'reference_synced_at', String(now - ago.h(3)));
  await setMeta(db, 'prices_synced_at', String(now - ago.m(12)));
  return prices;
}

async function writeObservations(db: Db, prices: UexPrice[], now: number): Promise<void> {
  for (const o of OWN_OBSERVATIONS) {
    const row = prices.find((p) => p.terminalId === o.terminal && p.commodityId === commodityId(o.code));
    if (!row) throw new Error(`preview seed: no UEX price for ${o.terminal}:${o.code}`);
    const price = Math.round((row[o.side].last * o.jitter) / 5) * 5;
    await addObservation(db, log, {
      ts: now - o.age, terminalId: o.terminal, commodityId: row.commodityId, side: o.side, price, scu: o.scu,
    });
  }
}

/** The player's settings: the C2 Hercules in Stanton, standing at HUR-L1. */
async function writeSettings(db: Db, extra: Partial<Settings> = {}): Promise<Settings> {
  const settings: Settings = {
    ...DEFAULT_SETTINGS, vehicleId: C2_HERCULES, scuCapacity: 696, starSystemId: STANTON, currentTerminalId: 3, ...extra,
  };
  for (const key of ['vehicleId', 'scuCapacity', 'starSystemId', 'currentTerminalId', 'targetTerminalId'] as const) {
    if (settings[key] !== DEFAULT_SETTINGS[key]) await saveSetting(db, log, key, settings[key]);
  }
  return settings;
}

/** A trade at `at`: the clock the trade service reads is set to it for the call. */
function tradeClock(db: Db, settings: Settings) {
  let clock = 0;
  const deps: TradeDeps = { db, log, now: () => clock, settings };
  return {
    buy: (at: number, terminalId: number, code: string, scu: number, price: number, knownScu?: number) => {
      clock = at;
      return recordBuy(deps, { terminalId, commodityId: commodityId(code), scu, price, knownScu });
    },
    sell: (at: number, terminalId: number, code: string, scu: number, price: number, knownScu?: number) => {
      clock = at;
      return recordSell(deps, { terminalId, commodityId: commodityId(code), scu, price, knownScu });
    },
    mark: (at: number, type: 'depart' | 'arrive') => {
      clock = at;
      return recordMark(deps, type);
    },
  };
}

/** Two finished runs: gold from Port Tressler to Area 18 two days ago, medicine and stims from HUR-L1 to ARC-L1 yesterday. */
async function writeHistory(db: Db, now: number, settings: Settings): Promise<void> {
  const trade = tradeClock(db, settings);

  const first = now - ago.d(2);
  await trade.buy(first, 11, 'GOLD', 150, 5320, 420);
  await trade.mark(first + 6 * MIN, 'depart');
  await trade.mark(first + 31 * MIN, 'arrive');
  await trade.sell(first + 34 * MIN, 5, 'GOLD', 150, 6410, 0);

  const second = now - ago.d(1);
  await trade.buy(second, 3, 'MEDS', 200, 2105, 560);
  await trade.buy(second + 2 * MIN, 3, 'STIM', 100, 2790);
  await trade.mark(second + 8 * MIN, 'depart');
  await trade.mark(second + 33 * MIN, 'arrive');
  await trade.sell(second + 36 * MIN, 1, 'MEDS', 200, 2540, 90);
  await trade.sell(second + 38 * MIN, 1, 'STIM', 100, 3320);
}

/** The run in progress: two commodities bought at HUR-L1 25 minutes ago, ARC-L1 is the target. */
async function writeActiveRun(db: Db, now: number, settings: Settings): Promise<void> {
  const trade = tradeClock(db, settings);
  const start = now - ago.m(25);
  await trade.buy(start, 3, 'MEDS', 120, 2115, 380);
  await trade.buy(start + MIN, 3, 'STIM', 80, 2810);
}

/**
 * Fills a fresh database with a named dataset:
 * - `default`: the reference (3 star systems, 17 terminals, 15 commodities, 8 ships), UEX prices, distances, own observations of
 *   every age, the settings of the player and two finished runs;
 * - `run`: the same plus an active run;
 * - `empty`: nothing at all, not even the schema (a first launch; the application migrates by itself).
 */
export async function prepareDataset(db: Db, dataset: DatasetName, now: number): Promise<void> {
  if (dataset === 'empty') return;
  await migrate(db, log);
  const prices = await writeReference(db, now);
  await writeObservations(db, prices, now);
  const settings = await writeSettings(db, dataset === 'run' ? { targetTerminalId: 1 } : {});
  await writeHistory(db, now, settings);
  if (dataset === 'run') await writeActiveRun(db, now, settings);
}
