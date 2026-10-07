import { estimate } from '../core/estimate';
import { DEFAULT_SETTINGS } from '../core/settings';
import type { Commodity, StarSystem, Terminal, UexPrice, UexSideStats } from '../core/types';
import type { Db } from '../data/db';
import { createLogger } from '../data/logger';
import { addObservation } from '../data/repo/diary';
import { loadReference, loadUexPrices, saveReference, upsertPrices } from '../data/repo/uex-cache';
import { loadMarket } from '../data/suggest';

// What the scenes of the window layout need that the default dataset does not have. It is written on top of the
// default dataset by the same real repository functions, and changes only what it has to:
//  - the trips from HUR-L1 are five, one tier of ROI each (the bar at the edge of a row and its number are the point
//    of the list: the default prices give five trips of the same two tiers);
//  - Area 18 trades two dozen commodities, so that a table has to scroll;
//  - Seraphim Station is a terminal nothing is known about;
//  - two "Stanton Gateway" terminals stand in two other star systems, so that a search for the name finds two places of one name.
// Everything else is the default dataset: the player, the history, the other terminals.

const quiet = createLogger({ write() {} });

const HUR_L1 = 3;
const AREA_18 = 5;
const SERAPHIM = 12;

const MIN = 60;
const DAY = 86_400;

/**
 * The five trips from HUR-L1 (commodity, where it is sold, the ROI of the trip). Every other place that buys what
 * HUR-L1 sells is made to pay less than HUR-L1 asks, so these five are all the trips there are. The ROI is the sale
 * price over the purchase price minus one, whatever the quantity.
 */
const LADDER: ReadonlyArray<{ code: string; destId: number; roi: number }> = [
  { code: 'SCRA', destId: 9, roi: 0.38 }, // Everus Harbor: great
  { code: 'STIM', destId: 4, roi: 0.22 }, // MIC-L1: good
  { code: 'HYDR', destId: 11, roi: 0.18 }, // Port Tressler: good
  { code: 'PFOO', destId: 10, roi: 0.11 }, // Baijini Point: ok
  { code: 'MEDS', destId: 2, roi: 0.03 }, // CRU-L1: poor
];
/** What the places that are not on the ladder pay, as a part of the purchase price: a trip there loses. */
const NO_TRIP = 0.8;

/** The commodities Area 18 trades on top of its own: name, code, base price. The first three it SELLS, the rest it BUYS. */
const EXTRA_COMMODITIES: ReadonlyArray<[name: string, code: string, base: number]> = [
  ['Agricultural Supplies', 'AGRS', 1020], ['Iron', 'IRON', 610], ['Copper', 'COPP', 640],
  ['Aphorite', 'APHO', 3500], ['Astatine', 'ASTA', 1700], ['Bexalite', 'BEXA', 3400], ['Borase', 'BORA', 3200],
  ['Chlorine', 'CHLO', 1450], ['Corundum', 'CORU', 2600], ['Distilled Spirits', 'DIST', 1700], ['Fluorine', 'FLUO', 3000],
  ['Hadanite', 'HADA', 4900], ['Hephaestanite', 'HEPH', 1400], ['Iodine', 'IODI', 430], ['Pressurized Ice', 'PRIC', 1200],
  ['Quantanium', 'QUAN', 9400], ['Recycled Material Composite', 'RMC', 1100], ['Silicon', 'SILI', 700], ['Steel', 'STEE', 780],
  ['Sunset Berries', 'SBER', 360], ['Altruciatoxin', 'ATOX', 2900], ['Carbon', 'CARB', 1900],
];
const SOLD_BY_AREA_18 = 3;

/** The statistics of one side around a price: the week inside the month inside the whole history. */
function around(price: number): UexSideStats {
  const at = (factor: number): number => Math.round(price * factor);
  return {
    last: price, minWeek: at(0.95), maxWeek: at(1.05), avgWeek: price,
    minMonth: at(0.9), maxMonth: at(1.1), avgMonth: price,
    min: at(0.8), max: at(1.25), avg: price,
  };
}

const NOTHING: UexSideStats = { last: 0, minWeek: 0, maxWeek: 0, avgWeek: 0, minMonth: 0, maxMonth: 0, avgMonth: 0, min: 0, max: 0, avg: 0 };

