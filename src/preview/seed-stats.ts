import { estimate } from '../core/estimate';
import type { Settings } from '../core/settings';
import type { Reference } from '../core/types';
import type { Db } from '../data/db';
import { createLogger } from '../data/logger';
import { loadSettings } from '../data/repo/settings';
import { loadReference } from '../data/repo/uex-cache';
import { loadMarket } from '../data/suggest';
import { loseCargo, recordBuy, recordMark, recordSell, type TradeDeps } from '../data/trade';

// What the scenes of the "Мои маршруты" section need that the window dataset does not have: a long history of the
// player's runs. It is written on top of the `window` dataset by the REAL trade functions (the first purchase starts a
// run, the sale that empties the hold finishes it, `loseCargo` loses it), at times in the past, session after session:
//  - 35 runs of mine over nine days in eight sessions (a pause of more than two hours between sessions), done and
//    lost, a few with the departure and arrival marks, and one of two commodities (a "mixed" run) on a day of its own:
//    with the two runs of the default history and the one that is going, 39 in all;
//  - the three runs on ONE pair, Stims from HUR-L1 to MIC-L1, that take longer than the estimate by the distance: the
//    "Варианты" from HUR-L1 show my median time and "3 рейса" for that trip;
//  - a run that is going now: Tungsten bought at Lorville a few minutes ago.
// The prices of those three runs are exactly the prices the market shows now, and no other run touches a commodity that
// HUR-L1 sells, so the trips from HUR-L1 are the five of the `window` dataset, with the same numbers.
// The other half of this file's job is the empty state: `removeRuns` makes the same data with no run at all, and
// `removeDiary` takes the player's own prices out as well (a first launch after the first sync).

const quiet = createLogger({ write() {} });

const MIN = 60;
const HOUR = 3600;
const DAY = 86_400;

const HUR_L1 = 3;
const MIC_L1 = 4;

interface Leg {
  from: number; to: number; code: string; scu: number;
  /** From the first purchase to the sale (or to the loss) in minutes. */
  minutes: number;
  /** Minutes from the first purchase to the departure and from the departure to the arrival; no marks when absent. */
  marks?: readonly [loading: number, flight: number];
  /** The cargo is lost instead of being sold. */
  lost?: boolean;
}

/** The price level of a commodity per SCU, for the prices of the runs. */
const BASE: Record<string, number> = { GOLD: 6100, TUNG: 3650, LARA: 3150, AGRI: 2650, TITA: 8450, DIAM: 7050, BERY: 4300, QUAR: 1450 };

/** A small deterministic random generator: the same dataset every time. */
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

const round5 = (n: number): number => Math.round(n / 5) * 5;

/** The pair that is flown three times: Stims from HUR-L1 to MIC-L1 (the time of each run is given where it is flown). */
const STIMS: Omit<Leg, 'minutes' | 'marks'> = { from: HUR_L1, to: MIC_L1, code: 'STIM', scu: 300 };

/**
 * The sessions, oldest first: how long before `now` it began (days, hours) and the runs it held, one after the other.
 * Terminals: 1 ARC-L1, 2 CRU-L1, 3 HUR-L1, 4 MIC-L1, 5 Area 18, 6 Lorville, 9 Everus Harbor, 10 Baijini Point, 11 Port Tressler.
 * The three runs of the pair last 24:10, 26:35 and 22:50, so the median is 24:10 (the estimate by the distance is 15:34).
 */
