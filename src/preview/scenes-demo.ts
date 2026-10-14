import type { Scene, SceneApp } from './scenes';

// The demo trip of version 1.3 (`src/ui/vm/demo.ts`), step by step: each scene starts the REAL demo (its own database, the demo
// world) and goes through it with the presses a player makes, on the elements the hints point at, up to its step. So the sweep of
// the preview walks the whole trip of the demo, and `preview:shot` shows each step with its hint.

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function press(selector: string): Promise<void> {
  // the director reads the window five times a second: a press waits for its element, and the step for the director
  for (let i = 0; i < 40; i++) {
    const found = document.querySelector<HTMLElement>(selector);
    if (found !== null) {
      found.click();
      await pause(350);
      return;
    }
    await pause(50);
  }
  throw new Error(`the demo scene wants to press "${selector}", and there is none`);
}

const STATION = 3; // HUR-L1, where the demo starts

/** The presses of the demo up to the step of `upTo` (the ids of `DEMO_STEPS`). */
const PATH: ReadonlyArray<{ step: string; go: (app: SceneApp) => Promise<void> }> = [
  { step: 'location', go: async () => press('.coach .sc-btn--primary') },
  { step: 'row', go: async (app) => { await app.setCurrentTerminal(STATION); await pause(350); } },
  { step: 'where', go: async () => press('[data-tour-row="STIM"]') },
  { step: 'target', go: async () => { await press('[data-tour-open="STIM"] [data-tour="lookup"]'); await press('[data-tour="option-first"]'); } },
  { step: 'buy', go: async () => press('[data-tour="set-target"]') },
  { step: 'trade', go: async () => press('[data-tour-open="STIM"] [data-tour="trade"]') },
  { step: 'depart', go: async () => press('form.trade button[type="submit"]') },
  { step: 'fly', go: async () => press('[data-tour="mark"]') },
  { step: 'fly-mini', go: async () => press('[data-tour="collapse"]') },
  { step: 'sell', go: async () => press('[data-tour="mark"]') },
  { step: 'sell-expanded', go: async () => { await press('[data-tour="strip"]'); await pause(300); await press('[data-tour-row="STIM"]'); await press('[data-tour-open="STIM"] [data-tour="trade"]'); } },
  { step: 'done', go: async () => press('form.trade button[type="submit"]') },
];

function demoScene(name: string, title: string, upTo: string | null): Scene {
  return {
    name, title, dataset: 'default',
    act: async (app) => {
      await app.startDemo('preview');
      await pause(400);
      if (upTo === null) return;
      for (const { step, go } of PATH) {
        await go(app);
        if (step === upTo) break;
      }
      await pause(300);
    },
  };
}

export const DEMO_SCENES: readonly Scene[] = [
  demoScene('demo-01-start', 'Демо-рейс, 1: начало', null),
  demoScene('demo-02-location', 'Демо-рейс, 2: станция', 'location'),
  demoScene('demo-03-row', 'Демо-рейс, 3: строка товара', 'row'),
  demoScene('demo-04-where', 'Демо-рейс, 4: куда везти', 'where'),
  demoScene('demo-05-target', 'Демо-рейс, 5: цель', 'target'),
  demoScene('demo-06-buy', 'Демо-рейс, 6: «Купил»', 'buy'),
  demoScene('demo-07-trade', 'Демо-рейс, 7: сделка', 'trade'),
  demoScene('demo-08-depart', 'Демо-рейс, 8: «Взлетел»', 'depart'),
  demoScene('demo-09-fly', 'Демо-рейс, 9: свернуть окно', 'fly'),
  demoScene('demo-09-fly-mini', 'Демо-рейс, 9: «Прилетел» в мини-строке', 'fly-mini'),
  demoScene('demo-10-sell', 'Демо-рейс, 10: развернуть окно у цели', 'sell'),
  demoScene('demo-10-sell-form', 'Демо-рейс, 10: «Продал»', 'sell-expanded'),
  demoScene('demo-11-done', 'Демо-рейс, 11: рейс закрыт', 'done'),
  {
    // the player types the station: the list of stations opens under the field, and the hint stands under the list, not over it
    // (the author: «дроп-даун находится под подсказкой обучения, выбрать невозможно»)
    name: 'demo-02-typing',
    title: 'Демо-рейс, 2: набрано «HUR», список станций открыт над подсказкой',
    dataset: 'default',
    act: async (app) => {
      await app.startDemo('preview');
      await pause(400);
      await press('.coach .sc-btn--primary');
      const field = document.querySelector<HTMLInputElement>('[data-tour="location"] input');
      if (field === null) throw new Error('the demo scene wants the field of the location, and there is none');
      field.focus();
      field.value = 'HUR';
      field.dispatchEvent(new Event('input', { bubbles: true }));
      await pause(500);
    },
  },
  {
    // leaving the demo at a step: the player's own data comes back (the preview dataset: HUR-L1, two finished runs)
    name: 'demo-left',
    title: 'Демо-рейс: вышли на шаге 4 — свои данные вернулись',
    dataset: 'default',
    act: async (app) => {
      await app.startDemo('preview');
      await pause(400);
      for (const { step, go } of PATH) {
        await go(app);
        if (step === 'where') break;
      }
      await press('.coach .sc-btn--ghost');
      await pause(500);
    },
  },
];