/** The ladder: what each place that buys a commodity of HUR-L1 pays. */
async function writeLadder(db: Db, now: number): Promise<void> {
  const reference = await loadReference(db);
  const idOf = (code: string): number => {
    const found = [...reference.commodities.values()].find((c) => c.code === code);
    if (found === undefined) throw new Error(`preview seed: unknown commodity code ${code}`);
    return found.id;
  };
  const market = await loadMarket(db);
  const ctx = { now, thresholds: { hotMin: DEFAULT_SETTINGS.hotMin, warmMin: DEFAULT_SETTINGS.warmMin, coolingMin: DEFAULT_SETTINGS.coolingMin }, serverChangedAt: null };

  // what HUR-L1 asks for each commodity it sells (a price of mine is the price when it is not cold)
  const asked = new Map<number, number>();
  for (const id of market.byTerminal.get(HUR_L1) ?? []) {
    const price = estimate(market, HUR_L1, id, 'buy', ctx);
    if (price !== null) asked.set(id, price.price);
  }
  const wanted = new Map(LADDER.map((step) => [`${step.destId}:${idOf(step.code)}`, step.roi]));

  /** What the place pays for the commodity so that the trip has the ROI of its step (a trip that is not on the ladder loses). */
  const payment = (terminalId: number, commodityId: number, ask: number): number => {
    const roi = wanted.get(`${terminalId}:${commodityId}`) ?? NO_TRIP - 1;
    return Math.round((ask * (1 + roi)) / 5) * 5;
  };

  const changed: UexPrice[] = [];
  for (const row of await loadUexPrices(db)) {
    const ask = asked.get(row.commodityId);
    if (row.terminalId === HUR_L1 || ask === undefined || row.sell.avgWeek <= 0) continue;
    changed.push({ ...row, sell: around(payment(row.terminalId, row.commodityId, ask)) });
  }
  await upsertPrices(db, [], changed, now);

  // A price of the player's own beats the UEX one while it is not cold, and the default dataset has such sale prices
  // at some of these places. The player has "seen the price again": a fresh reading of what the step says, so the
  // reading before it stays as the previous one (the mark of a price that moved is there to be seen in the list).
  for (const own of market.own.values()) {
    const ask = asked.get(own.commodityId);
    if (own.side !== 'sell' || own.terminalId === HUR_L1 || ask === undefined) continue;
    const price = payment(own.terminalId, own.commodityId, ask);
    if (price === own.price) continue;
    await addObservation(db, quiet, { ts: now - 20, terminalId: own.terminalId, commodityId: own.commodityId, side: 'sell', price, scu: own.scu });
  }
}

/** Area 18 trades two dozen more commodities: it sells the first few of them and buys the rest. */
async function writeBusyTerminal(db: Db, now: number): Promise<void> {
  const reference = await loadReference(db);
  const first = Math.max(...reference.commodities.keys()) + 1;
  const extra: Commodity[] = EXTRA_COMMODITIES.map(([name, code], i) => ({
    id: first + i, name, code, isIllegal: false, isBuyable: true, isSellable: true, isAvailableLive: true,
  }));
  await saveReference(db, { commodities: [...reference.commodities.values(), ...extra] });

  const prices: UexPrice[] = extra.map((commodity, i): UexPrice => {
    const base = EXTRA_COMMODITIES[i][2];
    const sold = i < SOLD_BY_AREA_18;
    const price = Math.round((base * (sold ? 0.9 : 1.08)) / 5) * 5;
    const stock = 80 + ((i * 137) % 900);
    return {
      terminalId: AREA_18, commodityId: commodity.id,
      buy: sold ? around(price) : { ...NOTHING }, sell: sold ? { ...NOTHING } : around(price),
      scuBuy: sold ? stock : 0, scuSell: sold ? 0 : stock, scuBuyMax: sold ? stock * 2 : 0, scuSellMax: sold ? 0 : stock * 2,
      // a few minutes to a few days old, every row of its own age
      dateModified: now - (20 + ((i * 53) % 400)) * MIN - ((i * 5) % 3) * DAY,
    };
  });
  await upsertPrices(db, [], prices, now);
}

/**
 * Two terminals of one name in different star systems, as UEX has many ("Stanton Gateway" stands in Pyro, in Nyx and in other
 * systems): the list of the location search has to say where each of them is. They trade nothing, so no table or trip changes.
 */
async function writeGateways(db: Db): Promise<void> {
  const reference = await loadReference(db);
  const first = Math.max(...reference.terminals.keys()) + 1;
  const gateway = (n: number, system: StarSystem, code: string, planet: string | null): Terminal => ({
    id: first + n, starSystemId: system.id, planetId: 0, orbitId: first + n,
    name: 'Admin - Stanton Gateway', nickname: 'Stanton Gateway', displayname: 'Stanton Gateway', code,
    starSystemName: system.name, planetName: planet, orbitName: planet === null ? 'Stanton Jump Point' : planet,
    moonName: null, spaceStationName: 'Stanton Gateway', outpostName: null, cityName: null,
    hasFreightElevator: true, hasLoadingDock: false, isAutoLoad: true, isAvailableLive: true,
  });
  const system = (name: string): StarSystem => {
    const found = reference.starSystems.find((s) => s.name === name);
    if (found === undefined) throw new Error(`preview seed: unknown star system ${name}`);
    return found;
  };
  await saveReference(db, {
    terminals: [...reference.terminals.values(), gateway(0, system('Pyro'), 'STGWP', null), gateway(1, system('Nyx'), 'STGWN', 'Delamar')],
  });
}

/** A terminal nothing is known about: no UEX price, no price of mine. */
async function clearTerminal(db: Db, terminalId: number): Promise<void> {
  await db.execute('DELETE FROM uex_price WHERE terminal_id = ?', [terminalId]);
  await db.execute('DELETE FROM observation WHERE terminal_id = ?', [terminalId]);
}

/** Writes the extras of the `window` dataset on top of a database that holds the default one. */
export async function extendForWindow(db: Db, now: number): Promise<void> {
  await writeLadder(db, now);
  await writeBusyTerminal(db, now);
  await writeGateways(db);
  await clearTerminal(db, SERAPHIM);
}
