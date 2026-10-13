import { intendedRoute, isIncomeRun, phases, routeOf, runTotals } from './run';
import type { Phases } from './run';
import { pairKey } from './types';
import type { RunWithEvents } from './types';

const SEC_PER_HOUR = 3600;

export interface RouteStat {
  originId: number; destId: number;
  /**
   * The goods of the route as a set, the smallest id first: one for a simple route, several for the route of a run of mixed cargo
   * (task 51: everything bought at one terminal, everything sold at another one). Runs between the same two terminals with
   * another set of goods are another route.
   */
  commodityIds: number[];
  runs: number;
  medianDurationSec: number;
  /** Medians over the runs that have departure and arrival marks; `null` when none has. */
  medianPhases: Phases | null;
  totalProfit: number;
  /** Mean of the per-run ROI over the runs that invested something; 0 when none did. */
  avgRoi: number;
  /** Total profit over total time; `null` when the runs took no time at all. */
  uecPerHour: number | null;
  /** The runs that were meant for this route (`intendedRoute`) and ended as lost: the attempts that failed. */
  lostRuns: number;
  /** What those lost runs made: what they sold less what they bought, a loss as a rule; 0 when there are none. */
  lostProfit: number;
  /** The profit with the lost runs in it, over the time of the finished and the lost runs together; `null` when they took no time. */
  uecPerHourWithLosses: number | null;
}

/** A finished run that has a route, reduced to what the statistics need. */
interface Finished {
  originId: number; destId: number; commodityIds: number[];
  durationSec: number; profit: number; roi: number | null; phases: Phases | null;
}

/** Median of a non-empty list; the mean of the two middle values when the count is even. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The runs with status 'done' that have a route (`routeOf`: one commodity or several, all bought at one terminal and all sold at
 * another one), in the given order, each run once. Nothing bought is left unsold in such a run: the data layer writes 'done' only
 * when the hold is empty for every commodity. A finished run always has an end; should one lack it, it lasts zero seconds
 * rather than until some "now".
 */
function finishedRoutes(runs: RunWithEvents[]): Finished[] {
  const out: Finished[] = [];
  for (const { run, events } of runs) {
    if (run.status !== 'done') continue;
    const route = routeOf(events);
    if (route === null) continue;
    const totals = runTotals(run, events, run.startedAt);
    out.push({ ...route, durationSec: totals.durationSec, profit: totals.profit, roi: totals.roi, phases: phases(events) });
  }
  return out;
}

/** A lost run that was meant for a route (`intendedRoute`): what it lost and how long it took. */
interface Lost { key: string; profit: number; durationSec: number }

/** The key of a route of the statistics: the two terminals and the set of goods. */
const routeKey = (r: { originId: number; destId: number; commodityIds: number[] }): string => `${pairKey(r.originId, r.destId)}:${r.commodityIds.join(',')}`;

/**
 * The runs with status 'lost' that say where they were going: by what they sold before the loss, or by the target recorded
 * when the cargo was written off. A lost run without either belongs to no route (it is in the history and in its session).
 */
function lostRoutes(runs: RunWithEvents[]): Lost[] {
  const out: Lost[] = [];
  for (const { run, events } of runs) {
    if (run.status !== 'lost') continue;
    const route = intendedRoute(run, events);
    if (route === null) continue;
    const totals = runTotals(run, events, run.startedAt);
    out.push({ key: routeKey(route), profit: totals.profit, durationSec: totals.durationSec });
  }
  return out;
}

function medianPhases(list: Phases[]): Phases | null {
  if (list.length === 0) return null;
  return {
    loadingSec: median(list.map(p => p.loadingSec)),
    flightSec: median(list.map(p => p.flightSec)),
    unloadingSec: median(list.map(p => p.unloadingSec)),
  };
}

