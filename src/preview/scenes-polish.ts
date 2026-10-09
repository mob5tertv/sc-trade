import { installPriceFake, type PriceFake, type PriceFakeOptions } from './fake-prices';
import type { Scene, SceneApp } from './scenes';
import { hoverAndPress } from './scenes-keyboard';

// The scenes of task 44, the last polish of the run and the trades (the persona review of an experienced hauler): the form of a
// trade that marks a price that is not mine, the notice of a run that was closed, the sign that says the window holds the keyboard
// and the target set from the section «Рейс». They run inside the page, so they reach for the elements themselves, as the scenes of
// `scenes.ts` do (that module imports this one, hence only the type comes from it).
// The list is added to `SCENES` in `scenes.ts`.

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until `done()` is true; a scene that waits for what never comes fails with what it waited for. */
async function until(what: string, done: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!done()) {
    if (performance.now() > deadline) throw new Error(`the scene waited ${timeoutMs / 1000} s for ${what}`);
    await pause(25);
  }
}

/** A click on what is on the screen, the way a button handler sees it; a scene that names something that is not there fails with its name. */
async function click(selector: string, text?: string): Promise<void> {
  const found = [...document.querySelectorAll<HTMLElement>(selector)].find((el) => text === undefined || (el.textContent ?? '').includes(text));
  if (found === undefined) throw new Error(`the scene wants to click "${selector}"${text === undefined ? '' : ` with "${text}"`}, and there is none`);
  found.click();
  await pause(60);
}

// ids of the preview data: terminals HUR-L1 3, ARC-L1 1; the run of `run-loading` bought at HUR-L1
const HUR_L1 = 3;
const ARC_L1 = 1;

/**
 * What the sign of the keyboard says, for `--do "eval:window.__keyboard()"` (whether the window holds the keyboard, what the sign says, who has
 * the keyboard in the mocked Windows), what the header looks like, for `eval:window.__header()` (the left edge and the width of every part of
 * the header, and the width of the location field), and how many price requests UEX got and how many times the player asked for a refresh,
 * for `eval:window.__sync()`. The price requests are answered by a fake (the preview has no network), which also counts them.
 */
function watchKeyboard(app: SceneApp, fake: PriceFake): void {
  const global = window as unknown as Record<string, () => unknown>;
  const part = (el: Element): [string, number, number] => {
    const { left, width } = el.getBoundingClientRect();
    return [el.className.toString().replace(/\bsvelte-\w+\b/g, '').trim().split(' ')[0] || el.tagName.toLowerCase(), Math.round(left), Math.round(width)];
  };
  global.__keyboard = () => ({
    held: app.keyboardHeld,
    sign: (document.querySelector('header .uex .keys') ?? document.querySelector('header .badge'))?.textContent?.trim() ?? null,
    indicator: document.querySelector('header .uex .face')?.textContent?.trim() ?? null,
    owner: window.__preview?.state().keyboard,
  });
  global.__header = () => JSON.stringify({
    root: Math.round(document.querySelector('.sc-root')?.getBoundingClientRect().width ?? 0),
    location: Math.round(document.querySelector('header .location input')?.getBoundingClientRect().width ?? 0),
    parts: [...document.querySelectorAll('header.bar > *')].map(part),
  });
  // the width of the slot of the indicator for each text it can have (the text is put in by hand and put back: nothing is drawn for long)
  global.__slot = () => {
    const slot = document.querySelector<HTMLElement>('header .uex');
    const text = slot?.querySelector('.face')?.lastChild;
    if (!slot || !text) return 'no indicator';
    const own = text.textContent;
    const widths = ['UEX 12 мин', 'UEX сейчас', 'UEX 23/57', 'UEX 1,5 ч', 'UEX 2 д', 'UEX 59 мин', 'UEX 12/17', 'UEX …', 'UEX не загружен', 'UEX недоступен', 'UEX офлайн 12 мин']
      .map((shown) => {
        text.textContent = shown;
        return [shown, Math.round(slot.getBoundingClientRect().width * 10) / 10];
      });
    text.textContent = own;
    // the sign needs its own text and the padding of the slot (4 + 4)
    const keys = slot.querySelector('.keys');
    const range = document.createRange();
    if (keys !== null) range.selectNodeContents(keys);
    return JSON.stringify({ widths, sign: keys === null ? null : Math.round((range.getBoundingClientRect().width + 8) * 10) / 10 });
  };
  global.__sync = () => ({
    priceRequests: fake.asked(),
    refreshAsked: (window.__preview?.log ?? []).filter((line) => line.includes('refresh prices')).length,
  });
}

