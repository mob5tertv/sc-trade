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
import { loadMarket, suggestFrom, suggestTo, type SuggestDeps } from '../data/suggest';
import { syncPrices, syncReference, type SyncDeps } from '../data/sync';
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
import { shouldCollapse } from './vm/idle';
import { createKeyboardHolds, type KeyboardHolds } from './vm/keyboard-holds';
import { createLatestRequest } from './vm/latest-request';
import { affectsLookup, kindForSide, lookupTitle, terminalLabel, type LookupRequest } from './vm/lookup';
import { createRequestQueue } from './vm/request-queue';
import { parseOpenSections, serializeOpenSections, toggledSection } from './vm/sections';
import { validateSetting } from './vm/settings-validation';
import { META_PRICES_SYNCED_AT, META_REFERENCE_SYNCED_AT, metaSeconds, syncPlan } from './vm/sync-plan';
import { terminalRows as buildTerminalRows, type TerminalRow } from './vm/terminal-rows';
import { triggerErrorText } from './vm/trigger-error';
import { uexErrorText } from './vm/uex-error';

// The one application state. Everything the screens show lives here, and every action of the player
// goes through a method of `app`, which logs it under `ui`. Later tasks add their fields and methods
// to this class (recording prices, suggestions, trades, history) and reuse the pieces below:
//  - the dependencies (database, logger, UEX client, clock) live in one place, `#data` + `#log`; the
//    data services take them through `#syncDeps()` (a private view of that place), `suggestDeps()`, and
//    the trade deps a later task adds next to it. The raw UEX client is never handed out;
//  - `withUex(job)` is THE entry point for everything that can touch UEX: the syncs, and every suggestion
//    call that may fetch distances (`suggestFrom`, `suggestTo`, `ensureDistances`). Requests to UEX are
//    strictly sequential project-wide, so none of them may run outside of it. A job must never call
//    `withUex` itself, nor a method that does (`syncReferenceNow`, `syncPricesNow`, `refreshReference`):
//    the inner call would wait for the queue slot the outer job holds, and the queue would deadlock;
//  - `reloadMarket()` refreshes the market after anything wrote prices;
//  - UEX health is tracked per sync (`referenceOk`, `pricesOk`); `uexOk` is both together;
//  - the Terminal tab: `terminalRows` (the table of the viewed terminal, on a 15 s clock), `recordPrice`
//    (writes what the player saw), and the lookup (`lookup`, `runLookup`, `rerunLookup`, `newRoute`): where to
//    buy / where to sell, one answer at a time, the newest request wins;
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

export type Tab = 'terminal' | 'run' | 'routes';
/** What the expanded window shows: the main screen or the settings, which take the whole window. */
export type View = 'main' | 'settings';
export type Phase = 'booting' | 'ready' | 'failed';
export interface Notice { text: string; kind: 'info' | 'error' }

/** What the lookup block of the Terminal tab shows (spec 14.2). */
export interface LookupState {
  /** What was asked; `null` before anything was. */
  request: LookupRequest | null;
  /** What the options are, in a sentence: 'Где купить Gold для HUR-L1 · продажа 5 088'. */
  title: string;
  options: RouteOption[];
  loading: boolean;
  /** A short Russian sentence when the lookup failed; never the raw text of an error. */
  error: string | null;
}

/** What a price the player saw is: the observation's fields without a time (now is the time). */
export interface PriceInput { terminalId: number; commodityId: number; side: Side; price: number; scu: number | null }

/** What `boot()` opens once the database is there. */
export interface DataDeps { db: Db; uex: UexClient; now: () => number }

const EMPTY_REFERENCE: Reference = { starSystems: [], terminals: new Map(), commodities: new Map(), vehicles: [] };
const EMPTY_MARKET: Market = {
  uex: new Map(), own: new Map(), byTerminal: new Map(), byCommodity: new Map(), stock: new Map(), ownScu: new Map(), ownPrev: new Map(),
};
const IDLE_LOOKUP: LookupState = { request: null, title: '', options: [], loading: false, error: null };

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
const NO_CURRENT_LOCATION = 'Сначала укажи, где ты находишься: найди локацию в поиске и нажми «Я здесь».';

const nowSec = (): number => Math.floor(Date.now() / 1000);

