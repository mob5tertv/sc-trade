import type { Scene, SceneApp } from './scenes';

// THE MOCK-UP of the demo trip of version 1.3 (the author: «обучение должно выглядеть как демо с подсказками, будто маршрут уже
// выполняется… прогнать человека от введения станции до посадки и продажи»; «подсказки со стрелками»; «демо нажимает сам по
// подсказкам»). Each scene is one step: the window in the state of that step on the preview data, and the hint with its arrow.
// The texts are a draft for the author to read; the demo itself (its own data, the steps that move on by the player's actions)
// is written once he has said yes to these pictures.

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The element with this selector whose text has `text`, marked `data-coach` so that the arrow can find it. */
function mark(selector: string, text?: string): string {
  const found = [...document.querySelectorAll<HTMLElement>(selector)].find((el) => text === undefined || (el.textContent ?? '').includes(text));
  if (found === undefined) throw new Error(`the demo scene wants "${selector}"${text === undefined ? '' : ` with "${text}"`}, and there is none`);
  found.setAttribute('data-coach', 'here');
  return '[data-coach="here"]';
}

async function click(selector: string, text?: string): Promise<void> {
  const found = [...document.querySelectorAll<HTMLElement>(selector)].find((el) => text === undefined || (el.textContent ?? '').includes(text));
  if (found === undefined) throw new Error(`the demo scene wants to click "${selector}"${text === undefined ? '' : ` with "${text}"`}, and there is none`);
  found.click();
  await pause(120);
}

const TOTAL = 11;
const HUR_L1 = 3;
const MIC_L1 = 4; // the best place to sell Stims from HUR-L1 in the preview data: the top of «Варианты»

/** The window at HUR-L1 with the row of Stims open. */
async function stimsOpen(app: SceneApp): Promise<void> {
  await app.expand('preview');
  app.setViewTerminal(HUR_L1);
  await pause(80);
  await click('.table button.line', 'STIM');
}

/** A purchase of a full hold of Stims at HUR-L1 with MIC-L1 the target: the trip of the demo has begun. */
async function bought(app: SceneApp): Promise<void> {
  await app.expand('preview');
  await app.setTarget(MIC_L1);
  await app.buy({ terminalId: HUR_L1, commodityId: 8, scu: 696, price: 2860 });
  await pause(150);
}

