import { listen } from '@tauri-apps/api/event';
import { tick } from 'svelte';
import { appLogDir, join } from '@tauri-apps/api/path';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { anchorFromRect, WINDOW_MARGIN, type Corner, type Rect, type Size } from '../core/layout';
import type { RouteCtx, RouteOption } from '../core/routes';
import { DEFAULT_SETTINGS, type Settings } from '../core/settings';
import type { Market, Reference, RunWithEvents, Side } from '../core/types';
import type { Db } from '../data/db';
import { createLogger, type Logger } from '../data/logger';
import { addObservation } from '../data/repo/diary';
import { getActiveRun } from '../data/repo/runs';
import { saveSetting } from '../data/repo/settings';
import { getMeta, loadDistances, loadReference } from '../data/repo/uex-cache';
import {
  loadMarket, suggestFromDetailed, suggestToDetailed, type SuggestDeps, type SuggestProgress, type SuggestRun,
} from '../data/suggest';
import { syncPrices, syncReference, type SyncDeps } from '../data/sync';
import { loseCargo as closeAsLost, recordBuy, recordIncome, recordMark, recordSell, TradeError, type TradeDeps, type TradeInput } from '../data/trade';
import { UexError, type UexClient } from '../data/uex-client';
import { applyLogLevel } from '../platform/tauri-logger';
import { bindTriggers, type TriggerName } from '../platform/triggers';
import {
  fitWindow,
  giveKeyboard,
  isWindowFocused,
  moveWindow,
  setWindowVisible,
  showWindow,
  takeKeyboard,
  watchFocus,
  windowGeometry,
  type WindowLayout,
  type WindowMode,
} from '../platform/window';
import { resetHeldKeys } from './keyboard';
import { stats } from './stats.svelte';
import { shouldCollapse } from './vm/idle';
import { createKeyboardHolds, type KeyboardHolds } from './vm/keyboard-holds';
import { createLatestRequest } from './vm/latest-request';
import { affectsLookup, lookupTitle, sameRequest, type LookupRequest } from './vm/lookup';
import { answerLookup } from './vm/lookup-flow';
import { createRequestQueue } from './vm/request-queue';
import { markRefusal } from './vm/run-phase';
import { sameRun } from './vm/same-run';
import { parseOpenSections, serializeOpenSections, toggledSection } from './vm/sections';
import { validateSetting } from './vm/settings-validation';
import { META_PRICES_SYNCED_AT, META_REFERENCE_SYNCED_AT, metaSeconds, reloadsMidSync, syncPlan } from './vm/sync-plan';
import { stripModel, type StripModel } from './vm/strip';
import { rowRoiMap, type RowRoi } from './vm/row-roi';
import { sideCounts, terminalRows as buildTerminalRows, type TerminalRow } from './vm/terminal-rows';
import { resolveTerminalSide } from './vm/terminal-side';
import { triggerErrorText } from './vm/trigger-error';
import { uexErrorText } from './vm/uex-error';
import { PRICE_SYNC_IDLE, type PriceSync } from './vm/window-header';

// The one application state. Everything the screens show lives here, and every action of the player
// goes through a method of `app`, which logs it under `ui`. Later tasks add their fields and methods
// to this class (recording prices, suggestions, trades, history) and reuse the pieces below:
//  - the dependencies (database, logger, UEX client, clock) live in one place, `#data` + `#log`; the
//    data services take them through `#syncDeps()` (a private view of that place), `suggestDeps()`, and
//    the trade deps a later task adds next to it. The raw UEX client is never handed out;
//  - `withUex(job)` is THE entry point for everything that can touch UEX: the syncs, and every suggestion
//    call that may fetch distances (`suggestFromDetailed`/`suggestToDetailed` in the 'fetch' mode, `ensureDistances`).
//    Requests to UEX are strictly sequential project-wide, so none of them may run outside of it. A job must
//    never call `withUex` itself, nor a method that does (`syncReferenceNow`, `syncPricesNow`, `refreshPrices`, `refreshReference`):
//    the inner call would wait for the queue slot the outer job holds, and the queue would deadlock.
//    The ONE thing that is deliberately outside of it: the first step of a lookup, which answers from the cache
//    ('cached' mode) and makes no UEX request, so it must not wait behind a running sync. The second step, the one
//    that fetches the missing distances, goes through `withUex` (see `runLookup`);
//  - `reloadMarket()` refreshes the market after anything wrote prices;
//  - UEX health is tracked per sync (`referenceOk`, `pricesOk`); `uexOk` is both together. A price sync, the background
//    one and the one the player starts by a click on the indicator of the header (`refreshPrices`), is one thing at a
//    time and shows how far it is in `priceSync`;
//  - the Terminal section: `terminalRows` (the table of the viewed terminal, on a 15 s clock), `terminalSide` (the
//    side of it that is drawn), `recordPrice` (writes what the player saw, and nothing else: it asks no lookup), and
//    the lookup (`lookup`, `runLookup`, `rerunLookup`, `newRoute`, `closeLookup`): where to buy / where to sell, in
//    two steps (the cached answer at once, the fetching of missing distances after it), one answer at a time, the
//    newest request wins;
//  - trades and the run (`buy`, `sell`, `mark`, `loseCargo`): they never touch UEX. Each one is a job of `#tradeQueue`: it
//    writes through the trade service, then reads the active run (and, unless the service refused, the market) again, and only then the next one
//    starts, so that a double click or a key pressed twice judges the state the first press left. A refusal comes back as
//    a Russian sentence (the form under a row shows it); marks say it with `flash` (the mini line) and the notice line
//    (the expanded window). `ask` / `answer` are the one in-flow question of the window (a line under the header);
//  - the window: it is the mini bar (`mini`) or the expanded view (`expanded`), as big as its content and
//    anchored to a corner. It never takes the keyboard from the game by itself: the keyboard is taken only
//    through `keyboard.hold(...)` (a text field is edited) and handed back by `release`. The expanded view
//    folds into the mini bar by itself (`idleCollapseSec`). Window operations run in THREE queues, each one job
//    at a time: `#modeQueue` (mode changes, show / hide), `#fitQueue` (`place_window`), and the queue inside
//    `keyboard` (take / give of the keyboard). Operations of DIFFERENT queues may overlap, and that is harmless:
//    they change different properties of the window (visibility, the rectangle, focusability and the foreground
//    window) with separate calls that Tauri runs on the main thread in the order they arrive, and none of them
//    reads what another writes. The pairs that DO depend on each other are ordered on purpose: a collapse releases
//    the keyboard before it hides the window (it awaits `keyboard.release` inside its mode job), and a window that
//    is shown after being hidden is placed first (`#placeBeforeShow`). A job of one queue must never wait for a job
//    of a queue that may be waiting for it: a mode job awaits the keyboard and fit queues, and neither of those
//    ever awaits the mode queue. A drag (`dragBegin` .. `dragEnd`) is the one thing that stops `#refit`.

/** What the expanded window shows: the main screen or the settings, which take the whole window. */
export type View = 'main' | 'settings';
export type Phase = 'booting' | 'ready' | 'failed';
export interface Notice { text: string; kind: 'info' | 'error' }

/** What the "Варианты" section shows (spec 14.2, 14.8). */
export interface LookupState {
  /** What was asked; `null` before anything was: the section is on screen only while there is a request. */
  request: LookupRequest | null;
  /** What the options are, in a sentence: 'Где купить Gold для HUR-L1 · продажа 5 088'. */
  title: string;
  options: RouteOption[];
  /** Nothing to show yet: the first answer has not come. */
  loading: boolean;
  /** A short Russian sentence when the lookup failed; never the raw text of an error. */
  error: string | null;
  /** The answer is by the distances that were already known; the missing ones are being fetched (or could not be). */
  preliminary: boolean;
  /** How many of the missing distances are fetched, while they are. */
  progress: SuggestProgress | null;
}

