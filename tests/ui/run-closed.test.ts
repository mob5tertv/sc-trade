import { describe, expect, it } from 'vitest';
import type { RunWithEvents } from '../../src/core/types';
import { closedRunNotice, shownFor, stayTimes } from '../../src/ui/vm/run-closed';
import { historyRows } from '../../src/ui/vm/stats-rows';
import { ev, ref, run } from '../helpers/factories';
import { incomeRun } from '../helpers/income-fixtures';
import { R1, R4 } from '../helpers/stats-fixtures';
import { NOW } from '../helpers/stats-rows-fixtures';

// prices are formatted with a non-breaking space as the thousands separator: the spaces inside a number below are written as plain ones
const NBSP = String.fromCharCode(0xa0);
const nb = (s: string) => s.replace(/(\d) (?=\d{3}\b)/g, `$1${NBSP}`);

/** A finished Gold run from terminal 1 to terminal 2: `scu` bought at `buy` and sold at `sell`, `sec` seconds apart. */
function flight(scu: number, buy: number, sell: number, sec: number, status: 'done' | 'lost' = 'done'): RunWithEvents {
  return {
    run: run({ id: 31, startedAt: 1000, endedAt: 1000 + sec, status }),
    events: [
      ev({ id: 311, runId: 31, ts: 1000, type: 'buy', terminalId: 1, commodityId: 10, scu, price: buy }),
      ev({ id: 312, runId: 31, ts: 1000 + sec, type: 'sell', terminalId: 2, commodityId: 10, scu, price: sell }),
    ],
  };
}

describe('closedRunNotice, a run that was sold out', () => {
  it('says the profit with its sign, the income per hour and the ROI, as the row of the history does', () => {
    // R1: 345 000 over 40 minutes, 518k an hour, 14 %
    expect(closedRunNotice(R1)).toMatchObject({ text: nb('Рейс закрыт: +345 000 · 518k/ч · ROI 14%'), kind: 'info' });
  });

  it('takes its numbers from the very row the history will show (one function, not a second count)', () => {
    for (const r of [R1, flight(100, 1000, 1025, 600), flight(200, 5000, 4900, 1800), flight(7, 3, 4, 90)]) {
      const row = historyRows([r], ref, NOW)[0];
      const { text } = closedRunNotice(r);
      expect(text).toContain(row.profit.replace(/^-/, ''));
      expect(text).toContain(`${row.rate}/ч`);
      expect(text).toContain(`ROI ${row.roi}`);
    }
  });

  it('is a loss with a minus, in the colour of an error, when the cargo sold for less than it cost', () => {
    // 200 SCU bought at 5 000, sold at 4 900: -20 000 in half an hour, -40k an hour, -2 %
    expect(closedRunNotice(flight(200, 5000, 4900, 1800))).toMatchObject({ text: nb('Рейс закрыт: -20 000 · -40k/ч · ROI -2%'), kind: 'error' });
  });

  it('is not a loss, and has no sign, when nothing was earned', () => {
    expect(closedRunNotice(flight(10, 1000, 1000, 600))).toMatchObject({ text: 'Рейс закрыт: 0 · 0/ч · ROI 0%', kind: 'info' });
  });

  it('leaves the income per hour out when the run took no time', () => {
    expect(closedRunNotice(flight(100, 1000, 1025, 0))).toMatchObject({ text: nb('Рейс закрыт: +2 500 · ROI 2,5%'), kind: 'info' });
  });

  it('leaves the ROI out when nothing was invested', () => {
    // bought for nothing (a price of 0 is a price): the profit is the whole revenue, and a ratio to nothing says nothing
    expect(closedRunNotice(flight(100, 0, 25, 600))).toMatchObject({ text: nb('Рейс закрыт: +2 500 · 15k/ч'), kind: 'info' });
  });

  it('has no NaN and no infinity whatever the run is', () => {
    for (const r of [flight(100, 0, 0, 0), flight(1, 1, 1, 0), flight(3, 1000, 1, 5)]) {
      expect(closedRunNotice(r).text).not.toMatch(/NaN|Infinity|∞/);
    }
  });
});

describe('closedRunNotice, a run that was lost', () => {
  it('says that the cargo is lost and what it cost, as an error', () => {
    expect(closedRunNotice(R4)).toMatchObject({ text: nb('Рейс закрыт: груз потерян, -100 000'), kind: 'error' });
  });

  it('is only an error while it is a loss: a run that earned before the rest was lost stays quiet', () => {
    // 100 SCU bought at 1 000, 60 of them sold at 2 000, the other 40 lost: +20 000 all in all
    const partly: RunWithEvents = {
      run: run({ id: 32, startedAt: 1000, endedAt: 2000, status: 'lost' }),
      events: [
        ev({ id: 321, runId: 32, ts: 1000, type: 'buy', terminalId: 1, commodityId: 10, scu: 100, price: 1000 }),
        ev({ id: 322, runId: 32, ts: 1500, type: 'sell', terminalId: 2, commodityId: 10, scu: 60, price: 2000 }),
      ],
    };
    expect(closedRunNotice(partly)).toMatchObject({ text: nb('Рейс закрыт: груз потерян, +20 000'), kind: 'info' });
  });
});

describe('closedRunNotice, a sale without a purchase', () => {
  it('records an income, and says it did not close any run', () => {
    expect(closedRunNotice(incomeRun(21, 5000, 120, 3700))).toMatchObject({ text: nb('Доход записан: +444 000'), kind: 'info' });
  });
});

describe('closedRunNotice, whether a run was closed (fix round 1)', () => {
  it('says that a run was closed for a sale that emptied the hold and for a lost cargo', () => {
    expect(closedRunNotice(R1).closesRun).toBe(true);
    expect(closedRunNotice(R4).closesRun).toBe(true);
  });

  it('says that none was closed for a sale without a purchase: the run that goes on is still going', () => {
    expect(closedRunNotice(incomeRun(21, 5000, 120, 3700)).closesRun).toBe(false);
  });
});

describe('stayTimes, how long the notice stays where it is said', () => {
  const FLASH = 3000;
  const NOTICE = 8000;
  const closed = closedRunNotice(R1);
  const income = closedRunNotice(incomeRun(21, 5000, 120, 3700));

  it('keeps a closed run for eight seconds in the mini line too: no run is left whose marks the message could hide', () => {
    expect(stayTimes(closed, FLASH, NOTICE)).toEqual({ flashMs: 8000, noticeMs: 8000 });
  });

  it('keeps an income in the mini line for the usual short time: the run that goes on has its mark buttons there, and they are not drawn while a message is up', () => {
    expect(stayTimes(income, FLASH, NOTICE)).toEqual({ flashMs: FLASH, noticeMs: 8000 });
  });

  it('keeps the notice line at its own time when that is long enough, and raises it to eight seconds when it is not', () => {
    expect(stayTimes(income, FLASH, 10_000).noticeMs).toBe(10_000);
    expect(stayTimes(income, FLASH, 4000).noticeMs).toBe(8000);
  });
});

describe('shownFor', () => {
  it('keeps the time of the other messages when it is long enough to read the numbers', () => {
    expect(shownFor(8000)).toBe(8000);
    expect(shownFor(6000)).toBe(6000);
    expect(shownFor(10_000)).toBe(10_000);
  });

  it('gives a message that is gone sooner than six seconds eight (the mini line shows its messages for three)', () => {
    expect(shownFor(3000)).toBe(8000);
    expect(shownFor(5999)).toBe(8000);
  });
});
