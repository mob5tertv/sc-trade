import { estimate } from '../../core/estimate';
import { formatDuration } from '../../core/format';
import type { RouteCtx, RouteOption } from '../../core/routes';
import { cargoOf } from '../../core/run';
import { sellOrContinue } from '../../core/sell';
import type { SellAlternative, SellHere } from '../../core/sell';
import type { Searchable } from '../../core/search';
import type { Settings } from '../../core/settings';
import { ownRunCounts, routeStats, sessions } from '../../core/stats';
import type { Market, Reference, Side, UexPrice, UexSideStats } from '../../core/types';
import type { Db } from '../../data/db';
import type { Logger } from '../../data/logger';
import { addObservation } from '../../data/repo/diary';
import { allRecordTimestamps, getActiveRun, listRuns } from '../../data/repo/runs';
import { loadSettings } from '../../data/repo/settings';
import { getMeta, loadDistances, loadReference, loadUexPrices, upsertPrices } from '../../data/repo/uex-cache';
import { loadMarket, suggestFrom, suggestTo } from '../../data/suggest';
import type { SuggestDeps } from '../../data/suggest';
import { recordBuy } from '../../data/trade';
import type { UexClient } from '../../data/uex-client';
import { commoditySearchItems, terminalSearchItems } from '../../ui/vm/header';
import { lookupTitle } from '../../ui/vm/lookup';
import { locationModel } from '../../ui/vm/location';
import { defaultSide } from '../../ui/vm/quick-entry';
import { rowRoiMap } from '../../ui/vm/row-roi';
import type { RowRoi } from '../../ui/vm/row-roi';
import { BUY_PRICES, LORVILLE, SELL_PRICES } from '../scenes-roi';
import { routeRuns } from './route-runs';
import { runOutlook } from '../../ui/vm/run-outlook';
import type { RunOutlook } from '../../ui/vm/run-outlook';
import { phaseLine, runPhases } from '../../ui/vm/run-phase';
import type { PhaseLine } from '../../ui/vm/run-phase';
import { META_PRICES_SYNCED_AT, metaSeconds } from '../../ui/vm/sync-plan';
import { historyRows, routeRows, sessionRows } from '../../ui/vm/stats-rows';
import type { HistoryRow, RouteRow, SessionRow } from '../../ui/vm/stats-rows';
import { stripModel } from '../../ui/vm/strip';
import type { StripModel } from '../../ui/vm/strip';
import type { UexRangeOf } from '../../ui/vm/route-rows';
import { terminalRows, uexRangeOf } from '../../ui/vm/terminal-rows';
import type { TerminalRow } from '../../ui/vm/terminal-rows';

// The data of the component gallery. Nothing here is typed by hand into a row: the rows come out of the real
// loaders, the real services and the real view models, run over the database of the preview dataset `run`
// (a player standing at HUR-L1 in a C2 Hercules, an active run, a target). What the dataset lacks for a state to be
// seen (a price of every age at HUR-L1, a price typed with a slip, a long cargo) is written the way the player
// writes it: `addObservation` and `recordBuy`.

/** Where the player stands in the `run` dataset: the terminal whose table the gallery draws. */
export const VIEWED_TERMINAL = 3;
/** The target of the run in the dataset, and the terminal where the cargo is weighed in "продать или лететь дальше". */
export const TARGET_TERMINAL = 1;
/** A terminal nothing is known about: its table is empty. */
export const NO_DATA_TERMINAL = 9999;

/** The ROI of the five options of the tier ladder, one per tier, best first. */
export const LADDER_ROI = [0.42, 0.22, 0.09, 0.025, -0.04] as const;

/** The terminal whose table shows the three things «Мин–макс» can say (Levski: far from every trip of the other states). */
export const RANGE_TERMINAL = 17;

