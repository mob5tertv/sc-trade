import type { Scene, SceneApp } from './scenes';

// The scenes of task 49 (version 1.1, the small things from the trader's review): the field of the location that sets "Я здесь" by
// Enter, the question "Где прилетел?". They run inside the page; `scenes.ts` imports this module, hence only the type comes from it.

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Where the window stands, for `--do "eval:window.__where()"`: the current location and the viewed terminal (ids: ARC-L1 1, HUR-L1 3, MIC-L1 4),
 * whether the field of the location asks "Где прилетел?", and the target.
 */
function watchWhere(app: SceneApp): void {
  (window as unknown as { __where: () => unknown }).__where = () => ({
    current: app.settings.currentTerminalId,
    viewed: app.viewTerminalId,
    asking: app.askingWhere,
    target: app.settings.targetTerminalId,
    running: app.activeRun !== null,
  });
}

/**
 * What the hint about the keys has done, for `--do "eval:window.__keysHint()"`: whether the flag is set, what the notice line says and whether it
 * has a button, which screen is open and whether the group "Клавиши" of the settings is unfolded. `--do "eval:window.__fold()"` folds the window
 * into the mini line, `--do "eval:window.__unfold()"` expands it again (the hint is not taken away by the fold).
 */
function watchKeysHint(app: SceneApp): void {
  const w = window as unknown as { __keysHint: () => unknown; __fold: () => Promise<void>; __unfold: () => Promise<void> };
  w.__keysHint = () => ({
    flag: app.settings.keysHintShown,
    notice: app.notice === null ? null : { text: app.notice.text, button: app.notice.action?.label ?? null },
    view: app.view,
    keysOpen: app.sectionOpen('settings:keys'),
    mode: app.mode,
  });
  w.__fold = () => app.collapse('preview');
  w.__unfold = () => app.expand('preview');
}

// ids of the preview data: Medical Supplies 1, Stims 8; terminals: ARC-L1 1
const MEDS = 1;
const STIM = 8;
const ARC_L1 = 1;

/** The run of the dataset `run` (MEDS and STIM bought at HUR-L1, the target ARC-L1) is sold out at its target: the last sale closes the run. */
async function sellOut(app: SceneApp): Promise<void> {
  await app.expand('preview');
  app.setViewTerminal(ARC_L1);
  await app.sell({ terminalId: ARC_L1, commodityId: MEDS, scu: 120, price: 2540, knownScu: 90 });
  await app.sell({ terminalId: ARC_L1, commodityId: STIM, scu: 80, price: 3320 });
  await pause(200);
}

/** The settings with the group "Данные" unfolded, where the button "Выход" is (`--do "click:.quit"`). */
async function openDataSettings(app: SceneApp): Promise<void> {
  await app.expand('preview');
  app.openSettings();
  await app.toggleSection('settings:data');
  await pause(100);
}

/** The window at its narrowest (380 px) with only the section "Мои маршруты" open, on the list `view`: what is left of the two ends of a long route. */
async function openNarrowStats(app: SceneApp, view: 'Маршруты' | 'История'): Promise<void> {
  await app.updateSetting('panelWidth', 380);
  await app.expand('preview');
  await app.toggleSection('terminal');
  await app.toggleSection('routes');
  await pause(60);
  if (view !== 'Маршруты') {
    const tab = [...document.querySelectorAll<HTMLElement>('.sc-seg button')].find((el) => (el.textContent ?? '').includes(view));
    if (tab === undefined) throw new Error(`the scene wants the tab "${view}", and there is none`);
    tab.click();
    await pause(60);
  }
}

/**
 * HUR-L1, the buy side, the row of ALUM (UEX knows its price there and nobody knows the stock: the dash in the column «SCU») is opened and
 * "Купил" is pressed: the form offers the whole hold and says that the stock is unknown. A click on the button is the ordinary click of the form.
 */