export const DEMO_SCENES: readonly Scene[] = [
  {
    name: 'demo-01-start', title: 'Демо (макет), 1: начало', dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      app.coach = {
        target: null, step: 1, total: TOTAL, title: 'Демо-рейс', button: 'Начать',
        text: 'Пройдём один рейс на учебных данных: от станции до продажи. Нажимаешь ты сам — подсказка со стрелкой покажет куда. '
          + 'Твои цены, рейсы и настройки не трогаются: после демо всё вернётся как было.',
      };
    },
  },
  {
    name: 'demo-02-location', title: 'Демо (макет), 2: станция', dataset: 'window',
    act: async (app) => {
      await app.expand('preview');
      await app.updateSetting('currentTerminalId', null);
      app.viewTerminalId = null; // the demo starts nowhere: the player names the station
      await pause(120);
      app.coach = {
        target: '[data-tour="location"]', step: 2, total: TOTAL, title: 'Где ты', doing: 'Ждём: станция выбрана',
        text: 'Ты стоишь на станции HUR-L1. Впиши в это поле три буквы — HUR — и нажми Enter.',
      };
    },
  },
  {
    name: 'demo-03-table', title: 'Демо (макет), 3: таблица терминала', dataset: 'default',
    act: async (app) => {
      await app.expand('preview');
      app.setViewTerminal(HUR_L1);
      await pause(80);
      app.coach = {
        target: mark('.table button.line', 'STIM'), step: 3, total: TOTAL, title: 'Цены терминала', doing: 'Ждём: строка Stims открыта',
        text: 'Это HUR-L1: что здесь продают, почём, сколько на складе и сколько принесёт лучший рейс. Нажми на строку Stims.',
      };
    },
  },
  {
    name: 'demo-04-where', title: 'Демо (макет), 4: куда везти', dataset: 'default',
    act: async (app) => {
      await stimsOpen(app);
      app.coach = {
        target: '[aria-label="Где продать STIM"]', step: 4, total: TOTAL, title: 'Куда везти', doing: 'Ждём: «Где продать»',
        text: 'Строка раскрылась. «Где продать» покажет, куда выгоднее всего везти Stims отсюда.',
      };
    },
  },
  {
    name: 'demo-05-target', title: 'Демо (макет), 5: цель рейса', dataset: 'default',
    act: async (app) => {
      await stimsOpen(app);
      await click('[aria-label="Где продать STIM"]');
      await pause(400);
      await click('.list button.line');
      app.coach = {
        target: mark('.list button', 'Цель'), step: 5, total: TOTAL, title: 'Цель рейса', doing: 'Ждём: цель выбрана',
        text: 'Сверху — самый выгодный вариант: куда, сколько взять, прибыль за рейс и время в пути. Сделай его целью — «Цель».',
      };
    },
  },
  {
    name: 'demo-06-buy', title: 'Демо (макет), 6: покупка', dataset: 'default',
    act: async (app) => {
      await app.setTarget(MIC_L1);
      await stimsOpen(app);
      app.coach = {
        target: '[aria-label="Купил STIM"]', step: 6, total: TOTAL, title: 'Покупка', doing: 'Ждём: «Купил»',
        text: 'Цель — MIC-L1, она в шапке рейса. Покупаешь Stims в игре — отметь здесь: «Купил».',
      };
    },
  },
  {
    name: 'demo-07-trade', title: 'Демо (макет), 7: сделка', dataset: 'default',
    act: async (app) => {
      await app.setTarget(MIC_L1);
      await stimsOpen(app);
      await click('.expand button', 'Купил');
      await pause(100);
      app.coach = {
        target: 'form.trade button[type="submit"]', step: 7, total: TOTAL, title: 'Сделка', doing: 'Ждём: сделка записана',
        text: 'Количество и цена уже подставлены. Если в игре вышло иначе — поправь, и запиши сделку.',
      };
    },
  },
  {
    name: 'demo-08-run', title: 'Демо (макет), 8: рейс пошёл', dataset: 'default',
    act: async (app) => {
      await bought(app);
      app.coach = {
        target: mark('.sc-btn', 'Взлетел'), step: 8, total: TOTAL, title: 'Рейс пошёл', doing: 'Ждём: «Взлетел»',
        text: 'Первая покупка начала рейс: таймер, груз и ожидаемая прибыль в точке цели. Взлетаешь — нажми «Взлетел».',
      };
    },
  },
  {
    name: 'demo-09-mini', title: 'Демо (макет), 9: мини-строка в полёте', dataset: 'default',
    act: async (app) => {
      await bought(app);
      await app.mark('depart');
      await app.collapse('preview');
      await pause(150);
      app.coach = {
        target: mark('.marks button', 'Прилетел'), step: 9, total: TOTAL, title: 'В полёте', doing: 'Ждём: «Прилетел»',
        text: 'В полёте окно свёрнуто в одну строку и не мешает игре. Долетел до MIC-L1 — нажми «Прилетел».',
      };
    },
  },
  {
    name: 'demo-10-sell', title: 'Демо (макет), 10: продажа', dataset: 'default',
    act: async (app) => {
      await bought(app);
      await app.mark('depart');
      await app.mark('arrive');
      await pause(200);
      await click('.table button.line', 'STIM');
      app.coach = {
        target: '[aria-label="Продал STIM"]', step: 10, total: TOTAL, title: 'Продажа', doing: 'Ждём: «Продал»',
        text: 'Окно само открыло терминал цели, сторону продажи. Продаёшь в игре — отметь «Продал» и запиши сделку.',
      };
    },
  },
  {
    name: 'demo-11-done', title: 'Демо (макет), 11: рейс закрыт', dataset: 'default',
    act: async (app) => {
      await bought(app);
      await app.mark('depart');
      await app.mark('arrive');
      await app.sell({ terminalId: MIC_L1, commodityId: 8, scu: 696, price: 3730 });
      await pause(200);
      app.coach = {
        target: null, step: 11, total: TOTAL, title: 'Рейс закрыт: +605 520', button: 'Выбрать свой корабль',
        text: 'Так и выглядит рейс: станция → куда везти → цель → «Купил» → «Взлетел» → «Прилетел» → «Продал». Рейс попал в «Мои маршруты». '
          + 'Демо закончено, учебные данные уйдут. Дальше — твой корабль и твоя первая станция.',
      };
    },
  },
];