class AppState {
  // ---- data -----------------------------------------------------------------------------------
  settings = $state.raw<Settings>({ ...DEFAULT_SETTINGS });
  reference = $state.raw<Reference>(EMPTY_REFERENCE);
  market = $state.raw<Market>(EMPTY_MARKET);
  distances = $state.raw<Map<string, number | null>>(new Map());
  /** The active run; nothing writes runs yet, the strip and the run tab read it. */
  activeRun = $state.raw<RunWithEvents | null>(null);
  pricesSyncedAt = $state<number | null>(null);
  /** The last reference sync worked (true until one fails; true again after the next good one). */
  referenceOk = $state(true);
  /** The last price sync worked completely (a sync with unfetched terminals counts as failed). */
  pricesOk = $state(true);
  /** Unix seconds, updated once a second. */
  now = $state(nowSec());
  /** Unix seconds, updated every 15 seconds: the moment the table of the Terminal tab is counted at. */
  rowsNow = $state(nowSec());
  /** The Terminal tab's lookup block. */
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

  // ---- window and screen ------------------------------------------------------------------------
  mode = $state<WindowMode>('mini');
  /** The main screen or the settings (the settings keep the window open: they count as busy). */
  view = $state<View>('main');
  tab = $state<Tab>('terminal');
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
  /** What the Terminal tab shows (spec 14.2); not persisted. The current location is `settings.currentTerminalId`. */
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
  #shown = false;
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
  #pricesInFlight = false;
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
      ownMedian: new Map(), // filled by the statistics task
    };
  }

  /** Applies the loaded settings; the viewed terminal starts at the current location. */
  setSettings(settings: Settings): void {
    this.settings = settings;
    this.viewTerminalId = settings.currentTerminalId;
  }

  /** The numbers the route services need, from the settings and the loaded data. */
  routeCtx(freeScu: number = this.settings.scuCapacity): RouteCtx {
    const s = this.settings;
    return {
      now: this.now,
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
      ownMedian: new Map(), // filled by the statistics task
    };
  }

  // ---- loading ----------------------------------------------------------------------------------

  /** Reference, market, distances and the active run, from the database. Throws when the database does. */
  async loadFromDb(): Promise<void> {
    const { db } = this.#syncDeps();
    this.reference = await loadReference(db);
    await this.#loadMarketData();
    this.activeRun = await getActiveRun(db);
  }

  async #loadMarketData(): Promise<void> {
    const { db } = this.#syncDeps();
    this.market = await loadMarket(db);
    this.distances = await loadDistances(db);
    this.pricesSyncedAt = metaSeconds(await getMeta(db, META_PRICES_SYNCED_AT));
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

  /** Downloads the prices and reloads the market. Never throws; a failure marks the price sync as failed (`pricesOk`). */
  async syncPricesNow(): Promise<void> {
    if (this.#pricesInFlight) {
      this.#log.debug('ui', 'price sync already running, skipped');
      return;
    }
    this.#pricesInFlight = true;
    try {
      const { failed } = await this.withUex(() => syncPrices(this.#syncDeps()));
      this.pricesOk = failed === 0;
    } catch (err) {
      this.pricesOk = false;
      this.#log.warn('ui', 'price sync failed', { err });
    } finally {
      this.#pricesInFlight = false;
    }
    await this.reloadMarket();
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
   * A failure is logged and allows another try.
   */
  ensureShown(): void {
    if (this.#shown) return;
    this.#shown = true;
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
      }
    });
  }

  /** Runs one mode change after the previous ones; keeps the window and `mode` consistent. */
  #changeMode(pick: (current: WindowMode) => WindowMode, reason: string): Promise<void> {
    return this.#modeQueue(async () => {
      const from = this.mode;
      const next = pick(from);
      if (next === from) return;
      this.#log.info('window', 'mode change', { from, to: next, reason });
      if (next === 'mini') {
        this.view = 'main';
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
          depart: () => this.#log.info('ui', 'depart trigger, not wired yet'),
          arrive: () => this.#log.info('ui', 'arrive trigger, not wired yet'),
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

  setTab(tab: Tab): void {
    if (tab === this.tab) return;
    this.#log.info('ui', 'tab', { from: this.tab, to: tab });
    this.tab = tab;
  }

  /** The location search of the header: only changes what the Terminal tab shows. */
  setViewTerminal(id: number): void {
    this.#log.info('ui', 'view terminal', { terminalId: id });
    this.viewTerminalId = id;
  }

  /** "Я здесь": the viewed terminal becomes the current location. */
  async setCurrentTerminal(id: number): Promise<void> {
    this.#log.info('ui', 'set current terminal', { terminalId: id });
    if ((await this.updateSetting('currentTerminalId', id)) === null) this.viewTerminalId = id;
  }

  /** "Сменил сервер": own prices older than now are cold from this moment on. */
  async serverChanged(): Promise<void> {
    const ts = this.#syncDeps().now();
    this.#log.info('ui', 'server changed', { ts });
    if ((await this.updateSetting('serverChangedAt', ts)) === null) {
      this.notify('Отмечено: сервер сменился, свои цены до этого момента считаются холодными.', 'info');
    }
  }

  // ---- the Terminal tab ---------------------------------------------------------------------------

  /**
   * Writes a price the player saw (own observation, with the quantity only when typed), reloads the market,
   * makes that terminal the VIEWED one (the current location stays where it is) and runs the lookup the price
   * asks for: a sell price, "where to buy" for that terminal; a buy price, "where to sell". Returns the sentence
   * to show when the price was not saved, `null` when it was. The market is reloaded in either case, so the table
   * shows what is stored. The lookup runs on its own: the caller does not wait for UEX.
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

    this.viewTerminalId = input.terminalId;
    void this.runLookup({ kind: kindForSide(input.side), terminalId: input.terminalId, commodityId: input.commodityId, price: input.price });
    return null;
  }

  /**
   * Asks where to sell (`from`) or where to buy (`to`) for the terminal of the request, for one commodity or all
   * of them, with the whole cargo space of the ship. Never throws; the answer lands in `lookup`. A newer request
   * replaces an older one: the answer of the older one is dropped, and one still waiting in the queue is not run.
   * Nothing is run while the cargo space is not set (the block says so).
   */
  async runLookup(request: LookupRequest, reason = 'player'): Promise<void> {
    const isNewest = this.#latestLookup.begin();
    const title = lookupTitle(request, this.reference, this.settings.nearby);
    this.#log.info('ui', 'lookup', { ...request, reason });

    if (this.settings.scuCapacity <= 0) {
      this.#log.info('ui', 'lookup not run, the cargo space is not set', { ...request });
      this.lookup = { request, title, options: [], loading: false, error: null };
      return;
    }
    this.lookup = { request, title, options: [], loading: true, error: null };

    try {
      const options = await this.withUex(async () => {
        const freeScu = this.settings.scuCapacity;
        if (!isNewest() || freeScu <= 0) return [];
        const deps = this.suggestDeps();
        const commodityId = request.commodityId ?? undefined;
        return request.kind === 'from'
          ? suggestFrom(deps, request.terminalId, freeScu, commodityId)
          : suggestTo(deps, request.terminalId, freeScu, commodityId);
      });
      if (!isNewest()) return;
      this.lookup = { request, title, options, loading: false, error: null };
    } catch (err) {
      this.#log.error('ui', 'lookup failed', { ...request, err });
      if (!isNewest()) return;
      this.lookup = { request, title, options: [], loading: false, error: err instanceof UexError ? uexErrorText(err) : LOOKUP_FAILED };
    }
  }

  /** The same lookup again, after a setting that shapes its answer changed. Nothing to do before the first one. */
  async rerunLookup(): Promise<void> {
    const { request } = this.lookup;
    if (request !== null) await this.runLookup(request, 'settings changed');
  }

  /**
   * "Новый маршрут": where to take cargo from the CURRENT location, whatever the table shows. The location
   * becomes the viewed terminal. Without a current location the player is asked to pick one.
   */
  async newRoute(): Promise<void> {
    const terminalId = this.settings.currentTerminalId;
    this.#log.info('ui', 'new route', { currentTerminalId: terminalId });
    if (terminalId === null || !this.reference.terminals.has(terminalId)) {
      this.notify(NO_CURRENT_LOCATION, 'info');
      return;
    }
    this.viewTerminalId = terminalId;
    await this.runLookup({ kind: 'from', terminalId, commodityId: null, price: null }, 'new route');
  }

  /** "Цель": the terminal the next trip is flown to. */
  async setTarget(terminalId: number): Promise<void> {
    this.#log.info('ui', 'set target', { terminalId });
    if ((await this.updateSetting('targetTerminalId', terminalId)) === null) {
      this.notify(`Цель рейса: ${terminalLabel(this.reference, terminalId)}.`, 'info');
    }
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

  /** A short Russian message over the tabs; it goes away by itself. */
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
