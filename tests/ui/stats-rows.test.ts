import { describe, expect, it } from 'vitest';
import { formatCompact } from '../../src/core/format';
import { historyRows, liveRows, routeRows, sessionRows } from '../../src/ui/vm/stats-rows';
import { routeStats } from '../../src/core/stats';
import { ev, ref, run } from '../helpers/factories';
import { incomeRun } from '../helpers/income-fixtures';
import { MIX1, MIX2 } from '../helpers/mixed-fixtures';
import { R1, R2, R4, R5, R6, withMarks } from '../helpers/stats-fixtures';
import { NOW, stat } from '../helpers/stats-rows-fixtures';

// formatUec separates thousands with a non-breaking space
const nb = (s: string) => s.replace(/ /g, ' ');

describe('routeRows', () => {
  it('formats a route row', () => {
    const stats = routeStats([R1, withMarks(R2, 300, 1000, 500)]);
    expect(routeRows(stats, ref)[0]).toEqual({
      key: '1>2:10', route: 'ARC-L1 → TDD Area 18', commodity: 'GOLD', commodityHint: null, runs: 2, runsText: '2', time: '35:00',
      runsTitle: 'Число завершённых рейсов', profitTitle: 'Суммарная прибыль', rateTitle: 'UEC в час',
      phases: '5:00 · 16:40 · 8:20', profit: nb('545 000'), roi: '12%', rate: '467k', stat: stats[0],
    });
  });

  describe('with «Подробные расчёты» (spec 14.19)', () => {
    // one lost run of 100 000 that took 500 s was an attempt at this route
    const lossy = { ...stat, lostRuns: 1, lostProfit: -100_000, uecPerHourWithLosses: 340_851 };

    it('counts the lost runs into the row: finished of attempted, the profit and the rate with the losses', () => {
      const [row] = routeRows([lossy], ref, true);
      expect(row).toMatchObject({ runs: 2, runsText: '2/3', profit: nb('445 000'), rate: '341k', roi: '12%' });
      expect(row.runsTitle).toBe('Удачных рейсов 2 из 3 (67 %): потерянных 1');
      expect(row.profitTitle).toBe(`Прибыль с потерями: потерянный груз ${nb('-100 000')}`);
      expect(row.rateTitle).toContain('с потерями');
      // the table sorts by the numbers of the statistic, so they are the ones with the losses too
      expect(row.stat).toMatchObject({ totalProfit: 445_000, uecPerHour: 340_851, runs: 2 });
    });

    it('leaves the row as ever without the setting, and for a route that lost nothing', () => {
      expect(routeRows([lossy], ref)[0]).toMatchObject({ runs: 2, runsText: '2', profit: nb('545 000'), rate: '467k', runsTitle: 'Число завершённых рейсов' });
      expect(routeRows([lossy], ref)[0].stat).toBe(lossy);
      expect(routeRows([stat], ref, true)[0]).toEqual(routeRows([stat], ref)[0]);
    });
  });

  it('keeps the statistic a row was made of: the numbers the table is sorted by', () => {
    const stats = [{ ...stat, destId: 3 }, stat];
    expect(routeRows(stats, ref).map(r => r.stat)).toEqual(stats);
    expect(routeRows(stats, ref)[1].stat).toBe(stat);
  });

  it('writes the ROI the way the list of options does and the rate without its unit (the caption says UEC/ч)', () => {
    const row = (avgRoi: number, uecPerHour: number | null) => routeRows([{ ...stat, avgRoi, uecPerHour }], ref)[0];
    expect(row(0.025, 740_000).roi).toBe('2,5%');
    expect(row(0.2996, 740_000).roi).toBe('30%');
    expect(row(0.2996, 740_000).rate).toBe('740k');
    expect(row(0.2996, 1_890_000).rate).toBe(formatCompact(1_890_000));
    expect(row(Number.NaN, null)).toMatchObject({ roi: '—', rate: '—' });
  });

  it('shows missing phases as null and a missing rate as a dash', () => {
    const row = routeRows([{ ...stat, medianPhases: null, uecPerHour: null }], ref)[0];
    expect(row.phases).toBeNull();
    expect(row.rate).toBe('—');
  });

  it('keeps the given order, one row per route', () => {
    const rows = routeRows([{ ...stat, destId: 3 }, stat], ref);
    expect(rows.map(r => r.key)).toEqual(['1>3:10', '1>2:10']);
    expect(rows[0].route).toBe('ARC-L1 → CRU-L1');
  });

  it('is empty without statistics', () => {
    expect(routeRows([], ref)).toEqual([]);
  });

  describe('a route of several commodities (task 51)', () => {
    const mixedStat = routeStats([MIX1, MIX2])[0];

    it('says "смеш." in the column of the goods, and lists the goods in the tooltip', () => {
      expect(routeRows([mixedStat], ref)[0]).toMatchObject({
        route: 'ARC-L1 → TDD Area 18', commodity: 'смеш.', commodityHint: 'Смешанный груз: GOLD, TITA', runs: 2, profit: nb('156 000'), stat: mixedStat,
      });
    });

    it('has a key of its own, which the key of the simple route of one of the goods is not', () => {
      const simple = routeRows([{ ...mixedStat, commodityIds: [10] }], ref)[0];
      const mixed = routeRows([mixedStat], ref)[0];
      expect(mixed.key).toBe('1>2:10,20');
      expect(simple.key).toBe('1>2:10');
      expect(mixed.key).not.toBe(simple.key);
    });

    it('formats the numbers of the row as those of any route', () => {
      const [row] = routeRows([mixedStat], ref);
      expect(row).toMatchObject({ time: '25:00', phases: null, roi: '9,4%', rate: '187k' });
    });

    it('lists the goods by their codes, in the order of the codes, and by number the ones the reference lacks', () => {
      const withZinc = { ...ref, commodities: new Map([...ref.commodities, [10, { ...ref.commodities.get(10)!, code: 'ZINC' }]]) };
      expect(routeRows([mixedStat], withZinc)[0].commodityHint).toBe('Смешанный груз: TITA, ZINC');
      expect(routeRows([{ ...mixedStat, commodityIds: [10, 20, 999] }], ref)[0].commodityHint).toBe('Смешанный груз: #999, GOLD, TITA');
    });

    it('has no tooltip for the goods of a simple route, and no "смеш." in its cell', () => {
      expect(routeRows([stat], ref)[0]).toMatchObject({ commodity: 'GOLD', commodityHint: null });
    });
  });

  it('falls back to ids for entries missing from the reference', () => {
    expect(routeRows([{ ...stat, originId: 777, commodityIds: [999] }], ref)[0]).toMatchObject({ route: '#777 → TDD Area 18', commodity: '#999' });
    expect(routeRows([{ ...stat, destId: 888 }], ref)[0].route).toBe('ARC-L1 → #888');
  });

  // a terminal is spelled like everywhere else (`terminalName`): the nickname, else the display name, else the name, else its number
  it('spells a terminal without a nickname by its display name, then its name (task 44: it used to fall back to the number)', () => {
    const noNickname = { ...ref, terminals: new Map([...ref.terminals, [9, { ...ref.terminals.get(1)!, id: 9, nickname: '' }]]) };
    expect(routeRows([{ ...stat, originId: 9 }], noNickname)[0].route).toBe('ARC-L1 Wide Forest Station → TDD Area 18');
    const onlyName = { ...ref, terminals: new Map([...ref.terminals, [9, { ...ref.terminals.get(1)!, id: 9, nickname: '', displayname: '', name: 'Wide Forest' }]]) };
    expect(routeRows([{ ...stat, originId: 9 }], onlyName)[0].route).toBe('Wide Forest → TDD Area 18');
  });

  it('names a terminal without any name by its number', () => {
    const nameless = { ...ref, terminals: new Map([...ref.terminals, [9, { ...ref.terminals.get(1)!, id: 9, nickname: '', displayname: '', name: '' }]]) };
    expect(routeRows([{ ...stat, originId: 9 }], nameless)[0].route).toBe('#9 → TDD Area 18');
  });

  it('spells the terminals of the history and of the mixed run the same way', () => {
    const noNickname = { ...ref, terminals: new Map([...ref.terminals, [1, { ...ref.terminals.get(1)!, nickname: '' }]]) };
    expect(historyRows([R1], noNickname, NOW)[0].title).toBe('GOLD: ARC-L1 Wide Forest Station → TDD Area 18');
  });
});

