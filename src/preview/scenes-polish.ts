import type { Scene } from './scenes';

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

export const POLISH_SCENES: readonly Scene[] = [
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
