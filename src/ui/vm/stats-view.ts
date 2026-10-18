import { formatCompact, formatDuration, formatUec } from '../../core/format';
import { DEFAULT_SESSION_GAP_SEC, ownLegIndex, ownMedianIndex, ownRunCounts, routeStats, sessions } from '../../core/stats';
import type { RouteStat, Session } from '../../core/stats';
import type { RunWithEvents } from '../../core/types';
import { NONE, formatStamp } from './stats-rows';
import type { RouteRow } from './stats-rows';
import { tr } from '../../i18n';

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
  /** What was written off the storage (version 1.4): a loss of the session it falls in. Absent: none. */
  losses?: ReadonlyArray<{ ts: number; cost: number }>;
}

export const EMPTY_HISTORY: History = { runs: [], recordTs: [], losses: [] };

/** The lists the section shows, one at a time. */
export type StatsView = 'routes' | 'history' | 'sessions' | 'records';

export const STATS_VIEWS: ReadonlyArray<{ id: StatsView; label: string; title: string }> = [
  { id: 'routes', get label() { return tr('Маршруты'); }, get title() { return tr('Мои маршруты: сначала тот, чей рейс приносит больше'); } },
  { id: 'history', get label() { return tr('История'); }, get title() { return tr('Все рейсы, новые сверху'); } },
  { id: 'sessions', get label() { return tr('Сессии'); }, get title() { return tr('Пауза между записями дольше двух часов начинает новую сессию'); } },
  { id: 'records', get label() { return tr('Записи'); }, get title() { return tr('Твои записи цен, новые сверху: то, по чему считает программа. Запись можно исправить или убрать'); } },
];

/** How many rows a list of the section (routes, history, sessions) shows before it scrolls: older ones are reached with the wheel. The one place of the number. */
export const LIST_ROWS = 8;

/** The line of column heads that every one of those lists draws above its rows, px. */
export const LIST_HEAD_PX = 18;

/** The tallest the body of the section is: the line of heads and `LIST_ROWS` rows of the height the lists use (`--sc-row-h`). */
export const LIST_MAX_HEIGHT = `calc(var(--sc-row-h) * ${LIST_ROWS} + ${LIST_HEAD_PX}px)`;

const NO_FINISHED_RUNS = (): string => tr('пока нет завершённых рейсов');

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
  /** 'сессия +1 240 000 за 3:00:00': the exact profit and how long the session has lasted; the summary of the section and the tooltip of the mini line. */
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
  const { profit } = session;
  const lasted = session.endTs > session.startTs ? tr(' за {v1}', { v1: formatDuration(session.endTs - session.startTs) }) : '';
  const rounded = Math.round(profit);
  return {
    short: signed(formatCompact(profit), profit),
    line: tr('сессия {v1}{lasted}', { v1: signed(formatUec(profit), profit), lasted }),
    tone: rounded > 0 ? 'gain' : rounded < 0 ? 'loss' : 'even',
  };
}

/**
 * The summary of the section header: the session that is going (when it has earned anything to say) and the best route
 * with what one run of it brings ('сессия +1 240 000 за 3:00:00 · HUR-L1 → ARC-L1 · 310k за рейс'), or that there are no
 * routes yet. The header cuts a long summary with an ellipsis, so the session, which comes first, is what stays. The rows
 * carry the number without words (their column has the caption «За рейс»); the header has none, so the words are added here.
 */
export function routesSummary(rows: RouteRow[], session: SessionFigure | null = null): string {
  // the best route is looked for among the numbers that are shown: with «Подробные расчёты» a row carries its losses
  const best = rows.reduce<RouteRow | undefined>((top, row) => (top === undefined || row.perRunValue > top.perRunValue ? row : top), undefined);
  const route = best === undefined ? null : tr('{route} · {perRun} за рейс', { route: best.route, perRun: best.perRun });
  const parts = [session?.line ?? null, route].filter((part): part is string => part !== null);
  return parts.length === 0 ? NO_FINISHED_RUNS() : parts.join(' · ');
}

/** Everything the interface takes from the history, counted once per load. */
export interface StatsFigures {
  /** My finished runs per route (a run of mixed cargo between two terminals has its own route), best rate first. */
  stats: RouteStat[];
  /** Direction (`pairKey`) → my median time there, a run of mixed cargo among the samples: the estimates take it instead of the one from the distance. */
  ownMedian: Map<string, number>;
  /** Direction (`pairKey`) → my median of flight plus unloading there, by the runs that have both marks: the time of «лететь дальше». */
  ownLeg: Map<string, number>;
  /** Direction (`pairKey`) → how many finished runs I have there (the same runs `ownMedian` is made of). */
  runCounts: Map<string, number>;
  sessions: Session[];
}

export const EMPTY_FIGURES: StatsFigures = { stats: [], ownMedian: new Map(), ownLeg: new Map(), runCounts: new Map(), sessions: [] };

/**
 * The runs the routes are counted from after «Обнулить маршруты»: those that ended at `since` or later, and the run that is still
 * going. `null` is "no reset": every run. A run that was going at the moment of the reset ends after it, so it counts.
 */
export function runsSince(runs: RunWithEvents[], since: number | null): RunWithEvents[] {
  return since === null ? runs : runs.filter(({ run }) => run.endedAt === null || run.endedAt >= since);
}

/**
 * `routesSince` is the moment of «Обнулить маршруты» (the setting of that name): the routes, the player's own times and his pace
 * are counted from the runs that ended since (`runsSince`). The sessions are what was earned and when, so they keep every run.
 */
export function figuresOf(history: History, routesSince: number | null = null): StatsFigures {
  const { runs, recordTs } = history;
  const counted = runsSince(runs, routesSince);
  return {
    stats: routeStats(counted),
    ownMedian: ownMedianIndex(counted),
    ownLeg: ownLegIndex(counted),
    runCounts: ownRunCounts(counted),
    sessions: sessions(recordTs, runs, undefined, history.losses),
  };
}

/** 'Маршруты считаются с 13.10 20:55': the line under the table of routes after a reset. */
export const routesSinceLine = (since: number): string => tr('Маршруты считаются с {v1}', { v1: formatStamp(since) });
