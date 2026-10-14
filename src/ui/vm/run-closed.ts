import { isIncomeRun } from '../../core/run';
import type { RunWithEvents } from '../../core/types';
import { NONE, runFigures, type RunFigures } from './stats-rows';
import { tr } from '../../i18n';

// What the window says at the moment a run is closed (a sale that empties the hold, the cargo lost, a sale without a purchase), so
// that the result is not found only later in the history. Pure; the state says it (`app.#announceClosed`). The numbers are the
// ones the row of this run will show in the history (`runFigures`): there is one count of them.

/** A message for the player: the text, and `error` for what went wrong for his purse (the colour of the notice line and of the mini line). */
export interface ClosedRunNotice {
  text: string;
  kind: 'info' | 'error';
  /** A run was closed. `false` for a sale without a purchase: it is a run of its own, and the run that goes on is still going. */
  closesRun: boolean;
}

const MINIMUM_MS = 6000;
const LONG_ENOUGH_MS = 8000;

/**
 * How long this message stays, given how long the other messages of the place it is shown in stay (`base`, ms). It carries
 * three numbers to read, so a place that lets its messages go sooner than six seconds (the mini line: three) keeps this one for eight.
 */
export const shownFor = (base: number): number => (base < MINIMUM_MS ? LONG_ENOUGH_MS : base);

/**
 * How long the notice stays in the mini line (`flashBase` is the time of its ordinary messages) and in the notice line of the expanded
 * window (`noticeBase`). The notice line always keeps it at least eight seconds. The mini line does too, except for an income: the run
 * that goes on has its mark buttons there («Взлетел» / «Прилетел»), and they are not drawn while a message is up, so a message that
 * closed no run keeps the usual short time.
 */
export function stayTimes(notice: ClosedRunNotice, flashBase: number, noticeBase: number): { flashMs: number; noticeMs: number } {
  return { flashMs: notice.closesRun ? shownFor(flashBase) : flashBase, noticeMs: shownFor(noticeBase) };
}

/** The profit as the player reads it: a gain has a plus, a loss and a zero carry theirs in the number. */
const signed = (figures: RunFigures): string => (figures.tone === 'gain' ? `+${figures.profit}` : figures.profit);

/** The part of the line after a number that has no sense (no time, nothing invested) is left out. */
const known = (text: string, say: (text: string) => string): string[] => (text === NONE ? [] : [say(text)]);

/**
 * The notice of a run that has just been closed, `closed` being the run as the trade service returned it (with its end and its events):
 *  - a sale that emptied the hold: 'Рейс закрыт: +73 400 за 14:32 · ROI 15%' (no ROI without an investment);
 *  - the cargo lost: 'Рейс закрыт: груз потерян, -478 600';
 *  - a sale of goods that were never bought (a run of its own that is closed at once): 'Доход записан: +12 000', no run was closed.
 * A loss is an `error` (a run that lost its cargo but earned before it is not one).
 */
export function closedRunNotice(closed: RunWithEvents): ClosedRunNotice {
  const { run, events } = closed;
  const figures = runFigures(run, events, run.endedAt ?? run.startedAt);
  const kind = figures.tone === 'loss' ? 'error' : 'info';
  if (isIncomeRun(events)) return { text: tr('Доход записан: {v1}', { v1: signed(figures) }), kind, closesRun: false };
  if (run.status === 'lost') return { text: tr('Рейс закрыт: груз потерян, {v1}', { v1: signed(figures) }), kind, closesRun: true };
  // a run that took no time at all (the sale was written in the second of the purchase) has no time to say
  const took = figures.duration === NONE || figures.duration === '0:00' ? '' : tr(' за {duration}', { duration: figures.duration });
  const parts = [`${signed(figures)}${took}`, ...known(figures.roi, (roi) => `ROI ${roi}`)];
  return { text: tr('Рейс закрыт: {v1}', { v1: parts.join(' · ') }), kind, closesRun: true };
}