/** A question that waits for yes or no (the line under the header): what is asked, and the label of the "yes" button. */
export interface Confirm { text: string; yes: string }

/** What a price the player saw is: the observation's fields without a time (now is the time). */
export interface PriceInput { terminalId: number; commodityId: number; side: Side; price: number; scu: number | null }

/** What `boot()` opens once the database is there. */
export interface DataDeps { db: Db; uex: UexClient; now: () => number }

const EMPTY_REFERENCE: Reference = { starSystems: [], terminals: new Map(), commodities: new Map(), vehicles: [] };
const EMPTY_MARKET: Market = {
  uex: new Map(), own: new Map(), byTerminal: new Map(), byCommodity: new Map(), stock: new Map(), ownScu: new Map(), ownPrev: new Map(),
};
const NO_ROW_ROI: ReadonlyMap<number, RowRoi> = new Map();
const IDLE_LOOKUP: LookupState = { request: null, title: '', options: [], loading: false, error: null, preliminary: false, progress: null };

/** Prices are fetched again every hour (spec 6). */
const PRICE_SYNC_INTERVAL_MS = 60 * 60 * 1000;
const NOTICE_MS = 8000;
/** Temperatures and stock estimates move slowly: the table is refreshed this often, not every second. */
const ROWS_TICK_MS = 15_000;
/**
 * After our own take or give of the keyboard the window may report that it lost the focus: Windows sends that a moment
 * later, when a new take can already be under way. A loss this soon after is the echo of our own focus juggling, not the
 * player clicking the game (see `drop` in vm/keyboard-holds.ts). A loss that is real is found again after this time.
 */
const FOCUS_SETTLE_MS = 500;

const RECORD_FAILED = 'Не удалось записать цену. Подробности в логе.';
const LOOKUP_FAILED = 'Не удалось подобрать маршруты. Подробности в логе.';
const REFINE_FAILED = 'Не удалось уточнить расстояния. Показан предварительный ответ.';
/** The `reason` of the lookup that repeats the one on screen after a setting changed (it must not reopen a section the player closed). */
const LOOKUP_REPEAT = 'settings changed';
/** The id of the "Варианты" section among the open sections. */
const OPTIONS_SECTION = 'options';
/** The id of the "Рейс" section among the open sections. */
const RUN_SECTION = 'run';
/** How long a message of the mini line (`flash`) stays, and how long a question waits before it counts as "no". */
const FLASH_MS = 3000;
const CONFIRM_MS = 10_000;
const CONFIRM_BUSY = 'confirm';
const TRADE_FAILED = 'Не удалось записать сделку. Подробности в логе.';
const RUN_READ_FAILED = 'Не удалось прочитать рейс из базы. Подробности в логе.';
const NO_CURRENT_LOCATION = 'Сначала укажи, где ты находишься: найди локацию в поиске и нажми «Я здесь».';

const nowSec = (): number => Math.floor(Date.now() / 1000);

class AppState {
  // ---- data -----------------------------------------------------------------------------------
  settings = $state.raw<Settings>({ ...DEFAULT_SETTINGS });
  reference = $state.raw<Reference>(EMPTY_REFERENCE);
  market = $state.raw<Market>(EMPTY_MARKET);
  distances = $state.raw<Map<string, number | null>>(new Map());
  /** The active run: the trades write it, the mini line and the "Рейс" section read it. */
  activeRun = $state.raw<RunWithEvents | null>(null);
  /** A short message of the mini line (3 seconds); in the expanded window the same text goes to the notice line. */
  flash = $state<string | null>(null);
  /** The question under the header that waits for yes or no; `null` when none is asked. */
  confirm = $state.raw<Confirm | null>(null);
  pricesSyncedAt = $state<number | null>(null);
  /** The last reference sync worked (true until one fails; true again after the next good one). */
  referenceOk = $state(true);
  /** The last price sync worked completely (a sync with unfetched terminals counts as failed). */
  pricesOk = $state(true);
  /** How the price sync stands, for the indicator of the header: going with `done` of `total` batches, or not. */
  priceSync = $state.raw<PriceSync>(PRICE_SYNC_IDLE);
  /** Unix seconds, updated once a second. */
  now = $state(nowSec());
  /** Unix seconds, updated every 15 seconds: the moment the table of the Terminal section is counted at. */
  rowsNow = $state(nowSec());
  /** The "Варианты" section: what was asked and the answer to it. */
  lookup = $state.raw<LookupState>(IDLE_LOOKUP);

  /**
   * The table of the viewed terminal: what is known about each commodity it trades, from UEX and from my
   * diary. It follows the data and the 15 s clock, and never throws: a failure is logged and shows an empty table.
   */
  terminalRows = $derived.by((): TerminalRow[] => {
    const terminalId = this.viewTerminalId;
    if (terminalId === null) return [];
    const s = this.settings;
    try {
      return buildTerminalRows(this.market, this.reference, terminalId, {
        now: this.rowsNow,
        thresholds: { hotMin: s.hotMin, warmMin: s.warmMin, coolingMin: s.coolingMin },
        serverChangedAt: s.serverChangedAt,
        refillFullMin: s.refillFullMin,
      });
    } catch (err) {
      this.#log.error('ui', 'cannot build the terminal rows', { terminalId, err });
      return [];
    }
  });

  /**
   * The best ROI of each commodity of the table that is drawn (the viewed terminal, `terminalSide`), by commodity id: the
   * search of the options over the market that is in memory, with the settings of the options and without their limit on
   * the number (`vm/row-roi.ts`). It hangs on the market, the viewed terminal, the side, the settings and the 15 s clock of
   * the rows (the prices cool), never on the one-second clock; it never throws: a failure is logged and shows no values.
   */
  rowRoi = $derived.by((): ReadonlyMap<number, RowRoi> => {
    const terminalId = this.viewTerminalId;
    if (terminalId === null) return NO_ROW_ROI;
    try {
      return rowRoiMap(this.market, terminalId, this.terminalSide, this.routeCtx(undefined, this.rowsNow));
    } catch (err) {
      this.#log.error('ui', 'cannot count the ROI of the rows', { terminalId, err });
      return NO_ROW_ROI;
    }
  });

  /**
   * What the mini line and the "Рейс" section say: the location (and the target) and what the session that is going has
   * earned without a run; the phase, the cargo, the target, the expectation and the rate during one. Follows the data and
   * the one-second clock; nothing is shown before the start.
   */
  strip = $derived.by((): StripModel => (
    this.phase === 'ready'
      ? stripModel(this.activeRun, this.market, this.reference, this.settings, this.routeCtx(), stats.sessionNow)
      : { kind: 'idle', location: '', target: null, session: null }
  ));

