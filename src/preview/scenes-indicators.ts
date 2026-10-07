import { recordBuy, recordSell } from '../data/trade';
import { installPriceFake, type PriceFake, type PriceFakeOptions } from './fake-prices';
import type { Scene, SceneApp } from './scenes';

// The scenes of two indicators: the freshness of UEX in the header (a button that refreshes the prices and shows how far
// the refresh is) and what the play session earned (the idle mini line, the summary of the folded "Мои маршруты").
// A refresh needs a network, and the preview has none, so these scenes put a fake of the price requests in place
// (`fake-prices.ts`): it answers with the rows the application already has and lets the scene decide how far the
// refresh gets. The list is added to `SCENES` in `scenes.ts`.

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A click on what is on the screen, the way a button handler sees it; a scene that names something that is not there fails. */
async function click(selector: string, text?: string): Promise<void> {
  const found = [...document.querySelectorAll<HTMLElement>(selector)].find((el) => text === undefined || (el.textContent ?? '').includes(text));
  if (found === undefined) throw new Error(`the scene wants to click "${selector}"${text === undefined ? '' : ` with "${text}"`}, and there is none`);
  found.click();
  await pause(60);
}

/** Waits until `done()` is true; a scene that waits for what never comes fails with what it waited for. */
async function until(what: string, done: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!done()) {
    if (performance.now() > deadline) throw new Error(`the scene waited ${timeoutMs / 1000} s for ${what}`);
    await pause(25);
  }
}

/** The price requests of UEX, answered with the prices the application has now (see `fake-prices.ts`). */
const fakePrices = (app: SceneApp, options: Omit<PriceFakeOptions, 'rows'> = {}): PriceFake =>
  installPriceFake({ rows: () => app.market.uex.values(), ...options });

/** The click on the indicator of UEX in the header, which is what the player does. */
const clickIndicator = (): Promise<void> => click('header button.uex');

/**
 * One whole run written by the real trade service, the way the buttons of a run do it: Stims bought at HUR-L1 and sold at
 * MIC-L1. The state takes each run the service returns (`activeRun`), and the statistics follow it by themselves.
 */
async function flyStims(app: SceneApp, run: { scu: number; buy: number; sell: number }): Promise<void> {
  const { db, log, now } = app.suggestDeps();
  const stims = [...app.reference.commodities.values()].find((c) => c.code === 'STIM');
  if (stims === undefined) throw new Error('the scene wants the Stims, and the reference has none');
  const deps = { db, log, now, settings: app.settings };
  app.activeRun = await recordBuy(deps, { terminalId: 3, commodityId: stims.id, scu: run.scu, price: run.buy });
  await pause(150);
  const { finished, run: after } = await recordSell(deps, { terminalId: 4, commodityId: stims.id, scu: run.scu, price: run.sell });
  app.activeRun = finished ? null : after;
  await pause(300);
}

/** 600 SCU of Stims: bought for 1 716 000 and sold for 2 958 000 (a profit of 1 242 000) or for 900 000 (a loss of 816 000). */
const GAIN = { scu: 600, buy: 2860, sell: 4930 };
const LOSS = { scu: 600, buy: 2860, sell: 1500 };

export const INDICATOR_SCENES: readonly Scene[] = [
  {
    // the refresh is on its way: four batches are done, the fifth waits for the network
    name: 'indicator-syncing',
    title: 'Шапка во время обновления цен: «UEX 4/9» вместо возраста',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      const fake = fakePrices(app, { passes: 4 });
      await clickIndicator();
      await until('the fifth price request', () => fake.asked() >= 5);
      await pause(100);
    },
  },
  {
    // another request of UEX holds the queue: the refresh has been asked for and waits for its turn, its batches are not counted yet
    name: 'indicator-waiting',
    title: 'Шапка: обновление цен ждёт очереди к UEX («UEX …»)',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      fakePrices(app);
      void app.withUex(() => new Promise<void>(() => {})); // never ends: this page is only for the picture
      await clickIndicator();
      await pause(100);
    },
  },
  {
    // two batches could not be fetched even terminal by terminal: «UEX недоступен» in the warning colour; the tooltip counts the terminals
    name: 'indicator-failed',
    title: 'Шапка после неудачного обновления: «UEX недоступен», подсказка называет число терминалов',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      fakePrices(app, { failTerminals: new Set([2, 7, 8]) });
      await clickIndicator();
      await until('the refresh to end', () => !app.priceSync.running);
      await pause(100);
    },
  },
  {
    name: 'indicator-done',
    title: 'Шапка после удачного обновления: «UEX сейчас»',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      fakePrices(app);
      await clickIndicator();
      await until('the refresh to end', () => !app.priceSync.running);
      await pause(100);
    },
  },
  {
    // behaviour: `--do "click:header button.uex;wait:300;click:header button.uex;wait:300"`: the first click starts the refresh, the second changes nothing
    name: 'indicator-click',
    title: 'Шапка: клик по «UEX» запускает обновление (после третьего запроса сеть молчит), второй клик ничего не добавляет',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      fakePrices(app, { passes: 3 });
    },
  },
  {
    name: 'session-mini-plus',
    title: 'Мини-строка без рейса: «сессия +1,24M» в цвете прибыли',
    dataset: 'default',
    act: (app) => flyStims(app, GAIN),
  },
  {
    name: 'session-mini-minus',
    title: 'Мини-строка без рейса: сессия в минусе, красным',
    dataset: 'default',
    act: (app) => flyStims(app, LOSS),
  },
  {
    name: 'session-mini-target',
    title: 'Мини-строка без рейса с целью: после «HUR-L1 → ARC-L1» идёт «сессия»',
    dataset: 'default',
    act: async (app) => {
      await flyStims(app, GAIN);
      await app.setTarget(1);
      await pause(100);
    },
  },
  {
    name: 'session-summary-plus',
    title: 'Свёрнутые «Мои маршруты»: «сессия +1 242 000 · …/ч», затем лучший маршрут',
    dataset: 'window',
    act: async (app) => {
      await flyStims(app, GAIN);
      await app.expand('preview');
    },
  },
  {
    name: 'session-summary-minus',
    title: 'Свёрнутые «Мои маршруты»: сессия в минусе',
    dataset: 'window',
    act: async (app) => {
      await flyStims(app, LOSS);
      await app.expand('preview');
    },
  },
  {
    // the latest session holds the run that is going and no finished run: no figure, the summary is the best route alone
    name: 'session-summary-none',
    title: 'Свёрнутые «Мои маршруты»: в сессии только идущий рейс, сводка как была (лучший маршрут)',
    dataset: 'stats',
    act: (app) => app.expand('preview'),
  },
];