const SESSIONS: ReadonlyArray<{ ago: readonly [days: number, hours: number]; legs: readonly Leg[] }> = [
  { ago: [9, 5], legs: [
    { from: 11, to: 5, code: 'GOLD', scu: 150, minutes: 34, marks: [6, 25] },
    { from: 6, to: 5, code: 'TUNG', scu: 320, minutes: 29 },
    { from: 11, to: 5, code: 'GOLD', scu: 200, minutes: 36, marks: [7, 26] },
  ] },
  { ago: [8, 2], legs: [
    { from: 1, to: 3, code: 'LARA', scu: 400, minutes: 31 },
    { ...STIMS, minutes: 24.17, marks: [5, 14] },
    { from: 11, to: 4, code: 'AGRI', scu: 300, minutes: 14 },
    { from: 6, to: 5, code: 'GOLD', scu: 160, minutes: 28 },
    { from: 9, to: 2, code: 'DIAM', scu: 180, minutes: 33 },
  ] },
  { ago: [6, 4], legs: [
    { from: 1, to: 4, code: 'GOLD', scu: 150, minutes: 52 },
    { from: 4, to: 5, code: 'BERY', scu: 220, minutes: 41, marks: [8, 28] },
    { from: 6, to: 5, code: 'TUNG', scu: 360, minutes: 30 },
    { from: 1, to: 3, code: 'LARA', scu: 380, minutes: 32, marks: [6, 22] },
    { from: 1, to: 10, code: 'QUAR', scu: 500, minutes: 17 },
    { from: 6, to: 5, code: 'GOLD', scu: 120, minutes: 18, lost: true },
  ] },
  { ago: [5, 6], legs: [
    { from: 10, to: 5, code: 'TITA', scu: 100, minutes: 19 },
    { ...STIMS, minutes: 26.58, marks: [6, 15] },
    { from: 11, to: 5, code: 'GOLD', scu: 180, minutes: 35 },
    { from: 11, to: 4, code: 'AGRI', scu: 280, minutes: 15 },
  ] },
  { ago: [3, 3], legs: [
    { from: 6, to: 5, code: 'GOLD', scu: 200, minutes: 27, marks: [5, 18] },
    { from: 6, to: 5, code: 'TUNG', scu: 300, minutes: 31 },
    { from: 9, to: 2, code: 'DIAM', scu: 200, minutes: 35 },
    { from: 1, to: 3, code: 'LARA', scu: 420, minutes: 30 },
    { from: 4, to: 5, code: 'BERY', scu: 160, minutes: 22, lost: true },
  ] },
  { ago: [2, 9], legs: [
    { ...STIMS, minutes: 22.83, marks: [5, 13] },
    { from: 11, to: 5, code: 'GOLD', scu: 150, minutes: 33 },
    { from: 11, to: 4, code: 'AGRI', scu: 300, minutes: 14 },
    { from: 4, to: 5, code: 'BERY', scu: 200, minutes: 40 },
  ] },
  { ago: [1, 10], legs: [
    { from: 6, to: 5, code: 'GOLD', scu: 240, minutes: 28, marks: [5, 19] },
    { from: 6, to: 5, code: 'TUNG', scu: 380, minutes: 31 },
    { from: 10, to: 5, code: 'TITA', scu: 120, minutes: 20 },
    { from: 1, to: 10, code: 'QUAR', scu: 520, minutes: 16 },
    { from: 1, to: 3, code: 'LARA', scu: 440, minutes: 33 },
  ] },
  { ago: [0, 5], legs: [
    { from: 11, to: 5, code: 'GOLD', scu: 200, minutes: 34, marks: [6, 24] },
    { from: 9, to: 2, code: 'DIAM', scu: 190, minutes: 36 },
    { from: 6, to: 5, code: 'TUNG', scu: 200, minutes: 22, lost: true },
  ] },
];

/** The rest between two runs of a session, in minutes. */
const RESTS = [9, 14, 21, 11, 17, 25, 8, 19];

/** A trade clock: the trade service reads the time from here, and every call sets it first. */
function tradeClock(db: Db, settings: Settings) {
  let clock = 0;
  const deps: TradeDeps = { db, log: quiet, now: () => clock, settings };
  return (at: number): TradeDeps => {
    clock = at;
    return deps;
  };
}

function commodityIdOf(reference: Reference, code: string): number {
  const found = [...reference.commodities.values()].find((c) => c.code === code);
  if (found === undefined) throw new Error(`preview seed: unknown commodity code ${code}`);
  return found.id;
}

/**
 * The prices of the three runs on the pair: exactly what the market shows now (what HUR-L1 asks for the Stims, what
 * MIC-L1 pays), so that the lookup from HUR-L1 gives the same numbers with or without the history.
 */