  // ---- window and screen ------------------------------------------------------------------------
  mode = $state<WindowMode>('mini');
  /** The main screen or the settings (the settings keep the window open: they count as busy). */
  view = $state<View>('main');
  /**
   * The side of the viewed terminal that the table draws: what can be bought here or what can be sold here. It starts
   * as "buy"; the player switches it, and a terminal that has no rows on it brings the other side (`#settleSide`).
   */
  terminalSide = $state<Side>('buy');
  /** The keyboard is with the window: the player is typing. */
  keyboardHeld = $state(false);
  /**
   * Who needs the keyboard (see `HoldEffects` in vm/keyboard-holds.ts). The only way to the keyboard: the
   * window never takes the focus from the game by itself. `hold('field')` takes it, `release` gives it back.
   */
  readonly keyboard: KeyboardHolds = createKeyboardHolds(
    {
      take: () => this.#takeKeyboard(),
      give: (restore) => giveKeyboard(this.#log, restore),
    },
    (held) => {
      this.keyboardHeld = held;
      if (!held) this.#touch();
    },
    { settleMs: FOCUS_SETTLE_MS },
  );
  triggerErrors = $state<Record<TriggerName, string | null>>({ panel: null, depart: null, arrive: null });
  /**
   * What the Terminal section shows (spec 14.2); not persisted. The current location is `settings.currentTerminalId`.
   * Change it through `#showTerminal`, which also settles the side of the table.
   */
  viewTerminalId = $state<number | null>(null);
  phase = $state<Phase>('booting');
  /** One line for the strip while the application starts. */
  bootStatus = $state('Запуск…');
  bootError = $state<string | null>(null);
  notice = $state<Notice | null>(null);
  /** The reference is being downloaded by the button. */
  referenceBusy = $state(false);

  // ---- internals --------------------------------------------------------------------------------
  /** The queue of everything that can touch UEX; reached only through `withUex`. */
  readonly #uexQueue = createRequestQueue();
  /** Binding the trigger keys is one job at a time: two overlapping changes must not leave two listeners. */
  readonly #triggerQueue = createRequestQueue();
  #log: Logger = createLogger({ write() {} });
  #data: DataDeps | null = null;
  /** Mode changes come from the mini bar, the keys, the tray, the buttons and the idle timer; they run one after another. */
  readonly #modeQueue = createRequestQueue();
  /** The window is placed one rectangle at a time, each job with the content as it is when its turn comes. */
  readonly #fitQueue = createRequestQueue();
  /** Opening and closing a section is written to the settings one at a time, each from the state its turn finds. */
  readonly #sectionQueue = createRequestQueue();
  /** Trades and marks are written one at a time, each after the run was read again (see the header of this file). */
  readonly #tradeQueue = createRequestQueue();
  #flashTimer: ReturnType<typeof setTimeout> | undefined;
  #confirmTimer: ReturnType<typeof setTimeout> | undefined;
  /** What "yes" does for the question on screen. */
  #confirmAction: (() => void | Promise<void>) | null = null;
  #shown = false;
  /** The first show failed and is waiting for another try (made by the next request to change the window). */
  #showFailed = false;
  /** The window was shown for the first time: from now on it is fitted to its content. */
  #windowReady = false;
  /** The window is on the screen (not hidden). */
  #visible = false;
  /** The content of the window as the last measurement said; `null` before the first one. */
  #content: Size | null = null;
  /** The player is dragging the window: it must not be placed by anything else until the drag ends. */
  #dragging = false;
  /** Unix seconds of the last click or movement over the window, or of the moment it was expanded. */
  #lastActivityAt = nowSec();
  #pointerInside = false;
  /** The root of the interface measures itself (set by `App.svelte`); `null` before it is mounted. */
  #measureRoot: (() => Size) | null = null;
  /** A look at the real focus of the window is planned after a loss of focus that was taken for an echo. */
  #focusCheck: ReturnType<typeof setTimeout> | undefined;
  /** Reasons why the window must not fold by itself (a trade dialog is open). */
  readonly #busy = new Set<string>();
  /** The sections that are open, from the setting. */
  #openIds = $derived(parseOpenSections(this.settings.openSections));
  #noticeTimer: ReturnType<typeof setTimeout> | undefined;
  #backgroundStarted = false;
  /** The market is being read again in the middle of a price sync. */
  #reloadingMidSync = false;
  /** Lookups overlap when the player asks again; only the newest one may show its answer. */
  readonly #latestLookup = createLatestRequest();

  // ---- dependencies -----------------------------------------------------------------------------

  /** The logger is there from the very start, before the database. */
  init(log: Logger): void {
    this.#log = log;
    setInterval(() => {
      this.now = nowSec();
      this.#collapseWhenIdle();
    }, 1000);
    setInterval(() => {
      this.rowsNow = nowSec();
    }, ROWS_TICK_MS);
  }

  get log(): Logger {
    return this.#log;
  }

  /** `boot()` calls it once the database is open and migrated. */
  attach(data: DataDeps): void {
    this.#data = data;
  }

  /** Both syncs worked (or have not failed yet). The header says "UEX недоступен" when this is false. */
  get uexOk(): boolean {
    return this.referenceOk && this.pricesOk;
  }

  /** Database, UEX client, logger and clock, in the shape the data services take. Private on purpose. */
  #syncDeps(): SyncDeps {
    if (this.#data === null) throw new Error('the database is not open yet');
    return { ...this.#data, log: this.#log };
  }

  /**
   * The one entry point for anything that may touch UEX: runs `job` after every job queued before it.
   * A job must not call `withUex` or the sync methods itself (see the header of this file).
   */
  withUex<T>(job: () => Promise<T>): Promise<T> {
    return this.#uexQueue(job);
  }

  /**
   * What `suggestFrom` / `suggestTo` need: the data services' dependencies plus the reference and the
   * settings as they are now. Run the call itself inside `withUex`: it may fetch distances.
   */
  suggestDeps(): SuggestDeps {
    return {
      ...this.#syncDeps(),
      reference: this.reference,
      settings: this.settings,
      ownMedian: stats.ownMedian,
    };
  }

  /** Applies the loaded settings; the viewed terminal starts at the current location. */
  setSettings(settings: Settings): void {
    this.settings = settings;
    this.#showTerminal(settings.currentTerminalId);
  }

  /**
   * The numbers the route services need, from the settings and the loaded data. `now` is the one-second clock unless the
   * caller counts on a slower one (a screen that recounts something heavy every 15 seconds passes `rowsNow`, and then does
   * not depend on the one-second clock).
   */
  routeCtx(freeScu: number = this.settings.scuCapacity, now: number = this.now): RouteCtx {
    const s = this.settings;
    return {
      now,
      thresholds: { hotMin: s.hotMin, warmMin: s.warmMin, coolingMin: s.coolingMin },
      serverChangedAt: s.serverChangedAt,
      refillFullMin: s.refillFullMin,
      settings: {
        starSystemId: s.starSystemId, budget: s.budget,
        quantumSpeedKkms: s.quantumSpeedKkms, overheadMin: s.overheadMin, overheadEmptyMin: s.overheadEmptyMin,
        topN: s.topN, sort: s.sort,
      },
      freeScu,
      terminals: this.reference.terminals,
      distances: this.distances,
      ownMedian: stats.ownMedian,
    };
  }

  // ---- loading ----------------------------------------------------------------------------------

  /** Reference, market, distances and the active run, from the database. Throws when the database does. */
  async loadFromDb(): Promise<void> {
    const { db } = this.#syncDeps();
    this.reference = await loadReference(db);
    await this.#loadMarketData();
    this.activeRun = await getActiveRun(db);
    await stats.reload('data loaded'); // never throws; from here on the statistics follow `activeRun` by themselves
    // the rows of the viewed terminal are known only now: a terminal that has nothing on the "buy" side opens on "sell"
    this.#settleSide();
  }

  async #loadMarketData(): Promise<void> {
    const { db } = this.#syncDeps();
    this.market = await loadMarket(db);
    this.distances = await loadDistances(db);
    this.pricesSyncedAt = metaSeconds(await getMeta(db, META_PRICES_SYNCED_AT));
  }

  /**
   * Reads the distances from the database again: the fetching step of a lookup stores the ones UEX answered, and the rate of the
   * run and the alternatives of "sell here or fly on" count with `distances`. A read of the database, not a request to UEX, so
   * it needs no place in the UEX queue (and is called after the job of the queue, not inside it). Never throws.
   */
  async #reloadDistances(): Promise<void> {
    try {
      this.distances = await loadDistances(this.#syncDeps().db);
    } catch (err) {
      this.#log.error('ui', 'cannot reload the distances', { err });
    }
  }

  /** Reloads prices, own observations, distances and the age of the prices; call it after anything wrote them. */
  async reloadMarket(): Promise<void> {
    try {
      await this.#loadMarketData();
    } catch (err) {
      this.#log.error('ui', 'cannot reload the market', { err });
      this.notify('Не удалось обновить данные рынка. Подробности в логе.', 'error');
    }
  }

  // ---- UEX syncs --------------------------------------------------------------------------------

  /**
   * Downloads the reference and loads it. Never throws: `null` when it worked, otherwise the Russian
   * sentence to show. A failed download marks the reference sync as failed (`referenceOk`); the prices
   * keep their own health.
   */
  async syncReferenceNow(): Promise<string | null> {
    try {
      await this.withUex(() => syncReference(this.#syncDeps()));
    } catch (err) {
      this.referenceOk = false;
      this.#log.warn('ui', 'reference sync failed', { err });
      return uexErrorText(err);
    }
    this.referenceOk = true;
    try {
      this.reference = await loadReference(this.#syncDeps().db);
    } catch (err) {
      // the download worked; it is the local database that failed
      this.#log.error('ui', 'cannot load the reference after the sync', { err });
      return 'Не удалось прочитать справочник из локальной базы. Подробности в логе.';
    }
    await this.reloadMarket();
    return null;
  }

  /**
   * Downloads the prices and reloads the market. Never throws; a failure marks the price sync as failed (`pricesOk`).
   * One at a time: a call while a sync is going does nothing. `priceSync` says how far it is, from the moment of the
   * call (the sync may first wait for its turn in the queue of UEX) until the market is reloaded.
   */
  async syncPricesNow(): Promise<void> {
    if (this.priceSync.running) {
      this.#log.debug('ui', 'price sync already running, skipped');
      return;
    }
    this.priceSync = { ...PRICE_SYNC_IDLE, running: true, unfetched: this.priceSync.unfetched };
    let unfetched = 0;
    try {
      const result = await this.withUex(() => {
        // The first launch: the cache has no price of UEX, and ~70 requests are before the first table. The market is read again
        // as the sync goes (a read of the database: nothing here asks the UEX queue, whose job this is).
        const startedEmpty = this.market.uex.size === 0;
        return syncPrices(this.#syncDeps(), (progress) => {
          this.priceSync = { running: true, done: progress.done, total: progress.total, unfetched: this.priceSync.unfetched };
          if (reloadsMidSync(startedEmpty, progress)) void this.#reloadWhileSyncing();
        });
      });
      this.pricesOk = result.failed === 0;
      unfetched = result.unfetched;
    } catch (err) {
      this.pricesOk = false;
      this.#log.warn('ui', 'price sync failed', { err });
    }
    try {
      await this.#reloadAndSettle();
    } finally {
      this.priceSync = { ...PRICE_SYNC_IDLE, unfetched };
    }
  }

  /** The market is read again in the middle of a price sync (not when the previous such read is still going). Never throws. */
  async #reloadWhileSyncing(): Promise<void> {
    if (this.#reloadingMidSync) return;
    this.#reloadingMidSync = true;
    try {
      await this.#reloadAndSettle();
    } finally {
      this.#reloadingMidSync = false;
    }
  }

  /**
   * Reads the market again; a table of the viewed terminal that said "Нет цен" and has rows now picks its side again (the
   * market that arrives late: the first sync, which the player does not wait for). A table that had rows keeps the side.
   */
  async #reloadAndSettle(): Promise<void> {
    const sides = sideCounts(this.terminalRows);
    const wasEmpty = sides.buy === 0 && sides.sell === 0;
    await this.reloadMarket();
    if (wasEmpty) this.#settleSide();
  }

  /** The click on the indicator of UEX in the header: refreshes the prices now. A click while a sync is going does nothing. */
  async refreshPrices(): Promise<void> {
    const running = this.priceSync.running;
    this.#log.info('ui', 'refresh prices', { running });
    if (!running) await this.syncPricesNow();
  }

  /**
   * The syncs that run in the background after the start: the reference when it is a day old, the prices
   * when they are an hour old, then the prices every hour. Failures never surface; the header shows
   * the age of the data.
   */
  async startBackgroundSync(): Promise<void> {
    if (this.#backgroundStarted) return;
    this.#backgroundStarted = true;
    setInterval(() => void this.syncPricesNow(), PRICE_SYNC_INTERVAL_MS);

    const { db, now } = this.#syncDeps();
    let plan = { reference: false, prices: false };
    try {
      plan = syncPlan(
        await getMeta(db, META_REFERENCE_SYNCED_AT),
        await getMeta(db, META_PRICES_SYNCED_AT),
        now(),
      );
    } catch (err) {
      this.#log.error('ui', 'cannot read the sync marks', { err });
    }
    this.#log.info('ui', 'background sync', plan);
    if (plan.reference) await this.syncReferenceNow();
    if (plan.prices) await this.syncPricesNow();
  }

  /** The "Обновить справочник" button. */
  async refreshReference(): Promise<void> {
    if (this.referenceBusy) return;
    this.#log.info('ui', 'refresh reference');
    this.referenceBusy = true;
    try {
      const failure = await this.syncReferenceNow();
      this.notify(failure ?? 'Справочник обновлён.', failure === null ? 'info' : 'error');
    } finally {
      this.referenceBusy = false;
    }
  }

  // ---- window -----------------------------------------------------------------------------------

  get layout(): WindowLayout {
    const s = this.settings;
    return {
      corner: s.stripCorner,
      offset: { dx: s.windowDx, dy: s.windowDy },
      showMini: s.showStrip,
      opacity: s.opacity,
    };
  }

  get windowLocked(): boolean {
    return this.settings.windowLocked;
  }

  /** The window is on the screen when it is expanded, or collapsed with the mini bar switched on. */
  #wantVisible(): boolean {
    return this.mode === 'expanded' || this.settings.showStrip;
  }

  /** Marks "the player is here now": the idle time counts from this moment. */
  #touch(): void {
    this.#lastActivityAt = nowSec();
  }

  /**
   * Shows the window for the first time, whatever the start came to: the player must always see something
   * (with the mini bar switched off, the window is prepared and stays hidden until it is expanded).
   * A failure is logged and allows another try: the next change of the mode makes it (`#changeMode`).
   */
  ensureShown(): void {
    if (this.#shown) return;
    this.#shown = true;
    this.#showFailed = false;
    void this.#modeQueue(async () => {
      try {
        const visible = this.#wantVisible();
        await showWindow({ ...this.layout, showMini: visible }, this.#log);
        this.#visible = visible;
        this.#windowReady = true;
        void this.#refit();
      } catch {
        // already logged by the window layer
        this.#shown = false;
        this.#showFailed = true;
      }
    });
  }

  /** Runs one mode change after the previous ones; keeps the window and `mode` consistent. */
  #changeMode(pick: (current: WindowMode) => WindowMode, reason: string): Promise<void> {
    return this.#modeQueue(async () => {
      // A first show that failed was set back for another try (`ensureShown`), and nothing else would make it: the tray and the
      // key of the panel come here, so every request to change the window asks for the show again. It runs after this job, when
      // `mode` is what the request made it. (A show that is still going, or has not started yet, is not repeated.)
      if (this.#showFailed) this.ensureShown();
      const from = this.mode;
      const next = pick(from);
      if (next === from) return;
      this.#log.info('window', 'mode change', { from, to: next, reason });
      if (next === 'mini') {
        this.view = 'main';
        if (this.confirm !== null) this.answer(false, 'collapse');
        // The window shrinks under the cursor and may never report that the cursor left it; the idle timer must not
        // wait for the cursor of a window that is not there any more (the next movement over it says "inside" again).
        this.#pointerInside = false;
        // the player is done with the window: the keyboard goes back to the game, the window may fold
        await this.keyboard.release('field').catch(() => undefined); // a failure is logged by the window layer
      }
      this.mode = next;
      this.#touch();
      // before the first show the first show decides what is visible
      if (!this.#windowReady) return;
      try {
        // A hidden window is not painting, so nothing reports the size of the expanded view; lay it out, measure it
        // and put the window at that size BEFORE it is shown, or its first frame would be a clipped corner.
        if (next === 'expanded' && !this.#visible) await this.#placeBeforeShow();
        await this.#syncVisibility();
      } catch {
        this.mode = from; // already logged by the window layer
      }
    });
  }

  /** The root of the interface says how to measure itself (`App.svelte`). */
  setRootMeasurer(measure: (() => Size) | null): void {
    this.#measureRoot = measure;
  }

  /**
   * The expanded view is in the DOM (the caller has set `mode`): waits for Svelte to put it there, measures it (a
   * measurement forces the layout, painting or not) and places the window at that size. A hidden window can be placed.
   */
  async #placeBeforeShow(): Promise<void> {
    await tick();
    const size = this.#measureRoot?.();
    if (size === undefined || !(size.width > 0) || !(size.height > 0)) return;
    this.#content = size;
    await this.#refit();
  }

