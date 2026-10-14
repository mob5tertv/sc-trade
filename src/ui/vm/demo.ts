import type { Settings } from '../../core/settings';
import { DEMO_COMMODITY, DEMO_START_TERMINAL, commodityId } from '../../demo/world';
import { tr } from '../../i18n';
import type { Coach } from './coach';

// The demo trip of version 1.3 (the author: «обучение должно выглядеть как демо с подсказками, будто маршрут уже выполняется…
// прогнать человека от введения станции до посадки и продажи»; «подсказки со стрелками»; «демо нажимает сам по подсказкам»). One
// trip on the demo world, in eleven steps; at each one a hint with an arrow points at the element of the window to press, and the
// step moves on when the window shows that it was pressed. A step whose condition is already met (the player went ahead) is passed
// over. Pure: `DemoDirector.svelte` reads the window into a `DemoView` and asks here what to show.

const STATION = DEMO_START_TERMINAL;
const CODE = DEMO_COMMODITY;
const COMMODITY = commodityId(DEMO_COMMODITY);

/** What a step reads of the window. */
export interface DemoView {
  mode: 'mini' | 'expanded';
  locationId: number | null;
  viewedId: number | null;
  /** The commodity of the lookup on the screen («Где продать» of a row), `null` without one. */
  lookupCommodityId: number | null;
  targetId: number | null;
  /** The name of the target, for the texts. */
  targetName: string;
  /** The run of the demo: none, or its phase. */
  run: 'none' | 'loading' | 'flight' | 'unloading';
  /** A run was on during the demo: with `run` 'none' again, it is over (the cargo is sold). */
  hadRun: boolean;
  /** The code of the commodity whose row of the terminal table is open, `null` when none is. */
  openRow: string | null;
  /** The form of a trade is open. */
  formOpen: boolean;
}

export interface DemoStep {
  id: string;
  /** Where the arrow may point, in order: the first of these on the screen. `null`: a card in the middle of the window. */
  targets: (v: DemoView) => readonly string[] | null;
  title: (v: DemoView) => string;
  text: (v: DemoView) => string;
  /** What the step waits for, said small; absent on a card, which waits for its button. */
  doing?: () => string;
  /** The step is done: the window shows what it asked for, or something that comes after it. Absent: it waits for its button. */
  done?: (v: DemoView) => boolean;
}

const sold = (v: DemoView): boolean => v.run === 'none' && v.hadRun;
const departed = (v: DemoView): boolean => v.run === 'flight' || v.run === 'unloading' || sold(v);
const arrived = (v: DemoView): boolean => v.run === 'unloading' || sold(v);
const bought = (v: DemoView): boolean => v.run !== 'none' || v.hadRun;
const targeted = (v: DemoView): boolean => v.targetId !== null || bought(v);
const asked = (v: DemoView): boolean => v.lookupCommodityId === COMMODITY || targeted(v);

const ROW = `[data-tour-row="${CODE}"]`;
const OPEN = `[data-tour-open="${CODE}"]`;

