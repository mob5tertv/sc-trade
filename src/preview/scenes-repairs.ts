import { saveReference } from '../data/repo/uex-cache';
import { installPriceFake } from './fake-prices';
import { installHttpFake, type FakeAnswer } from './http-fake';
import type { Scene, SceneApp } from './scenes';

// The scenes of task 35, the repairs after the review of the whole branch: places where the state and the screens met badly.
// They run inside the page, as the scenes of `scenes.ts` do (that module imports this one, hence only the type comes from it).

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const ok = (data: unknown): FakeAnswer => ({ status: 200, body: { status: 'ok', data } });

// ids of the preview data: terminals HUR-L1 3, ARC-L1 1; the run of `run-loading` bought at HUR-L1 and goes to ARC-L1
const HUR_L1 = 3;

/** The distance from the place of the purchase of the run (HUR-L1) to its target (ARC-L1) is not stored: the time of the run is not known. */
async function forgetTheFlight(app: SceneApp): Promise<void> {
  await app.suggestDeps().db.execute('DELETE FROM uex_distance WHERE terminal_a_id = 1 AND terminal_b_id = 3');
  await app.loadFromDb();
}

/** Waits until `done()` is true; a scene that waits for what never comes fails with what it waited for. */
async function until(what: string, done: () => boolean, timeoutMs = 8000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!done()) {
    if (performance.now() > deadline) throw new Error(`the scene waited ${timeoutMs / 1000} s for ${what}`);
    await pause(25);
  }
}

/** The terminal the first sync scene looks at: Orbituary, where the player has no price of his own. UEX answers for it with the rows of the side it buys on only. */
const VIEWED = 16;