  /** Shows or hides the window as the mode and the "show the mini bar" setting say. */
  async #syncVisibility(): Promise<void> {
    const visible = this.#wantVisible();
    if (visible === this.#visible) return;
    await setWindowVisible(visible, this.#log);
    this.#visible = visible;
  }

  /** The "развернуть" of the mini bar, the tray, a key. */
  expand(reason: string): Promise<void> {
    this.#log.info('ui', 'expand', { reason });
    return this.#changeMode(() => 'expanded', reason);
  }

  /** The "свернуть" button and everything else that puts the window away. */
  collapse(reason: string): Promise<void> {
    this.#log.info('ui', 'collapse', { reason });
    return this.#changeMode(() => 'mini', reason);
  }

  toggleMode(): Promise<void> {
    this.#log.info('ui', 'toggle window');
    return this.#changeMode((current) => (current === 'expanded' ? 'mini' : 'expanded'), 'trigger');
  }

  openSettings(): void {
    if (this.view === 'settings') return;
    this.#log.info('ui', 'open settings');
    if (this.confirm !== null) this.answer(false, 'settings');
    this.view = 'settings';
    this.#touch();
  }

  closeSettings(): void {
    if (this.view === 'main') return;
    this.#log.info('ui', 'close settings');
    this.view = 'main';
    this.#touch();
  }

  /**
   * The content of the window measured (CSS pixels, rounded up); the window takes this size in its corner.
   * Called by the root of the interface whenever its size changes. Before the first show only the size is kept.
   */
  fit(content: Size): void {
    this.#content = content;
    void this.#refit();
  }

  /**
   * Places the window by the content measured last. Never throws: a failure is logged by the window layer.
   * Nothing is placed before the window was shown for the first time (the first show places it itself). While the
   * window is being dragged nothing places it (it would jump under the cursor): the request is dropped, and the
   * end of the drag fits the window again.
   */
  #refit(): Promise<void> {
    return this.#fitQueue(async () => {
      if (!this.#windowReady || this.#content === null || this.#dragging) return;
      try {
        await fitWindow(this.#content, this.layout, this.#log);
      } catch {
        // already logged by the window layer
      }
    });
  }

