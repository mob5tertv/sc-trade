import type { app } from '../ui/state.svelte';
import type { DatasetName } from './datasets';
import { ANCHOR_SCENES } from './scenes-anchor';
import { CLEAR_SCENES } from './scenes-clear';
import { INCOME_SCENES } from './scenes-income';
import { INDICATOR_SCENES } from './scenes-indicators';
import { KEYBOARD_SCENES } from './scenes-keyboard';
import { ROI_SCENES } from './scenes-roi';
import { REPAIR_SCENES } from './scenes-repairs';
import { RUN_SCENES } from './scenes-run';
import { STATS_SCENES } from './scenes-stats';

/** The one state of the application; scenes drive it only through its public methods. */
export type SceneApp = typeof app;

export interface Scene {
  /** The value of the `scene=` parameter. */
  name: string;
  /** What the scene shows, for the selector of the desktop page (Russian). */
  title: string;
  /** The test data the database is filled with (`seed.ts`). */
  dataset: DatasetName;
  /** The monitor the scene needs, `<width>x<height>@<scale>`, when it is not the default one (`preview:sweep` loads it with it). */
  monitor?: string;
  /** Runs before the application is loaded: puts in place what its start has to meet (a failure made on purpose, see `ipc.ts`). */
  beforeStart?: () => void;
  /** What happens after the application has started and settled: expand the window, open the settings, and so on. */
  act?: (app: SceneApp) => Promise<void> | void;
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A click on what is on the screen, the way a button handler sees it. The scenes run inside the page, so they reach
 * for the elements themselves; a scene that names something that is not there fails with its name.
 */
async function click(selector: string, text?: string): Promise<void> {
  const found = [...document.querySelectorAll<HTMLElement>(selector)].find((el) => text === undefined || (el.textContent ?? '').includes(text));
  if (found === undefined) throw new Error(`the scene wants to click "${selector}"${text === undefined ? '' : ` with "${text}"`}, and there is none`);
  found.click();
  await pause(60);
}

/** The row of the table of the Terminal section with this commodity code. */
const openRow = (code: string): Promise<void> => click('.table button.line', code);

// To add a scene: one more entry below. To add a dataset: `datasets.ts` and `seed.ts`.
export const SCENES: readonly Scene[] = [
  ...ROI_SCENES,
  ...RUN_SCENES,
  { name: 'mini', title: 'Мини-строка, без рейса', dataset: 'default' },
  { name: 'mini-run', title: 'Мини-строка в рейсе', dataset: 'run' },
  {
    name: 'mini-bottom-left',
    title: 'Мини-строка в левом нижнем углу',
    dataset: 'default',
    act: async (app) => void (await app.setCorner('bottom-left')),
  },
  ...ANCHOR_SCENES,
  { name: 'expanded', title: 'Развёрнутый вид: терминал, сторона «Купить»', dataset: 'default', act: (app) => app.expand('preview') },
  {
    name: 'expanded-sell',
    title: 'Развёрнутый вид: сторона «Продать»',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      app.setTerminalSide('sell');
    },
  },
  {
    name: 'expanded-row',
    title: 'Развёрнутый вид: выдвинута строка товара',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      await openRow('MEDS');
    },
  },
  {
    name: 'expanded-entry',
    title: 'Развёрнутый вид: выдвинута строка быстрого ввода',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      await click('button.entry');
    },
  },
  {
    // five trips of five tiers of ROI (the `window` dataset)
    name: 'expanded-options',
    title: 'Развёрнутый вид после «Маршрут»: пять вариантов под таблицей, ROI разных ступеней',
    dataset: 'window',
    act: async (app) => {
      await app.expand('preview');
      await click('header button.route');
      await pause(400);
    },
  },
  {
    name: 'expanded-options-row',
    title: 'Варианты: выдвинуты подробности первого варианта',
    dataset: 'window',
    act: async (app) => {
      await app.expand('preview');
      await click('header button.route');
      await pause(400);
      await click('.list button.line');
    },
  },
  {
    // «Где купить» from the sell side of a terminal: the trips that END at Area 18 (the other end is named)
    name: 'expanded-options-to',
    title: 'Поиск «Где купить» для Gold на стороне «Продать» терминала Area 18',
    dataset: 'window',
    act: async (app) => {
      await app.expand('preview');
      app.setViewTerminal(5);
      app.setTerminalSide('sell');
      await pause(60);
      await openRow('GOLD');
      await click('button', 'Где купить');
      await pause(400);
    },
  },
  {
    // trips from HUR-L1 and from the other terminals of Hurston: a row that starts elsewhere names both ends
    name: 'expanded-options-nearby',
    title: 'Поиск «Отсюда» с «и рядом»: у вариантов с другого терминала Хёрстона названы оба конца',
    dataset: 'window',
    act: async (app) => {
      await app.expand('preview');
      await app.updateSetting('nearby', true);
      await click('header button.route');
      await pause(400);
    },
  },
  {
    // a terminal with more rows than the window holds: the table scrolls inside its section (shoot with `--monitor 1366x768@1`)
    name: 'expanded-tall',
    title: 'Терминал с 26 товарами на стороне «Продать»: таблица прокручивается (снимать с --monitor 1366x768@1)',
    dataset: 'window',
    monitor: '1366x768@1',
    act: async (app) => {
      await app.expand('preview');
      app.setViewTerminal(5);
      app.setTerminalSide('sell');
      await app.runLookup({ kind: 'to', terminalId: 5, commodityId: null, price: null });
      await pause(400);
    },
  },
  {
    // the star system of the settings is "all": the list holds the terminals of every system, and "Stanton Gateway" stands in
    // two of them (`--do "click:header input;type:stanton g"`)
    name: 'search-places',
    title: 'Поиск локации: у вариантов подписано место (все системы, «Stanton Gateway» в двух системах)',
    dataset: 'window',
    act: async (app) => {
      await app.updateSetting('starSystemId', null);
      await app.expand('preview');
    },
  },
  {
    // the narrowest window the settings allow: the list must not be wider than the window (`--do "click:header input;type:stanton g"`)
    name: 'search-places-narrow',
    title: 'Поиск локации в самом узком окне (380 px): место подписано, список не шире окна',
    dataset: 'window',
    act: async (app) => {
      await app.updateSetting('starSystemId', null);
      await app.updateSetting('panelWidth', 380);
      await app.expand('preview');
    },
  },
  {
    name: 'expanded-empty',
    title: 'Терминал, о котором ничего не известно (Seraphim Station): одна приглушённая строка',
    dataset: 'window',
    act: async (app) => {
      await app.expand('preview');
      app.setViewTerminal(12);
      await pause(60);
    },
  },
  {
    // low window at the bottom: a list that opens from the quick entry must stay on the screen (`--do "click:.quick input;type:ste"`)
    name: 'expanded-empty-bottom-left',
    title: 'Терминал без цен, окно в левом нижнем углу, выдвинута строка быстрого ввода',
    dataset: 'window',
    act: async (app) => {
      await app.setCorner('bottom-left');
      await app.expand('preview');
      app.setViewTerminal(12);
      await pause(60);
      await click('button.entry');
    },
  },
  {
    // the cargo space is not set: «Маршрут» says so in one line and offers the settings
    name: 'no-capacity',
    title: 'Вместимость трюма не задана: «Маршрут» просит указать корабль',
    dataset: 'default',
    act: async (app) => {
      await app.updateSetting('scuCapacity', 0);
      await app.expand('preview');
      await click('header button.route');
      await pause(200);
    },
  },
  {
    name: 'expanded-bottom-left',
    title: 'Развёрнутый вид в левом нижнем углу',
    dataset: 'default',
    act: async (app) => {
      await app.setCorner('bottom-left');
      await app.expand('preview');
    },
  },
  {
    // the window is only as tall as its content: every section is folded
    name: 'expanded-short',
    title: 'Развёрнутый вид, секция «Терминал» свёрнута (окно низкое)',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      await app.toggleSection('terminal');
    },
  },
  {
    // Windows delivers the loss of the focus that a give causes a moment later (here 400 ms): `click:input;press:Escape;click:input`
    // must still end with the keyboard in the window.
    name: 'slow-blur',
    title: 'Низкое окно, потеря фокуса приходит с задержкой 400 мс',
    dataset: 'default',
    act: async (app) => {
      (window as unknown as { __previewBlurDelayMs: number }).__previewBlurDelayMs = 400;
      await app.expand('preview');
      await app.toggleSection('terminal');
    },
  },
  {
    // the mini line is switched off and the window is hidden: expanding it must place it before it is shown
    name: 'hidden-expand',
    title: 'Мини-строка выключена, окно разворачивается из скрытого',
    dataset: 'default',
    act: async (app) => {
      await app.updateSetting('showStrip', false);
      await app.expand('preview');
    },
  },
  {
    name: 'expanded-short-bottom-left',
    title: 'Низкое окно в левом нижнем углу',
    dataset: 'default',
    act: async (app) => {
      await app.setCorner('bottom-left');
      await app.expand('preview');
      await app.toggleSection('terminal');
    },
  },
  {
    name: 'settings',
    title: 'Развёрнутый вид, настройки',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      app.openSettings();
    },
  },
  {
    name: 'settings-open-all',
    title: 'Настройки: все группы открыты',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      app.openSettings();
      for (const id of ['fresh', 'routes', 'keys', 'window', 'data']) await app.toggleSection(`settings:${id}`);
    },
  },
  {
    // the window unfolds by itself when the start fails (`fail` in boot.ts); the player folds it, and the line says it
    name: 'mini-boot-failed',
    title: 'Мини-строка после ошибки запуска: окно развернулось само, игрок его свернул',
    dataset: 'empty',
    act: (app) => app.collapse('preview'),
  },
  { name: 'boot-failed', title: 'Ошибка запуска: пустая база, UEX недоступен (окно развернулось само)', dataset: 'empty' },
  {
    // The database was written by a newer version of the application: the start stops at the check of the schema, before
    // it backs anything up or migrates, and the screen says so in the words of the error itself, not in the general sentence.
    name: 'boot-newer-database',
    title: 'Ошибка запуска: база создана более новой версией программы (текст самой ошибки)',
    dataset: 'newer-schema',
  },
  {
    // The player has just clicked the mini bar, so the cursor is over the window. `hover:.sc-root;leave;wait:3000`
    // takes it away: the window folds 2 seconds later, unless the keyboard or a dialog holds it.
    name: 'idle',
    title: 'Развёрнутый вид, курсор над окном, сворачивается через 2 с после ухода курсора',
    dataset: 'default',
    act: async (app) => {
      await app.updateSetting('idleCollapseSec', 2);
      await app.expand('preview');
      app.pointer(true);
    },
  },
  ...INCOME_SCENES,
  ...STATS_SCENES,
  ...CLEAR_SCENES,
  ...INDICATOR_SCENES,
  ...KEYBOARD_SCENES,
  ...REPAIR_SCENES,
];

export const DEFAULT_SCENE = 'mini';

export const findScene = (name: string): Scene | undefined => SCENES.find((scene) => scene.name === name);
