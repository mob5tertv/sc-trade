import { describe, expect, it } from 'vitest';
import { formatCompact } from '../../src/core/format';
import { historyRows, liveRows, routeRows, sessionRows } from '../../src/ui/vm/stats-rows';
import { routeStats } from '../../src/core/stats';
import { ev, ref, run } from '../helpers/factories';
import { R1, R2, R4, R5, R6, withMarks } from '../helpers/stats-fixtures';
import { NOW, stat } from '../helpers/stats-rows-fixtures';

// formatUec separates thousands with a non-breaking space
const nb = (s: string) => s.replace(/ /g, ' ');

describe('routeRows', () => {
  it('formats a route row', () => {
    expect(routeRows(routeStats([R1, withMarks(R2, 300, 1000, 500)]), ref)[0]).toEqual({
      key: '1>2:10', route: 'ARC-L1 → TDD Area 18', commodity: 'GOLD', runs: 2, time: '35:00',
      phases: '5:00 · 16:40 · 8:20', profit: nb('545 000'), roi: '12%', rate: '467k',
    });
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

  it('falls back to ids for entries missing from the reference', () => {
    expect(routeRows([{ ...stat, originId: 777, commodityId: 999 }], ref)[0]).toMatchObject({ route: '#777 → TDD Area 18', commodity: '#999' });
    expect(routeRows([{ ...stat, destId: 888 }], ref)[0].route).toBe('ARC-L1 → #888');
  });

  it('treats an empty label like a missing one', () => {
    const blank = { ...ref, terminals: new Map([...ref.terminals, [9, { ...ref.terminals.get(1)!, id: 9, nickname: '' }]]) };
    expect(routeRows([{ ...stat, originId: 9 }], blank)[0].route).toBe('#9 → TDD Area 18');
  });
});

describe('historyRows', () => {
  it('formats history, including mixed and lost runs', () => {
    const h = historyRows([R5, R4, R1], ref, NOW);
    expect(h[2]).toMatchObject({ title: 'GOLD: ARC-L1 → TDD Area 18', status: 'done', profit: nb('345 000'), roi: '14%', duration: '40:00', rate: '518k' });
    expect(h[1]).toMatchObject({ status: 'lost', profit: nb('-100 000'), roi: '-100%' });
    expect(h[0].title).toBe('GOLD: смешанный рейс');
  });

  it('calls a run that only bought a run without sales, and a run that sold in several places a mixed one', () => {
    // R4 bought gold and lost it, nothing was sold; R5 bought at one terminal and sold at two
    expect(historyRows([R4], ref, NOW)[0].title).toBe('GOLD: рейс без продаж');
    expect(historyRows([R5], ref, NOW)[0].title).toBe('GOLD: смешанный рейс');
  });

  it('calls an active run that has only bought a run without sales, with every commodity bought', () => {
    const loading = {
      run: run({ id: 10, startedAt: 1000, endedAt: null, status: 'active' }),
      events: [
        ev({ id: 101, runId: 10, ts: 1000, type: 'buy', terminalId: 1, commodityId: 10, scu: 10, price: 100 }),
        ev({ id: 102, runId: 10, ts: 1100, type: 'buy', terminalId: 1, commodityId: 20, scu: 10, price: 100 }),
      ],
    };
    expect(historyRows([loading], ref, 2000)[0]).toMatchObject({ title: 'GOLD, TITA: рейс без продаж', status: 'active' });
  });

  it('does not take a sale without a price or a quantity for a sale', () => {
    const half = {
      run: run({ id: 11, startedAt: 1000, endedAt: 2000, status: 'lost' }),
      events: [
        ev({ id: 111, runId: 11, ts: 1000, type: 'buy', terminalId: 1, commodityId: 10, scu: 10, price: 100 }),
        ev({ id: 112, runId: 11, ts: 2000, type: 'sell', terminalId: 2, commodityId: 10, scu: null, price: null }),
      ],
    };
    expect(historyRows([half], ref, NOW)[0].title).toBe('GOLD: рейс без продаж');
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
      expect(row).toMatchObject({ status: 'active', title: 'GOLD: рейс без продаж', profit: '—', roi: '—', duration: '12:01', rate: '—' });
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

  it('lists every commodity of a mixed run once, in the order of first use', () => {
    const mixed = {
      run: run({ id: 7, startedAt: 1000, endedAt: 2000, status: 'done' }),
      events: [
        ev({ id: 71, runId: 7, ts: 1000, type: 'buy', terminalId: 1, commodityId: 10, scu: 10, price: 100 }),
        ev({ id: 72, runId: 7, ts: 1100, type: 'buy', terminalId: 1, commodityId: 20, scu: 10, price: 100 }),
        ev({ id: 73, runId: 7, ts: 2000, type: 'sell', terminalId: 2, commodityId: 10, scu: 10, price: 120 }),
        ev({ id: 74, runId: 7, ts: 2000, type: 'sell', terminalId: 2, commodityId: 20, scu: 10, price: 120 }),
      ],
    };
    expect(historyRows([mixed], ref, NOW)[0].title).toBe('GOLD, TITA: смешанный рейс');
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
    expect(sessionRows([{ startTs: 30000, endTs: 30000, runIds: [], profit: 0, uecPerHour: null }])[0]).toMatchObject({ runs: 0, duration: '0:00', rate: '—' });
  });

  it('formats a session with runs, in the given order', () => {
    const start = new Date(2026, 9, 6, 14, 5).getTime() / 1000;
    const rows = sessionRows([
      { startTs: start, endTs: start + 5400, runIds: [3, 4], profit: 345_000, uecPerHour: 230_000 },
      { startTs: 1000, endTs: 2000, runIds: [1], profit: -100_000, uecPerHour: -360_000 },
    ]);
    expect(rows[0]).toEqual({ when: '06.10 14:05', duration: '1:30:00', runs: 2, profit: nb('345 000'), rate: '230k' });
    expect(rows[1]).toMatchObject({ runs: 1, profit: nb('-100 000'), rate: '-360k' });
  });

  it('is empty without sessions', () => {
    expect(sessionRows([])).toEqual([]);
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
