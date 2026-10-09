import { RANGE_HEAD_TITLE } from './terminal-rows';

// The tooltips of the words that the README explains in «Обозначения» (version 1.1.1): «Худший», «Время» of an option, «скорость выучена» /
// «скорость запасная», «Мин–макс», every «≈» and every «UEC/ч». The player does not open the README in a flight, so the screen says the same, in
// one or two short sentences. The texts live HERE and nowhere else: the components take them from `LEGEND` (a second copy would drift from the
// README again), and `tests/ui/legend.test.ts` checks that every word has its tooltip and that a component really hangs it.

/** The places that have a tooltip of the legend: one text for each place where a word of the README stands on the screen. */
export type LegendTerm =
  | 'worst' | 'time' | 'rateLearned' | 'rateDefault' | 'range'
  | 'approxScu' | 'approxRun' | 'approxStrip' | 'approxOptions'
  | 'rateOptions' | 'rateRun' | 'rateRoutes' | 'rateSessions';

/**
 * The word as the screen shows it, for each text of the legend. The three «≈» of the README are the column «SCU», the section «Рейс» with the mini line
 * (two places, two texts: the mini line has the profit and the rate only) and the title of «Варианты»; the four «UEC/ч» are the options, the running
 * run, the finished runs («Маршруты» and «История») and the sessions.
 */
export const LEGEND_WORDS: Readonly<Record<LegendTerm, string>> = {
  worst: 'Худший',
  time: 'Время',
  rateLearned: 'скорость выучена',
  rateDefault: 'скорость запасная',
  range: 'Мин–макс',
  approxScu: '≈ (столбец «SCU»)',
  approxRun: '≈ (секция «Рейс»)',
  approxStrip: '≈ (мини-строка)',
  approxOptions: '≈ (заголовок «Варианты»)',
  rateOptions: 'UEC/ч (варианты)',
  rateRun: 'UEC/ч (рейс)',
  rateRoutes: 'UEC/ч (маршруты, история)',
  rateSessions: 'UEC/ч (сессии)',
};

/** What the tooltip of each place says: the sense of the README, shortened to one or two sentences. */
export const LEGEND: Readonly<Record<LegendTerm, string>> = {
  worst: 'Прибыль при худших ценах диапазона: закупка по верхней границе диапазона, продажа по нижней. У твоей цены диапазона нет — берётся она сама.',
  time: 'Время всего рейса: сам рейс (медиана твоих рейсов по этой паре, иначе расчёт по расстоянию) и, если закупка на другом терминале, пустой перелёт к ней. '
    + 'Не хватает расстояния — прочерк.',
  rateLearned: 'Скорость пополнения склада выучена по твоим замерам на этой паре «терминал + товар»: взято самое быстрое пополнение между двумя соседними записями. '
    + 'По ней считается оценка «≈».',
  rateDefault: 'Замеров скорости пополнения по этой паре нет, взята запасная: максимум запаса, делённый на «Полное пополнение склада, мин» из настроек. '
    + 'По ней считается оценка «≈».',
  range: `${RANGE_HEAD_TITLE}. «= 5 500» — цена за период не менялась.`,
  approxScu: '≈ — оценка запаса по таймеру пополнения: сколько там, по расчёту, сейчас. «было …» в раскрытой строке говорит, от какого твоего замера считалось.',
  approxRun: '≈ — ожидаемый результат идущего рейса (прибыль, ROI, UEC/ч): так будет, если груз продастся в точке цели по ожидаемым ценам.',
  approxStrip: '≈ — ожидаемые прибыль и UEC в час идущего рейса: так будет, если груз продастся в точке цели по ожидаемым ценам.',
  approxOptions: '≈ — список предварительный: он построен по тем расстояниям, что уже известны, остальные догружаются (рядом «расстояния 7/15»). '
    + 'Пока у вариантов без расстояния нет ни времени, ни UEC/ч.',
  rateOptions: 'UEC/ч варианта — ожидание: прибыль по ожидаемым ценам, делённая на «Время» варианта.',
  rateRun: 'UEC/ч идущего рейса — оценка: ожидаемая прибыль всего рейса за время всего рейса (не меньше прошедшего и не меньше, чем лететь до цели).',
  rateRoutes: 'UEC/ч по завершённым рейсам: прибыль, делённая на время рейсов.',
  rateSessions: 'UEC/ч сессии — заработок сессии: прибыль, делённая на всё время сессии от первой записи до последней, простои между записями входят.',
};

/** A tooltip that says the legend and, on a line of its own under it, what is true of this very place ('по твоим рейсам · пустой перелёт 4:10'). */
export function legendTitle(legend: string, detail?: string | null): string {
  return detail === undefined || detail === null || detail === '' ? legend : `${legend}\n${detail}`;
}
