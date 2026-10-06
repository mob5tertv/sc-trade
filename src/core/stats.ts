import { phases, runTotals, simpleRoute } from './run';
import type { Phases } from './run';
import { pairKey } from './types';
import type { RunWithEvents } from './types';

const SEC_PER_HOUR = 3600;

export interface RouteStat {
  originId: number; destId: number; commodityId: number; runs: number;
  medianDurationSec: number;
  /** Medians over the runs that have departure and arrival marks; `null` when none has. */
  medianPhases: Phases | null;
  totalProfit: number;
  /** Mean of the per-run ROI over the runs that invested something; 0 when none did. */
  avgRoi: number;
  /** Total profit over total time; `null` when the runs took no time at all. */
  uecPerHour: number | null;
}

/** A finished simple run reduced to what the statistics need. */
interface Finished {
  originId: number; destId: number; commodityId: number;
  durationSec: number; profit: number; roi: number | null; phases: Phases | null;
}

/** Median of a non-empty list; the mean of the two middle values when the count is even. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The runs with status 'done' that have a simple route, in the given order. A finished run always
 * has an end; should one lack it, it lasts zero seconds rather than until some "now".
 */
function finishedSimple(runs: RunWithEvents[]): Finished[] {
  const out: Finished[] = [];
  for (const { run, events } of runs) {
    if (run.status !== 'done') continue;
    const route = simpleRoute(events);
    if (route === null) continue;
    const totals = runTotals(run, events, run.startedAt);
    out.push({ ...route, durationSec: totals.durationSec, profit: totals.profit, roi: totals.roi, phases: phases(events) });
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

/** The player's own statistics per route (origin, destination, commodity), best UEC per hour first; routes without a rate go last. */
export function routeStats(runs: RunWithEvents[]): RouteStat[] {
  const groups = new Map<string, Finished[]>();
  for (const f of finishedSimple(runs)) {
    const key = `${f.originId}>${f.destId}:${f.commodityId}`;
    const group = groups.get(key);
    if (group) group.push(f); else groups.set(key, [f]);
  }

  const stats: RouteStat[] = [];
  for (const group of groups.values()) {
    const { originId, destId, commodityId } = group[0];
    const totalProfit = group.reduce((sum, f) => sum + f.profit, 0);
    const totalSec = group.reduce((sum, f) => sum + f.durationSec, 0);
    const rois = group.flatMap(f => (f.roi === null ? [] : [f.roi]));
    stats.push({
      originId, destId, commodityId, runs: group.length,
      medianDurationSec: median(group.map(f => f.durationSec)),
      medianPhases: medianPhases(group.flatMap(f => (f.phases === null ? [] : [f.phases]))),
      totalProfit,
      avgRoi: rois.length > 0 ? rois.reduce((sum, r) => sum + r, 0) / rois.length : 0,
      uecPerHour: totalSec > 0 ? (totalProfit * SEC_PER_HOUR) / totalSec : null,
    });
  }
  return stats.sort((a, b) => {
    if (a.uecPerHour === null || b.uecPerHour === null) return Number(a.uecPerHour === null) - Number(b.uecPerHour === null);
    return b.uecPerHour - a.uecPerHour;
  });
}

/** Direction (`pairKey`) → the median duration of my finished simple runs there, all commodities together. */
export function ownMedianIndex(runs: RunWithEvents[]): Map<string, number> {
  const durations = new Map<string, number[]>();
  for (const f of finishedSimple(runs)) {
    const key = pairKey(f.originId, f.destId);
    const list = durations.get(key);
    if (list) list.push(f.durationSec); else durations.set(key, [f.durationSec]);
  }
  return new Map([...durations].map(([key, list]) => [key, median(list)]));
}

/** Direction (`pairKey`) → the number of my finished simple runs there, all commodities together. */
export function ownRunCounts(runs: RunWithEvents[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of finishedSimple(runs)) {
    const key = pairKey(f.originId, f.destId);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export interface Session { startTs: number; endTs: number; runIds: number[]; profit: number; uecPerHour: number | null }

const DEFAULT_SESSION_GAP_SEC = 7200;

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
    else out.push({ startTs: ts, endTs: ts, runIds: [], profit: 0, uecPerHour: null });
  }

  const finished = runs
    .filter(({ run }) => run.status === 'done' || run.status === 'lost')
    .sort((a, b) => a.run.startedAt - b.run.startedAt || a.run.id - b.run.id);
  for (const { run, events } of finished) {
    const session = out.find(s => s.startTs <= run.startedAt && run.startedAt <= s.endTs);
    if (!session) continue;
    session.runIds.push(run.id);
    session.profit += runTotals(run, events, run.startedAt).profit;
  }

  for (const s of out) {
    const spanSec = s.endTs - s.startTs;
    s.uecPerHour = spanSec > 0 ? (s.profit * SEC_PER_HOUR) / spanSec : null;
  }
  return out.reverse();
}
