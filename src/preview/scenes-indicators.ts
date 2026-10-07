import { recordBuy, recordSell } from '../data/trade';
import { installPriceFake, priceRow, terminalsOfPriceRequest, type PriceFake, type PriceFakeOptions } from './fake-prices';
import { installHttpFake, type FakeAnswer } from './http-fake';
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

/**
 * The whole of UEX that a sync asks for, answered with what the application has now: the reference (the reverse of the mappers
 * of `data/uex-client.ts`; no vehicle manufacturers, so the stored vehicles stay) and the prices. The list holds the URLs asked, in order.
 */
function fakeUex(app: SceneApp): string[] {
  const asked: string[] = [];
  const ok = (data: unknown): FakeAnswer => ({ status: 200, body: { status: 'ok', data } });
  const flag = (value: boolean): number => (value ? 1 : 0);
  installHttpFake((url) => {
    asked.push(url);
    const priceIds = terminalsOfPriceRequest(url);
    if (priceIds !== null) return ok([...app.market.uex.values()].filter((p) => priceIds.includes(p.terminalId)).map(priceRow));
    if (url.endsWith('/star_systems')) {
      return ok(app.reference.starSystems.map((s) => ({ id: s.id, name: s.name, code: s.code, is_available_live: flag(s.isAvailableLive) })));
    }
    const system = /\/terminals\?type=commodity&id_star_system=(\d+)$/.exec(url);
    if (system !== null) {
      return ok([...app.reference.terminals.values()].filter((t) => t.starSystemId === Number(system[1])).map((t) => ({
        id: t.id, id_star_system: t.starSystemId, id_planet: t.planetId, id_orbit: t.orbitId, name: t.name, nickname: t.nickname,
        displayname: t.displayname, code: t.code, star_system_name: t.starSystemName, planet_name: t.planetName, orbit_name: t.orbitName,
        moon_name: t.moonName, space_station_name: t.spaceStationName, outpost_name: t.outpostName, city_name: t.cityName,
        has_freight_elevator: flag(t.hasFreightElevator), has_loading_dock: flag(t.hasLoadingDock), is_auto_load: flag(t.isAutoLoad),
        is_available_live: flag(t.isAvailableLive),
      })));
    }
    if (url.endsWith('/commodities')) {
      return ok([...app.reference.commodities.values()].map((c) => ({
        id: c.id, name: c.name, code: c.code, is_illegal: flag(c.isIllegal), is_buyable: flag(c.isBuyable), is_sellable: flag(c.isSellable),
        is_available_live: flag(c.isAvailableLive),
      })));
    }
    if (url.endsWith('/companies?is_vehicle_manufacturer=1')) return ok([]);
    throw new Error(`preview: no network for ${url}`);
  });
  return asked;
}

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
    // two batches could not be fetched even terminal by terminal: «UEX офлайн 12 мин» (the age of the data) in the warning colour; the tooltip counts the terminals
    name: 'indicator-failed',
    title: 'Шапка после неудачного обновления: «UEX офлайн 12 мин», подсказка называет число терминалов',
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
    // The reference sync of the start failed (the preview has no network at that moment) and stays the last one: the indicator is in the
    // warning colour, and its tooltip says that the reference did not update. UEX answers again from here on (`window.__uexAsked` lists
    // the requests it gets). `--do "click:header button.uex;wait:800"`: the click repeats the reference first, then the prices, and the
    // indicator turns quiet («UEX сейчас»); `eval:window.__uexAsked` shows star_systems .. commodities, then the price requests. A click
    // with `--do "click:header button.uex;wait:800;click:header button.uex;wait:800"` asks for the reference once only: the second round is prices alone.
    name: 'indicator-reference-failed',
    title: 'Справочник не загрузился при запуске: шапка «UEX офлайн», клик по ней повторяет справочник и обновляет цены',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      await app.syncReferenceNow(); // no network yet: it fails and leaves the reference marked as failed
      (window as unknown as { __uexAsked: string[] }).__uexAsked = fakeUex(app);
      await pause(100);
    },
  },
  {
    // The same, but UEX answers the price requests only: the repeated reference sync fails again, and the prices are refreshed all the same;
    // the indicator stays in the warning colour (`--do "click:header button.uex;wait:800"`: the log has a second `reference sync failed`
    // and a `prices sync finished`).
    name: 'indicator-reference-failed-again',
    title: 'Справочник не загрузился ни при запуске, ни по клику: цены всё равно обновляются, шапка остаётся «UEX офлайн»',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      await app.syncReferenceNow();
      fakePrices(app); // the price requests are answered, every other one fails
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
    // the clock jumps two hours and two minutes forward: the last record of the session is older than the pause that splits
    // sessions, and the segment goes away by the one-second clock alone (no read of the database: the log has one
    // `statistics loaded`, from the start, and one for each of the two trades)
    name: 'session-mini-expires',
    title: 'Мини-строка: после перерыва в два часа сегмент сессии исчезает сам, база не читается',
    dataset: 'default',
    act: async (app) => {
      await flyStims(app, GAIN);
      const realNow = Date.now.bind(Date);
      Date.now = () => realNow() + (2 * 3600 + 120) * 1000;
      await until('the session to end', () => app.strip.kind === 'idle' && app.strip.session === null);
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
    // the diary of prices of the last nine hours is one session, and the three runs of the `stats` dataset are in it (one lost): -174 000 over the whole stretch
    name: 'session-summary-long',
    title: 'Свёрнутые «Мои маршруты»: сессия длиной в девять часов с тремя рейсами, один потерян',
    dataset: 'stats',
    act: (app) => app.expand('preview'),
  },
  {
    // the session is there (the player has written prices) but no run has ended in it: no segment, the line is the location alone
    name: 'session-mini-none',
    title: 'Мини-строка без рейса: в сессии есть цены, но ни одного завершённого рейса, сегмента нет',
    dataset: 'default',
  },
  {
    // nothing at all: no run, no price of his own: the summary says there are no routes yet and says nothing of a session
    name: 'session-summary-none',
    title: 'Свёрнутые «Мои маршруты»: ни записей, ни рейсов, сводка «пока нет завершённых рейсов»',
    dataset: 'no-records',
    act: (app) => app.expand('preview'),
  },
];