export interface GalleryData {
  now: number;
  reference: Reference;
  settings: Settings;
  viewedId: number;
  /** What the header says for the viewed terminal. */
  viewedName: string;
  /** The table of the viewed terminal, and of a terminal nothing is known about. */
  rows: TerminalRow[];
  noRows: TerminalRow[];
  commodityItems: Searchable[];
  terminalItems: Searchable[];
  boostIds: Set<number>;
  /** The range UEX knows for a side of a terminal: it stands beside a price of mine in the lists of trips. */
  uexRange: UexRangeOf;
  sideFor: (commodityId: number) => Side;
  routes: {
    /** Trips from the viewed terminal only. */
    from: RouteOption[];
    /** The same with "и рядом": some of them are bought at another terminal of the planet. */
    nearby: RouteOption[];
    /** Trips to the viewed terminal. */
    to: RouteOption[];
    /** Five trips of the search, each with the ROI of one tier (the search never returns a losing trip). */
    ladder: RouteOption[];
  };
  runCounts: Map<string, number>;
  titles: { from: string; nearby: string; to: string; long: string };
  strip: {
    idle: StripModel; run: StripModel; long: StripModel;
    /** The run of the dataset without a target: no price there, no rate, and no expectation in the tooltip of the cargo. */
    noTarget: StripModel;
    /**
     * A hold of one, two and three commodities, each bought for a seven-digit price: how the line takes the longest cargo it can have. `single` is a
     * hold of one commodity at an ordinary price: the line the trader reads, 'MEDS 120 SCU по 2 115, ждём …' and the profit expected after the target.
     */
    cargo: { single: StripModel; one: StripModel; two: StripModel; three: StripModel };
  };
  runCard: { cargo: Array<{ code: string; scu: number; avgBuyPrice: number }>; timer: string; phases: PhaseLine; outlook: RunOutlook };
  sell: { commodityCode: string; here: SellHere; alternatives: SellAlternative[] };
  history: HistoryRow[];
  sessions: SessionRow[];
  routeStats: RouteRow[];
  trade: { title: string; scu: number; price: number };
  /**
   * What the «Мин–макс» column says in a table and in a list of trips: a spread, one price (UEX gives the same number as
   * the minimum and the maximum), or nothing. The rows are those of `RANGE_TERMINAL`, the trips are the first trip of the
   * search with its sale at that terminal.
   */
  ranges: { terminalId: number; rows: TerminalRow[]; trips: RouteOption[]; uexRange: UexRangeOf };
  /**
   * The best ROI of every commodity of a table, by commodity id, from the real search over the market of the dataset
   * (`rowRoiMap`). `here` are the two tables of the viewed terminal (HUR-L1); `lorville` is the story of the spec: the player
   * has come to Lorville and typed what the terminal pays and asks (the prices of the scenes `roi-sell` and `roi-buy`), so
   * its table has a row of every tier, rows above the threshold and rows without a trip.
   */
  roi: {
    here: { buy: ReadonlyMap<number, RowRoi>; sell: ReadonlyMap<number, RowRoi> };
    lorville: { terminalId: number; rows: TerminalRow[]; buy: ReadonlyMap<number, RowRoi>; sell: ReadonlyMap<number, RowRoi> };
  };
}

export interface GalleryDeps { db: Db; log: Logger; uex: UexClient; now: number }

/**
 * A price the player saw at the viewed terminal: how much of the UEX price it is, how long ago, and what quantity went
 * with it. `before` are the readings of the same price he made earlier (without a quantity unless said): the
 * triangle next to the price tells how it moved since the latest of them that is not a correction of the price.
 */
interface PlayerPrice {
  code: string; side: Side; factor: number; ageMin: number; scu: number | null;
  before?: Array<{ factor: number; ageMin: number; scu?: number }>;
}