  // ---- where the window stands ------------------------------------------------------------------------

  /**
   * Saves a new anchor of the window (the corner and the distances from it) as one change: the settings are
   * written, then `settings` changes once. Returns the sentence to show when it was not saved, `null` when it was.
   * It does not place the window: the caller does, with `#refit`.
   */
  async #setAnchor(corner: Corner, dx: number, dy: number): Promise<string | null> {
    const next = { stripCorner: corner, windowDx: dx, windowDy: dy };
    for (const key of Object.keys(next) as Array<keyof typeof next>) {
      const invalid = validateSetting(key, next[key], this.settings);
      if (invalid !== null) {
        this.#log.warn('ui', 'setting rejected', { key, value: next[key], reason: invalid });
        return invalid;
      }
    }
    try {
      const { db } = this.#syncDeps();
      // only what changed is written
      if (this.settings.stripCorner !== corner) await saveSetting(db, this.#log, 'stripCorner', corner);
      if (this.settings.windowDx !== dx) await saveSetting(db, this.#log, 'windowDx', dx);
      if (this.settings.windowDy !== dy) await saveSetting(db, this.#log, 'windowDy', dy);
    } catch (err) {
      this.#log.error('ui', 'cannot save the position of the window', { ...next, err });
      const text = 'Не удалось сохранить положение окна. Подробности в логе.';
      this.notify(text, 'error');
      return text;
    }
    this.settings = { ...this.settings, ...next };
    return null;
  }

  /** The corner of the settings: the window goes to that corner, 16 px from its edges (the offsets are reset). */
  async setCorner(corner: Corner): Promise<string | null> {
    this.#log.info('ui', 'set corner', { corner });
    const failure = await this.#setAnchor(corner, WINDOW_MARGIN, WINDOW_MARGIN);
    if (failure === null) await this.#refit();
    return failure;
  }

  /** The lock: a locked window cannot be moved by its grip. */
  async toggleWindowLock(): Promise<void> {
    const locked = !this.settings.windowLocked;
    this.#log.info('ui', 'toggle window lock', { locked });
    await this.updateSetting('windowLocked', locked);
  }

  /**
   * The player pressed the grip. Returns where the window is and how big the monitor is (logical pixels) so that
   * the drag can work out new places, or `null` when nothing may be dragged (locked, not shown yet). From now on
   * nothing but the drag places the window; every drag must end with `dragEnd`.
   */
  async dragBegin(): Promise<{ rect: Rect; monitor: Size } | null> {
    if (this.settings.windowLocked || !this.#windowReady || this.#dragging) return null;
    this.#dragging = true;
    // a placement that is already under way finishes first, so that it cannot land on top of the first move
    await this.#fitQueue(async () => undefined);
    const geometry = windowGeometry();
    if (geometry === null) this.#dragging = false;
    return geometry;
  }

  /** The window follows the pointer (at most once per frame); not logged. A failure is logged by the window layer. */
  async dragMove(rect: Rect): Promise<void> {
    try {
      await moveWindow(rect, this.#log);
    } catch {
      // already logged by the window layer
    }
  }

  /**
   * The drag is over. With the rect where the window ended the anchor is worked out and saved (one `ui` line),
   * with `null` the window was only pressed and stays. Either way the window is fitted to its content again,
   * with the requests that came during the drag.
   */
  async dragEnd(rect: Rect | null): Promise<void> {
    try {
      const monitor = windowGeometry()?.monitor;
      if (rect !== null && monitor !== undefined) {
        const anchor = anchorFromRect(monitor, rect);
        this.#log.info('ui', 'window moved', anchor);
        await this.#setAnchor(anchor.corner, anchor.dx, anchor.dy);
      }
    } finally {
      this.#dragging = false;
    }
    await this.#refit();
  }

  /** The cursor is over the window or has left it. Any movement over the window counts as activity; not logged. */
  pointer(inside: boolean): void {
    this.#pointerInside = inside;
    this.#touch();
  }

  /** Something needs the window to stay as it is (a dialog is open): it does not fold by itself while that lasts. */
  holdBusy(why: string): void {
    this.#busy.add(why);
  }

  releaseBusy(why: string): void {
    if (this.#busy.delete(why)) this.#touch();
  }

  /** Once a second: the expanded window folds into the mini bar when nobody has touched it for the time of the setting. */
  #collapseWhenIdle(): void {
    const idleSec = this.settings.idleCollapseSec;
    const collapse = shouldCollapse({
      mode: this.mode,
      idleSec,
      now: nowSec(),
      pointerInside: this.#pointerInside,
      lastActivityAt: this.#lastActivityAt,
      keyboardHeld: this.keyboardHeld,
      busy: this.#busy.size > 0 || this.view === 'settings',
    });
    if (collapse) void this.#changeMode(() => 'mini', `idle ${idleSec} s`);
  }

  /** `take` of the keyboard holds: a key of the game that is still down must not type into a field. */
  async #takeKeyboard(): Promise<void> {
    resetHeldKeys();
    await takeKeyboard(this.#log);
  }

  /**
   * The window lost the focus. When the player clicked the game, the game already has the focus, so it is not pulled
   * back by force; the window only stops waiting for the keyboard (the window stays as it is). When it is only the
   * echo of our own take or give (see `FOCUS_SETTLE_MS`), nothing changes now; the real focus is looked at once the
   * echo time is over, so that a real loss that was taken for an echo does not leave the window focusable for good.
   */
  #onFocusLost(): void {
    void this.keyboard
      .drop()
      .then((dropped) => {
        if (dropped) this.#log.info('window', 'focus lost: the player went to the game, the keyboard is dropped');
        else if (this.keyboard.held) this.#checkFocusLater();
      })
      .catch(() => undefined); // a failure is logged by the window layer
  }

  /** Once the echo time is over: a window that holds the keyboard but has not the focus has lost it for real. */
  #checkFocusLater(): void {
    if (this.#focusCheck !== undefined) return;
    this.#focusCheck = setTimeout(() => {
      this.#focusCheck = undefined;
      if (!this.keyboard.held) return;
      void isWindowFocused(this.#log).then((focused) => {
        if (focused) return;
        this.#onFocusLost(); // asks `drop` again; still inside an echo time of a newer take or give, it waits once more
      });
    }, FOCUS_SETTLE_MS + 50);
  }