async function openFormWithoutStock(app: SceneApp): Promise<void> {
  await app.expand('preview');
  const find = (selector: string, text: string): HTMLElement => {
    const found = [...document.querySelectorAll<HTMLElement>(selector)].find((el) => (el.textContent ?? '').includes(text));
    if (found === undefined) throw new Error(`the scene wants "${selector}" with "${text}", and there is none`);
    return found;
  };
  find('.table button.line', 'ALUM').click();
  await pause(120);
  find('.expand button', 'Купил').click();
  await pause(150);
}

export const TRADER_SCENES: readonly Scene[] = [
  {
    // nobody knows the stock of ALUM at HUR-L1: the form still offers the whole hold, and now says so: a «?» by the quantity and one line under the form
    name: 'trade-stock-unknown',
    title: '«Купил» товар с неизвестным запасом: «?» у количества и строка «Запас неизвестен: количество — по трюму и бюджету»',
    dataset: 'default',
    act: openFormWithoutStock,
  },
  {
    // the same form in the narrowest window (380 px): the sum gives way, the «?» and the line stay
    name: 'trade-stock-unknown-narrow',
    title: '«Купил» товар с неизвестным запасом в самом узком окне (380 px)',
    dataset: 'default',
    act: async (app) => {
      await app.updateSetting('panelWidth', 380);
      await openFormWithoutStock(app);
    },
  },
  { name: 'stats-routes-narrow', title: 'Мои маршруты: рейтинг маршрутов в самом узком окне (380 px)', dataset: 'stats', act: (app) => openNarrowStats(app, 'Маршруты') },
  { name: 'stats-history-narrow', title: 'Мои маршруты: история рейсов в самом узком окне (380 px)', dataset: 'stats', act: (app) => openNarrowStats(app, 'История') },
  {
    // "Где купить" for HUR-L1 over the data of the run: Tungsten from Admin 4 rests on a stock nobody knows (the «?»), and pays better per hour than
    // five trips with a known stock that stand above it; with the ROI (`--do "click:.sc-seg[aria-label=Сортировка] button:nth-child(2)"`) it still
    // stands below every known one. Twelve options are asked for, so that the whole list is on the screen.
    name: 'options-unknown-stock',
    title: 'Варианты «Где купить» для HUR-L1: вариант с «?» (запас неизвестен) стоит ниже всех, у кого запас известен, при любой сортировке',
    dataset: 'run',
    act: async (app) => {
      await app.updateSetting('topN', 12);
      await app.expand('preview');
      await app.runLookup({ kind: 'to', terminalId: 3, commodityId: null, price: null });
      await pause(500);
    },
  },
  {
    // a run is going: the button asks first, in a line under the header (`--do "click:.quit;wait:200"`)
    name: 'settings-quit-run',
    title: 'Настройки → Данные, идёт рейс: «Выход» спрашивает «Идёт рейс. Закрыть программу?»',
    dataset: 'run',
    act: openDataSettings,
  },
  {
    // no run: the button leaves at once (the preview's log says `quit`; no question)
    name: 'settings-quit-idle',
    title: 'Настройки → Данные, рейса нет: «Выход» закрывает программу сразу',
    dataset: 'default',
    act: openDataSettings,
  },
  {
    // no key for the marks: the notice of the closed run goes on with the hint and its button (`--do "click:.notice .action"` opens the keys)
    name: 'keys-hint',
    title: 'После первого закрытого рейса без клавиш «Взлетел» и «Прилетел»: подсказка про клавиши с кнопкой «Настроить»',
    dataset: 'run',
    act: async (app) => {
      watchKeysHint(app);
      await sellOut(app);
    },
  },
  {
    // the flag of the hint cannot be written: the hint is on the screen all the same (it is shown BEFORE it is remembered), nothing says a word of
    // the settings, and the flag stays false (`__keysHint()`: flag false, the notice with its button), so the hint may come once more
    name: 'keys-hint-save-fails',
    title: 'Подсказка про клавиши: флаг не записывается, подсказка всё равно на экране, ошибки настроек нет',
    dataset: 'run',
    act: async (app) => {
      watchKeysHint(app);
      (globalThis as { __previewSettingWriteFails?: string[] }).__previewSettingWriteFails = ['keysHintShown'];
      await sellOut(app);
    },
  },
  {
    // a lost cargo is a result in the colour of an error: no hint and no flag, it waits for the next closed run
    name: 'keys-hint-lost-cargo',
    title: 'Груз потерян: итог ошибкой, подсказки про клавиши нет и флаг не пишется',
    dataset: 'run',
    act: async (app) => {
      watchKeysHint(app);
      await app.expand('preview');
      await app.loseCargo();
      await pause(200);
    },
  },
  {
    // a key for the take-off is assigned before: the player knows the keys, the notice is the result of the run alone, and the flag is set
    name: 'keys-hint-key-assigned',
    title: 'Клавиша «Взлетел» назначена раньше: после закрытого рейса подсказки нет и больше не будет',
    dataset: 'run',
    act: async (app) => {
      watchKeysHint(app);
      await app.updateSetting('hotkeyDepart', 'F9');
      await sellOut(app);
    },
  },
  {
    // the hint was shown once already (the flag): the run that closes now says its result and nothing else
    name: 'keys-hint-shown-before',
    title: 'Подсказка про клавиши уже была показана: рейс закрывается без неё',
    dataset: 'run',
    act: async (app) => {
      watchKeysHint(app);
      await app.updateSetting('keysHintShown', true);
      await sellOut(app);
    },
  },
  {
    // ARC-L1, the sell side, the hold has MEDS and STIM (the cargo stands first): the row of MEDS is opened, then MEDS is sold out. Its row stays the first
    // one, open (the order is held while a row is open); `--do "click:.row.selected .line;wait:200"` folds it, and then the rows go to their places
    name: 'open-row-keeps-place',
    title: 'Продать: раскрытая строка проданного товара остаётся на месте; свёрнута — строки встают по порядку',
    dataset: 'run',
    act: async (app) => {
      await app.expand('preview');
      app.setViewTerminal(ARC_L1);
      app.setTerminalSide('sell');
      await pause(150);
      const line = [...document.querySelectorAll<HTMLElement>('.table button.line')].find((el) => (el.textContent ?? '').includes('MEDS'));
      if (line === undefined) throw new Error('the scene wants the row of MEDS on the sell side, and there is none');
      line.click();
      await pause(150);
      await app.sell({ terminalId: ARC_L1, commodityId: MEDS, scu: 120, price: 2540, knownScu: 90 });
      await pause(300);
    },
  },
  {
    // HUR-L1 is the current location; `--do "click:header input;type:arc;press:Enter;eval:window.__where()"` makes ARC-L1 the viewed one AND the current one
    name: 'pick-no-run',
    title: 'Локация: без рейса Enter в поле делает выбранный терминал и просматриваемым, и текущей локацией',
    dataset: 'default',
    act: async (app) => {
      watchWhere(app);
      await app.expand('preview');
    },
  },
  {
    // a run is flying from HUR-L1 to ARC-L1: Enter only views (`press:Ctrl+Enter` is "Я здесь")
    name: 'pick-in-run',
    title: 'Локация: в рейсе Enter только смотрит терминал, Ctrl+Enter — «Я здесь»',
    dataset: 'run-flight',
    act: async (app) => {
      watchWhere(app);
      await app.expand('preview');
    },
  },
  {
    // the run is in the air, the target is taken away and the arrival is marked: nothing tells where the ship has landed
    name: 'arrived-no-target',
    title: 'После «Прилетел» без цели поле локации спрашивает «Где прилетел?»',
    dataset: 'run-flight',
    act: async (app) => {
      watchWhere(app);
      await app.setTarget(null);
      await app.mark('arrive');
      await app.expand('preview');
      await pause(100);
    },
  },
];
