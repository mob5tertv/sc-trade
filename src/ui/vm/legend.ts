// The tooltips of the words that the README explains in «Обозначения» (version 1.1.1): «Худший», «Время» of an option, «скорость выучена» /
// «скорость запасная», «Мин–макс», every «≈» and «Прибыль» of a trip. The player does not open the README in a flight, so the screen says the same, in
// one or two short sentences. The texts live HERE and nowhere else: the components take them from `LEGEND` (a second copy would drift from the
// README again), and `tests/ui/legend.test.ts` checks that every word has its tooltip and that a component really hangs it.

/** The places that have a tooltip of the legend: one text for each place where a word of the README stands on the screen. */
import { tr } from '../../i18n';

export type LegendTerm =
  | 'worst' | 'time' | 'rateLearned' | 'rateDefault' | 'range'
  | 'approxScu' | 'approxRun' | 'approxStrip' | 'approxOptions'
  | 'profitTrip';

/**
 * The word as the screen shows it, for each text of the legend. The three «≈» of the README are the column «SCU», the section «Рейс» with the mini line
 * (two places, two texts: the mini line has the profit only) and the title of «Варианты»; «Прибыль» is the profit of a trip in the list of options and
 * in the table of the terminal. The four «UEC/ч» are gone with the rate per hour itself (plan item 17).
 */
export const LEGEND_WORDS: Readonly<Record<LegendTerm, string>> = {
  get worst() { return tr('Худший'); },
  get time() { return tr('Время'); },
  get rateLearned() { return tr('скорость выучена'); },
  get rateDefault() { return tr('скорость запасная'); },
  get range() { return tr('Мин–макс'); },
  get approxScu() { return tr('≈ (столбец «SCU»)'); },
  get approxRun() { return tr('≈ (секция «Рейс»)'); },
  get approxStrip() { return tr('≈ (мини-строка)'); },
  get approxOptions() { return tr('≈ (заголовок «Варианты»)'); },
  get profitTrip() { return tr('Прибыль (варианты, таблица терминала)'); },
};

/**
 * Which period the two numbers of «Мин–макс» are of: the estimate takes the bounds of the week, and only when the week has no price those of the month,
 * then of all time (`priceRange` of the core). `terminal-rows.ts` keeps it as `RANGE_HEAD_TITLE`; it stands here, and not there, so that this module imports nothing
 * (`terminal-rows.ts` takes the tooltip of the estimate «≈» from it).
 */
export const RANGE_PERIOD = (): string => tr('Минимум и максимум цены по данным UEX за неделю; если за неделю цены нет — за месяц, потом за всё время');

/** What the tooltip of each place says: the sense of the README, shortened to one or two sentences. */
export const LEGEND: Readonly<Record<LegendTerm, string>> = {
  get worst() { return tr('Прибыль при худших ценах диапазона: закупка по верхней границе диапазона, продажа по нижней. У твоей цены диапазона нет — берётся она сама; когда обе цены твои, худшего нет — прочерк.'); },
  get time() { return tr('Время всего рейса: сам рейс (медиана твоих рейсов по этой паре, иначе расчёт по расстоянию) и, если закупка на другом терминале, пустой перелёт к ней. Не хватает расстояния — прочерк.'); },
  get rateLearned() { return tr('Скорость пополнения склада выучена по твоим замерам на этой паре «терминал + товар»: взята средняя по отрезкам, где запас между твоими записями только рос. По ней считается оценка «≈».'); },
  get rateDefault() { return tr('Замеров скорости пополнения по этой паре нет, взята запасная: максимум запаса, делённый на «Полное пополнение склада, мин» из настроек. По ней считается оценка «≈».'); },
  get range() { return tr('{period}. «= 5 500» — цена за период не менялась.', { period: RANGE_PERIOD() }); },
  get approxScu() { return tr('≈ — оценка запаса по таймеру пополнения: сколько там, по расчёту, сейчас. «было …» в раскрытой строке говорит, от какого твоего замера считалось.'); },
  get approxRun() { return tr('≈ — ожидаемый результат идущего рейса (прибыль, ROI): так будет, если груз продастся в точке цели по ожидаемым ценам.'); },
  get approxStrip() { return tr('≈ — ожидаемая прибыль идущего рейса: так будет, если груз продастся в точке цели по ожидаемым ценам.'); },
  get approxOptions() { return tr('≈ — список предварительный: он построен по тем расстояниям, что уже известны, остальные догружаются (рядом «расстояния 7/15»). Пока у вариантов без расстояния нет времени.'); },
  get profitTrip() { return tr('Прибыль за рейс по ожидаемым ценам: сколько берёшь (меньшее из свободного места в трюме, запаса на станции и бюджета), умноженное на разницу цен.'); },
};

/**
 * The tooltip of a value of the card of a run, by what it says: a number that carries «≈» gets the legend of it; a dash has no «≈» to explain, so it has
 * only its own reason (`dashReason`: why the card cannot say, or nothing).
 */
export function approxTitle(value: string, legend: string, dashReason?: string): string | undefined {
  return value.startsWith('≈') ? legend : dashReason;
}

/** A tooltip that says the legend and, on a line of its own under it, what is true of this very place ('по твоим рейсам · пустой перелёт 4:10'). */
export function legendTitle(legend: string, detail?: string | null): string {
  return detail === undefined || detail === null || detail === '' ? legend : `${legend}\n${detail}`;
}