  /** Starts listening for focus changes and for the tray's "Показать панель"; returns what stops it. */
  async watchWindow(): Promise<() => void> {
    const stops: Array<() => void> = [];
    try {
      stops.push(await watchFocus(() => this.mode, this.#log, () => this.#onFocusLost()));
    } catch (err) {
      this.#log.error('app', 'cannot listen for focus changes', { err });
    }
    try {
      stops.push(await listen('tray://show-panel', () => {
        this.#log.info('app', 'tray: show panel');
        void this.expand('tray');
      }));
    } catch (err) {
      this.#log.error('app', 'cannot listen for the tray event', { err });
    }
    return () => stops.forEach((stop) => stop());
  }

  // ---- sections of the expanded window ------------------------------------------------------------

  /** Whether the section is open; the state is kept between runs (setting `openSections`). */
  sectionOpen(id: string): boolean {
    return this.#openIds.has(id);
  }

  /** Opens a closed section, closes an open one; the state is saved. */
  toggleSection(id: string): Promise<void> {
    return this.#sectionQueue(async () => {
      const next = toggledSection(this.#openIds, id);
      this.#log.info('ui', 'toggle section', { id, open: next.has(id.trim()) });
      await this.updateSetting('openSections', serializeOpenSections(next));
    });
  }

  /** Opens the section when it is closed (the answer of a lookup is shown open); an open one stays as it is. */
  openSection(id: string): Promise<void> {
    return this.#sectionQueue(async () => {
      if (this.#openIds.has(id.trim())) return;
      this.#log.info('ui', 'open section', { id });
      await this.updateSetting('openSections', serializeOpenSections(new Set([...this.#openIds, id])));
    });
  }

  // ---- triggers ---------------------------------------------------------------------------------

  /**
   * Binds the optional trigger keys from the settings; what is wrong with each key lands in
   * `triggerErrors` as text that is fit for the screen (the raw text of a failure stays in the log).
   * One binding at a time, each with the settings as they are when its turn comes.
   */
  applyTriggers(): Promise<void> {
    return this.#triggerQueue(async () => {
      const s = this.settings;
      const outcome = await bindTriggers(
        { panel: s.hotkeyPanel, depart: s.hotkeyDepart, arrive: s.hotkeyArrive },
        {
          panel: () => void this.toggleMode(),
          depart: () => void this.mark('depart'),
          arrive: () => void this.mark('arrive'),
        },
        this.#log,
      );
      const shown: Record<TriggerName, string | null> = {
        panel: triggerErrorText(outcome.panel),
        depart: triggerErrorText(outcome.depart),
        arrive: triggerErrorText(outcome.arrive),
      };
      for (const name of Object.keys(outcome) as TriggerName[]) {
        if (outcome[name] !== shown[name]) {
          this.#log.warn('ui', 'trigger error not shown as it is', { trigger: name, raw: outcome[name], shown: shown[name] });
        }
      }
      this.triggerErrors = shown;
    });
  }

  // ---- actions of the player ----------------------------------------------------------------------

  /** The location search of the header: only changes what the Terminal section shows. */
  setViewTerminal(id: number): void {
    this.#log.info('ui', 'view terminal', { terminalId: id });
    this.#showTerminal(id);
  }

  /** "Я здесь": the viewed terminal becomes the current location. */
  async setCurrentTerminal(id: number): Promise<void> {
    this.#log.info('ui', 'set current terminal', { terminalId: id });
    if ((await this.updateSetting('currentTerminalId', id)) === null) this.#showTerminal(id);
  }

  /** The Buy / Sell switch of the Terminal section. */
  setTerminalSide(side: Side): void {
    if (side === this.terminalSide) return;
    this.#log.info('ui', 'terminal side', { from: this.terminalSide, to: side });
    this.terminalSide = side;
  }

  /**
   * Makes `id` the viewed terminal. The side of the table follows the rows of the new terminal: the side the player
   * had chosen stays while the new terminal has rows on it, otherwise the other side (when that has some) takes its place.
   */
  #showTerminal(id: number | null): void {
    this.viewTerminalId = id;
    this.#settleSide();
  }

  /** The drawn side is one that has rows, when the viewed terminal has rows on either. */
  #settleSide(): void {
    this.terminalSide = resolveTerminalSide(this.terminalSide, sideCounts(this.terminalRows));
  }

  /** "Сменил сервер": own prices older than now are cold from this moment on. */
  async serverChanged(): Promise<void> {
    const ts = this.#syncDeps().now();
    this.#log.info('ui', 'server changed', { ts });
    if ((await this.updateSetting('serverChangedAt', ts)) === null) {
      this.notify('Отмечено: сервер сменился, свои цены до этого момента считаются холодными.', 'info');
    }
  }

  // ---- the Terminal and the Options sections -----------------------------------------------------

  /**
   * Writes a price the player saw (own observation, with the quantity only when typed), reloads the market (and, in the
   * background, the statistics: a price is a record of the session) and
   * makes that terminal the VIEWED one (the current location stays where it is). It asks no lookup: prices are
   * entered quietly, one after another, and the "Варианты" on screen are not recounted nor closed (spec 14.8).
   * Returns the sentence to show when the price was not saved, `null` when it was. The market is reloaded in
   * either case, so the table shows what is stored.
   */
  async recordPrice(input: PriceInput): Promise<string | null> {
    this.#log.info('ui', 'record price', input);
    let failure: string | null = null;
    try {
      const { db, log, now } = this.#syncDeps();
      await addObservation(db, log, { ts: now(), ...input });
    } catch (err) {
      this.#log.error('ui', 'cannot record the price', { ...input, err });
      failure = RECORD_FAILED;
    }
    await this.reloadMarket();
    this.rowsNow = nowSec();
    if (failure !== null) return failure;

    // a price is a record of the session: its end moves, so the session of the mini line goes on while the player writes prices
    // (one read of the statistics per price; it never throws and the entry does not wait for it)
    void stats.reload('price recorded');
    this.#showTerminal(input.terminalId);
    return null;
  }

