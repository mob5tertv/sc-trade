import { listen } from '@tauri-apps/api/event';
import { appLogDir, join } from '@tauri-apps/api/path';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
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
import { setMode, watchFocus, type SetModeOptions, type WindowLayout, type WindowMode } from '../platform/window';
import { createLatestRequest } from './vm/latest-request';
import { affectsLookup, kindForSide, lookupTitle, terminalLabel, type LookupRequest } from './vm/lookup';
import { createRequestQueue } from './vm/request-queue';
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
//    buy / where to sell, one answer at a time, the newest request wins.

export type Tab = 'terminal' | 'run' | 'routes' | 'settings';
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
const EMPTY_MARKET: Market = { uex: new Map(), own: new Map(), byTerminal: new Map(), byCommodity: new Map(), stock: new Map() };
const IDLE_LOOKUP: LookupState = { request: null, title: '', options: [], loading: false, error: null };

/** Prices are fetched again every hour (spec 6). */
const PRICE_SYNC_INTERVAL_MS = 60 * 60 * 1000;
const NOTICE_MS = 8000;
/** Temperatures and stock estimates move slowly: the table is refreshed this often, not every second. */
const ROWS_TICK_MS = 15_000;

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
  mode = $state<WindowMode>('strip');
  tab = $state<Tab>('terminal');
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
  /** The mode being switched to; it leads `mode` while a switch is in progress. */
  #requestedMode: WindowMode = 'strip';
  /** Mode changes come from the strip, the keys, the tray, Esc and the focus; they run one after another. */
  readonly #modeQueue = createRequestQueue();
  #shown = false;
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
    return { panelWidth: s.panelWidth, stripCorner: s.stripCorner, showStrip: s.showStrip, opacity: s.opacity };
  }

  /** Shows the strip for the first time, whatever the start came to: the player must always see something. */
  ensureShown(): void {
    if (this.#shown) return;
    this.#shown = true;
    void this.changeMode(() => 'strip', 'startup');
  }

  /** Runs one mode change after the previous ones; keeps the window and `mode` consistent. */
  changeMode(pick: (current: WindowMode) => WindowMode, reason: string, options: SetModeOptions = {}): Promise<void> {
    return this.#modeQueue(async () => {
      const next = pick(this.mode);
      this.#log.info('app', 'mode change', { from: this.mode, to: next, reason });
      this.#requestedMode = next;
      try {
        await setMode(next, this.layout, this.#log, options);
        this.mode = next;
      } catch {
        // already logged by setMode; keep the previous mode
        this.#requestedMode = this.mode;
      }
    });
  }

  openPanel(reason = 'strip click'): Promise<void> {
    this.#log.info('ui', 'open panel', { reason });
    return this.changeMode(() => 'panel', reason);
  }

  closePanel(reason: string): Promise<void> {
    this.#log.info('ui', 'close panel', { reason });
    return this.changeMode(() => 'strip', reason);
  }

  toggleMode(): Promise<void> {
    this.#log.info('ui', 'toggle panel');
    return this.changeMode((current) => (current === 'panel' ? 'strip' : 'panel'), 'trigger');
  }

  /**
   * The panel collapses by itself when the player clicks the game. Only a settled panel does: while a
   * switch is in progress, the focus changes belong to the switch. The game already has the focus
   * then, so it is not pulled back by force.
   */
  #onFocusLost(): void {
    if (this.mode === 'panel' && this.#requestedMode === 'panel') {
      void this.changeMode(() => 'strip', 'focus lost', { restoreFocus: false });
    }
  }

  /** Starts listening for focus changes and for the tray's "Показать панель"; returns what stops it. */
  async watchWindow(): Promise<() => void> {
    const stops: Array<() => void> = [];
    try {
      stops.push(await watchFocus(() => this.#requestedMode, this.#log, () => this.#onFocusLost()));
    } catch (err) {
      this.#log.error('app', 'cannot listen for focus changes', { err });
    }
    try {
      stops.push(await listen('tray://show-panel', () => {
        this.#log.info('app', 'tray: show panel');
        void this.openPanel('tray');
      }));
    } catch (err) {
      this.#log.error('app', 'cannot listen for the tray event', { err });
    }
    return () => stops.forEach((stop) => stop());
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
      case 'panelWidth':
      case 'stripCorner':
      case 'showStrip':
      case 'opacity':
        // the settings are used by the player in the panel, which keeps the focus it has
        await this.changeMode((current) => current, `setting ${key}`, { restoreFocus: false });
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
