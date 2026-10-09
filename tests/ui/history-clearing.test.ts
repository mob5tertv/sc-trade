import { describe, expect, it } from 'vitest';
import type { Run } from '../../src/core/types';
import {
  CLEAR_BUTTONS, clearedText, clearQuestion, countFor, historyCounts, historyStatus, oldRunsBefore, OLD_RUN_DAYS, pluralRuns,
} from '../../src/ui/vm/history-clearing';
import { run } from '../helpers/factories';

// Spec 14.14: clearing the history of runs. The pure parts: how many runs there are and since when, how many ended more than
// thirty days ago, the words of the question and of the notice.

const DAY = 86_400;
const NOW = 1_800_000_000;

/** A finished run that began `startedAgo` seconds before NOW and ended `endedAgo` seconds before NOW. */
const finished = (startedAgo: number, endedAgo: number, status: 'done' | 'lost' = 'done') => ({
  run: run({ startedAt: NOW - startedAgo, endedAt: NOW - endedAgo, status }),
});
const going = (startedAgo: number) => ({ run: run({ startedAt: NOW - startedAgo, endedAt: null, status: 'active' }) });

describe('the threshold', () => {
  it('is thirty days, in one place', () => {
    expect(OLD_RUN_DAYS).toBe(30);
    expect(oldRunsBefore(NOW)).toBe(NOW - 30 * DAY);
  });
});

describe('historyCounts', () => {
  it('counts the finished and the lost runs, income sales included, and says when the earliest began', () => {
    const counts = historyCounts([finished(2 * DAY, 2 * DAY - 600), finished(5 * DAY, 5 * DAY - 60, 'lost'), finished(9 * DAY, 9 * DAY)], NOW);
    expect(counts).toEqual({ finished: 3, old: 0, since: NOW - 9 * DAY });
  });

  it('does not count the run that is going, and it does not give the date either', () => {
    expect(historyCounts([going(3600), finished(2 * DAY, 2 * DAY - 600)], NOW)).toEqual({ finished: 1, old: 0, since: NOW - 2 * DAY });
    expect(historyCounts([going(40 * DAY)], NOW)).toEqual({ finished: 0, old: 0, since: null });
  });

  it('is empty without runs', () => {
    expect(historyCounts([], NOW)).toEqual({ finished: 0, old: 0, since: null });
  });

  it('counts a run as old by the time it ENDED, not by the time it began', () => {
    // begun 31 days ago, ended 29 days ago: not old; begun 33 days ago, ended 32 days ago: old
    const counts = historyCounts([finished(31 * DAY, 29 * DAY), finished(33 * DAY, 32 * DAY)], NOW);
    expect(counts.finished).toBe(2);
    expect(counts.old).toBe(1);
  });

  it('counts a run that ended exactly thirty days ago as not old: it is MORE than thirty days that count', () => {
    expect(historyCounts([finished(31 * DAY, 30 * DAY)], NOW).old).toBe(0);
    expect(historyCounts([finished(31 * DAY, 30 * DAY + 1)], NOW).old).toBe(1);
  });

  it('counts old lost runs too, and takes the earliest start whatever the order of the list', () => {
    const counts = historyCounts([finished(1 * DAY, 1 * DAY), finished(60 * DAY, 59 * DAY, 'lost'), finished(45 * DAY, 44 * DAY)], NOW);
    expect(counts).toEqual({ finished: 3, old: 2, since: NOW - 60 * DAY });
  });

  it('does not take a finished run with no end time for an old one (it cannot be told, and the SQL does not match it either)', () => {
    const odd = { run: { ...run({ status: 'done', startedAt: NOW - 90 * DAY }), endedAt: null } as Run };
    expect(historyCounts([odd], NOW)).toEqual({ finished: 1, old: 0, since: NOW - 90 * DAY });
  });
});

