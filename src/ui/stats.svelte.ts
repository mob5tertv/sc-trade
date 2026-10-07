import { untrack } from 'svelte';
import type { RunWithEvents } from '../core/types';
import { app } from './state.svelte';
import { loadHistorySafely } from './stats-history';
import { createLatestRequest } from './vm/latest-request';
import { historyRows, liveRows, routeRows, sessionRows, type HistoryRow, type RouteRow, type SessionRow } from './vm/stats-rows';
import { EMPTY_FIGURES, EMPTY_HISTORY, figuresOf, routesSummary, type History, type StatsFigures, type StatsView } from './vm/stats-view';

// The statistics of the player's own runs: the history of runs and the numbers made of it (routes, sessions, the
// times of the pairs he has flown). It is the state of the "Мои маршруты" section, and the source of two things the
// route services need (`ownMedian`, `runCounts`).
//
//  - The dependencies come from `app` (the database and the logger, through `app.suggestDeps()`); `app` reads
//    this module for the medians. The two import each other, which is fine because neither constructor touches the other.
//  - It follows `app.activeRun` by itself: when a run appears, changes (a trade, a mark) or is closed (finished, lost),
//    the history is read again. Whoever writes the runs does not have to tell it. It is also read again when the player
//    opens the section or switches to the sessions (`opened`, `setView`): prices written since move the latest session.
//  - Loading never throws (`reload` is one `try` from its first line to its last) and never blocks the window: a failure is logged (`ui`) and what was there stays; before the
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

  /** The rows of every run, made once per load (and per change of the reference): the clock is not read here. */
  readonly #historyBase = $derived.by((): HistoryRow[] => {
    try {
      return historyRows(this.#history.runs, app.reference, 0);
    } catch (err) {
      app.log.error('ui', 'cannot build the history rows', { err });
      return [];
    }
  });

  /**
   * Every run, the newest first. Only the row of a run that is still going follows the clock (once a second); the
   * finished rows are the ones made at the load, and with no run going the clock is not even read.
   */
  historyList = $derived.by((): HistoryRow[] => {
    const runs = this.#history.runs;
    const base = this.#historyBase;
    const now = runs.some(({ run }) => run.status === 'active') ? app.now : 0;
    try {
      return liveRows(base, runs, app.reference, now);
    } catch (err) {
      app.log.error('ui', 'cannot build the history rows of the run that is going', { err });
      return base;
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
   * Reads the runs and the time of every record again and counts the figures. NEVER throws, and that is the shape of the
   * method, not a promise about its parts: the whole body is one `try`, because the start of the application awaits it.
   * The first call (after the data of the application is loaded) also makes the state follow `app.activeRun` from then on.
   */
  async reload(reason = 'data loaded'): Promise<void> {
    try {
      this.#follow();
      const isNewest = this.#latest.begin();
      const { db } = app.suggestDeps();
      const history = await loadHistorySafely(db, app.log); // logs its own failure
      if (history === null || !isNewest()) return;
      this.#figures = figuresOf(history);
      this.#history = history;
      app.log.debug('ui', 'statistics loaded', { reason, runs: history.runs.length, records: history.recordTs.length });
    } catch (err) {
      try {
        app.log.error('ui', 'cannot load the statistics', { reason, err });
      } catch {
        // the log is gone too: there is nothing left to do, and nothing may reach the caller
      }
    }
  }

  /** Reads again whenever the active run is not the one that was seen last (a run appeared, changed, closed). */
  #follow(): void {
    if (this.#following) return;
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
    this.#following = true; // after the root exists: a failure to make it is tried again with the next load
  }

  // ---- actions of the player --------------------------------------------------------------------------

  /**
   * The player opened the section: read the history again (a price he wrote since moves the end of the latest session,
   * which no change of the active run says). Not awaited; the list shows the old figures until the new ones come.
   */
  opened(): void {
    void this.reload('section opened');
  }

  setView(next: StatsView): void {
    if (next === this.view) return;
    app.log.info('ui', 'statistics view', { from: this.view, to: next });
    this.view = next;
    if (next === 'sessions') void this.reload('sessions opened'); // same reason as `opened`
  }
}

export const stats = new StatsState();