async function pairPrices(db: Db, reference: Reference, settings: Settings, now: number): Promise<{ buy: number; sell: number }> {
  const market = await loadMarket(db);
  const stims = commodityIdOf(reference, 'STIM');
  const ctx = { now, thresholds: { hotMin: settings.hotMin, warmMin: settings.warmMin, coolingMin: settings.coolingMin }, serverChangedAt: null };
  const buy = estimate(market, HUR_L1, stims, 'buy', ctx);
  const sell = estimate(market, MIC_L1, stims, 'sell', ctx);
  if (buy === null || sell === null) throw new Error('preview seed: the Stims have no price at HUR-L1 or at MIC-L1');
  return { buy: buy.price, sell: sell.price };
}

/** Writes the long history on top of a database that holds the `window` dataset. */
export async function extendForStats(db: Db, now: number): Promise<void> {
  const reference = await loadReference(db);
  const settings = await loadSettings(db, quiet);
  const at = tradeClock(db, settings);
  const rng = randomOf(20261007);
  const pair = await pairPrices(db, reference, settings, now);

  /** One run, the first purchase at `start` (seconds); returns the time the run ended. */
  async function fly(start: number, leg: Leg): Promise<number> {
    const commodityId = commodityIdOf(reference, leg.code);
    const isPair = leg.from === HUR_L1;
    const base = BASE[leg.code] ?? 0;
    const buy = isPair ? pair.buy : round5(base * (0.84 + rng() * 0.1));
    const sell = isPair ? pair.sell : round5(base * (1.04 + rng() * 0.12));
    const end = start + Math.round(leg.minutes * MIN);

    await recordBuy(at(start), { terminalId: leg.from, commodityId, scu: leg.scu, price: buy });
    if (leg.marks !== undefined) {
      await recordMark(at(start + leg.marks[0] * MIN), 'depart');
      await recordMark(at(start + (leg.marks[0] + leg.marks[1]) * MIN), 'arrive');
    }
    if (leg.lost) await loseCargo(at(end));
    else await recordSell(at(end), { terminalId: leg.to, commodityId, scu: leg.scu, price: sell });
    return end;
  }

  let n = 0;
  for (const session of SESSIONS) {
    let t = now - session.ago[0] * DAY - session.ago[1] * HOUR;
    for (const leg of session.legs) {
      t = (await fly(t, leg)) + RESTS[n++ % RESTS.length] * MIN;
    }
  }

  // one run of two commodities at once, a mixed run in the history: four days and seven hours ago, between two sessions,
  // so a session of its own
  const mixed = now - 4 * DAY - 7 * HOUR;
  const gold = commodityIdOf(reference, 'GOLD');
  const tung = commodityIdOf(reference, 'TUNG');
  await recordBuy(at(mixed), { terminalId: 6, commodityId: gold, scu: 150, price: 5400 });
  await recordBuy(at(mixed + 2 * MIN), { terminalId: 6, commodityId: tung, scu: 250, price: 3100 });
  await recordMark(at(mixed + 9 * MIN), 'depart');
  await recordMark(at(mixed + 24 * MIN), 'arrive');
  await recordSell(at(mixed + 27 * MIN), { terminalId: 5, commodityId: gold, scu: 150, price: 6300 });
  await recordSell(at(mixed + 29 * MIN), { terminalId: 5, commodityId: tung, scu: 250, price: 3700 });

  // the run that is going: Tungsten bought at Lorville twelve minutes ago
  await recordBuy(at(now - 12 * MIN), { terminalId: 6, commodityId: tung, scu: 250, price: 3080 });
}

/** The same data with no run at all (the player has not flown yet): the runs and their events are deleted. */
export async function removeRuns(db: Db): Promise<void> {
  await db.execute('DELETE FROM run_event');
  await db.execute('DELETE FROM run');
}

/** The diary emptied as well (the player has not written a price either): every observation is deleted. */
export async function removeDiary(db: Db): Promise<void> {
  await db.execute('DELETE FROM observation');
}
