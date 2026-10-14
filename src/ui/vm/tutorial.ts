import type { Settings } from '../../core/settings';
import { tr } from '../../i18n';

// The short tutorial of version 1.3 (plan of 1.3, item 5): a few steps in a card at the top of the real window, each with the
// element of the window it speaks of marked (`data-tour` on that element). The first step is a setting, not a story: the ship,
// whose hold every calculation needs. The tutorial takes no keyboard by itself: the field of the ship takes it the way every
// field of the window does. It can be left at any step, comes once by itself, and opens again from the settings («Данные»).

export type TutorialStepId = 'ship' | 'location' | 'price' | 'where' | 'run' | 'mini';

export interface TutorialStep {
  id: TutorialStepId;
  /** The `data-tour` mark of the element the step speaks of; `null`: the step has none on the screen (a run is not there yet). */
  target: string | null;
  title: () => string;
  text: () => string;
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'ship', target: null,
    title: () => tr('Корабль'),
    text: () => tr('От вместимости трюма зависят все расчёты: сколько взять, прибыль за рейс и ROI. Выбери корабль — вместимость подставится сама.'),
  },
  {
    id: 'location', target: 'location',
    title: () => tr('Где ты'),
    text: () => tr('Впиши в это поле три буквы станции и нажми Enter: откроется таблица её терминала с ценами покупки и продажи.'),
  },
  {
    id: 'price', target: 'price',
    title: () => tr('Своя цена'),
    text: () => tr('Видишь цену на терминале в игре — нажми «+ цена» и впиши товар и цену. Пока ты печатаешь, клавиатура у окна; Esc или клик в игру возвращают её.'),
  },
  {
    id: 'where', target: 'best',
    title: () => tr('Куда везти'),
    text: () => tr('«Лучшее» — лучшие рейсы из твоей локации: что взять, куда везти, сколько это принесёт и сколько займёт. Клик по товару в таблице — куда везти именно его.'),
  },
  {
    id: 'run', target: null,
    title: () => tr('Рейс'),
    text: () => tr('Первая покупка начинает рейс: таймер, груз и ожидаемая прибыль. Кнопки «Взлетел» и «Прилетел» — отметки рейса; на них можно назначить клавиши в настройках.'),
  },
  {
    id: 'mini', target: 'collapse',
    title: () => tr('Мини-строка'),
    text: () => tr('Эта кнопка сворачивает окно в мини-строку: в полёте она показывает рейс и не мешает игре. Клик по мини-строке разворачивает окно снова.'),
  },
];

/** Whether the tutorial opens by itself after the language is chosen: on a database where no ship is set, that is, a new one. */
export const opensTutorialByItself = (settings: Settings): boolean => !settings.tutorialShown && settings.scuCapacity === 0;

/** 'Шаг 2 из 6'. */
export const tutorialCounter = (index: number): string => tr('Шаг {n} из {total}', { n: index + 1, total: TUTORIAL_STEPS.length });

/** The step after `index`, or `null` when `index` was the last one. */
export const nextTutorialStep = (index: number): number | null => (index + 1 < TUTORIAL_STEPS.length ? index + 1 : null);
