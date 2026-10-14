import { recordBuy, recordSell } from '../data/trade';
import type { Scene, SceneApp } from './scenes';

// The scenes of the "Мои маршруты" section. They run on the `window` dataset (the two runs of the default history), on
// `stats` (the same data with a long history of the player's runs), `no-runs` (no run at all) and `no-records` (no run and no price of his own); see `seed-stats.ts`.
// The list is added to `SCENES` in `scenes.ts`.

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A click on what is on the screen, the way a button handler sees it; a scene that names something that is not there fails. */
async function click(selector: string, text?: string): Promise<void> {
  const found = [...document.querySelectorAll<HTMLElement>(selector)].find((el) => text === undefined || (el.textContent ?? '').includes(text));
  if (found === undefined) throw new Error(`the scene wants to click "${selector}"${text === undefined ? '' : ` with "${text}"`}, and there is none`);
  found.click();
  await pause(60);
}

/** The window expanded with only the "Мои маршруты" section open (the terminal folded) on its list `view`. */
async function openStats(app: SceneApp, view: 'Маршруты' | 'История' | 'Сессии' | 'Записи'): Promise<void> {
  await app.expand('preview');
  await app.toggleSection('terminal');
  await app.toggleSection('routes');
  await pause(60);
  if (view !== 'Маршруты') await click('.sc-seg button', view);
}

/**
 * What the trade actions of the window do to the statistics: the trade is written by the real trade service, and the
 * state of the application takes the run it returns (`activeRun`), the way a button of a run does. The history is
 * not told to reload: it follows the active run by itself.
 */
async function tradeStims(app: SceneApp, step: 'buy' | 'sell'): Promise<void> {
  const { db, log, now } = app.suggestDeps();
  const stims = [...app.reference.commodities.values()].find((c) => c.code === 'STIM');
  if (stims === undefined) throw new Error('the scene wants the Stims, and the reference has none');
  const deps = { db, log, now, settings: app.settings };
  if (step === 'buy') {
    app.activeRun = await recordBuy(deps, { terminalId: 3, commodityId: stims.id, scu: 100, price: 2860 });
  } else {
    const { finished, run } = await recordSell(deps, { terminalId: 4, commodityId: stims.id, scu: 100, price: 3490 });
    app.activeRun = finished ? null : run;
  }
  await pause(300);
}

export const STATS_SCENES: readonly Scene[] = [
  {
    // the history is open and a run starts: it appears in the list (a run without sales, "идёт")
    name: 'stats-follow-start',
    title: 'История открыта, игрок купил груз: в списке появился идущий рейс',
    dataset: 'no-runs',
    act: async (app) => {
      await openStats(app, 'История');
      await tradeStims(app, 'buy');
    },
  },
  {
    // ...and it is sold: the run is closed, the list shows it finished, and the routes list has its route
    name: 'stats-follow-done',
    title: 'История открыта, груз продан: рейс завершён, в «Маршрутах» появился маршрут',
    dataset: 'no-runs',
    act: async (app) => {
      await openStats(app, 'История');
      await tradeStims(app, 'buy');
      await tradeStims(app, 'sell');
    },
  },
  {
    name: 'stats-follow-done-routes',
    title: 'Груз продан, открыт список «Маршруты»: в сводке и в таблице новый маршрут',
    dataset: 'no-runs',
    act: async (app) => {
      await openStats(app, 'Маршруты');
      await tradeStims(app, 'buy');
      await tradeStims(app, 'sell');
    },
  },
  {
    name: 'stats-folded',
    title: 'Мои маршруты: секция свёрнута, в заголовке лучший маршрут (история из двух рейсов)',
    dataset: 'window',
    act: (app) => app.expand('preview'),
  },
  {
    name: 'stats-folded-empty',
    title: 'Мои маршруты: секция свёрнута, рейсов ещё не было',
    dataset: 'no-records',
    act: (app) => app.expand('preview'),
  },
  {
    name: 'stats-routes',
    title: 'Мои маршруты: рейтинг маршрутов по UEC/ч',
    dataset: 'stats',
    act: (app) => openStats(app, 'Маршруты'),
  },
  {
    name: 'stats-records',
    title: 'Мои маршруты: «Записи» — свои цены, новые сверху; клик по строке даёт исправить или убрать',
    dataset: 'stats',
    act: (app) => openStats(app, 'Записи'),
  },
  {
    // the hold is made small so that the stock of Medical Supplies at HUR-L1 (my reading, a few minutes old) is a full one;
    // the alert itself is a moment (ten seconds in the mini line): the scene waits it out, what stays is the mark «★1»
    name: 'favourite-ready',
    title: 'Избранный маршрут с полным складом: сигнал прошёл, в мини-строке осталось «★1»',
    dataset: 'default',
    act: async (app) => {
      const meds = [...app.reference.commodities.values()].find((c) => c.code === 'MEDS');
      if (meds === undefined) throw new Error('the dataset has no Medical Supplies');
      await app.updateSetting('favouriteSound', false);
      await app.updateSetting('scuCapacity', 300);
      await app.toggleFavourite({ originId: 3, destId: 5, commodityId: meds.id });
      await pause(10_500);
    },
  },
  {
    name: 'stats-history',
    title: 'Мои маршруты: история рейсов (идущий, завершённые, потерянные, смешанный)',
    dataset: 'stats',
    act: (app) => openStats(app, 'История'),
  },
  {
    name: 'stats-sessions',
    title: 'Мои маршруты: сессии',
    dataset: 'stats',
    act: (app) => openStats(app, 'Сессии'),
  },
  {
    name: 'stats-empty',
    title: 'Мои маршруты: ещё не было рейсов, маршруты',
    dataset: 'no-records',
    act: (app) => openStats(app, 'Маршруты'),
  },
  {
    name: 'stats-empty-history',
    title: 'Мои маршруты: ещё не было рейсов, история',
    dataset: 'no-records',
    act: (app) => openStats(app, 'История'),
  },
  {
    name: 'stats-empty-sessions',
    title: 'Мои маршруты: ещё не было рейсов, сессии',
    dataset: 'no-records',
    act: (app) => openStats(app, 'Сессии'),
  },
  {
    // the terminal is open as well, and the history is long: the window must not exceed the screen (shoot with `--monitor 1366x768@1`)
    name: 'stats-long',
    title: 'Длинная история рядом с открытым терминалом: прокрутка внутри секции (снимать с --monitor 1366x768@1)',
    dataset: 'stats',
    act: async (app) => {
      await app.expand('preview');
      await app.toggleSection('routes');
      await pause(60);
      await click('.sc-seg button', 'История');
    },
  },
  {
    // the same trip in the options with my three runs: the time is my median, "Рейсов 3" (compare `stats-options-estimate`)
    name: 'stats-options-own',
    title: 'Варианты из HUR-L1: у вариантов по паре с моими тремя рейсами время из моей медианы',
    dataset: 'stats',
    act: async (app) => {
      await app.expand('preview');
      await click('header button.route');
      await pause(400);
      await click('.list button.line', 'STIM');
    },
  },
  {
    name: 'stats-options-estimate',
    title: 'Варианты из HUR-L1 без моих рейсов: время по расстоянию, «Рейсов 0»',
    dataset: 'no-runs',
    act: async (app) => {
      await app.expand('preview');
      await click('header button.route');
      await pause(400);
      await click('.list button.line', 'STIM');
    },
  },
];