const PLAYER_PRICES: PlayerPrice[] = [
  { code: 'PFOO', side: 'buy', factor: 1.02, ageMin: 95, scu: 210, before: [{ factor: 1.1, ageMin: 260 }] }, // warm, with a quantity; bought cheaper than before: the price fell
  { code: 'HYDR', side: 'buy', factor: 0.98, ageMin: 205, scu: null, before: [{ factor: 0.98, ageMin: 330 }] }, // cooling: UEX range stays next to it; the same price as before
  { code: 'ALUM', side: 'buy', factor: 1.04, ageMin: 300, scu: 300 }, // cold: the table falls back to the UEX price and remembers mine
  { code: 'BERY', side: 'buy', factor: 1.0, ageMin: 400, scu: null }, // cold, and UEX has nothing here: the table keeps mine as a hint
  // hot, a slip of the finger: far outside the history of UEX. It follows readings of the stock (its refill rate is
  // learned from them, the estimate counts from the last one), so its line in the expanded row is the longest there is:
  // a five-digit price that moved, the estimate with its base, the learned rate and the warning
  {
    code: 'SCRA', side: 'buy', factor: 9, ageMin: 3, scu: null,
    before: [{ factor: 1.0, ageMin: 600, scu: 80 }, { factor: 1.0, ageMin: 420, scu: 260 }, { factor: 1.02, ageMin: 200, scu: 150 }],
  },
  { code: 'GOLD', side: 'buy', factor: 0.85, ageMin: 11, scu: 80 }, // the terminal buys it, but its purchase price was seen too: a row with two sides
  { code: 'TUNG', side: 'sell', factor: 1.03, ageMin: 14, scu: 640, before: [{ factor: 0.95, ageMin: 190 }] }, // hot, with what the buyer already holds; sells dearer than before: the price rose
  { code: 'DIAM', side: 'sell', factor: 1.06, ageMin: 130, scu: 0, before: [{ factor: 1.12, ageMin: 400 }] }, // warm, an empty buyer; sells cheaper than before: the price fell
  { code: 'LARA', side: 'sell', factor: 1.0, ageMin: 40, scu: null, before: [{ factor: 1.0, ageMin: 200 }] }, // hot, the same price as before
];

/**
 * The holds of the lines that show one, two and three commodities: the quantity and the price each was bought for (the price
 * is seven digits, 'по 1 234 567', the widest the line has to take). Not written to the database: the lines are made of
 * the events of a run of the dataset by the real view model.
 */
const PRICED_HOLDS = {
  single: [{ code: 'MEDS', scu: 120, price: 2_115 }],
  one: [{ code: 'MEDS', scu: 600, price: 1_234_567 }],
  two: [{ code: 'MEDS', scu: 120, price: 1_234_567 }, { code: 'STIM', scu: 80, price: 2_345_678 }],
  three: [{ code: 'MEDS', scu: 120, price: 1_234_567 }, { code: 'STIM', scu: 80, price: 2_345_678 }, { code: 'PFOO', scu: 50, price: 1_456_789 }],
} satisfies Record<string, Array<{ code: string; scu: number; price: number }>>;

/** What the gallery buys on top of the run of the dataset to make a cargo that does not fit a line. */
const EXTRA_CARGO: Array<{ code: string; scu: number }> = [
  { code: 'PFOO', scu: 60 }, { code: 'HYDR', scu: 90 }, { code: 'ALUM', scu: 50 }, { code: 'SCRA', scu: 40 },
];

const commodityByCode = (ref: Reference, code: string): number => {
  const found = [...ref.commodities.values()].find((c) => c.code === code);
  if (!found) throw new Error(`gallery: the reference has no commodity ${code}`);
  return found.id;
};

const sellSide = (side: Side): Side => (side === 'buy' ? 'sell' : 'buy');

