import { formatCompact, formatUec } from '../../core/format';
import { DEFAULT_SESSION_GAP_SEC, ownMedianIndex, ownRunCounts, routeStats, sessions } from '../../core/stats';
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

/** How many rows a list of the section (routes, history, sessions) shows before it scrolls: older ones are reached with the wheel. The one place of the number. */
export const LIST_ROWS = 8;

/** The line of column heads that every one of those lists draws above its rows, px. */
export const LIST_HEAD_PX = 18;

/** The tallest the body of the section is: the line of heads and `LIST_ROWS` rows of the height the lists use (`--sc-row-h`). */
export const LIST_MAX_HEIGHT = `calc(var(--sc-row-h) * ${LIST_ROWS} + ${LIST_HEAD_PX}px)`;

const NO_FINISHED_RUNS = 'пока нет завершённых рейсов';

/**
 * The latest of `sessions` (the newest first, as the statistics hold them) while it is still going at `now`: its last
 * record is less than the pause that splits sessions old. After that pause the next record would start a new session,
 * so this one is over. The same object comes back for as long as it is current: the caller can compare it.
 */
export function currentSession(sessionList: Session[], now: number): Session | null {
  const latest = sessionList[0];
  return latest !== undefined && now - latest.endTs < DEFAULT_SESSION_GAP_SEC ? latest : null;
}

/** What the play session that is going has earned, in the two forms the interface needs. */
export interface SessionFigure {
  /** '+1,24M': the profit in the short form of the mini line. */
  short: string;
  /** 'сессия +1 240 000 · 413k/ч': the exact profit and the rate; the summary of the section and the tooltip of the mini line. */
  line: string;
  /** What colour the profit is: the colour of a profit, of a loss, or neither. */
  tone: 'gain' | 'loss' | 'even';
}

/** The sign that a profit shows: a plus for a gain (a loss and zero carry theirs in the formatted number). */
const signed = (text: string, value: number): string => (Math.round(value) > 0 ? `+${text}` : text);

/**
 * What `session` earned, or `null` when there is nothing to say: no session, or no run that has ended in it. A run that
 * is still going has earned nothing yet, and prices alone are not earnings; a zero that is not one is worse than no number.
 */
export function sessionFigure(session: Session | null): SessionFigure | null {
  if (session === null || session.runIds.length === 0) return null;
  const { profit, uecPerHour } = session;
  const rate = uecPerHour === null ? '' : ` · ${formatCompact(uecPerHour)}/ч`;
  const rounded = Math.round(profit);
  return {
    short: signed(formatCompact(profit), profit),
    line: `сессия ${signed(formatUec(profit), profit)}${rate}`,
    tone: rounded > 0 ? 'gain' : rounded < 0 ? 'loss' : 'even',
  };
}

/**
 * The summary of the section header: the session that is going (when it has earned anything to say) and the best route
 * with its rate ('сессия +1 240 000 · 413k/ч · HUR-L1 → ARC-L1 · 310k/ч'), or that there are no routes yet. The header
 * cuts a long summary with an ellipsis, so the session, which comes first, is what stays. The rows carry the rate
 * without its unit (their column has a caption); the header has none, so the unit is added here.
 */
export function routesSummary(rows: RouteRow[], session: SessionFigure | null = null): string {
  const best = rows[0];
  const route = best === undefined ? null : best.rate === NONE ? best.route : `${best.route} · ${best.rate}/ч`;
  const parts = [session?.line ?? null, route].filter((part): part is string => part !== null);
  return parts.length === 0 ? NO_FINISHED_RUNS : parts.join(' · ');
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