export const DEMO_STEPS: readonly DemoStep[] = [
  {
    id: 'start', targets: () => null,
    title: () => tr('Демо-рейс'),
    text: () => tr('Пройдём один рейс на учебных данных: от станции до продажи. Нажимаешь ты сам — подсказка со стрелкой покажет куда. Твои цены, рейсы и настройки не трогаются: после демо всё вернётся как было.'),
  },
  {
    id: 'location', targets: () => ['[data-tour="location"]'],
    title: () => tr('Где ты'),
    text: () => tr('Ты стоишь на станции HUR-L1. Впиши в это поле три буквы — HUR — и нажми Enter.'),
    doing: () => tr('Ждём: станция выбрана'),
    done: (v) => v.locationId === STATION || v.viewedId === STATION || asked(v),
  },
  {
    id: 'row', targets: () => [ROW],
    title: () => tr('Цены терминала'),
    text: () => tr('Это HUR-L1: что здесь продают, почём, сколько на складе и сколько принесёт лучший рейс. Нажми на строку Stims.'),
    doing: () => tr('Ждём: строка Stims открыта'),
    done: (v) => v.openRow === CODE || asked(v),
  },
  {
    id: 'where', targets: () => [`${OPEN} [data-tour="lookup"]`, ROW],
    title: () => tr('Куда везти'),
    text: () => tr('Строка раскрылась. «Где продать» покажет, куда выгоднее всего везти Stims отсюда.'),
    doing: () => tr('Ждём: «Где продать»'),
    done: asked,
  },
  {
    id: 'target', targets: () => ['[data-tour="set-target"]', '[data-tour="option-first"]'],
    title: () => tr('Цель рейса'),
    text: () => tr('Сверху — самый выгодный вариант: куда, сколько взять, прибыль за рейс и время в пути. Открой его и сделай целью — «Цель».'),
    doing: () => tr('Ждём: цель выбрана'),
    done: targeted,
  },
  {
    id: 'buy', targets: () => [`${OPEN} [data-tour="trade"]`, ROW],
    title: () => tr('Покупка'),
    text: (v) => tr('Цель — {target}, она в шапке рейса. Покупаешь Stims в игре — отметь в строке Stims: «Купил».', { target: v.targetName }),
    doing: () => tr('Ждём: «Купил»'),
    done: (v) => v.formOpen || bought(v),
  },
  {
    id: 'trade', targets: () => ['form.trade button[type="submit"]', `${OPEN} [data-tour="trade"]`, ROW],
    title: () => tr('Сделка'),
    text: () => tr('Количество мы берём исходя из полного размера трюма выбранного корабля. Если в игре вышло иначе — поправь и запиши сделку.'),
    doing: () => tr('Ждём: сделка записана'),
    done: bought,
  },
  {
    id: 'depart', targets: () => ['[data-tour="mark"]'],
    title: () => tr('Рейс пошёл'),
    text: () => tr('Первая покупка начала рейс: таймер, груз и ожидаемая прибыль в точке цели. Взлетаешь — нажми «Взлетел».'),
    doing: () => tr('Ждём: «Взлетел»'),
    done: departed,
  },
  {
    id: 'fly', targets: (v) => (v.mode === 'mini' ? ['[data-tour="mark"]'] : ['[data-tour="collapse"]', '[data-tour="mark"]']),
    title: () => tr('В полёте'),
    text: (v) => (v.mode === 'mini'
      ? tr('В полёте окно свёрнуто в одну строку и не мешает игре. Долетел до {target} — нажми «Прилетел».', { target: v.targetName })
      : tr('В полёте окно не нужно: сверни его в мини-строку — кнопка «—» в углу.')),
    doing: () => tr('Ждём: «Прилетел»'),
    done: arrived,
  },
  {
    id: 'sell',
    targets: (v) => (v.mode === 'mini' ? ['[data-tour="strip"]'] : ['form.trade button[type="submit"]', `${OPEN} [data-tour="trade"]`, ROW]),
    title: () => tr('Продажа'),
    text: (v) => (v.mode === 'mini'
      ? tr('Ты у цели. Разверни окно — клик по мини-строке.')
      : tr('Окно само открыло терминал цели, сторону продажи. Продаёшь в игре — строка Stims → «Продал» → запиши сделку.')),
    doing: () => tr('Ждём: груз продан'),
    done: sold,
  },
  {
    id: 'done', targets: () => null,
    title: () => tr('Рейс закрыт'),
    text: () => tr('Так и выглядит рейс: станция → куда везти → цель → «Купил» → «Взлетел» → «Прилетел» → «Продал». Рейс попал в «Мои маршруты». Демо закончено, учебные данные уйдут.'),
  },
];

/** The step to show: `index`, or the first after it whose condition is not met yet. A card waits for its button. */
export function demoAdvance(index: number, v: DemoView): number {
  let at = index;
  while (at < DEMO_STEPS.length - 1 && DEMO_STEPS[at].done?.(v) === true) at++;
  return at;
}

export interface DemoActions {
  begin: () => void;
  leave: () => void;
  finish: () => void;
  /** A new player: the last card leads to the choice of his ship. */
  newPlayer: boolean;
}

/** The hint of step `index`: the arrow at the first of its targets that `exists` on the screen. */
export function demoCoach(index: number, v: DemoView, exists: (selector: string) => boolean, actions: DemoActions): Coach {
  const step = DEMO_STEPS[index];
  const targets = step.targets(v);
  const target = targets === null ? null : targets.find(exists) ?? null;
  const last = index === DEMO_STEPS.length - 1;
  const coach: Coach = {
    target, title: step.title(v), text: step.text(v), step: index + 1, total: DEMO_STEPS.length,
  };
  if (!last) coach.leave = { label: index === 0 ? tr('Пропустить') : tr('Выйти из демо'), run: actions.leave };
  if (step.doing !== undefined) coach.doing = step.doing();
  if (index === 0) coach.primary = { label: tr('Начать'), run: actions.begin };
  if (last) coach.primary = { label: actions.newPlayer ? tr('Выбрать свой корабль') : tr('Готово'), run: actions.finish };
  return coach;
}

/** The demo opens by itself after the language is chosen on a new database (no ship set yet) that has not seen it. */
export const opensDemoByItself = (settings: Settings): boolean => !settings.tutorialShown && settings.scuCapacity === 0;
