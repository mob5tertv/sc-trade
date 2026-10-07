import { ownMedianIndex, ownRunCounts, routeStats, sessions } from '../../core/stats';
import type { RouteStat, Session } from '../../core/stats';
import type { RunWithEvents } from '../../core/types';
import { NONE } from './stats-rows';
import type { RouteRow } from './stats-rows';

// What the "Мои маршруты" section decides without the screen: the lists it offers, the line of its header, and the
// numbers that come out of the history of runs (the statistics, my own times for the estimates, the sessions).

/** The run history as it is read from the database: every run (newest first) and the time of every record there is. */
export interface History {
  runs: RunWithEvents[];
  /**
   * The time of EVERY record, run events included, ascending. Sessions are cut from these: a run is attributed to the
   * session its start falls in, so a session that held nothing but run events must exist. Never give `sessions` the
   * diary alone.
   */
  recordTs: number[];
}

export const EMPTY_HISTORY: History = { runs: [], recordTs: [] };

/** The lists the section shows, one at a time. */
export type StatsView = 'routes' | 'history' | 'sessions';

export const STATS_VIEWS: ReadonlyArray<{ id: StatsView; label: string; title: string }> = [
  { id: 'routes', label: 'Маршруты', title: 'Мои маршруты по UEC в час' },
  { id: 'history', label: 'История', title: 'Все рейсы, новые сверху' },
  { id: 'sessions', label: 'Сессии', title: 'Пауза между записями дольше двух часов начинает новую сессию' },
];

const NO_FINISHED_RUNS = 'пока нет завершённых рейсов';

/**
 * The summary of the section header: the best route and its rate ('HUR-L1 → ARC-L1 · 310k/ч'), or that there are none.
 * The rows carry the rate without its unit (their column has a caption); the header has none, so the unit is added here.
 */
export function routesSummary(rows: RouteRow[]): string {
  const best = rows[0];
  if (best === undefined) return NO_FINISHED_RUNS;
  return best.rate === NONE ? best.route : `${best.route} · ${best.rate}/ч`;
}

/** Everything the interface takes from the history, counted once per load. */
export interface StatsFigures {
  /** My finished simple runs per route, best rate first. */
  stats: RouteStat[];
  /** Direction (`pairKey`) → my median time there: the estimates take it instead of the one from the distance. */
  ownMedian: Map<string, number>;
  /** Direction (`pairKey`) → how many finished runs I have there. */
  runCounts: Map<string, number>;
  sessions: Session[];
}

export const EMPTY_FIGURES: StatsFigures = { stats: [], ownMedian: new Map(), runCounts: new Map(), sessions: [] };

export function figuresOf(history: History): StatsFigures {
  const { runs, recordTs } = history;
  return {
    stats: routeStats(runs),
    ownMedian: ownMedianIndex(runs),
    runCounts: ownRunCounts(runs),
    sessions: sessions(recordTs, runs),
  };
}