/**
 * The player's own statistics per route (origin, destination, set of goods), best UEC per hour first; routes without a rate go last.
 * The numbers of a route are those of its whole runs, whatever they carried. A route is one the player has FINISHED at least
 * once: the lost runs that were meant for it stand beside its numbers (`lostRuns`, `lostProfit`, `uecPerHourWithLosses`) and
 * change none of them; a route that was only ever lost is not listed.
 */
export function routeStats(runs: RunWithEvents[]): RouteStat[] {
  const groups = new Map<string, Finished[]>();
  for (const f of finishedRoutes(runs)) {
    const key = routeKey(f);
    const group = groups.get(key);
    if (group) group.push(f); else groups.set(key, [f]);
  }
  const lostByRoute = new Map<string, Lost[]>();
  for (const l of lostRoutes(runs)) {
    const list = lostByRoute.get(l.key);
    if (list) list.push(l); else lostByRoute.set(l.key, [l]);
  }

  const stats: RouteStat[] = [];
  for (const [key, group] of groups) {
    const { originId, destId, commodityIds } = group[0];
    const totalProfit = group.reduce((sum, f) => sum + f.profit, 0);
    const totalSec = group.reduce((sum, f) => sum + f.durationSec, 0);
    const rois = group.flatMap(f => (f.roi === null ? [] : [f.roi]));
    const lost = lostByRoute.get(key) ?? [];
    const lostProfit = lost.reduce((sum, l) => sum + l.profit, 0);
    const allSec = totalSec + lost.reduce((sum, l) => sum + l.durationSec, 0);
    stats.push({
      originId, destId, commodityIds, runs: group.length,
      medianDurationSec: median(group.map(f => f.durationSec)),
      medianPhases: medianPhases(group.flatMap(f => (f.phases === null ? [] : [f.phases]))),
      totalProfit,
      avgRoi: rois.length > 0 ? rois.reduce((sum, r) => sum + r, 0) / rois.length : 0,
      uecPerHour: totalSec > 0 ? (totalProfit * SEC_PER_HOUR) / totalSec : null,
      lostRuns: lost.length, lostProfit,
      uecPerHourWithLosses: allSec > 0 ? ((totalProfit + lostProfit) * SEC_PER_HOUR) / allSec : null,
    });
  }
  return stats.sort((a, b) => {
    if (a.uecPerHour === null || b.uecPerHour === null) return Number(a.uecPerHour === null) - Number(b.uecPerHour === null);
    return b.uecPerHour - a.uecPerHour;
  });
}

/**
 * Direction (`pairKey`) → the median duration of my finished runs there, all commodities together, the runs of mixed cargo between
 * the two terminals among them. Every run is one sample of its pair, whatever number of goods it carried.
 */
export function ownMedianIndex(runs: RunWithEvents[]): Map<string, number> {
  const durations = new Map<string, number[]>();
  for (const f of finishedRoutes(runs)) {
    const key = pairKey(f.originId, f.destId);
    const list = durations.get(key);
    if (list) list.push(f.durationSec); else durations.set(key, [f.durationSec]);
  }
  return new Map([...durations].map(([key, list]) => [key, median(list)]));
}

/**
 * The statistic of a route as it reads with its lost runs in it (the setting «Подробные расчёты»): the profit and the rate are
 * the ones with the losses, so that a table sorted by them is sorted by what the route really brought. Everything else stays.
 */
export function withLosses(stat: RouteStat): RouteStat {
  return stat.lostRuns === 0 ? stat : { ...stat, totalProfit: stat.totalProfit + stat.lostProfit, uecPerHour: stat.uecPerHourWithLosses };
}

/**
 * Direction (`pairKey`) → the median of flight plus unloading of my finished runs there that have both marks (`phases`): the way
 * with the cargo already aboard, which is what «лететь дальше» takes. A pair whose runs have no marks is absent.
 */
export function ownLegIndex(runs: RunWithEvents[]): Map<string, number> {
  const legs = new Map<string, number[]>();
  for (const f of finishedRoutes(runs)) {
    if (f.phases === null) continue;
    const key = pairKey(f.originId, f.destId);
    const sec = f.phases.flightSec + f.phases.unloadingSec;
    const list = legs.get(key);
    if (list) list.push(sec); else legs.set(key, [sec]);
  }
  return new Map([...legs].map(([key, list]) => [key, median(list)]));
}