/** `window.__binds()`: how many times the trigger keys went to the Rust side (`set_trigger_keys`) and how many `bound` lines the log got, counted from now on. */
function watchBinds(): void {
  const count = (text: string): number => (window.__preview?.log ?? []).filter((line) => line.includes(text)).length;
  const [calls0, bound0] = [count('set_trigger_keys'), count('[trigger] bound')];
  (window as unknown as { __binds: () => unknown }).__binds = () => ({ calls: count('set_trigger_keys') - calls0, bound: count('[trigger] bound') - bound0 });
}

/** The player presses the location field: the window holds the keyboard. */
async function holdKeyboard(): Promise<void> {
  await hoverAndPress('header input');
}

/** The price requests answered by a fake, so that a click on the indicator can be counted (and a refresh can really go). */
const pricesOf = (app: SceneApp, options: Omit<PriceFakeOptions, 'rows'> = {}): PriceFake =>
  installPriceFake({ rows: () => app.market.uex.values(), ...options });

export const POLISH_SCENES: readonly Scene[] = [
  {
    // The pointer comes over the field of the location and presses it: the window holds the keyboard, and the UEX indicator of the header says how to
    // give it back, in its own place. The ship stands where the window looks: no «Я здесь». `--do "eval:window.__header();click:header .uex;wait:600;
    // eval:window.__header()"` prints the header with the sign and without it (every part but the location field stays as it is), the click
    // gives the keyboard back and asks for no refresh (`eval:window.__sync()`).
    name: 'keyboard-sign',
    title: 'Клавиатура у окна (клик в поле локации): в шапке на месте индикатора UEX «Esc — в игру», «Я здесь» нет',
    dataset: 'default',
    act: async (app) => {
      watchKeyboard(app, pricesOf(app));
      await app.expand('preview');
      await holdKeyboard();
    },
  },
  {
    // another terminal is viewed: «Я здесь» is in the header too, the fullest it is
    name: 'keyboard-sign-here',
    title: 'Клавиатура у окна, в шапке «Я здесь»: знак на месте индикатора UEX, остальное не сдвинулось',
    dataset: 'default',
    act: async (app) => {
      watchKeyboard(app, pricesOf(app));
      await app.expand('preview');
      app.setViewTerminal(5);
      await pause(60);
      await holdKeyboard();
    },
  },
  {
    // the narrowest window the settings allow, no «Я здесь»
    name: 'keyboard-sign-narrow',
    title: 'Клавиатура у окна, самое узкое окно (380 px): знак на месте индикатора, поле локации не сжато',
    dataset: 'default',
    act: async (app) => {
      watchKeyboard(app, pricesOf(app));
      await app.updateSetting('panelWidth', 380);
      await app.expand('preview');
      await holdKeyboard();
    },
  },
  {
    // ...and with «Я здесь»
    name: 'keyboard-sign-narrow-here',
    title: 'Клавиатура у окна, самое узкое окно (380 px) и «Я здесь»: знак на месте индикатора, остальное не сдвинулось',
    dataset: 'default',
    act: async (app) => {
      watchKeyboard(app, pricesOf(app));
      await app.updateSetting('panelWidth', 380);
      await app.expand('preview');
      app.setViewTerminal(5);
      await pause(60);
      await holdKeyboard();
    },
  },
  {
    // the indicator says «UEX офлайн 12 мин» (the longest of its texts, in the warning colour): the slot keeps that width under the sign
    name: 'keyboard-sign-offline',
    title: 'Клавиатура у окна при «UEX офлайн 12 мин»: знак на месте индикатора, слот сохраняет его ширину',
    dataset: 'default',
    act: async (app) => {
      const fake = pricesOf(app, { failTerminals: new Set([2, 7, 8]) });
      watchKeyboard(app, fake);
      await app.expand('preview');
      await click('header button.uex');
      await until('the refresh to end', () => !app.priceSync.running);
      await pause(100);
      await holdKeyboard();
    },
  },
  {
    // a refresh is on its way (four batches done, the fifth waits): the sign hides the progress, the refresh goes on; when the keyboard goes back the
    // indicator shows the progress again: `--do "click:header .uex;wait:600;eval:window.__keyboard()"`
    name: 'keyboard-sign-syncing',
    title: 'Клавиатура у окна во время обновления цен: знак на месте «UEX 4/9», обновление идёт дальше',
    dataset: 'default',
    act: async (app) => {
      const fake = pricesOf(app, { passes: 4 });
      watchKeyboard(app, fake);
      await app.expand('preview');
      await click('header button.uex');
      await until('the fifth price request', () => fake.asked() >= 5);
      await pause(100);
      await holdKeyboard();
    },
  },
  {
    // the settings have free room in their header: the sign is a badge of its own there, and the collapse button stays where it was
    name: 'keyboard-sign-settings',
    title: 'Клавиатура у окна в настройках (клик в поле «Вместимость»): в шапке настроек плашка «Esc — в игру», кнопка «Свернуть» на месте',
    dataset: 'default',
    act: async (app) => {
      watchKeyboard(app, pricesOf(app));
      await app.expand('preview');
      app.openSettings();
      await pause(60);
      await hoverAndPress('#set-scuCapacity');
    },
  },
  {
    name: 'keyboard-sign-settings-narrow',
    title: 'Клавиатура у окна в настройках, самое узкое окно (380 px): плашка в шапке настроек, кнопка «Свернуть» на месте',
    dataset: 'default',
    act: async (app) => {
      watchKeyboard(app, pricesOf(app));
      await app.updateSetting('panelWidth', 380);
      await app.expand('preview');
      app.openSettings();
      await pause(60);
      await hoverAndPress('#set-scuCapacity');
    },
  },
  {
    // No trigger key is assigned (the usual case). A visit to a key field of the settings suspends the keys and, when the focus is gone, applies
    // them again: with nothing saved and nothing bound that is no call to the Rust side and no line `bound` in the log. `--do "click:#set-hotkeyPanel;
    // wait:300;click:.title;wait:300;eval:window.__binds()"` prints the number of `set_trigger_keys` calls and of `bound` lines since the start of the scene.
    name: 'settings-keys-visit',
    title: 'Настройки → Клавиши, ничего не назначено: заход в поле клавиши и выход из него не обращаются к Rust (ни одного set_trigger_keys)',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      app.openSettings();
      await app.toggleSection('settings:keys');
      await pause(100);
      watchBinds();
    },
  },
  {
    // A key is assigned: the same visit unbinds it while the field has the focus and binds it again afterwards: two calls, as before
    name: 'settings-keys-visit-assigned',
    title: 'Настройки → Клавиши, назначена клавиша панели: заход в поле клавиши снимает её, выход возвращает (два вызова set_trigger_keys)',
    dataset: 'default',
    act: async (app) => {
      await app.updateSetting('hotkeyPanel', 'F8');
      await app.expand('preview');
      app.openSettings();
      await app.toggleSection('settings:keys');
      await pause(100);
      watchBinds();
    },
  },
  {
    // A run goes on and its target is taken away; the player looks at ARC-L1, not at the terminal of the purchase: the header of the section
    // offers it as the target. `--do "click:.offer;wait:400;eval:..."` makes it one (the same `setTarget` as the button of an option).
    name: 'run-target-offer',
    title: '«Рейс» без цели, в шапке окна другой терминал (ARC-L1): кнопка «Цель: ARC-L1» вместо «цель не выбрана»',
    dataset: 'run-loading',
    act: async (app) => {
      await app.expand('preview');
      await app.toggleSection('run');
      await app.setTarget(null);
      app.setViewTerminal(ARC_L1);
      await pause(100);
    },
  },
  {
    // the narrowest window the settings allow: the name of the terminal is cut before the mark button is pushed out of the header
    name: 'run-target-offer-narrow',
    title: '«Рейс» без цели в самом узком окне (380 px): кнопка «Цель: …» и «Взлетел» в одной шапке',
    dataset: 'run-loading',
    act: async (app) => {
      await app.updateSetting('panelWidth', 380);
      await app.expand('preview');
      await app.toggleSection('run');
      await app.setTarget(null);
      app.setViewTerminal(5);
      await pause(100);
    },
  },
  {
    // ...and at the terminal where the cargo was bought the run does not fly there: no offer, the header says «цель не выбрана» as before
    name: 'run-target-offer-here',
    title: '«Рейс» без цели, в шапке окна терминал первой покупки (HUR-L1): кнопки нет, «цель не выбрана»',
    dataset: 'run-loading',
    act: async (app) => {
      await app.expand('preview');
      await app.toggleSection('run');
      await app.setTarget(null);
      app.setViewTerminal(HUR_L1);
      await pause(100);
    },
  },
  {
    // The cargo is lost and the window is folded at once: the mini line says it, in the colour of an error, for eight seconds (the other
    // messages of the line stay three). `--do "wait:6000;eval:window.__flash()"` still has the text, `--do "wait:9000;eval:window.__flash()"` has none.
    name: 'run-closed-mini',
    title: 'Груз потерян, окно свёрнуто: мини-строка говорит итог красным, 8 секунд',
    dataset: 'run',
    act: async (app) => {
      (window as unknown as { __flash: () => unknown }).__flash = () => ({ text: app.flash, kind: app.flashKind });
      await app.expand('preview');
      await app.loseCargo();
      await app.collapse('preview');
    },
  },
  {
    // A run goes on and a cargo that was never bought through the application is sold (an income); the window is folded at once. The mini line says
    // «Доход записан…» for the usual three seconds, and then draws the mark button again (it is not drawn while a message is up):
    // `--do "eval:window.__mini();wait:4000;eval:window.__mini()"` prints the message and the buttons right after and four seconds later.
    name: 'run-income-mini',
    title: 'Доход записан при идущем рейсе, окно свёрнуто: мини-строка говорит об этом три секунды, затем снова кнопка отметки',
    dataset: 'run',
    act: async (app) => {
      (window as unknown as { __mini: () => unknown }).__mini = () => ({
        flash: app.flash, marks: document.querySelectorAll('.marks button').length, notice: app.notice?.text ?? null,
      });
      await app.expand('preview');
      await app.sell({ terminalId: 4, commodityId: 2, scu: 150, price: 6742 }, true);
      await app.collapse('preview');
    },
  },
  {
    // The sale of the last cargo that makes a profit, the window folded after it: the line says it in the accent colour
    name: 'run-sold-mini',
    title: 'Последний груз продан, окно свёрнуто: мини-строка говорит итог рейса',
    dataset: 'run',
    act: async (app) => {
      (window as unknown as { __flash: () => unknown }).__flash = () => ({ text: app.flash, kind: app.flashKind });
      await app.expand('preview');
      app.setViewTerminal(ARC_L1);
      await app.sell({ terminalId: ARC_L1, commodityId: 1, scu: 120, price: 2540, knownScu: 90 });
      await app.sell({ terminalId: ARC_L1, commodityId: 8, scu: 80, price: 3320 });
      await app.collapse('preview');
    },
  },
  {
    // ALUM has only a price of UEX at HUR-L1: the form of the purchase starts with it, and the field is muted until it is touched
    // (`--do "eval:..."` reads the class `foreign` of `form.trade .in-price`; typing into the field makes the number the player's)
    name: 'trade-buy-foreign',
    title: '«Купил» для товара, у которого только цена UEX: цена в форме приглушена, пока её не тронули',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      await click('.table button.line', 'ALUM');
      await click('.expand button', 'Купил');
    },
  },
];
