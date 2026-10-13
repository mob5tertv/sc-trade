import { untrack } from 'svelte';
import type { RunWithEvents } from '../core/types';
import { app } from './state.svelte';
import { loadHistorySafely } from './stats-history';
import { historyCounts as countHistory, type HistoryCounts } from './vm/history-clearing';
import { createLatestRequest } from './vm/latest-request';
import { tradeLines, type TradeLine } from './vm/run-trades';
import { historyRows, liveRows, routeRows, sessionRows, type HistoryRow, type RouteRow, type SessionRow } from './vm/stats-rows';
import {
  currentSession, EMPTY_FIGURES, EMPTY_HISTORY, figuresOf, routesSummary, sessionFigure, type History, type StatsFigures, type StatsView,
} from './vm/stats-view';

// The statistics of the player's own runs: the history of runs and the numbers made of it (routes, sessions, the
// times of the pairs he has flown). It is the state of the "Мои маршруты" section, and the source of two things the
// route services need (`ownMedian`, `runCounts`).
//
//  - The dependencies come from `app` (the database and the logger, through `app.suggestDeps()`); `app` reads
//    this module for the medians. The two import each other, which is fine because neither constructor touches the other.
//  - It follows `app.activeRun` by itself: when a run appears, changes (a trade, a mark) or is closed (finished, lost),
//    the history is read again. Whoever writes the runs does not have to tell it. It is also read again when the player
//    opens the section or switches to the sessions (`opened`, `setView`): prices written since move the latest session.
//  - `sessionNow` is what the play session that is going has earned (the mini line without a run and the summary of the
//    section say it). It is made of the sessions of the last load and the one-second clock, so it never reads the database.
//  - Loading never throws (`reload` is one `try` from its first line to its last) and never blocks the window: a failure is logged (`ui`) and what was there stays; before the
//    first successful load everything is empty, and the section says so in one muted line. No error text reaches the screen.

class StatsState {
  /** The list the section shows. Kept only while the application runs. */
  view = $state<StatsView>('routes');

  #history = $state.raw<History>(EMPTY_HISTORY);
  /**
   * The numbers made of the history, counted once per load and once per «Обнулить маршруты» (or its undo): the routes, the times
   * and the pace are those of the runs since the reset, so they follow the setting by themselves, with no read of the database.
   */
  readonly #figures = $derived.by((): StatsFigures => {
    try {
      return figuresOf(this.#history, app.settings.routesSince);
    } catch (err) {
      app.log.error('ui', 'cannot count the statistics', { err });
      return EMPTY_FIGURES;
    }
  });
  /** Reads overlap when the active run changes quickly; only the newest may put its answer in. */
  readonly #latest = createLatestRequest();
  #following = false;
  #seenRun: RunWithEvents | null = null;

  // ---- what the route services take --------------------------------------------------------------

  /** Direction (`pairKey`) → my median time there; the estimates use it instead of the one from the distance. */
  get ownMedian(): Map<string, number> {
    return this.#figures.ownMedian;
  }

  /** Direction (`pairKey`) → my median of flight plus unloading there: the time «лететь дальше» takes with the cargo aboard. */
  get ownLeg(): Map<string, number> {
    return this.#figures.ownLeg;
  }

  /** What I usually earn per hour of a run; `null` while no flight is finished. */
  get pace(): StatsFigures['pace'] {
    return this.#figures.pace;
  }

  /** Direction (`pairKey`) → how many finished runs I have there (the details of an option say it). */
  get runCounts(): Map<string, number> {
    return this.#figures.runCounts;
  }

  // ---- what the section shows ---------------------------------------------------------------------

  /** My routes, the best rate first; with «Подробные расчёты» each one is counted with its lost runs. */
  routes = $derived.by((): RouteRow[] => {
    try {
      return routeRows(this.#figures.stats, app.reference, app.settings.detailedCalc);
    } catch (err) {
      app.log.error('ui', 'cannot build the route rows', { err });
      return [];
    }
  });

  /**
   * The latest session while it is going on. Whether it still is depends on the clock, and that is one comparison with
   * `app.now` (no database read): the same object comes back until the pause is over, so nothing downstream moves each second.
   * The session is as of the last load (a run that changed, a price that was recorded, the section that was opened): the
   * statistics are read again by each of those, so that a session does not end two hours after its last run while the player
   * went on writing prices.
   */
  readonly #currentSession = $derived.by(() => currentSession(this.#figures.sessions, app.now));

  /**
   * What the session that is going has earned, for the mini line and the summary of the section; `null` when there is no
   * such session or no run has ended in it.
   */
  sessionNow = $derived(sessionFigure(this.#currentSession));

  /** The line of the section header: the session that is going, then the best route (or that there is none yet). */
  summary = $derived(routesSummary(this.routes, this.sessionNow));

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

  /** The trades of the run `runId` of the history, for the form that corrects them; empty when the run is not there (any more). */
  tradesOf(runId: number): TradeLine[] {
    const run = this.#history.runs.find((r) => r.run.id === runId);
    return run === undefined ? [] : tradeLines(run, app.reference);
  }

  /**
   * How many finished runs the history holds, since when, and how many of them ended more than thirty days ago: the status line
   * and the buttons of the clearing in "Настройки" → "Данные" (spec 14.14). Made of the last load, like the list, and counted at
   * the one-second clock only while the settings are on screen (nobody else reads it).
   */
  historyCounts = $derived.by((): HistoryCounts => {
    try {
      return countHistory(this.#history.runs, app.now);
    } catch (err) {
      app.log.error('ui', 'cannot count the history', { err });
      return { finished: 0, old: 0, since: null };
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
      this.#history = history; // the figures are counted from it (`#figures`)
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

  /**
   * «Обнулить маршруты»: from now on the routes, the player's own times and his pace are counted from the runs that end after this
   * moment. Nothing is deleted: the history and the sessions keep every run, and `restoreRoutes` takes the reset back.
   */
  async resetRoutes(): Promise<void> {
    const since = app.now;
    app.log.info('ui', 'routes reset', { since, routes: this.routes.length });
    await app.updateSetting('routesSince', since);
  }

  /** Takes «Обнулить маршруты» back: the routes are counted from the first run again. */
  async restoreRoutes(): Promise<void> {
    app.log.info('ui', 'routes reset taken back', { since: app.settings.routesSince });
    await app.updateSetting('routesSince', null);
  }

  setView(next: StatsView): void {
    if (next === this.view) return;
    app.log.info('ui', 'statistics view', { from: this.view, to: next });
    this.view = next;
    if (next === 'sessions') void this.reload('sessions opened'); // same reason as `opened`
  }
}

export const stats = new StatsState();