/** The player's own prices at the viewed terminal: the dataset has only a hot one, here is every age. */
async function writePlayerPrices(deps: GalleryDeps, ref: Reference): Promise<void> {
  const prices = await loadUexPrices(deps.db);
  const rowOf = (terminalId: number, commodityId: number): UexPrice | undefined =>
    prices.find((p) => p.terminalId === terminalId && p.commodityId === commodityId);
  for (const p of PLAYER_PRICES) {
    const commodityId = commodityByCode(ref, p.code);
    // the base of the price the player saw: UEX at this terminal, else the other side of it (a terminal that only
    // buys has no purchase price in UEX), else what UEX says for this commodity anywhere
    const row = rowOf(VIEWED_TERMINAL, commodityId);
    const elsewhere = prices.find((q) => q.commodityId === commodityId && q[p.side].last > 0);
    const base = row?.[p.side].last || row?.[sellSide(p.side)].last || elsewhere?.[p.side].last;
    if (!base) throw new Error(`gallery: no UEX price to base ${p.code} on`);
    const write = (factor: number, ageMin: number, scu: number | null) => addObservation(deps.db, deps.log, {
      ts: deps.now - ageMin * 60 - 5, terminalId: VIEWED_TERMINAL, commodityId, side: p.side,
      price: Math.max(1, Math.round((base * factor) / 5) * 5), scu,
    });
    for (const earlier of p.before ?? []) await write(earlier.factor, earlier.ageMin, earlier.scu ?? null);
    await write(p.factor, p.ageMin, p.scu);
  }
}

/** How UEX describes the price of one side: the numbers it gives for the week, the month and all time. */
type RangeShape =
  | { kind: 'flat'; price: number }
  | { kind: 'spread'; avg: number; low: number; high: number }
  /** UEX has a price and no bounds for it (the average only): the cell is a dash, and the price column still shows a UEX price. */
  | { kind: 'average'; price: number }
  /** The week has one price, the month moved: the estimate takes the week (src/core/estimate.ts), so the cell says one price. */
  | { kind: 'week-flat'; price: number; monthLow: number; monthHigh: number };

/** What the table of `RANGE_TERMINAL` holds. `uex: null` is a place UEX has no row for; `own` is a price I saw there. */
const RANGE_ROWS: Array<{ code: string; uex: RangeShape | null; own?: { price: number; ageMin: number }; trip?: false }> = [
  { code: 'MEDS', uex: { kind: 'flat', price: 5500 } },
  { code: 'GOLD', uex: { kind: 'week-flat', price: 31_000, monthLow: 30_000, monthHigh: 31_000 } },
  { code: 'TUNG', uex: { kind: 'spread', avg: 3650, low: 3480, high: 3820 } },
  { code: 'TITA', uex: { kind: 'flat', price: 1_300_000 } }, // seven digits: must fit the column whole
  { code: 'QUAR', uex: { kind: 'average', price: 1450 } }, // a UEX price with no bounds: a dash, but UEX does know the price
  { code: 'AGRI', uex: { kind: 'flat', price: 2650 }, own: { price: 2700, ageMin: 20 } }, // mine, and one price of UEX beside it
  { code: 'DIAM', uex: { kind: 'spread', avg: 7050, low: 6800, high: 7300 }, own: { price: 7100, ageMin: 25 } }, // mine, and a spread beside it
  { code: 'STIM', uex: null, own: { price: 3100, ageMin: 15 } }, // mine, and UEX knows nothing there
  { code: 'BERY', uex: null, own: { price: 4200, ageMin: 420 }, trip: false }, // mine and cold: a grey hint and a dash
];

const sideStats = (avg: number, low: number, high: number): UexSideStats => ({
  last: avg, avgWeek: avg, minWeek: low, maxWeek: high, avgMonth: avg, minMonth: low, maxMonth: high, avg, min: low, max: high,
});

function rangeStats(shape: RangeShape): UexSideStats {
  switch (shape.kind) {
    case 'flat':
      return sideStats(shape.price, shape.price, shape.price);
    case 'spread':
      return sideStats(shape.avg, shape.low, shape.high);
    case 'average':
      return sideStats(shape.price, 0, 0);
    case 'week-flat':
      return {
        ...sideStats(shape.price, shape.price, shape.price),
        avgMonth: Math.round((shape.monthLow + shape.monthHigh) / 2), minMonth: shape.monthLow, maxMonth: shape.monthHigh,
        min: shape.monthLow, max: shape.monthHigh,
      };
  }
}