describe('countFor', () => {
  it('is the number the question names: all finished runs, or the old ones', () => {
    const counts = { finished: 57, old: 42, since: NOW - 60 * DAY };
    expect(countFor('all', counts)).toBe(57);
    expect(countFor('old', counts)).toBe(42);
  });
});

describe('pluralRuns', () => {
  it.each([
    [0, 'рейсов'], [1, 'рейс'], [2, 'рейса'], [3, 'рейса'], [4, 'рейса'], [5, 'рейсов'], [9, 'рейсов'], [10, 'рейсов'],
    [11, 'рейсов'], [12, 'рейсов'], [14, 'рейсов'], [19, 'рейсов'], [20, 'рейсов'], [21, 'рейс'], [22, 'рейса'], [25, 'рейсов'],
    [42, 'рейса'], [57, 'рейсов'], [100, 'рейсов'], [101, 'рейс'], [111, 'рейсов'], [112, 'рейсов'], [121, 'рейс'], [1002, 'рейса'],
  ])('%i: %s', (n, word) => {
    expect(pluralRuns(n)).toBe(word);
  });
});

describe('historyStatus', () => {
  it('says how many runs and since when, the date as day.month.year in local time', () => {
    const since = new Date(2026, 7, 3, 14, 5).getTime() / 1000;
    expect(historyStatus({ finished: 57, old: 12, since })).toBe('История: 57 рейсов, с 03.08.2026');
    expect(historyStatus({ finished: 1, old: 0, since })).toBe('История: 1 рейс, с 03.08.2026');
    expect(historyStatus({ finished: 42, old: 0, since })).toBe('История: 42 рейса, с 03.08.2026');
  });

  it('says it is empty when there is no finished run', () => {
    expect(historyStatus({ finished: 0, old: 0, since: null })).toBe('История пуста');
  });
});

describe('CLEAR_BUTTONS', () => {
  it('labels the two buttons and says in the hint what each leaves alone', () => {
    expect(CLEAR_BUTTONS.old.label).toBe('Очистить старше 30 дней');
    expect(CLEAR_BUTTONS.all.label).toBe('Очистить всю историю');
    for (const scope of ['old', 'all'] as const) {
      expect(CLEAR_BUTTONS[scope].title).toContain('Идущий рейс и свои цены остаются');
    }
  });
});

describe('clearQuestion', () => {
  it('names the number of runs older than thirty days, and what is kept', () => {
    const q = clearQuestion('old', 42);
    expect(q.text).toBe('Удалить 42 рейса старше 30 дней? Рейтинг маршрутов и сессии пересчитаются по оставшимся. Свои цены не трогаются.');
    expect(q.yes).toBe('Да, удалить');
  });

  it('names the number of runs of the whole history, and says the run that is going stays', () => {
    const q = clearQuestion('all', 57);
    expect(q.text).toBe('Удалить всю историю — 57 рейсов? Рейтинг маршрутов и сессии пересчитаются по оставшимся. Идущий рейс и свои цены не трогаются.');
    expect(q.yes).toBe('Да, удалить');
  });

  it('declines the word after the number', () => {
    expect(clearQuestion('old', 1).text).toMatch(/^Удалить 1 рейс старше/);
    expect(clearQuestion('old', 21).text).toMatch(/^Удалить 21 рейс старше/);
    expect(clearQuestion('all', 3).text).toMatch(/^Удалить всю историю — 3 рейса\?/);
    expect(clearQuestion('all', 11).text).toMatch(/^Удалить всю историю — 11 рейсов\?/);
  });
});

describe('clearedText', () => {
  it('names the number of runs that were deleted', () => {
    expect(clearedText(42)).toBe('Удалено 42 рейса');
    expect(clearedText(57)).toBe('Удалено 57 рейсов');
    expect(clearedText(1)).toBe('Удалено 1 рейс');
  });

  it('says there was nothing to delete when it was nothing', () => {
    expect(clearedText(0)).toBe('Удалять было нечего');
  });
});
