import { untrack } from 'svelte';
import type { RunWithEvents } from '../core/types';
import type { Db } from '../data/db';
import { app } from './state.svelte';
import { loadHistorySafely } from './stats-history';
import { createLatestRequest } from './vm/latest-request';
import { historyRows, routeRows, sessionRows, type HistoryRow, type RouteRow, type SessionRow } from './vm/stats-rows';
import { EMPTY_FIGURES, EMPTY_HISTORY, figuresOf, routesSummary, type History, type StatsFigures, type StatsView } from './vm/stats-view';

// The statistics of the player's own runs: the history of runs and the numbers made of it (routes, sessions, the
// times of the pairs he has flown). It is the state of the "Мои маршруты" section, and the source of two things the
// route services need (`ownMedian`, `runCounts`).
//
//  - The dependencies come from `app` (the database and the logger, through `app.suggestDeps()`); `app` reads
//    this module for the medians. The two import each other, which is fine because neither constructor touches the other.
//  - It follows `app.activeRun` by itself: when a run appears, changes (a trade, a mark) or is closed (finished, lost),
//    the history is read again. Whoever writes the runs does not have to tell it.
//  - Loading never throws and never blocks the window: a failure is logged (`ui`) and what was there stays; before the
//    first successful load everything is empty, and the section says so in one muted line. No error text reaches the screen.

class StatsState {
  /** The list the section shows. Kept only while the application runs. */
  view = $state<StatsView>('routes');

  #history = $state.raw<History>(EMPTY_HISTORY);
  #figures = $state.raw<StatsFigures>(EMPTY_FIGURES);
  /** Reads overlap when the active run changes quickly; only the newest may put its answer in. */
  readonly #latest = createLatestRequest();
  #following = false;
  #seenRun: RunWithEvents | null = null;

  // ---- what the route services take --------------------------------------------------------------

  /** Direction (`pairKey`) → my median time there; the estimates use it instead of the one from the distance. */
  get ownMedian(): Map<string, number> {
    return this.#figures.ownMedian;
  }

  /** Direction (`pairKey`) → how many finished runs I have there (the details of an option say it). */
  get runCounts(): Map<string, number> {
    return this.#figures.runCounts;
  }

  // ---- what the section shows ---------------------------------------------------------------------

  /** My routes, the best rate first. */
  routes = $derived.by((): RouteRow[] => {
    try {
      return routeRows(this.#figures.stats, app.reference);
    } catch (err) {
      app.log.error('ui', 'cannot build the route rows', { err });
      return [];
    }
  });

  /** The line of the section header: the best route, or that there is none yet. */
  summary = $derived(routesSummary(this.routes));

  /** Every run, the newest first. Only a run that is still going needs the clock. */
  historyList = $derived.by((): HistoryRow[] => {
    const runs = this.#history.runs;
    const now = runs.some(({ run }) => run.status === 'active') ? app.now : 0;
    try {
      return historyRows(runs, app.reference, now);
    } catch (err) {
      app.log.error('ui', 'cannot build the history rows', { err });
      return [];
    }
  });

  /** The play sessions, the newest first. */
  sessionList = $derived.by((): SessionRow[] => {
    try {
      return sessionRows(this.#figures.sessions);
    } catch (err) {
      app.log.error('ui', 'cannot build the session rows', { err });
      return [];
    }
  });

  // ---- loading --------------------------------------------------------------------------------------

  /**
   * Reads the runs and the time of every record again and counts the figures. Never throws. The first call (after the
   * data of the application is loaded) also makes the state follow `app.activeRun` from then on.
   */
  async reload(reason = 'data loaded'): Promise<void> {
    this.#follow();
    const isNewest = this.#latest.begin();
    let db: Db;
    try {
      ({ db } = app.suggestDeps());
    } catch (err) {
      app.log.error('ui', 'cannot load the statistics: no database', { err });
      return;
    }
    const history = await loadHistorySafely(db, app.log);
    if (history === null || !isNewest()) return;
    try {
      this.#figures = figuresOf(history);
    } catch (err) {
      app.log.error('ui', 'cannot count the statistics', { err });
      return;
    }
    this.#history = history;
    app.log.debug('ui', 'statistics loaded', { reason, runs: history.runs.length, records: history.recordTs.length });
  }

  /** Reads again whenever the active run is not the one that was seen last (a run appeared, changed, closed). */
  #follow(): void {
    if (this.#following) return;
    this.#following = true;
    this.#seenRun = untrack(() => app.activeRun);
    // lives as long as the application does
    $effect.root(() => {
      $effect(() => {
        const current = app.activeRun;
        untrack(() => {
          if (current === this.#seenRun) return;
          this.#seenRun = current;
          void this.reload('active run changed');
        });
      });
    });
  }

  // ---- actions of the player --------------------------------------------------------------------------

  setView(next: StatsView): void {
    if (next === this.view) return;
    app.log.info('ui', 'statistics view', { from: this.view, to: next });
    this.view = next;
  }
}

export const stats = new StatsState();