/**
 * The table of `RANGE_TERMINAL` and the trips that end there. UEX gives the terminal exactly the rows of `RANGE_ROWS`
 * (the sync writes them, the old ones of the dataset go), and the player has seen the prices of `own` there. The rows come
 * out of the real view model; the trips are the first trip of the search with its sale replaced by the real estimate at
 * that terminal (as the ladder replaces the ROI: the search itself never goes to a terminal in another star system).
 */
async function loadRanges(deps: GalleryDeps, ref: Reference, ctx: RouteCtx, base: RouteOption): Promise<GalleryData['ranges']> {
  const { db, log, now } = deps;
  const rows: UexPrice[] = [];
  for (const { code, uex } of RANGE_ROWS) {
    if (uex === null) continue;
    rows.push({
      terminalId: RANGE_TERMINAL, commodityId: commodityByCode(ref, code), buy: rangeStats(uex), sell: rangeStats(uex),
      scuBuy: 500, scuSell: 500, scuBuyMax: 0, scuSellMax: 0, dateModified: now - 3 * 3600,
    });
  }
  await upsertPrices(db, [RANGE_TERMINAL], rows, now + 1); // later than the dataset's rows of this terminal: they are removed
  for (const { code, own } of RANGE_ROWS) {
    if (own === undefined) continue;
    for (const side of ['buy', 'sell'] as const) {
      await addObservation(db, log, {
        ts: now - own.ageMin * 60 - 5, terminalId: RANGE_TERMINAL, commodityId: commodityByCode(ref, code), side, price: own.price, scu: null,
      });
    }
  }
  const market = await loadMarket(db);
  const trips: RouteOption[] = [];
  for (const { code, trip } of RANGE_ROWS) {
    if (trip === false) continue;
    const commodityId = commodityByCode(ref, code);
    const sell = estimate(market, RANGE_TERMINAL, commodityId, 'sell', ctx);
    if (sell !== null) trips.push({ ...base, commodityId, destId: RANGE_TERMINAL, sell });
  }
  return {
    terminalId: RANGE_TERMINAL,
    rows: terminalRows(market, ref, RANGE_TERMINAL, ctx),
    trips,
    uexRange: (terminalId, commodityId, side) => uexRangeOf(market, terminalId, commodityId, side, ctx),
  };
}

/**
 * The player at Lorville: what he saw the terminal pay and ask (the prices of the scenes), written the way `recordPrice`
 * writes them, then the table and the best ROI of its rows. Lorville is a terminal of the other states too, so this is done
 * after the tables of the viewed terminal have been made, and the readings are made at `now`, like those of the cargo: the
 * diary that the tests read has them taken out again, so that it stays what the other states saw.
 */
async function loadLorville(deps: GalleryDeps, ref: Reference, ctx: RouteCtx): Promise<GalleryData['roi']['lorville']> {
  const { db, log, now } = deps;
  for (const [side, prices] of [['sell', SELL_PRICES], ['buy', BUY_PRICES]] as const) {
    for (const { code, price } of prices) {
      await addObservation(db, log, { ts: now, terminalId: LORVILLE, commodityId: commodityByCode(ref, code), side, price, scu: null });
    }
  }
  const market = await loadMarket(db);
  return {
    terminalId: LORVILLE,
    rows: terminalRows(market, ref, LORVILLE, ctx),
    buy: rowRoiMap(market, LORVILLE, 'buy', ctx),
    sell: rowRoiMap(market, LORVILLE, 'sell', ctx),
  };
}

function routeCtx(settings: Settings, ref: Reference, distances: Map<string, number | null>, now: number): RouteCtx {
  return {
    now,
    thresholds: { hotMin: settings.hotMin, warmMin: settings.warmMin, coolingMin: settings.coolingMin },
    serverChangedAt: settings.serverChangedAt,
    refillFullMin: settings.refillFullMin,
    settings: {
      starSystemId: settings.starSystemId, budget: settings.budget,
      quantumSpeedKkms: settings.quantumSpeedKkms, overheadMin: settings.overheadMin, overheadEmptyMin: settings.overheadEmptyMin,
      topN: settings.topN, sort: settings.sort,
    },
    freeScu: settings.scuCapacity,
    terminals: ref.terminals,
    distances,
    ownMedian: new Map(),
  };
}