describe('historyRows', () => {
  it('formats history, including mixed and lost runs', () => {
    const h = historyRows([R5, R4, R1], ref, NOW);
    expect(h[2]).toMatchObject({ title: 'GOLD: ARC-L1 → TDD Area 18', status: 'done', profit: nb('345 000'), roi: '14%', duration: '40:00', rate: '518k' });
    expect(h[1]).toMatchObject({ status: 'lost', profit: nb('-100 000'), roi: '-100%' });
    expect(h[0].title).toBe('GOLD: смешанный рейс');
  });

  it('calls a lost run that never sold "груз потерян", and a run that sold in several places a mixed one', () => {
    // R4 bought gold and lost it, nothing was sold; R5 bought at one terminal and sold at two
    expect(historyRows([R4], ref, NOW)[0]).toMatchObject({ title: 'GOLD: груз потерян', status: 'lost' });
    expect(historyRows([R5], ref, NOW)[0].title).toBe('GOLD: смешанный рейс');
  });

  it('calls an active run that has only bought "идёт", with every commodity bought', () => {
    const loading = {
      run: run({ id: 10, startedAt: 1000, endedAt: null, status: 'active' }),
      events: [
        ev({ id: 101, runId: 10, ts: 1000, type: 'buy', terminalId: 1, commodityId: 10, scu: 10, price: 100 }),
        ev({ id: 102, runId: 10, ts: 1100, type: 'buy', terminalId: 1, commodityId: 20, scu: 10, price: 100 }),
      ],
    };
    expect(historyRows([loading], ref, 2000)[0]).toMatchObject({ title: 'GOLD, TITA: идёт', status: 'active' });
  });

  it('does not take a sale without a price or a quantity for a sale', () => {
    const half = {
      run: run({ id: 11, startedAt: 1000, endedAt: 2000, status: 'lost' }),
      events: [
        ev({ id: 111, runId: 11, ts: 1000, type: 'buy', terminalId: 1, commodityId: 10, scu: 10, price: 100 }),
        ev({ id: 112, runId: 11, ts: 2000, type: 'sell', terminalId: 2, commodityId: 10, scu: null, price: null }),
      ],
    };
    expect(historyRows([half], ref, NOW)[0].title).toBe('GOLD: груз потерян');
  });

  describe('a sale without a purchase (income, task 32)', () => {
    const income = incomeRun(21, 5000, 120, 3700);

    it('is called by its code and "продажа без закупки", not a mixed run, with the revenue as the profit and dashes for ROI, time and rate', () => {
      expect(historyRows([income], ref, NOW)[0]).toEqual({
        runId: 21, when: expect.stringMatching(/^\d\d\.\d\d \d\d:\d\d$/), title: 'TITA: продажа без закупки', hint: 'TITA: продажа без закупки', status: 'done',
        profit: nb('444 000'), roi: '—', duration: '—', rate: '—',
      });
    });

    it('has no duration even when the sale is written a moment after the start, and keeps the duration of every run that bought', () => {
      const slow = { run: { ...income.run, endedAt: 5300 }, events: income.events };                  // not what the service writes, but still no flight
      expect(historyRows([slow], ref, NOW)[0]).toMatchObject({ title: 'TITA: продажа без закупки', duration: '—', rate: '—' });
      expect(historyRows([R1, R4], ref, NOW).map(r => r.duration)).toEqual(['40:00', '8:20']);
    });

    it('names every commodity when one run sold several without buying', () => {
      const several = { run: income.run, events: [...income.events, ev({ id: 212, runId: 21, ts: 5000, type: 'sell', terminalId: 2, commodityId: 10, scu: 5, price: 7000 })] };
      expect(historyRows([several], ref, NOW)[0].title).toBe('TITA, GOLD: продажа без закупки');
    });

    it('leaves the titles of the runs that bought alone: a purchase makes it a run again', () => {
      expect(historyRows([R4], ref, NOW)[0].title).toBe('GOLD: груз потерян');
      expect(historyRows([R5], ref, NOW)[0].title).toBe('GOLD: смешанный рейс');
      expect(historyRows([R1], ref, NOW)[0].title).toBe('GOLD: ARC-L1 → TDD Area 18');
    });

    it('prints no NaN and no infinite percent anywhere in the row', () => {
      expect(Object.values(historyRows([income], ref, NOW)[0]).join('|')).not.toMatch(/NaN|Infinity|∞/);
    });

    it('stands in the list next to a run that is going, which keeps its dashes', () => {
      const rows = historyRows([income, R6], ref, R6.run.startedAt + 600);
      expect(rows.map(r => [r.status, r.profit])).toEqual([['done', nb('444 000')], ['active', '—']]);
    });
  });

  it('carries the run id and keeps the given order', () => {
    expect(historyRows([R5, R4, R1], ref, NOW).map(r => r.runId)).toEqual([5, 4, 1]);
  });

  it('lasts until now while a run is active', () => {
    const [row] = historyRows([R6], ref, R6.run.startedAt + 600);
    expect(row).toMatchObject({ status: 'active', duration: '10:00' });
  });

  describe('a run that is still going', () => {
    const going = (events: ReturnType<typeof ev>[]) => ({ run: run({ id: 12, startedAt: 1000, endedAt: null, status: 'active' }), events });
    const bought = ev({ id: 121, runId: 12, ts: 1000, type: 'buy', terminalId: 1, commodityId: 10, scu: 100, price: 5000 });
    const soldPart = ev({ id: 122, runId: 12, ts: 1300, type: 'sell', terminalId: 2, commodityId: 10, scu: 40, price: 6000 });

    it('is not a loss: with purchases only, profit, ROI and rate are dashes and the time is what has passed', () => {
      const [row] = historyRows([going([bought])], ref, 1000 + 12 * 60 + 1);
      expect(row).toMatchObject({ status: 'active', title: 'GOLD: идёт', profit: '—', roi: '—', duration: '12:01', rate: '—' });
    });

    it('shows no partial figure after it sold part of its cargo', () => {
      const [row] = historyRows([going([bought, soldPart])], ref, 1000 + 600);
      expect(row).toMatchObject({ status: 'active', profit: '—', roi: '—', rate: '—', duration: '10:00' });
    });

    it('keeps the loss of a lost run, and the figures of a done one', () => {
      const lost = { run: run({ id: 13, startedAt: 1000, endedAt: 1600, status: 'lost' }), events: [{ ...bought, id: 131, runId: 13 }] };
      const done = { run: run({ id: 14, startedAt: 1000, endedAt: 4400, status: 'done' }), events: [{ ...bought, id: 141, runId: 14 }, { ...soldPart, id: 142, runId: 14, ts: 4400, scu: 100 }] };
      const rows = historyRows([lost, done], ref, NOW);
      expect(rows[0]).toMatchObject({ status: 'lost', profit: nb('-500 000'), roi: '-100%', duration: '10:00' });
      expect(rows[0].rate).toMatch(/^-/);
      expect(rows[1]).toMatchObject({ status: 'done', profit: nb('100 000'), roi: '20%', duration: '56:40', rate: '106k' });
    });
  });

  it('writes the ROI the way the list of options does: whole percents, a decimal only below ten', () => {
    const roiOf = (price: number) => {
      const r = { run: run({ id: 15, startedAt: 0, endedAt: 600, status: 'done' }), events: [
        ev({ id: 151, runId: 15, ts: 0, type: 'buy', terminalId: 1, commodityId: 10, scu: 100, price: 1000 }),
        ev({ id: 152, runId: 15, ts: 600, type: 'sell', terminalId: 2, commodityId: 10, scu: 100, price }),
      ] };
      return historyRows([r], ref, NOW)[0].roi;
    };
    expect(roiOf(1025)).toBe('2,5%');
    expect(roiOf(1090)).toBe('9%');
    expect(roiOf(1141)).toBe('14%');
    expect(roiOf(960)).toBe('-4%');
  });

  describe('a run of several commodities that sold (task 44)', () => {
    const mixed = {
      run: run({ id: 7, startedAt: 1000, endedAt: 2000, status: 'done' }),
      events: [
        ev({ id: 71, runId: 7, ts: 1000, type: 'buy', terminalId: 1, commodityId: 10, scu: 10, price: 100 }),
        ev({ id: 72, runId: 7, ts: 1100, type: 'buy', terminalId: 1, commodityId: 20, scu: 10, price: 100 }),
        ev({ id: 73, runId: 7, ts: 2000, type: 'sell', terminalId: 2, commodityId: 10, scu: 10, price: 120 }),
        ev({ id: 74, runId: 7, ts: 2000, type: 'sell', terminalId: 2, commodityId: 20, scu: 10, price: 120 }),
      ],
    };

    it('shows where it went instead of the cut "смешанный ре…": the route, and "смеш." for the goods', () => {
      expect(historyRows([mixed], ref, NOW)[0].title).toBe('смеш.: ARC-L1 → TDD Area 18');
    });

    it('lists every commodity once, in the order of first use, in the hint of the row', () => {
      expect(historyRows([mixed], ref, NOW)[0].hint).toBe('GOLD, TITA: смешанный рейс, ARC-L1 → TDD Area 18');
    });

    it('goes from the first purchase to the last sale when it bought and sold in several places', () => {
      const wide = {
        run: mixed.run,
        events: [
          ev({ id: 71, runId: 7, ts: 1000, type: 'buy', terminalId: 3, commodityId: 10, scu: 10, price: 100 }),
          ev({ id: 72, runId: 7, ts: 1100, type: 'buy', terminalId: 1, commodityId: 20, scu: 10, price: 100 }),
          ev({ id: 73, runId: 7, ts: 1800, type: 'sell', terminalId: 2, commodityId: 10, scu: 10, price: 120 }),
          ev({ id: 74, runId: 7, ts: 2000, type: 'sell', terminalId: 4, commodityId: 20, scu: 10, price: 120 }),
        ],
      };
      expect(historyRows([wide], ref, NOW)[0].title).toBe('смеш.: CRU-L1 → Ruin Station');
    });

    it('names a terminal the reference lacks by its number, and a trade without a terminal by a dash', () => {
      const gone = { run: mixed.run, events: mixed.events.map((e) => (e.id === 71 ? { ...e, terminalId: 777 } : e.id === 74 ? { ...e, terminalId: null } : e)) };
      expect(historyRows([gone], ref, NOW)[0].title).toBe('смеш.: #777 → —');
    });

    it('keeps the commodities it has not sold yet in the list while it goes: "идёт" has no route to show', () => {
      const loading = { run: run({ id: 8, startedAt: 1000, endedAt: null, status: 'active' }), events: mixed.events.slice(0, 2) };
      expect(historyRows([loading], ref, 1500)[0]).toMatchObject({ title: 'GOLD, TITA: идёт', hint: 'GOLD, TITA: идёт' });
    });

    it('says "груз потерян" for the lost one that never sold, and shows the route of the one that sold before it was lost', () => {
      const lost = { run: run({ id: 9, startedAt: 1000, endedAt: 1500, status: 'lost' }), events: mixed.events.slice(0, 2) };
      expect(historyRows([lost], ref, NOW)[0]).toMatchObject({ title: 'GOLD, TITA: груз потерян', status: 'lost' });
      const soldPart = { run: lost.run, events: mixed.events.slice(0, 3) };
      expect(historyRows([soldPart], ref, NOW)[0]).toMatchObject({ title: 'смеш.: ARC-L1 → TDD Area 18', status: 'lost' });
    });

    it('is told apart from a run of one commodity sold in several places, which keeps its name', () => {
      expect(historyRows([R5], ref, NOW)[0]).toMatchObject({ title: 'GOLD: смешанный рейс', hint: 'GOLD: смешанный рейс' });
    });
  });

  it('falls back to ids for terminals and commodities missing from the reference', () => {
    const gone = {
      run: run({ id: 8, startedAt: 1000, endedAt: 2000, status: 'done' }),
      events: [
        ev({ id: 81, runId: 8, ts: 1000, type: 'buy', terminalId: 777, commodityId: 999, scu: 10, price: 100 }),
        ev({ id: 82, runId: 8, ts: 2000, type: 'sell', terminalId: 2, commodityId: 999, scu: 10, price: 120 }),
      ],
    };
    expect(historyRows([gone], ref, NOW)[0].title).toBe('#999: #777 → TDD Area 18');
  });

  it('shows a dash for a run without trades', () => {
    const empty = { run: run({ id: 9, startedAt: 1000, endedAt: null, status: 'active' }), events: [] };
    expect(historyRows([empty], ref, 1000)[0]).toMatchObject({ title: '—', profit: '—', roi: '—', duration: '0:00', rate: '—' });
    const done = { run: run({ id: 10, startedAt: 1000, endedAt: 1000, status: 'done' }), events: [] };
    expect(historyRows([done], ref, 1000)[0]).toMatchObject({ title: '—', profit: '0', roi: '—', duration: '0:00', rate: '—' });
  });

  it('prints the start in local time, zero-padded', () => {
    const start = new Date(2026, 0, 5, 9, 7).getTime() / 1000;
    const local = { run: { ...R1.run, startedAt: start, endedAt: start + 60 }, events: R1.events };
    expect(historyRows([local], ref, NOW)[0].when).toBe('05.01 09:07');
  });

  it('is empty without runs', () => {
    expect(historyRows([], ref, NOW)).toEqual([]);
  });
});

