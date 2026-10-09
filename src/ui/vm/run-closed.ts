import { isIncomeRun } from '../../core/run';
import type { RunWithEvents } from '../../core/types';
import { NONE, runFigures, type RunFigures } from './stats-rows';

// What the window says at the moment a run is closed (a sale that empties the hold, the cargo lost, a sale without a purchase), so
// that the result is not found only later in the history. Pure; the state says it (`app.#announceClosed`). The numbers are the
// ones the row of this run will show in the history (`runFigures`): there is one count of them.

/** A message for the player: the text, and `error` for what went wrong for his purse (the colour of the notice line and of the mini line). */
export interface ClosedRunNotice {
  text: string;
  kind: 'info' | 'error';
}

const MINIMUM_MS = 6000;
const LONG_ENOUGH_MS = 8000;

/**
 * How long this message stays, given how long the other messages of the place it is shown in stay (`base`, ms). It carries
 * three numbers to read, so a place that lets its messages go sooner than six seconds (the mini line: three) keeps this one for eight.
 */
export const shownFor = (base: number): number => (base < MINIMUM_MS ? LONG_ENOUGH_MS : base);

/** The profit as the player reads it: a gain has a plus, a loss and a zero carry theirs in the number. */
const signed = (figures: RunFigures): string => (figures.tone === 'gain' ? `+${figures.profit}` : figures.profit);

/** The part of the line after a number that has no sense (no time, nothing invested) is left out. */
const known = (text: string, say: (text: string) => string): string[] => (text === NONE ? [] : [say(text)]);

/**
 * The notice of a run that has just been closed, `closed` being the run as the trade service returned it (with its end and its events):
 *  - a sale that emptied the hold: 'Рейс закрыт: +73 400 · 369k/ч · ROI 15%' (no rate without a time, no ROI without an investment);
 *  - the cargo lost: 'Рейс закрыт: груз потерян, -478 600';
 *  - a sale of goods that were never bought (a run of its own that is closed at once): 'Доход записан: +12 000', no run was closed.
 * A loss is an `error` (a run that lost its cargo but earned before it is not one).
 */
export function closedRunNotice(closed: RunWithEvents): ClosedRunNotice {
  const { run, events } = closed;
  const figures = runFigures(run, events, run.endedAt ?? run.startedAt);
  const kind = figures.tone === 'loss' ? 'error' : 'info';
  if (isIncomeRun(events)) return { text: `Доход записан: ${signed(figures)}`, kind };
  if (run.status === 'lost') return { text: `Рейс закрыт: груз потерян, ${signed(figures)}`, kind };
  const parts = [signed(figures), ...known(figures.rate, (rate) => `${rate}/ч`), ...known(figures.roi, (roi) => `ROI ${roi}`)];
  return { text: `Рейс закрыт: ${parts.join(' · ')}`, kind };
}