  /**
   * Asks where to sell (`from`) or where to buy (`to`) for the terminal of the request, for one commodity or all
   * of them, with the whole cargo space of the ship. Never throws; the answer lands in `lookup`, in two steps
   * (`answerLookup`): at once from the distances that are already known (marked preliminary while some are
   * missing), then, when some are missing, ONE fetching of them inside the UEX queue. A newer request replaces an
   * older one: the answer of the older one is dropped, and a step that has not started yet is not started.
   * Nothing is run while the cargo space is not set (the section says so). A request of the player opens the
   * section; the repeat after a setting changed (`reason`) leaves it as the player has it.
   */
  async runLookup(request: LookupRequest, reason = 'player'): Promise<void> {
    const isNewest = this.#latestLookup.begin();
    const title = lookupTitle(request, this.reference, this.settings.nearby);
    this.#log.info('ui', 'lookup', { ...request, reason });
    if (reason !== LOOKUP_REPEAT) void this.openSection(OPTIONS_SECTION);

    const quiet = { loading: false, error: null, preliminary: false, progress: null };
    if (this.settings.scuCapacity <= 0) {
      this.#log.info('ui', 'lookup not run, the cargo space is not set', { ...request });
      this.lookup = { request, title, options: [], ...quiet };
      return;
    }
    // the same request asked again keeps its answer on screen until the new one comes
    const same = sameRequest(this.lookup.request, request);
    this.lookup = { request, title, options: same ? this.lookup.options : [], ...quiet, loading: true, preliminary: same && this.lookup.preliminary };

    const suggest = (run: SuggestRun) => {
      const freeScu = this.settings.scuCapacity;
      const deps = this.suggestDeps();
      const commodityId = request.commodityId ?? undefined;
      return request.kind === 'from'
        ? suggestFromDetailed(deps, request.terminalId, freeScu, commodityId, run)
        : suggestToDetailed(deps, request.terminalId, freeScu, commodityId, run);
    };
    await answerLookup({
      suggest,
      withUex: (job) => this.withUex(job),
      isNewest,
      canRun: () => this.settings.scuCapacity > 0,
      distancesChanged: () => this.#reloadDistances(),
      show: {
        answer: (options, preliminary) => {
          this.lookup = { request, title, options, ...quiet, preliminary, progress: preliminary ? this.lookup.progress : null };
        },
        progress: (progress) => {
          this.lookup = { ...this.lookup, progress };
        },
        failed: (err) => {
          this.#log.error('ui', 'lookup failed', { ...request, err });
          this.lookup = { request, title, options: [], ...quiet, error: err instanceof UexError ? uexErrorText(err) : LOOKUP_FAILED };
        },
        refineFailed: (err) => {
          this.#log.error('ui', 'lookup: the distances could not be fetched, the preliminary answer stays', { ...request, err });
          this.lookup = { ...this.lookup, progress: null };
          this.notify(err instanceof UexError ? uexErrorText(err) : REFINE_FAILED, 'error');
        },
      },
    });
  }

  /** The same lookup again, after a setting that shapes its answer changed. Nothing to do before the first one. */
  async rerunLookup(): Promise<void> {
    const { request } = this.lookup;
    if (request !== null) await this.runLookup(request, LOOKUP_REPEAT);
  }

  /** The cross of the "Варианты" section: the answer goes away, and so does the section; the table stays. */
  closeLookup(): void {
    if (this.lookup.request === null) return;
    this.#log.info('ui', 'close lookup');
    this.#latestLookup.begin(); // an answer that is still on its way has nowhere to land
    this.lookup = IDLE_LOOKUP;
  }

  /**
   * "Маршрут": where to take cargo from the CURRENT location, whatever the table shows. The location
   * becomes the viewed terminal. Without a current location the player is asked to pick one.
   */
  async newRoute(): Promise<void> {
    const terminalId = this.settings.currentTerminalId;
    this.#log.info('ui', 'new route', { currentTerminalId: terminalId });
    if (terminalId === null || !this.reference.terminals.has(terminalId)) {
      this.notify(NO_CURRENT_LOCATION, 'info');
      return;
    }
    this.#showTerminal(terminalId);
    await this.runLookup({ kind: 'from', terminalId, commodityId: null, price: null }, 'new route');
  }

  /**
   * "Цель": the terminal the next trip is flown to; `null` takes the target away (a run that goes on keeps going).
   * The "Рейс" section shows the target, so a new one opens that section: the effect of the click is seen at once. Taking it
   * away says nothing: the section or the mark of the target going away is the answer.
   */
  async setTarget(terminalId: number | null): Promise<void> {
    if (terminalId === null) {
      this.#log.info('ui', 'clear target');
      await this.updateSetting('targetTerminalId', null);
      return;
    }
    this.#log.info('ui', 'set target', { terminalId });
    if ((await this.updateSetting('targetTerminalId', terminalId)) === null) void this.openSection(RUN_SECTION);
  }

  // ---- trades and the run ----------------------------------------------------------------------------------

