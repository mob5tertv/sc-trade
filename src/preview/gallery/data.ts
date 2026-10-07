import { estimate } from '../../core/estimate';
import { formatDuration } from '../../core/format';
import type { RouteCtx, RouteOption } from '../../core/routes';
import { cargoOf, runTotals } from '../../core/run';
import type { RunTotals } from '../../core/run';
import { sellOrContinue } from '../../core/sell';
import type { SellAlternative, SellHere } from '../../core/sell';
import type { Searchable } from '../../core/search';
import type { Settings } from '../../core/settings';
import { ownRunCounts, routeStats, sessions } from '../../core/stats';
import type { Market, Reference, Side, UexPrice } from '../../core/types';
import type { Db } from '../../data/db';
import type { Logger } from '../../data/logger';
import { addObservation } from '../../data/repo/diary';
import { allRecordTimestamps, getActiveRun, listRuns } from '../../data/repo/runs';
import { loadSettings } from '../../data/repo/settings';
import { getMeta, loadDistances, loadReference, loadUexPrices } from '../../data/repo/uex-cache';
import { loadMarket, suggestFrom, suggestTo } from '../../data/suggest';
import type { SuggestDeps } from '../../data/suggest';
import { recordBuy } from '../../data/trade';
import type { UexClient } from '../../data/uex-client';
import { commoditySearchItems, terminalSearchItems } from '../../ui/vm/header';
import { lookupTitle } from '../../ui/vm/lookup';
import { locationModel } from '../../ui/vm/location';
import { defaultSide } from '../../ui/vm/quick-entry';
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
  strip: { idle: StripModel; run: StripModel; long: StripModel };
  runCard: { cargo: Array<{ code: string; scu: number; avgBuyPrice: number }>; timer: string; totals: RunTotals };
  sell: { commodityCode: string; here: SellHere; alternatives: SellAlternative[] };
  history: HistoryRow[];
  sessions: SessionRow[];
  routeStats: RouteRow[];
  trade: { title: string; scu: number; price: number };
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

  const lines = active === null ? [] : cargoOf(active.events);
  const codeOf = (commodityId: number): string => reference.commodities.get(commodityId)?.code ?? `#${commodityId}`;
  const runCard = {
    cargo: lines.map((l) => ({ code: codeOf(l.commodityId), scu: l.scu, avgBuyPrice: l.avgBuyPrice })),
    timer: active === null ? '0:00' : formatDuration(now - active.run.startedAt),
    totals: runTotals(active?.run ?? { id: 0, vehicleId: null, scuCapacity: 0, startedAt: now, endedAt: null, status: 'active' }, active?.events ?? [], now),
  };

  // "продать или лететь дальше": the first line of the cargo, weighed at the target
  const first = lines[0];
  if (first === undefined || active === null) throw new Error('gallery: the dataset has no run with cargo (use the `run` dataset)');
  const actual = estimate(market0, TARGET_TERMINAL, first.commodityId, 'sell', ctx)?.price ?? first.avgBuyPrice;
  const { here, alternatives } = sellOrContinue(market0, first, TARGET_TERMINAL, actual, now - active.run.startedAt, ctx);

  const history = historyRows(runs, reference, now);
  const sessionList = sessionRows(sessions(await allRecordTimestamps(db), runs));
  const stats = routeRows(routeStats(runs), reference);

  // the prices the player saw at the viewed terminal, then its table
  await writePlayerPrices(deps, reference);
  const market: Market = await loadMarket(db);
  const rows = terminalRows(market, reference, VIEWED_TERMINAL, ctx);
  const noRows = terminalRows(market, reference, NO_DATA_TERMINAL, ctx);

  // a cargo of six lines for the mini line, bought last: it changes the prices the player saw
  for (const { code, scu } of EXTRA_CARGO) {
    const commodityId = commodityByCode(reference, code);
    const price = rows.find((r) => r.commodityId === commodityId)?.buy?.hint ?? 100;
    await recordBuy({ db, log, now: () => now, settings }, { terminalId: VIEWED_TERMINAL, commodityId, scu, price });
  }
  const longRun = stripModel(await getActiveRun(db), await loadMarket(db), reference, settings, stripCtx);

  const viewedName = locationModel(reference, settings, VIEWED_TERMINAL, pricesSyncedAt, true, now).header.location;
  const meds = commodityByCode(reference, 'MEDS');
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
    strip: { idle, run, long: longRun },
    runCard, sell: { commodityCode: codeOf(first.commodityId), here, alternatives },
    history, sessions: sessionList, routeStats: stats,
    trade: { title: `Купил ${reference.commodities.get(meds)?.name ?? 'MEDS'}`, scu: 120, price: 2115 },
  };
}
