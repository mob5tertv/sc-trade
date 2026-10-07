import { tick } from 'svelte';
import type { Scene } from './scenes';

// The scenes of task 15c: trades from the row of the table, the section «Рейс», the marks on the mini line, the question
// under the header and the target. They run inside the page, so they reach for the elements themselves, as the scenes of
// `scenes.ts` do (that module imports this one, hence only the type comes from it).

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

/** The row of the table with this commodity code opened, and the button of its trade pressed ("Купил" / "Продал"). */
async function openTradeForm(code: string, button: string): Promise<void> {
  await click('.table button.line', code);
  await click('.expand button', button);
}

// ids of the preview data: Medical Supplies 1, Stims 8; terminals: ARC-L1 1, MIC-L1 4, HUR-L1 3
const MEDS = 1;
const STIM = 8;
const ARC_L1 = 1;
const MIC_L1 = 4;

export const RUN_SCENES: readonly Scene[] = [
  // ---- the form of a trade, under the row ----
  {
    name: 'trade-buy',
    title: '«Купил» в выдвинутой строке: форма сделки прямо под строкой',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      await openTradeForm('MEDS', 'Купил');
    },
  },
  {
    // sell side of MIC-L1, where Stims have a price of my own; the form starts with the whole cargo of the commodity
    name: 'trade-sell',
    title: '«Продал»: форма продажи под строкой, весь груз товара',
    dataset: 'run',
    act: async (app) => {
      await app.expand('preview');
      app.setViewTerminal(MIC_L1);
      app.setTerminalSide('sell');
      await pause(60);
      await openTradeForm('STIM', 'Продал');
    },
  },
  {
    // the form is open and the window folds after 2 seconds without activity: `--do "leave;wait:4500"` must find it expanded
    name: 'trade-busy',
    title: 'Форма сделки открыта, окно сворачивается через 2 с без движения мыши: пока форма открыта, не сворачивается',
    dataset: 'default',
    act: async (app) => {
      await app.updateSetting('idleCollapseSec', 2);
      await app.expand('preview');
      await openTradeForm('MEDS', 'Купил');
      app.pointer(true);
    },
  },
  {
    // MEDS is already sold through the form; the form of the last commodity is open: Enter in its field ends the run
    // (`--do "click:form.trade input;press:Enter"`)
    name: 'trade-sell-last',
    title: 'Остался один товар: форма «Продал» открыта, продажа закроет рейс',
    dataset: 'run',
    act: async (app) => {
      await app.expand('preview');
      await app.toggleSection('run');
      app.setViewTerminal(ARC_L1);
      app.setTerminalSide('sell');
      await pause(60);
      await openTradeForm('MEDS', 'Продал');
      document.querySelector<HTMLFormElement>('form.trade')?.requestSubmit();
      await pause(400);
      await click('.table button.line', 'STIM');
      await click('.expand button', 'Продал');
    },
  },
  {
    // more than the hold takes: the service refuses and the form says why, in Russian
    name: 'trade-refused',
    title: 'Форма покупки с отказом службы: свободно только 696 SCU',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      await openTradeForm('MEDS', 'Купил');
      await typeInto(QUANTITY, '700');
      document.querySelector<HTMLFormElement>('form.trade')?.requestSubmit();
      await pause(400);
    },
  },

  // ---- the section «Рейс» ----
  { name: 'run-section-closed', title: '«Рейс» свёрнут: таймер фазы, груз, цель и кнопка отметки в заголовке', dataset: 'run', act: (app) => app.expand('preview') },
  {
    name: 'run-section-open',
    title: '«Рейс» развёрнут: фазы рейса, отметки, груз, итоги',
    dataset: 'run',
    act: async (app) => {
      await app.expand('preview');
      await app.toggleSection('run');
    },
  },
  {
    // Stims have a price of mine at MIC-L1: the choice "sell here or fly on" for them
    name: 'run-sell-decision',
    title: '«Продать или лететь дальше»: на просматриваемом терминале есть своя цена продажи товара из трюма',
    dataset: 'run',
    act: async (app) => {
      await app.expand('preview');
      app.setViewTerminal(MIC_L1);
      await app.toggleSection('run');
      await pause(100);
    },
  },
  {
    name: 'run-lost-confirm',
    title: '«Груз потерян»: вопрос строкой под шапкой, без всплывающих окон',
    dataset: 'run',
    act: async (app) => {
      await app.expand('preview');
      await app.toggleSection('run');
      await click('button', 'Груз потерян');
    },
  },
  {
    // the whole cargo sold at ARC-L1 through the state: the run is over, the section and the target are gone
    name: 'run-sold-out',
    title: 'После продажи всего груза: секции «Рейс» нет, цель сброшена',
    dataset: 'run',
    act: async (app) => {
      await app.expand('preview');
      await app.toggleSection('run');
      app.setViewTerminal(ARC_L1);
      await app.sell({ terminalId: ARC_L1, commodityId: MEDS, scu: 120, price: 2540, knownScu: 90 });
      await app.sell({ terminalId: ARC_L1, commodityId: STIM, scu: 80, price: 3320 });
      await pause(200);
    },
  },

  // ---- the phases of a run ----
  ...(['loading', 'flight', 'unloading'] as const).flatMap((phase): Scene[] => [
    {
      name: `run-${phase}`,
      title: `«Рейс» развёрнут, фаза «${{ loading: 'погрузка', flight: 'полёт', unloading: 'выгрузка' }[phase]}»`,
      dataset: `run-${phase}`,
      act: async (app) => {
        await app.expand('preview');
        await app.toggleSection('run');
      },
    },
    {
      name: `mini-run-${phase}`,
      title: `Мини-строка, фаза «${{ loading: 'погрузка', flight: 'полёт', unloading: 'выгрузка' }[phase]}»`,
      dataset: `run-${phase}`,
    },
  ]),

  {
    // 50 of 120 MEDS are sold at ARC-L1 after the arrival: the card shows what is in hand and the result expected for the rest
    name: 'run-partly-sold',
    title: '«Рейс» после продажи части груза: выручка уже есть, результат всего рейса ожидаемый (≈)',
    dataset: 'run-unloading',
    act: async (app) => {
      await app.expand('preview');
      await app.toggleSection('run');
      app.setViewTerminal(ARC_L1);
      await app.sell({ terminalId: ARC_L1, commodityId: MEDS, scu: 50, price: 2540 });
      await pause(200);
    },
  },
  {
    // the target is taken away in the middle of the run: the three expected numbers are dashes and say why
    name: 'run-no-target',
    title: '«Рейс» без цели: ожидаемые прибыль, ROI и UEC/ч — прочерки с подсказкой «выбери цель»',
    dataset: 'run-loading',
    act: async (app) => {
      await app.expand('preview');
      await app.toggleSection('run');
      await app.setTarget(null);
      await pause(100);
    },
  },
  {
    // the whole way with the keyboard-free parts of the window: `--do` buys, marks, sells a part and the rest (see the task report)
    name: 'trade-flow',
    title: 'Покупка, отметки, продажа части и остатка: сценарий для --do (рейс начинается в HUR-L1, цель ARC-L1)',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      await app.setTarget(ARC_L1);
      await openTradeForm('MEDS', 'Купил');
    },
  },
  {
    // a write that is refused changes nothing, so the run the state holds stays THE SAME object (whoever follows it by
    // identity is not woken); a mark that is written replaces it. The result is in `window.__runIdentity` (`--do eval`).
    name: 'run-identity',
    title: 'Отказ службы не подменяет активный рейс в состоянии (проверка тождества объекта)',
    dataset: 'run-loading',
    act: async (app) => {
      const before = app.activeRun;
      const refusal = await app.buy({ terminalId: 3, commodityId: MEDS, scu: 9999, price: 100 });
      const afterRefusal = app.activeRun === before;
      const refusedMark = await app.mark('depart').then(() => app.mark('depart'));
      const afterRepeat = app.activeRun === before;
      (window as unknown as { __runIdentity: unknown }).__runIdentity = {
        refusal, sameAfterRefusedBuy: afterRefusal, repeatedMark: refusedMark, changedAfterWrittenMark: !afterRepeat,
      };
      await app.expand('preview');
    },
  },
  {
    // the player goes to another row and opens its form while the write of the first one is still on its way: the answer
    // (a refusal) must stay with the first form. `--do eval`: the form of PFOO has no message.
    name: 'trade-switched-row',
    title: 'Ответ службы приходит, когда открыта форма другой строки: он не должен попасть в неё',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      await openTradeForm('MEDS', 'Купил');
      await typeInto(QUANTITY, '9999');
      document.querySelector<HTMLFormElement>('form.trade')?.requestSubmit();
      // no pause from here to the second form: the write is still under way (it goes through the database)
      [...document.querySelectorAll<HTMLElement>('.table button.line')].find((el) => (el.textContent ?? '').includes('PFOO'))?.click();
      await tick();
      [...document.querySelectorAll<HTMLElement>('.expand button')].find((el) => (el.textContent ?? '').includes('Купил'))?.click();
      await tick();
      await pause(500);
    },
  },
  {
    // what the state knew is thrown away and read again from the database, as after a restart in the middle of a run
    name: 'run-restart',
    title: 'Приложение перезапущено посреди рейса: рейс и таймер читаются из базы',
    dataset: 'run-flight',
    act: async (app) => {
      await app.expand('preview');
      await app.toggleSection('run');
      app.activeRun = null;
      await pause(100);
      await app.loadFromDb();
      await pause(100);
    },
  },

  // ---- the target ----
  {
    name: 'run-plan',
    title: 'Цель выбрана, ничего не куплено: «Рейс» в состоянии плана',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      await app.setTarget(ARC_L1);
      await pause(100);
    },
  },
  {
    name: 'mini-plan',
    title: 'Мини-строка без рейса, цель выбрана: «HUR-L1 → ARC-L1»',
    dataset: 'default',
    act: async (app) => {
      await app.setTarget(ARC_L1);
      await pause(100);
    },
  },
  {
    // «Цель» in the details of an option opens «Рейс» with the target
    name: 'options-target',
    title: 'Варианты: «Цель» в подробностях строки, секция «Рейс» появилась с целью',
    dataset: 'window',
    act: async (app) => {
      await app.expand('preview');
      await click('header button.route');
      await pause(400);
      await click('.list button.line');
      await click('button', 'Цель');
      await pause(150);
    },
  },

  // ---- messages and questions ----
  {
    // a key of the game without a run: the mini line says so for three seconds
    name: 'mini-flash',
    title: 'Мини-строка: «Нет активного рейса» (клавиша «взлетел» без рейса)',
    dataset: 'default',
    act: async (app) => {
      await app.mark('depart');
      await pause(60);
    },
  },
  {
    // the question is up and the window folds after 2 seconds without activity: `--do "leave;wait:4000"` must find it expanded
    name: 'confirm-busy',
    title: '«Сменил сервер» задан, окно сворачивается через 2 с без движения мыши: пока вопрос на экране, не сворачивается',
    dataset: 'default',
    act: async (app) => {
      await app.updateSetting('idleCollapseSec', 2);
      await app.expand('preview');
      await click('button[aria-label="Сменил сервер"]');
      app.pointer(true);
    },
  },
  {
    name: 'confirm-server',
    title: '«Сменил сервер»: вопрос строкой под шапкой',
    dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      await click('button[aria-label="Сменил сервер"]');
      await pause(60);
    },
  },
];