/** Five real options with the ROI of each tier: great, good, ok, poor and a loss. */
function ladderOf(options: RouteOption[]): RouteOption[] {
  return options.slice(0, LADDER_ROI.length).map((o, i) => {
    const roi = LADDER_ROI[i];
    const invested = o.qty * o.buy.price;
    return { ...o, roi, profit: Math.round(invested * roi), worstProfit: Math.round(invested * (roi - 0.03)) };
  });
}

export async function loadGalleryData(deps: GalleryDeps): Promise<GalleryData> {
  const { db, log, now } = deps;
  const reference = await loadReference(db);
  const settings = await loadSettings(db, log);
  const distances = await loadDistances(db);
  const ctx = routeCtx(settings, reference, distances, now);
  const pricesSyncedAt = metaSeconds(await getMeta(db, META_PRICES_SYNCED_AT));

  const suggestDeps = (s: Settings): SuggestDeps => ({ db, uex: deps.uex, now: () => now, log, reference, settings: s, ownMedian: new Map() });
  const capacity = settings.scuCapacity;

  // the trips, over the prices of the dataset
  const from = await suggestFrom(suggestDeps({ ...settings, nearby: false }), VIEWED_TERMINAL, capacity);
  const nearby = await suggestFrom(suggestDeps({ ...settings, nearby: true }), VIEWED_TERMINAL, capacity);
  const to = await suggestTo(suggestDeps(settings), VIEWED_TERMINAL, capacity);
  const ladder = ladderOf(await suggestFrom(suggestDeps({ ...settings, topN: LADDER_ROI.length }), VIEWED_TERMINAL, capacity));

  // the player's history and the run in progress
  const runs = await listRuns(db);
  const active = await getActiveRun(db);
  const market0: Market = await loadMarket(db);
  const stripCtx = { ...ctx };
  const idle = stripModel(null, market0, reference, settings, stripCtx);
  const run = stripModel(active, market0, reference, settings, stripCtx);
  const noTarget = stripModel(active, market0, reference, { ...settings, targetTerminalId: null }, stripCtx);
  const heldRun = (hold: Array<{ code: string; scu: number; price: number }>): StripModel => stripModel(active === null ? null : {
    run: active.run,
    events: hold.map(({ code, scu, price }, i) => ({
      id: i + 1, runId: active.run.id, ts: active.run.startedAt, type: 'buy' as const,
      terminalId: VIEWED_TERMINAL, commodityId: commodityByCode(reference, code), scu, price,
    })),
  }, market0, reference, settings, stripCtx);

  const lines = active === null ? [] : cargoOf(active.events);
  const codeOf = (commodityId: number): string => reference.commodities.get(commodityId)?.code ?? `#${commodityId}`;
  const runCard = {
    cargo: lines.map((l) => ({ code: codeOf(l.commodityId), scu: l.scu, avgBuyPrice: l.avgBuyPrice })),
    timer: active === null ? '0:00' : formatDuration(now - active.run.startedAt),
    // the leg of the run in progress: loading since the first purchase
    phases: phaseLine(runPhases(active?.run ?? { id: 0, vehicleId: null, scuCapacity: 0, startedAt: now, endedAt: null, status: 'active' }, active?.events ?? [], now)),
    // the money of a run that goes on: what is put in and sold, and the result EXPECTED at the target of the settings
    outlook: active === null
      ? { invested: '0', revenue: '0', expected: null, why: null }
      : runOutlook(active, market0, reference, settings, ctx),
  };

  // "продать или лететь дальше": the first line of the cargo, weighed at the target
  const first = lines[0];
  if (first === undefined || active === null) throw new Error('gallery: the dataset has no run with cargo (use the `run` dataset)');
  const actual = estimate(market0, TARGET_TERMINAL, first.commodityId, 'sell', ctx)?.price ?? first.avgBuyPrice;
  const { here, alternatives } = sellOrContinue(market0, first, TARGET_TERMINAL, actual, now - active.run.startedAt, ctx);

  const history = historyRows(runs, reference, now);
  const sessionList = sessionRows(sessions(await allRecordTimestamps(db), runs));
  // the dataset has few finished routes (one of them a mixed cargo); the table of routes also gets finished runs of other routes, so that a sort has something to put in order
  const stats = routeRows(routeStats([...runs, ...routeRuns(now, (code) => commodityByCode(reference, code))]), reference);

  // the prices the player saw at the viewed terminal, then its table
  await writePlayerPrices(deps, reference);
  const market: Market = await loadMarket(db);
  const rows = terminalRows(market, reference, VIEWED_TERMINAL, ctx);
  const noRows = terminalRows(market, reference, NO_DATA_TERMINAL, ctx);
  const hereRoi = { buy: rowRoiMap(market, VIEWED_TERMINAL, 'buy', ctx), sell: rowRoiMap(market, VIEWED_TERMINAL, 'sell', ctx) };
  // Lorville's table over the same market, before the cargo below changes the prices of HUR-L1 (a source of its trips)
  const lorville = await loadLorville(deps, reference, ctx);

  // a cargo of six lines for the mini line, bought last: it changes the prices the player saw
  for (const { code, scu } of EXTRA_CARGO) {
    const commodityId = commodityByCode(reference, code);
    const price = rows.find((r) => r.commodityId === commodityId)?.buy?.hint ?? 100;
    await recordBuy({ db, log, now: () => now, settings }, { terminalId: VIEWED_TERMINAL, commodityId, scu, price });
  }
  const longRun = stripModel(await getActiveRun(db), await loadMarket(db), reference, settings, stripCtx);

  const viewedName = locationModel(reference, settings, VIEWED_TERMINAL, pricesSyncedAt, true, now).header.location;
  const meds = commodityByCode(reference, 'MEDS');
  // last: it rewrites the prices of one far terminal, which no other state looks at
  if (from[0] === undefined) throw new Error('gallery: the search found no trip from the viewed terminal');
  const ranges = await loadRanges(deps, reference, ctx, from[0]);
  const request = { kind: 'from' as const, terminalId: VIEWED_TERMINAL, commodityId: null, price: null };
  return {
    now, reference, settings, viewedId: VIEWED_TERMINAL, viewedName, rows, noRows,
    commodityItems: commoditySearchItems(reference),
    terminalItems: terminalSearchItems(reference, settings.starSystemId),
    boostIds: new Set(market.byTerminal.get(VIEWED_TERMINAL)),
    uexRange: (terminalId, commodityId, side) => uexRangeOf(market, terminalId, commodityId, side, ctx),
    sideFor: (commodityId) => defaultSide(rows.find((r) => r.commodityId === commodityId)),
    routes: { from, nearby, to, ladder },
    runCounts: ownRunCounts(runs),
    titles: {
      from: lookupTitle(request, reference, false),
      nearby: lookupTitle(request, reference, true),
      to: lookupTitle({ ...request, kind: 'to' }, reference, false),
      long: lookupTitle({ ...request, commodityId: meds, price: 2115 }, reference, true),
    },
    strip: {
      idle, run, long: longRun, noTarget,
      cargo: { single: heldRun(PRICED_HOLDS.single), one: heldRun(PRICED_HOLDS.one), two: heldRun(PRICED_HOLDS.two), three: heldRun(PRICED_HOLDS.three) },
    },
    runCard, sell: { commodityCode: codeOf(first.commodityId), here, alternatives },
    history, sessions: sessionList, routeStats: stats,
    trade: { title: `Купил ${reference.commodities.get(meds)?.name ?? 'MEDS'}`, scu: 120, price: 2115 },
    ranges,
    roi: { here: hereRoi, lorville },
  };
}
