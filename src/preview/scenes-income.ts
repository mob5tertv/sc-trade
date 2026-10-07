import type { Scene, SceneApp } from './scenes';

// The scenes of task 32: a sale of goods that were never bought through the application is recorded as income (spec 14.10).
// They run inside the page, so they reach for the elements themselves, as the scenes of `scenes-run.ts` do. The list is added to
// `SCENES` in `scenes.ts` (that module imports this one, hence only the types come from it).

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A click on what is on the screen, the way a button handler sees it; a scene that names something that is not there fails with its name. */
async function click(selector: string, text?: string): Promise<void> {
  const found = [...document.querySelectorAll<HTMLElement>(selector)].find((el) => text === undefined || (el.textContent ?? '').includes(text));
  if (found === undefined) throw new Error(`the scene wants to click "${selector}"${text === undefined ? '' : ` with "${text}"`}, and there is none`);
  found.click();
  await pause(60);
}

/** Types a text into a field the way the input event of a real typing does. */
async function typeInto(selector: string, text: string): Promise<void> {
  const field = document.querySelector<HTMLInputElement>(selector);
  if (field === null) throw new Error(`the scene wants to type into "${selector}", and there is none`);
  field.value = text;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  await pause(30);
}

const QUANTITY = 'form.trade input[aria-label="Количество, SCU"]';
const submit = (): void => document.querySelector<HTMLFormElement>('form.trade')?.requestSubmit();

// ids of the preview data: terminals MIC-L1 4, ARC-L1 1
const MIC_L1 = 4;
const ARC_L1 = 1;

/** The window expanded on the side "Продать" of a terminal. */
async function atSellSide(app: SceneApp, terminalId: number): Promise<void> {
  await app.expand('preview');
  app.setViewTerminal(terminalId);
  app.setTerminalSide('sell');
  await pause(60);
}

/** The row with this code opened and its "Продал" pressed: the form of the trade is under the row. */
async function openSellForm(code: string): Promise<void> {
  await click('.table button.line', code);
  await click('.expand button', 'Продал');
}

/** The way a player sells goods that are not in the hold: the form of the row, the quantity typed, the form confirmed. */
async function sellThroughForm(code: string, scu: number): Promise<void> {
  await openSellForm(code);
  await typeInto(QUANTITY, String(scu));
  submit();
  await pause(500);
}

/** The window with only the section of statistics open (the terminal folded), on its list `view`. */
async function showStats(app: SceneApp, view: 'Маршруты' | 'История' | 'Сессии'): Promise<void> {
  await app.toggleSection('terminal');
  await app.toggleSection('routes');
  await pause(60);
  if (view !== 'Маршруты') await click('.sc-seg button', view);
}

