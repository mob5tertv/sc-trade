import { formatCompact, formatDuration, formatUec } from '../../core/format';
import { isIncomeRun, runTotals, simpleRoute } from '../../core/run';
import { withLosses } from '../../core/stats';
import type { RouteStat, Session } from '../../core/stats';
import { pairKey } from '../../core/types';
import type { Reference, Run, RunEvent, RunWithEvents } from '../../core/types';
import { formatRoi } from './route-rows';
import { terminalLabel } from './terminal-name';

// Display rows of the "Мои маршруты" section: the routes, the run history and the session list. Every number is already
// formatted, the way the list of options formats it: the ROI in `formatRoi`, the profit of one run in the short form ('467k').
// No list shows a rate per hour any more (plan item 17): a route says what one run of it brings and how long it takes.

/** Shown instead of a value that does not exist. */
export const NONE = '—';

// Terminals are named as everywhere else (`terminalLabel`: the nickname, else the display name, else the name), commodities by their code;
// what the reference lacks (or leaves blank) is shown by id.
const commodityName = (ref: Reference, id: number): string => ref.commodities.get(id)?.code || `#${id}`;

const routeName = (ref: Reference, originId: number, destId: number): string => `${terminalLabel(ref, originId)} → ${terminalLabel(ref, destId)}`;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** '06.10 14:05' in the machine's local time zone. */
export function formatStamp(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** The word for the commodities of a run or of a route that trades in several: the list is too long for the line, and stands in the hint of the row. */
const SEVERAL_COMMODITIES = 'смеш.';

export interface RouteRow {
  /** The route and its set of goods: a simple route and a mixed cargo of the same two terminals have keys of their own. */
  key: string; route: string;
  /** The code of the commodity of a simple route; 'смеш.' for the route of a mixed cargo. */
  commodity: string;
  /** The goods of a route of mixed cargo, for the tooltip of the cell: 'Смешанный груз: GOLD, TITA'; `null` for a simple route. */
  commodityHint: string | null;
  runs: number; time: string;
  /** The finished runs as the cell writes them: '5', or with «Подробные расчёты» and lost runs '5/6' (finished of attempted). */
  runsText: string;
  /** What the three numbers of the row are, for their tooltips: with lost runs counted in, they say so. */
  runsTitle: string; profitTitle: string; perRunTitle: string;
  /** Loading · flight · unloading, or `null` when no run of the route has both marks. */
  phases: string | null;
  profit: string; roi: string;
  /** What one run of the route brings on average ('467k'), and the number behind it, which the table is sorted by. With lost runs counted in it is per attempt. */
  perRun: string; perRunValue: number;
  /** The statistic the row was made of: the numbers behind the text, which the table is sorted by (`route-sort.ts`). */
  stat: RouteStat;
}

/** The route of a row as a favourite can hold it (spec 14.19, item 11): a route of ONE commodity; `null` for a mixed cargo. */
export function favouriteOf(row: Pick<RouteRow, 'stat'>): { originId: number; destId: number; commodityId: number } | null {
  const { originId, destId, commodityIds } = row.stat;
  return commodityIds.length === 1 ? { originId, destId, commodityId: commodityIds[0] } : null;
}

const RUNS_TITLE = 'Число завершённых рейсов';
const PROFIT_TITLE = 'Суммарная прибыль';
const PER_RUN_TITLE = 'Средняя прибыль за рейс';

/** The tooltips of a route that has lost runs counted into its numbers. */
function lossTitles(s: RouteStat): Pick<RouteRow, 'runsTitle' | 'profitTitle' | 'perRunTitle'> {
  const attempts = s.runs + s.lostRuns;
  const lost = formatUec(s.lostProfit);
  return {
    runsTitle: `Удачных рейсов ${s.runs} из ${attempts} (${Math.round((s.runs / attempts) * 100)} %): потерянных ${s.lostRuns}`,
    profitTitle: `Прибыль с потерями: потерянный груз ${lost}`,
    perRunTitle: `Средняя прибыль за попытку, с потерями: потерянный груз ${lost}, потерянные рейсы входят в счёт`,
  };
}

/** The goods of a route of mixed cargo by their codes, in the order of the codes (a set has no order of its own). */
function mixedGoods(ref: Reference, commodityIds: number[]): string {
  return `Смешанный груз: ${commodityIds.map(id => commodityName(ref, id)).sort().join(', ')}`;
}

/**
 * One row per route statistic, in the given order (the table orders them itself, `sortRoutes`). A route of mixed cargo (task 51) says "смеш." for its goods.
 * `detailed` («Подробные расчёты», spec 14.19) counts the lost runs of a route into its row: the profit is the one with the losses (`withLosses`), what a
 * run brings is counted per ATTEMPT, and the runs read 'finished/attempted'. Without it, and for a route that lost nothing, the row is as ever.
 */
export function routeRows(stats: RouteStat[], ref: Reference, detailed = false): RouteRow[] {
  return stats.map(base => (detailed && base.lostRuns > 0 ? { s: withLosses(base), lossy: true } : { s: base, lossy: false })).map(({ s, lossy }) => ({
    s, lossy, perRunValue: s.totalProfit / Math.max(1, lossy ? s.runs + s.lostRuns : s.runs),
  })).map(({ s, lossy, perRunValue }) => ({
    stat: s,
    key: `${pairKey(s.originId, s.destId)}:${s.commodityIds.join(',')}`,
    route: routeName(ref, s.originId, s.destId),
    commodity: s.commodityIds.length === 1 ? commodityName(ref, s.commodityIds[0]) : SEVERAL_COMMODITIES,
    commodityHint: s.commodityIds.length === 1 ? null : mixedGoods(ref, s.commodityIds),
    runs: s.runs,
    runsText: lossy ? `${s.runs}/${s.runs + s.lostRuns}` : String(s.runs),
    ...(lossy ? lossTitles(s) : { runsTitle: RUNS_TITLE, profitTitle: PROFIT_TITLE, perRunTitle: PER_RUN_TITLE }),
    time: formatDuration(s.medianDurationSec),
    phases: s.medianPhases && [s.medianPhases.loadingSec, s.medianPhases.flightSec, s.medianPhases.unloadingSec].map(formatDuration).join(' · '),
    profit: formatUec(s.totalProfit),
    roi: formatRoi(s.avgRoi),
    perRun: formatCompact(perRunValue), perRunValue,
  }));
}

export interface HistoryRow {
  runId: number; when: string;
  /** What the row says of the run, short: 'GOLD: ARC-L1 → TDD Area 18', 'смеш.: ARC-L1 → TDD Area 18', 'GOLD: груз потерян'. */
  title: string;
  /** The same in full, for the tooltip: it lists every commodity of a run whose title says only "смеш.". */
  hint: string;
  status: 'active' | 'done' | 'lost';
  profit: string; roi: string; duration: string;
}

/** A buy or a sell that names a commodity, a quantity and a price: the same trades `simpleRoute` looks at. */
function isTrade(e: RunEvent): boolean {
  return (e.type === 'buy' || e.type === 'sell') && e.commodityId !== null && e.scu !== null && e.scu > 0 && e.price !== null;
}

/** The commodities a run trades in, in the order of first use. */
function tradedCommodityIds(events: RunEvent[]): number[] {
  const ids = new Set<number>();
  for (const e of events) {
    if (isTrade(e) && e.commodityId !== null) ids.add(e.commodityId);
  }
  return [...ids];
}

/**
 * The title of a row and its hint. 'GOLD: ARC-L1 → TDD Area 18' for a simple run; a run that has not sold anything says what
 * became of its cargo: 'GOLD, TITA: идёт' while it goes, 'GOLD, TITA: груз потерян' when it was lost; 'GOLD: смешанный рейс' for
 * one commodity that sold in several places; 'GOLD: продажа без закупки' for a run that only sold (goods the application never
 * saw bought, spec 14.10); the dash for a run without trades. A run of several commodities that sold is no simple route (when it bought
 * at one terminal and sold at another it has a route of mixed cargo in the rating, task 51), and it has two ends:
 * 'смеш.: ARC-L1 → TDD Area 18', the terminal of its first purchase and the one of its last sale. The hint of that
 * row lists the commodities ('GOLD, TITA: смешанный рейс, ARC-L1 → TDD Area 18'); every other row's hint is its title.
 */
function runLabel(status: HistoryRow['status'], events: RunEvent[], ref: Reference): { title: string; hint: string } {
  const ids = tradedCommodityIds(events);
  if (ids.length === 0) return { title: NONE, hint: NONE };
  const commodities = ids.map(id => commodityName(ref, id)).join(', ');
  const same = (kind: string) => ({ title: `${commodities}: ${kind}`, hint: `${commodities}: ${kind}` });

  if (isIncomeRun(events)) return same('продажа без закупки');
  const route = simpleRoute(events);
  if (route !== null) return same(routeName(ref, route.originId, route.destId));
  if (!events.some(e => e.type === 'sell' && isTrade(e))) return same(status === 'lost' ? 'груз потерян' : status === 'active' ? 'идёт' : 'рейс без продаж');
  if (ids.length === 1) return same('смешанный рейс');

  const ends = mixedRoute(events, ref);
  return { title: `${SEVERAL_COMMODITIES}: ${ends}`, hint: `${commodities}: смешанный рейс, ${ends}` };
}

/** 'ARC-L1 → TDD Area 18': from the terminal of the first purchase to the one of the last sale; a trade without a terminal is a dash. */
function mixedRoute(events: RunEvent[], ref: Reference): string {
  const trades = events.filter(isTrade);
  const from = trades.find(e => e.type === 'buy')?.terminalId ?? null;
  const to = trades.findLast(e => e.type === 'sell')?.terminalId ?? null;
  const name = (id: number | null): string => (id === null ? NONE : terminalLabel(ref, id));
  return `${name(from)} → ${name(to)}`;
}

/** What a run says of its result, written as the lists write it: the numbers of a row of the history and of the notice of a run that was closed. */
export interface RunFigures {
  profit: string;
  /** The dash when nothing was invested. */
  roi: string;
  duration: string;
  /** What the profit is, to the rounded UEC: a gain, a loss or neither. */
  tone: 'gain' | 'loss' | 'even';
}

/**
 * The figures of a run as of `now` (a run that has an end lasts until it). A sale of goods that were never bought (`isIncomeRun`)
 * is not a flight: it has no time, only its profit. Whether the run is over is not decided here: a run that goes on
 * has these figures too, and the row of the history blanks them (`historyRow`).
 */
export function runFigures(run: Run, events: RunEvent[], now: number): RunFigures {
  const totals = runTotals(run, events, now);
  const income = isIncomeRun(events);
  const rounded = Math.round(totals.profit);
  return {
    profit: formatUec(totals.profit),
    roi: totals.roi === null ? NONE : formatRoi(totals.roi),
    duration: income ? NONE : formatDuration(totals.durationSec),
    tone: rounded > 0 ? 'gain' : rounded < 0 ? 'loss' : 'even',
  };
}

/**
 * The row of one run. An active run lasts until `now`; its profit and ROI are dashes: it has not finished, so the
 * money in the hold is not a loss (the profit the run has so far is only what the cargo card shows). A lost run keeps its loss.
 */
function historyRow({ run, events }: RunWithEvents, ref: Reference, now: number): HistoryRow {
  const figures = runFigures(run, events, now);
  const going = run.status === 'active';
  const { title, hint } = runLabel(run.status, events, ref);
  return {
    runId: run.id,
    when: formatStamp(run.startedAt),
    title,
    hint,
    status: run.status,
    profit: going ? NONE : figures.profit,
    roi: going ? NONE : figures.roi,
    duration: figures.duration,
  };
}

/** One row per run, in the given order (`listRuns` delivers the newest first). */
export function historyRows(runs: RunWithEvents[], ref: Reference, now: number): HistoryRow[] {
  return runs.map(run => historyRow(run, ref, now));
}

/**
 * `rows` (made by `historyRows` from `runs`, row for row) with the row of every run that is going made again for
 * `now`; the other rows are the same objects, and the very same list comes back while no run is going. Only the
 * duration of a running run follows the clock, so the finished rows are made once and not every second.
 */
export function liveRows(rows: HistoryRow[], runs: RunWithEvents[], ref: Reference, now: number): HistoryRow[] {
  if (!runs.some(({ run }) => run.status === 'active')) return rows;
  return rows.map((row, i) => (runs[i]?.run.status === 'active' ? historyRow(runs[i], ref, now) : row));
}

export interface SessionRow { when: string; duration: string; runs: number; profit: string }

/**
 * A session of nothing: no run ended in it and it earned nothing (the player only wrote prices, or the history was cleared).
 * A session that holds only a sale without a purchase is not one: it has no run, but it has its profit.
 */
const isEmptySession = (s: Session): boolean => s.runIds.length === 0 && Math.round(s.profit) === 0;

/**
 * One row per session, in the given order (`sessions` delivers the newest first). A session of nothing is not listed: a line
 * of '0:00, 0 рейсов' says nothing. The session that is going is read from the sessions as they are (`currentSession`), not from here.
 */
export function sessionRows(list: Session[]): SessionRow[] {
  return list.filter(s => !isEmptySession(s)).map(s => ({
    when: formatStamp(s.startTs),
    duration: formatDuration(s.endTs - s.startTs),
    runs: s.runCount,                                  // the runs of the session; its incomes are in the profit only
    profit: formatUec(s.profit),
  }));
}
