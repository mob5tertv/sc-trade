import { describe, expect, it } from 'vitest';
import { historyRows, routeRows, sessionRows } from '../../src/ui/vm/stats-rows';
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
      phases: '5:00 · 16:40 · 8:20', profit: nb('545 000'), roi: '12,1%', rate: '467k/ч',
    });
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
    expect(h[2]).toMatchObject({ title: 'GOLD: ARC-L1 → TDD Area 18', status: 'done', profit: nb('345 000'), roi: '14,1%', duration: '40:00', rate: '518k/ч' });
    expect(h[1]).toMatchObject({ status: 'lost', profit: nb('-100 000') });
    expect(h[0].title).toBe('GOLD: смешанный рейс');
  });

  it('carries the run id and keeps the given order', () => {
    expect(historyRows([R5, R4, R1], ref, NOW).map(r => r.runId)).toEqual([5, 4, 1]);
  });

  it('lasts until now while a run is active', () => {
    const [row] = historyRows([R6], ref, R6.run.startedAt + 600);
    expect(row).toMatchObject({ status: 'active', duration: '10:00' });
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
    expect(historyRows([empty], ref, 1000)[0]).toMatchObject({ title: '—', profit: '0', roi: '—', duration: '0:00', rate: '—' });
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
    expect(rows[0]).toEqual({ when: '06.10 14:05', duration: '1:30:00', runs: 2, profit: nb('345 000'), rate: '230k/ч' });
    expect(rows[1]).toMatchObject({ runs: 1, profit: nb('-100 000'), rate: '-360k/ч' });
  });

  it('is empty without sessions', () => {
    expect(sessionRows([])).toEqual([]);
  });
});