  /** What the trade service takes: the database and the clock of the application, and the settings as they are now. */
  #tradeDeps(): TradeDeps {
    const { db, log, now } = this.#syncDeps();
    return { db, log, now, settings: this.settings };
  }

  /**
   * Reads the active run again after a trade, and keeps the one the state has when the database says the same (whoever follows
   * `activeRun` by identity, the statistics, is woken only by a change). The market is read again only when something may have
   * been written: a refusal of the service (`TradeError`) wrote nothing, a failure of the database may have written a part.
   */
  async #reloadRun(mayHaveWritten: boolean): Promise<void> {
    try {
      const read = await getActiveRun(this.#syncDeps().db);
      if (!sameRun(read, this.activeRun)) this.activeRun = read;
    } catch (err) {
      this.#log.error('ui', 'cannot read the active run', { err });
      this.notify(RUN_READ_FAILED, 'error');
    }
    if (!mayHaveWritten) return;
    await this.reloadMarket();
    this.rowsNow = nowSec();
  }

  /** The sentence for a trade that was not written: the text of a refusal of the service, else a general one (the cause is in the log). */
  #tradeFailure(what: string, err: unknown, context: Record<string, unknown>): string {
    if (err instanceof TradeError) {
      this.#log.info('ui', 'trade refused', { what, code: err.code, ...context });
      return err.message;
    }
    this.#log.error('ui', 'cannot write the trade', { what, ...context, err });
    return TRADE_FAILED;
  }

  /** A short message for the player where he looks now: the mini line for 3 seconds, the notice line in the expanded window. */
  #say(text: string, kind: Notice['kind'] = 'info'): void {
    this.flash = text;
    clearTimeout(this.#flashTimer);
    this.#flashTimer = setTimeout(() => {
      this.flash = null;
    }, FLASH_MS);
    if (this.mode === 'expanded') this.notify(text, kind);
  }

  /**
   * A trade that was written says where the ship stands: the terminal of the trade becomes the current location, the way
   * "Я здесь" makes it (spec 14.2: the location is changed by the button and by a trade), with the same line in the log.
   * Nothing is written or logged when the ship is there already.
   */
  async #locateAt(terminalId: number): Promise<void> {
    if (this.settings.currentTerminalId === terminalId) return;
    await this.setCurrentTerminal(terminalId);
  }

  /**
   * The player bought. `input.knownScu` is the quantity he saw at the terminal: the diary then keeps "was minus bought".
   * The first purchase starts the run (and opens its section). A purchase that was written sets the current location.
   * Returns the sentence to show at the form when it was not written, `null` when it was.
   */
  buy(input: TradeInput): Promise<string | null> {
    return this.#tradeQueue(async () => {
      this.#log.info('ui', 'buy', { ...input });
      const startsRun = this.activeRun === null;
      let failure: string | null = null;
      let mayHaveWritten = true;
      try {
        await recordBuy(this.#tradeDeps(), input);
      } catch (err) {
        failure = this.#tradeFailure('buy', err, { ...input });
        mayHaveWritten = !(err instanceof TradeError);
      }
      await this.#reloadRun(mayHaveWritten);
      if (failure === null) {
        await this.#locateAt(input.terminalId);
        if (startsRun) void this.openSection(RUN_SECTION);
      }
      return failure;
    });
  }

  /**
   * The player sold. `input.knownScu` is what the buyer held before: the diary then keeps "was plus sold". The sale that
   * empties the hold ends the run, and the target goes with it, BEFORE the market is read again: between the end of the run and
   * the end of the target the window would show a plan with a target of a run that is over. A sale that was written (an income
   * too) sets the current location. Returns the sentence for the form, `null` when it was written.
   *
   * With `income` the goods were never bought through the application (spec 14.10): the sale is written as a finished run of
   * its own and the run that is going is not touched, so `activeRun` stays the very same object and nothing re-reads the
   * statistics by itself. They are told to here, once, because the history, the sessions and the profit of the session have
   * changed. A refusal of the service wrote nothing and re-reads nothing.
   */
  sell(input: TradeInput, income = false): Promise<string | null> {
    const what = income ? 'sell without purchase' : 'sell';
    return this.#tradeQueue(async () => {
      this.#log.info('ui', what, { ...input });
      let failure: string | null = null;
      let finished = false;
      let mayHaveWritten = true;
      try {
        if (income) await recordIncome(this.#tradeDeps(), input);
        else finished = (await recordSell(this.#tradeDeps(), input)).finished;
      } catch (err) {
        failure = this.#tradeFailure(what, err, { ...input });
        mayHaveWritten = !(err instanceof TradeError);
      }
      if (failure === null && finished) await this.#runEnded('done');
      await this.#reloadRun(mayHaveWritten);
      if (income && mayHaveWritten) void stats.reload('income sale');
      if (failure === null) await this.#locateAt(input.terminalId);
      return failure;
    });
  }

  /**
   * "Взлетел" / "Прилетел": the button of the mini line or of the section, or a key of the game. Without a run, or when it
   * repeats the mark before it, nothing is written and the player is told. Returns that sentence, `null` when the mark was written.
   */
  mark(type: 'depart' | 'arrive'): Promise<string | null> {
    return this.#tradeQueue(async () => {
      this.#log.info('ui', 'mark', { type });
      const refusal = markRefusal(type, this.activeRun);
      if (refusal !== null) {
        this.#log.info('ui', 'mark refused', { type, refusal });
        this.#say(refusal);
        return refusal;
      }
      let failure: string | null = null;
      let mayHaveWritten = true;
      try {
        await recordMark(this.#tradeDeps(), type);
      } catch (err) {
        failure = this.#tradeFailure('mark', err, { type });
        mayHaveWritten = !(err instanceof TradeError);
        this.#say(failure, 'error');
      }
      await this.#reloadRun(mayHaveWritten);
      return failure;
    });
  }

  /** "Груз потерян" (after the question was answered with yes): the run is closed as lost, the hold is written off, the target goes. */
  loseCargo(): Promise<string | null> {
    return this.#tradeQueue(async () => {
      this.#log.info('ui', 'lose cargo');
      let failure: string | null = null;
      let mayHaveWritten = true;
      try {
        await closeAsLost(this.#tradeDeps());
      } catch (err) {
        failure = this.#tradeFailure('lose cargo', err, {});
        mayHaveWritten = !(err instanceof TradeError);
        this.#say(failure, 'error');
      }
      if (failure === null) await this.#runEnded('lost'); // before the run is read again, as after the last sale
      await this.#reloadRun(mayHaveWritten);
      return failure;
    });
  }

  /** A run is over (the hold was sold or lost): the target of that run goes. Called before the state reads the run that is over. */
  async #runEnded(how: 'done' | 'lost'): Promise<void> {
    this.#log.info('ui', 'run ended, the target is cleared', { how });
    await this.updateSetting('targetTerminalId', null);
  }

  // ---- a question under the header --------------------------------------------------------------------------

  /**
   * Asks the player something that must not happen by a misclick: a line under the header with the question and two buttons.
   * It takes no keyboard. `onYes` runs only on "yes"; "no", the collapse of the window, the settings and ten seconds without an
   * answer are "no". The window does not fold by itself while the question is there. A new question replaces the old one.
   */
  ask(question: Confirm, onYes: () => void | Promise<void>): void {
    // a question that is still up is answered "no" first, and the log says so
    if (this.confirm !== null) this.answer(false, 'replaced');
    this.#log.info('ui', 'ask', { text: question.text });
    this.confirm = question;
    this.#confirmAction = onYes;
    this.holdBusy(CONFIRM_BUSY);
    this.#confirmTimer = setTimeout(() => this.answer(false, 'no answer'), CONFIRM_MS);
  }

  /** The answer to the question on screen; nothing happens when there is none. */
  answer(yes: boolean, why = 'player'): void {
    if (this.confirm === null) return;
    const onYes = this.#confirmAction;
    this.#log.info('ui', 'answer', { yes, why, text: this.confirm.text });
    this.#dropQuestion();
    if (yes && onYes !== null) {
      void Promise.resolve(onYes()).catch((err: unknown) => this.#log.error('ui', 'the confirmed action failed', { err }));
    }
  }

  #dropQuestion(): void {
    clearTimeout(this.#confirmTimer);
    this.confirm = null;
    this.#confirmAction = null;
    this.releaseBusy(CONFIRM_BUSY);
  }

  /**
   * Saves a setting and applies it right away: trigger keys are bound again, the window geometry and
   * opacity are applied, the log level changes. Returns the sentence to show next to the field when
   * the value was not saved, `null` when it was.
   */
  async updateSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<string | null> {
    const invalid = validateSetting(key, value, this.settings);
    if (invalid !== null) {
      this.#log.warn('ui', 'setting rejected', { key, value, reason: invalid });
      return invalid;
    }
    if (Object.is(this.settings[key], value)) return null;

    this.#log.info('ui', 'change setting', { key, from: this.settings[key], to: value });
    try {
      await saveSetting(this.#syncDeps().db, this.#log, key, value);
    } catch (err) {
      this.#log.error('ui', 'cannot save the setting', { key, err });
      const text = 'Не удалось сохранить настройку. Подробности в логе.';
      this.notify(text, 'error');
      return text;
    }
    this.settings = { ...this.settings, [key]: value };
    await this.#applySetting(key);
    return null;
  }

  async #applySetting(key: keyof Settings): Promise<void> {
    switch (key) {
      case 'hotkeyPanel':
      case 'hotkeyDepart':
      case 'hotkeyArrive':
        await this.applyTriggers();
        break;
      case 'stripCorner':
      case 'windowDx':
      case 'windowDy':
      case 'opacity':
        // the corner and the opacity reach the window through the same fit as a change of the content;
        // the width needs nothing here: the root of the interface changes its size and reports it itself
        await this.#refit();
        break;
      case 'showStrip':
        await this.#modeQueue(async () => {
          if (!this.#windowReady) return;
          try {
            await this.#syncVisibility();
          } catch {
            // already logged by the window layer
          }
        });
        break;
      case 'logLevel':
        await applyLogLevel(this.#log, this.settings.logLevel);
        break;
    }
    // The lookup on screen is answered again when the setting shapes its answer (not awaited: it may wait for UEX).
    const shown = this.lookup.request;
    if (shown !== null && affectsLookup(key, shown.kind)) void this.rerunLookup();
  }

  async openLogs(): Promise<void> {
    this.#log.info('ui', 'open logs folder');
    try {
      await revealItemInDir(await join(await appLogDir(), 'sctrade.log'));
    } catch (err) {
      this.#log.error('ui', 'cannot open the logs folder', { err });
      this.notify('Не удалось открыть папку логов.', 'error');
    }
  }

  async quit(): Promise<void> {
    this.#log.info('ui', 'quit');
    try {
      await getCurrentWindow().close();
    } catch (err) {
      this.#log.error('ui', 'cannot quit', { err });
      this.notify('Не удалось выйти. Закройте приложение через значок в трее.', 'error');
    }
  }

  // ---- messages ---------------------------------------------------------------------------------

  /** A short Russian message under the header (the line exists only while there is one); it goes away by itself. */
  notify(text: string, kind: Notice['kind']): void {
    clearTimeout(this.#noticeTimer);
    this.notice = { text, kind };
    this.#noticeTimer = setTimeout(() => this.dismissNotice(), NOTICE_MS);
  }

  dismissNotice(): void {
    clearTimeout(this.#noticeTimer);
    this.notice = null;
  }
}

export const app = new AppState();