export const INCOME_SCENES: readonly Scene[] = [
  {
    // no run at all: the quantity is empty (the player types it), the price is the one of the row, one muted line under the form
    name: 'income-form',
    title: '«Продал» товара, которого нет в трюме (рейса нет): форма дохода, количество пустое, строка под формой',
    dataset: 'default',
    act: async (app) => {
      await atSellSide(app, MIC_L1);
      await openSellForm('GOLD');
    },
  },
  {
    // a run is going and its hold has no Gold: the same form, the section «Рейс» above it as it was
    name: 'income-form-run',
    title: '«Продал» товара, которого нет в трюме, пока идёт рейс: форма дохода под строкой, «Рейс» открыт',
    dataset: 'run',
    act: async (app) => {
      await atSellSide(app, MIC_L1);
      await app.toggleSection('run');
      await openSellForm('GOLD');
    },
  },
  {
    // the sale is written during the run: `window.__incomeCheck` says what the state saw (`--do "eval:JSON.stringify(window.__incomeCheck)"`)
    name: 'income-during-run',
    title: 'Доход записан во время идущего рейса: секция «Рейс» та же, груз, таймер и цель на месте',
    dataset: 'run',
    act: async (app) => {
      await atSellSide(app, MIC_L1);
      await app.toggleSection('run');
      const runBefore = app.activeRun;
      const eventsBefore = JSON.stringify(runBefore?.events ?? null);
      // what the section says, without what moves with the clock (the timers and the rate of the run so far)
      const sectionText = (): string => ([...document.querySelectorAll('section.section')]
        .find((el) => el.querySelector('.title')?.textContent === 'Рейс')?.querySelector('.body')?.textContent ?? '')
        .replace(/\d+:\d\d/g, 't').replace(/UEC\/ч ≈ \S+/, 'UEC/ч ≈ r');
      const bodyBefore = sectionText();
      await sellThroughForm('GOLD', 150);
      (window as unknown as { __incomeCheck: unknown }).__incomeCheck = {
        sameRunObject: app.activeRun === runBefore,
        sameEvents: JSON.stringify(app.activeRun?.events ?? null) === eventsBefore,
        status: app.activeRun?.run.status ?? null,
        bodyOfRunSectionSame: bodyBefore !== '' && sectionText() === bodyBefore,
        formClosed: document.querySelector('form.trade') === null,
      };
    },
  },
  {
    // the run goes on after an income: its own sales still finish it
    name: 'income-then-run-finish',
    title: 'Доход записан во время рейса, затем весь груз рейса продан: рейс закрылся, а не слился с доходом',
    dataset: 'run',
    act: async (app) => {
      await atSellSide(app, MIC_L1);
      await sellThroughForm('GOLD', 150);
      app.setViewTerminal(ARC_L1);
      await pause(60);
      await sellThroughForm('MEDS', 120);
      await sellThroughForm('STIM', 80);
      await pause(200);
    },
  },
  {
    // more than the hold has is still refused: the sale stays a sale of the run, the service says how much there is
    name: 'income-oversell',
    title: 'Продажа большего, чем есть в трюме, по-прежнему отказ: «В трюме только 120 SCU», дохода не записано',
    dataset: 'run',
    act: async (app) => {
      await atSellSide(app, ARC_L1);
      await app.toggleSection('run');
      await openSellForm('MEDS');
      await typeInto(QUANTITY, '150');
      submit();
      await pause(500);
    },
  },
  {
    // the form of a sale of what IS in the hold has no income line
    name: 'income-sale-of-cargo',
    title: '«Продал» товара из трюма: обычная продажа, весь груз, без строки про доход',
    dataset: 'run',
    act: async (app) => {
      await atSellSide(app, ARC_L1);
      await openSellForm('MEDS');
    },
  },
  {
    name: 'income-history',
    title: 'История: запись «продажа без закупки» (прибыль есть, ROI и ставка — прочерки) рядом с рейсами',
    dataset: 'window',
    act: async (app) => {
      await atSellSide(app, MIC_L1);
      await sellThroughForm('GOLD', 120);
      await showStats(app, 'История');
    },
  },
  {
    name: 'income-sessions',
    title: 'Сессии: прибыль дохода в текущей сессии',
    dataset: 'stats',
    act: async (app) => {
      await atSellSide(app, MIC_L1);
      await sellThroughForm('GOLD', 120);
      await showStats(app, 'Сессии');
    },
  },
  {
    name: 'income-routes',
    title: 'Маршруты: доход не попал в рейтинг (такой же список, как без него)',
    dataset: 'stats',
    act: async (app) => {
      await atSellSide(app, MIC_L1);
      await sellThroughForm('GOLD', 120);
      await showStats(app, 'Маршруты');
    },
  },
  {
    // the same history and sessions without the income, to compare the numbers with the two scenes above
    name: 'income-sessions-before',
    title: 'Сессии без дохода (для сравнения)',
    dataset: 'stats',
    act: async (app) => {
      await app.expand('preview');
      await showStats(app, 'Сессии');
    },
  },
];
