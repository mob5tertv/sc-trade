import type { Scene, SceneApp } from './scenes';
import { hoverAndPress } from './scenes-keyboard';

// The scenes of task 44, the last polish of the run and the trades (the persona review of an experienced hauler): the form of a
// trade that marks a price that is not mine, the notice of a run that was closed, the badge that says the window holds the keyboard
// and the target set from the section «Рейс». They run inside the page, so they reach for the elements themselves, as the scenes of
// `scenes.ts` do (that module imports this one, hence only the type comes from it).
// The list is added to `SCENES` in `scenes.ts`.

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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

/** What the badge of the keyboard says, for `--do "eval:window.__keyboard()"`: whether the window holds the keyboard, whether the badge is drawn, who has the keyboard in the mocked Windows. */
function watchKeyboard(app: SceneApp): void {
  (window as unknown as { __keyboard: () => unknown }).__keyboard = () => ({
    held: app.keyboardHeld,
    badge: document.querySelector('.badge')?.textContent?.trim() ?? null,
    owner: window.__preview?.state().keyboard,
  });
}

export const POLISH_SCENES: readonly Scene[] = [
  {
    // The pointer comes over the field of the location and presses it: the window holds the keyboard, and the header says how to give it
    // back. Another terminal is viewed, so «Я здесь» is there too: the fullest header. `--do "click:.badge;wait:300;eval:window.__keyboard()"`
    // gives the keyboard back, and the badge goes away.
    name: 'keyboard-badge',
    title: 'Клавиатура у окна (клик в поле локации): в шапке «Esc — в игру», рядом «Я здесь»',
    dataset: 'default',
    act: async (app) => {
      watchKeyboard(app);
      await app.expand('preview');
      app.setViewTerminal(5);
      await pause(60);
      await hoverAndPress('header input');
    },
  },
  {
    // the ship stands where the window looks (no «Я здесь»): the header has room for the whole plaque
    name: 'keyboard-badge-plain',
    title: 'Клавиатура у окна (клик в поле локации), «Я здесь» нет: в шапке плашка «Esc — в игру» целиком',
    dataset: 'default',
    act: async (app) => {
      watchKeyboard(app);
      await app.expand('preview');
      await hoverAndPress('header input');
    },
  },
  {
    // the same in the narrowest window the settings allow
    name: 'keyboard-badge-narrow',
    title: 'Клавиатура у окна, самое узкое окно (380 px), виден «Я здесь»: знак в шапке не вытесняет кнопки',
    dataset: 'default',
    act: async (app) => {
      watchKeyboard(app);
      await app.updateSetting('panelWidth', 380);
      await app.expand('preview');
      app.setViewTerminal(5);
      await pause(60);
      await hoverAndPress('header input');
    },
  },
  {
    // the settings have a header of their own: a field of the settings holds the keyboard. The badge is in that header once
    // `SettingsView.svelte` mounts `<KeyboardBadge />` there (`__keyboard().badge` is its text, `null` until then).
    name: 'keyboard-badge-settings',
    title: 'Клавиатура у окна в настройках (клик в поле «Вместимость»): знак в шапке настроек',
    dataset: 'default',
    act: async (app) => {
      watchKeyboard(app);
      await app.expand('preview');
      app.openSettings();
      await pause(60);
      await hoverAndPress('#set-scuCapacity');
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
