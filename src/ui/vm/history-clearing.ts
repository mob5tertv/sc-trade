import type { Run } from '../../core/types';

// Clearing the history of the player's runs (spec 14.14): "Настройки" → "Данные" says how many runs the history holds and since
// when, and has two buttons, one for the runs that ended more than thirty days ago and one for the whole history. The pure
// parts are here: the threshold, the counts the status line and the questions are made of, and their words.

/** A run that ended more than this many days ago is "old"; the one place the number is written. */
export const OLD_RUN_DAYS = 30;

const DAY_SEC = 86_400;

/** Which part of the history a button clears. */
export type ClearScope = 'old' | 'all';

/** The runs that ended before this moment (unix seconds) are old at `now`. */
export const oldRunsBefore = (now: number): number => now - OLD_RUN_DAYS * DAY_SEC;

export interface HistoryCounts {
  /** The runs that are over, done or lost (a sale without a purchase is a done run): what a clearing can delete. The run that is going is not one of them. */
  finished: number;
  /** Of those, the ones that ended before `oldRunsBefore(now)`. */
  old: number;
  /** When the earliest of the finished runs began (unix seconds), `null` without any. */
  since: number | null;
}

/** What the status line and the buttons are made of; `runs` is the list of the history, the run that is going included. */
export function historyCounts(runs: ReadonlyArray<{ run: Pick<Run, 'status' | 'startedAt' | 'endedAt'> }>, now: number): HistoryCounts {
  const before = oldRunsBefore(now);
  let finished = 0;
  let old = 0;
  let since: number | null = null;
  for (const { run } of runs) {
    if (run.status === 'active') continue;
    finished++;
    // the same condition as the SQL of the deletion: `ended_at < ?`, which a run without an end does not meet
    if (run.endedAt !== null && run.endedAt < before) old++;
    if (since === null || run.startedAt < since) since = run.startedAt;
  }
  return { finished, old, since };
}

/** The number of runs the button of `scope` clears. */
export const countFor = (scope: ClearScope, counts: HistoryCounts): number => (scope === 'old' ? counts.old : counts.finished);

/** 'рейс' after 1, 21, 101 ...; 'рейса' after 2-4, 22-24 ...; 'рейсов' after the rest (the teens included). */
export function pluralRuns(n: number): string {
  const lastTwo = Math.abs(n) % 100;
  const last = lastTwo % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return 'рейсов';
  if (last === 1) return 'рейс';
  if (last >= 2 && last <= 4) return 'рейса';
  return 'рейсов';
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

// '03.08.2026' in the machine's local time zone
function formatDate(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** 'История: 57 рейсов, с 03.08.2026', or 'История пуста' when no run is over. */
export function historyStatus(counts: HistoryCounts): string {
  if (counts.finished === 0 || counts.since === null) return 'История пуста';
  return `История: ${counts.finished} ${pluralRuns(counts.finished)}, с ${formatDate(counts.since)}`;
}

/** The labels of the two buttons and what each says when the mouse rests on it. */
export const CLEAR_BUTTONS: Readonly<Record<ClearScope, { label: string; title: string }>> = {
  old: {
    label: `Очистить старше ${OLD_RUN_DAYS} дней`,
    title: `Удаляет завершённые и потерянные рейсы, которые закончились больше ${OLD_RUN_DAYS} дней назад. Идущий рейс и свои цены остаются.`,
  },
  all: {
    label: 'Очистить всю историю',
    title: 'Удаляет все завершённые и потерянные рейсы. Идущий рейс и свои цены остаются.',
  },
};

/** The question under the header before a clearing: it names the number of runs that will go. */
export function clearQuestion(scope: ClearScope, runs: number): { text: string; yes: string } {
  const recount = 'Рейтинг маршрутов и сессии пересчитаются по оставшимся.';
  const text = scope === 'old'
    ? `Удалить ${runs} ${pluralRuns(runs)} старше ${OLD_RUN_DAYS} дней? ${recount} Свои цены не трогаются.`
    : `Удалить всю историю — ${runs} ${pluralRuns(runs)}? ${recount} Идущий рейс и свои цены не трогаются.`;
  return { text, yes: 'Да, удалить' };
}

/** The notice after a clearing. */
export function clearedText(runs: number): string {
  return runs === 0 ? 'Удалять было нечего' : `Удалено ${runs} ${pluralRuns(runs)}`;
}
