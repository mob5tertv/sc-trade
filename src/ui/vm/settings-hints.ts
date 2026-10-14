// What a field of the settings does in the calculation, one phrase for its tooltip. Every sentence is what the code does with the
// number: `quantity` and `tripTime` of src/core/routes.ts, `estimateStock` of src/core/stock.ts and the lookup of src/ui/state.svelte.ts.

/** The fields of the calculation that have a tooltip of their own (the others say it in their label or have a hint in the settings view). */
import { tr } from '../../i18n';

export type HintedSetting =
  | 'scuCapacity' | 'budget' | 'quantumSpeedKkms' | 'overheadMin' | 'overheadEmptyMin' | 'nearbyMaxMin' | 'topN' | 'refillFullMin';

export const SETTING_HINTS: Readonly<Record<HintedSetting, string>> = {
  get scuCapacity() { return tr('Сколько SCU влезает в трюм: столько самое большее берёт рейс в расчёте вариантов. Без вместимости варианты и ROI не считаются.'); },
  get budget() { return tr('Сколько UEC ты готов потратить на закупку: больше, чем на них можно купить, в расчёте рейса не берётся. Пусто — без ограничения.'); },
  get quantumSpeedKkms() { return tr('Скорость квантового прыжка: по ней из расстояния считается время полёта, пока своих рейсов по этой паре нет.'); },
  get overheadMin() { return tr('Минуты сверх самого прыжка, которые добавляются к расчётному времени полёта. По своим рейсам время берётся как есть, без них.'); },
  get overheadEmptyMin() { return tr('Те же накладные для пустого перелёта к терминалу закупки, когда рейс начинается не там, где ты стоишь.'); },
  get nearbyMaxMin() { return tr('С кнопкой «выгоднее» варианты ищутся и с закупкой на другом терминале, но не дальше этого пустого перелёта от тебя.'); },
  get topN() { return tr('Сколько лучших вариантов показывает список «Варианты».'); },
  get refillFullMin() { return tr('За сколько минут склад пополняется от нуля до максимума, пока скорость его пополнения не выучена по твоим замерам: по ней считается оценка «≈».'); },
};