/** How many of the latest flights make the usual pace: enough to smooth one lucky run, few enough to follow a change of ship. */
export const PACE_RUNS = 20;

/** The player's usual pace: UEC per hour over his latest flights, and how many of them it is made of. */
export interface Pace { uecPerHour: number; runs: number }

/**
 * What the player usually earns per hour of a run: the profit of his latest `limit` flights (finished or lost: a lost cargo is
 * part of the pace; a sale of goods that were never bought is no flight) over their time. `null` until there is a flight that
 * took any time. It is the yardstick of «лететь дальше»: a further leg that earns less per hour than this is not worth it.
 */
export function usualPace(runs: RunWithEvents[], limit = PACE_RUNS): Pace | null {
  const flights = runs
    .filter(({ run, events }) => (run.status === 'done' || run.status === 'lost') && !isIncomeRun(events))
    .sort((a, b) => b.run.startedAt - a.run.startedAt || b.run.id - a.run.id)
    .slice(0, limit);
  let profit = 0;
  let sec = 0;
  for (const { run, events } of flights) {
    const totals = runTotals(run, events, run.startedAt);
    profit += totals.profit;
    sec += totals.durationSec;
  }
  return sec > 0 ? { uecPerHour: (profit * SEC_PER_HOUR) / sec, runs: flights.length } : null;
}

/** Direction (`pairKey`) → the number of my finished runs there, all commodities together (the same runs `ownMedianIndex` takes the time of). */
export function ownRunCounts(runs: RunWithEvents[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of finishedRoutes(runs)) {
    const key = pairKey(f.originId, f.destId);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export interface Session {
  startTs: number; endTs: number;
  /** Every finished run that starts inside the session, the sales of goods that were never bought included (their profit is in `profit`). */
  runIds: number[];
  /** How many of those are runs (flights): `runIds` without the sales of goods that were never bought (`isIncomeRun`). */
  runCount: number;
  profit: number; uecPerHour: number | null;
}

/** The pause between two records that starts a new play session (2 h); the interface asks it too, for "is this session still going". */
export const DEFAULT_SESSION_GAP_SEC = 7200;

/**
 * Play sessions: the record timestamps cut into stretches wherever two neighbours are more than
 * `gapSec` apart (exactly `gapSec` still counts as one stretch). A session spans from its first to its
 * last timestamp. A run belongs to the session whose span contains the run's start; a run starting
 * outside every span is left out. Runs that are done or lost count towards a session's profit, active ones do not.
 * The rate is profit over the session's span, `null` when the span is empty. Newest session first.
 */
export function sessions(recordTs: number[], runs: RunWithEvents[], gapSec = DEFAULT_SESSION_GAP_SEC): Session[] {
  const out: Session[] = [];
  for (const ts of [...recordTs].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && ts - last.endTs <= gapSec) last.endTs = ts;
    else out.push({ startTs: ts, endTs: ts, runIds: [], runCount: 0, profit: 0, uecPerHour: null });
  }

  const finished = runs
    .filter(({ run }) => run.status === 'done' || run.status === 'lost')
    .sort((a, b) => a.run.startedAt - b.run.startedAt || a.run.id - b.run.id);
  for (const { run, events } of finished) {
    const session = out.find(s => s.startTs <= run.startedAt && run.startedAt <= s.endTs);
    if (!session) continue;
    session.runIds.push(run.id);
    if (!isIncomeRun(events)) session.runCount += 1;
    session.profit += runTotals(run, events, run.startedAt).profit;
  }

  for (const s of out) {
    const spanSec = s.endTs - s.startTs;
    s.uecPerHour = spanSec > 0 ? (s.profit * SEC_PER_HOUR) / spanSec : null;
  }
  return out.reverse();
}