describe('sessionRows', () => {
  it('formats sessions and empty rates', () => {
    expect(sessionRows([{ startTs: 30000, endTs: 30000, runIds: [3], runCount: 1, profit: 50_000, uecPerHour: null }])[0]).toMatchObject({ runs: 1, duration: '0:00', rate: '—' });
  });

  it('formats a session with runs, in the given order', () => {
    const start = new Date(2026, 9, 6, 14, 5).getTime() / 1000;
    const rows = sessionRows([
      { startTs: start, endTs: start + 5400, runIds: [3, 4], runCount: 2, profit: 345_000, uecPerHour: 230_000 },
      { startTs: 1000, endTs: 2000, runIds: [1], runCount: 1, profit: -100_000, uecPerHour: -360_000 },
    ]);
    expect(rows[0]).toEqual({ when: '06.10 14:05', duration: '1:30:00', runs: 2, profit: nb('345 000'), rate: '230k' });
    expect(rows[1]).toMatchObject({ runs: 1, profit: nb('-100 000'), rate: '-360k' });
  });

  it('shows the runs of a session, not its incomes: a session of incomes only has no run and still has its profit', () => {
    const rows = sessionRows([
      { startTs: 1000, endTs: 2000, runIds: [5, 6, 7], runCount: 2, profit: 800_000, uecPerHour: 2_880_000 },   // two runs and an income
      { startTs: 5000, endTs: 5000, runIds: [9], runCount: 0, profit: 444_000, uecPerHour: null },               // one income
    ]);
    expect(rows[0]).toMatchObject({ runs: 2, profit: nb('800 000') });
    expect(rows[1]).toMatchObject({ runs: 0, profit: nb('444 000'), rate: '—' });
  });

  it('is empty without sessions', () => {
    expect(sessionRows([])).toEqual([]);
  });

  describe('a session of nothing (task 44)', () => {
    const prices = { startTs: 30000, endTs: 30000, runIds: [], runCount: 0, profit: 0, uecPerHour: null };
    const flight = { startTs: 1000, endTs: 2000, runIds: [1], runCount: 1, profit: -100_000, uecPerHour: -360_000 };
    const income = { startTs: 5000, endTs: 5000, runIds: [9], runCount: 0, profit: 444_000, uecPerHour: null };

    it('is not listed: no run and no profit (the player only wrote prices, or the history was cleared)', () => {
      expect(sessionRows([prices])).toEqual([]);
      expect(sessionRows([{ ...prices, startTs: 100, endTs: 7000, uecPerHour: 0 }])).toEqual([]);
    });

    it('is left out of a list of sessions that have something, and the others keep their order', () => {
      expect(sessionRows([prices, flight, { ...prices, startTs: 20 }, income]).map((r) => [r.runs, r.profit])).toEqual([
        [1, nb('-100 000')],
        [0, nb('444 000')],
      ]);
    });

    it('is listed when it holds only a sale without a purchase: no run, but a profit', () => {
      expect(sessionRows([income])).toHaveLength(1);
    });

    it('is listed when its run earned nothing: the run is there', () => {
      expect(sessionRows([{ ...flight, profit: 0, uecPerHour: 0 }])).toHaveLength(1);
    });
  });
});