export const REPAIR_SCENES: readonly Scene[] = [
  {
    // The header at its fullest: another terminal is viewed, so the button «Я здесь» is there beside the field, the freshness of UEX says
    // «UEX офлайн 12 мин» (the longest of its texts), and the three icons and «Маршрут» stand as always. One line, nothing cut off.
    name: 'indicator-failed-here',
    title: 'Шапка с «Я здесь» и «UEX офлайн 12 мин»: одна строка, ничего не обрезано',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      installPriceFake({ rows: () => app.market.uex.values(), failTerminals: new Set([2, 7, 8]) });
      app.setViewTerminal(12);
      await app.syncPricesNow();
      await pause(100);
    },
  },
  {
    // The first launch: the cache has no price of UEX (the reference is there) and the first sync goes: 34 live terminals, 17 batches of
    // two; the gate holds the 13th request. The market is read again after the 10th batch, so the table of Orbituary (which UEX answers
    // for with what it BUYS only) is full already, on «Продать» and not on an empty «Купить», while the header counts «UEX 12/17».
    name: 'first-sync-fills',
    title: 'Первый запуск: цены UEX грузятся (12 пакетов из 17), таблица терминала, который только покупает, уже заполнена и стоит на «Продать»',
    dataset: 'default',
    act: async (app) => {
      const { db } = app.suggestDeps();
      const uex = [...app.market.uex.values()].filter((p) => p.terminalId !== VIEWED || p.buy.last === 0);
      const own = [...app.reference.terminals.values()];
      await saveReference(db, { terminals: [...own, ...own.map((t) => ({ ...t, id: t.id + 100 }))] });
      await db.execute('DELETE FROM uex_price');
      await db.execute("DELETE FROM uex_meta WHERE key = 'prices_synced_at'");
      await app.loadFromDb();
      await app.expand('preview');
      app.setViewTerminal(VIEWED);
      const fake = installPriceFake({ rows: () => uex, passes: 12 });
      void app.syncPricesNow();
      await until('the 13th price request', () => fake.asked() >= 13);
      await pause(300);
    },
  },
  {
    // A first sync of 11 batches: the market is read again after the 10th (not awaited) and at the end, a moment later. The two reads
    // must not overlap: the later one has to be the one that lands last. The order in which `reloadMarket` starts and ends is in
    // `window.__reloadOrder` (`--do "eval:window.__reloadOrder"`): `start,end,start,end`.
    name: 'first-sync-short',
    title: 'Первая синхронизация из 11 пакетов: чтение рынка после 10-го и в конце идут одно за другим',
    dataset: 'default',
    act: async (app) => {
      const { db } = app.suggestDeps();
      const own = [...app.reference.terminals.values()];
      await saveReference(db, { terminals: [...own, ...own.slice(0, 5).map((t) => ({ ...t, id: t.id + 100 }))] });
      await db.execute('DELETE FROM uex_price');
      await db.execute("DELETE FROM uex_meta WHERE key = 'prices_synced_at'");
      const uex = [...app.market.uex.values()];
      await app.loadFromDb();
      const order: string[] = [];
      (window as unknown as { __reloadOrder: string[] }).__reloadOrder = order;
      const reload = app.reloadMarket.bind(app);
      app.reloadMarket = async () => {
        order.push('start');
        await reload();
        order.push('end');
      };
      installPriceFake({ rows: () => uex });
      await app.syncPricesNow();
      await pause(300);
    },
  },
  {
    // The mini line is switched off and the start fails after the settings were read (an empty database, no network): the window
    // is hidden by that setting, and the error would not be seen. It unfolds with the text of the error instead.
    name: 'boot-failed-no-strip',
    title: 'Мини-строка выключена, запуск не удался: окно разворачивается само, с текстом ошибки',
    dataset: 'empty-no-strip',
  },
  {
    // The start failed with the mini line off and the window unfolded by itself; the player looks away. It folds after 2 seconds
    // without activity unless the failed start holds it: `--do "hover:.sc-root;leave;wait:4500"` must find it still expanded, with the
    // error (the minus button still folds it: `--do "click:button[aria-label='Свернуть']"`).
    name: 'boot-failed-idle',
    title: 'Запуск не удался, мини-строка выключена, курсор ушёл, idle 2 с: окно с ошибкой не сворачивается',
    dataset: 'empty-no-strip',
    act: async (app) => {
      await app.updateSetting('idleCollapseSec', 2);
      app.pointer(true);
    },
  },
  {
    // The first show of the window fails (`place_window` is refused once). The window stays hidden; the tray's «Показать панель»
    // (`expand('tray')`, the same call) shows it again, and this time it works.
    name: 'show-fails-once',
    title: 'Первый показ окна не удался; «Показать панель» из трея показывает его снова',
    dataset: 'default',
    beforeStart: () => {
      (globalThis as { __previewPlaceWindowFailures?: number }).__previewPlaceWindowFailures = 1;
    },
    act: (app) => app.expand('tray'),
  },
  {
    // a few minutes after the purchase, the flight to the target is not known: the line says what the cargo is expected to
    // sell for (the profit), and no «≈ …/ч» (the seconds since the purchase are not the time of the run)
    name: 'mini-run-unknown-flight',
    title: 'Мини-строка в рейсе, время полёта до цели неизвестно: ожидание есть, «≈ …/ч» нет',
    dataset: 'run-loading',
    act: forgetTheFlight,
  },
  {
    name: 'run-unknown-flight',
    title: '«Рейс» развёрнут, время полёта до цели неизвестно: прибыль и ROI «≈», в UEC/ч прочерк',
    dataset: 'run-loading',
    act: async (app) => {
      await forgetTheFlight(app);
      await app.expand('preview');
      await app.toggleSection('run');
    },
  },
  {
    // The distance from the place of the purchase to the target is not stored, so the rate of the run is not known: the mini
    // line shows no «≈ …/ч». A lookup from HUR-L1 fetches the distance from UEX (the scene's network answers for it) and stores
    // it; from then on the state counts with it, and the number is there (`--do "eval:..."`: `app.distances.size`, `app.strip.rate`).
    name: 'lookup-fetches-distances',
    title: 'Рейс без известного расстояния до цели; поиск догружает его с UEX, и число «≈ …/ч» появляется без других действий',
    dataset: 'run-loading',
    act: async (app) => {
      await forgetTheFlight(app);
      installHttpFake((url) => (url.includes('commodities_routes') ? ok([]) : ok({ distance: 31.5 })));
      await app.expand('preview');
      await app.runLookup({ kind: 'from', terminalId: HUR_L1, commodityId: null, price: null });
      await pause(300);
    },
  },
];