describe('liveRows', () => {
  it('is the very same list while no run is going', () => {
    const rows = historyRows([R5, R4, R1], ref, NOW);
    expect(liveRows(rows, [R5, R4, R1], ref, NOW + 999)).toBe(rows);
  });

  it('makes again only the row of the run that is going, for the new time; the other rows are the same objects', () => {
    const runs = [R6, R5, R4, R1];
    const rows = historyRows(runs, ref, R6.run.startedAt + 60);
    expect(rows[0].duration).toBe('1:00');

    const later = liveRows(rows, runs, ref, R6.run.startedAt + 600);
    expect(later).not.toBe(rows);
    expect(later[0]).toMatchObject({ runId: 6, status: 'active', duration: '10:00' });
    expect(later[1]).toBe(rows[1]);
    expect(later[2]).toBe(rows[2]);
    expect(later[3]).toBe(rows[3]);
    expect(later).toEqual(historyRows(runs, ref, R6.run.startedAt + 600));
  });

  it('keeps the order of the runs when the one that is going is not the first', () => {
    const runs = [R5, R6, R1];
    const later = liveRows(historyRows(runs, ref, 0), runs, ref, R6.run.startedAt + 300);
    expect(later.map((r) => r.runId)).toEqual([5, 6, 1]);
    expect(later[1].duration).toBe('5:00');
  });
});
