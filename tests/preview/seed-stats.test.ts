import { describe, expect, it } from 'vitest';
import { pairKey } from '../../src/core/types';
import type { RunEvent } from '../../src/core/types';
import { suggestFromDetailed } from '../../src/data/suggest';
import { DATASET_NAMES } from '../../src/preview/datasets';
import { historyRows, routeRows } from '../../src/ui/vm/stats-rows';
import { figuresOf } from '../../src/ui/vm/stats-view';
import { loadHistory } from '../../src/ui/stats-history';
import { STATS_NOW, statsData } from '../helpers/stats-wiring-fixtures';

const ARC_L1 = 1;
const HUR_L1 = 3;
const MIC_L1 = 4;

describe('the stats datasets', () => {
  it('are datasets of their own', () => {
    expect(DATASET_NAMES).toContain('stats');
    expect(DATASET_NAMES).toContain('no-runs');
  });
});

describe('the stats dataset: the history', () => {
  it('holds thirty runs and more: done, lost and one that is going', async () => {
    const { runs } = await loadHistory((await statsData('stats')).db);
    expect(runs.length).toBeGreaterThanOrEqual(30);
    const count = (status: string) => runs.filter((r) => r.run.status === status).length;
    expect(count('active')).toBe(1);
    expect(count('lost')).toBeGreaterThanOrEqual(3);
    expect(count('done')).toBeGreaterThan(25);
  });

  it('is cut into several sessions, every finished run is in one of them, newest first', async () => {
    const { db } = await statsData('stats');
    const history = await loadHistory(db);
    const { sessions } = figuresOf(history);
    expect(sessions.length).toBeGreaterThanOrEqual(6);
    const finished = history.runs.filter((r) => r.run.status !== 'active').length;
    expect(sessions.reduce((sum, s) => sum + s.runIds.length, 0)).toBe(finished);
    expect(sessions.map((s) => s.startTs)).toEqual([...sessions.map((s) => s.startTs)].sort((a, b) => b - a));
  });

  it('names the lost run and the mixed one in the history as the section says', async () => {
    const { db, reference } = await statsData('stats');
    const { runs } = await loadHistory(db);
    const rows = historyRows(runs, reference, STATS_NOW);
    const titles = rows.map((r) => r.title);
    expect(titles.some((t) => t.endsWith(': груз потерян'))).toBe(true);
    expect(rows.some((r) => /^смеш\.: .+ → .+$/.test(r.title) && r.hint.startsWith('GOLD, TUNG: смешанный рейс, '))).toBe(true);
    expect(titles.some((t) => /^STIM: HUR-L1 → MIC-L1$/.test(t))).toBe(true);
  });

  it('has three runs on one pair: Stims from HUR-L1 to MIC-L1, median 24:10', async () => {
    const { db } = await statsData('stats');
    const f = figuresOf(await loadHistory(db));
    expect(f.runCounts.get(pairKey(HUR_L1, MIC_L1))).toBe(3);
    expect(f.ownMedian.get(pairKey(HUR_L1, MIC_L1))).toBe(1450);
    const stims = f.stats.find((s) => s.originId === HUR_L1 && s.destId === MIC_L1);
    expect(stims).toMatchObject({ runs: 3, medianDurationSec: 1450 });
  });

  it('has more routes than the pair, the best one first', async () => {
    const { db } = await statsData('stats');
    const { stats } = figuresOf(await loadHistory(db));
    expect(stats.length).toBeGreaterThanOrEqual(8);
    const rates = stats.map((s) => s.uecPerHour ?? -Infinity);
    expect(rates).toEqual([...rates].sort((a, b) => b - a));
  });
});

describe('the stats dataset: the options from HUR-L1', () => {
  it('are the five trips of the window dataset, with the same numbers, and the pair takes my time and my three runs', async () => {
    const own = await statsData('stats');
    const bare = await statsData('no-runs');
    const ask = (data: typeof own) => suggestFromDetailed(data.deps, HUR_L1, 696, undefined, { distances: 'cached' });
    const [withHistory, without] = [await ask(own), await ask(bare)];

    expect(withHistory.options).toHaveLength(5);
    const numbers = (list: typeof withHistory.options) => list.map((o) => ({ key: `${o.destId}:${o.commodityId}`, qty: o.qty, profit: o.profit, roi: o.roi }));
    expect(numbers(withHistory.options).sort((a, b) => a.key.localeCompare(b.key))).toEqual(numbers(without.options).sort((a, b) => a.key.localeCompare(b.key)));

    const stimsTrip = (list: typeof withHistory.options) => list.find((o) => o.destId === MIC_L1);
    expect(stimsTrip(without.options)).toMatchObject({ timeSource: 'estimate' });
    expect(stimsTrip(withHistory.options)).toMatchObject({ timeSource: 'own', timeSec: 1450 });
    expect(stimsTrip(withHistory.options)!.timeSec).toBeGreaterThan(stimsTrip(without.options)!.timeSec! + 300);
    // no other trip of the five is one I have flown
    expect(withHistory.options.filter((o) => o.timeSource === 'own')).toHaveLength(1);
  });
});

describe('the no-runs dataset', () => {
  it('has no run and no run event, but the prices, the reference and the settings of the window dataset', async () => {
    const { db, reference, settings } = await statsData('no-runs');
    expect(await db.select('SELECT id FROM run')).toEqual([]);
    expect(await db.select('SELECT id FROM run_event')).toEqual([]);
    expect(figuresOf(await loadHistory(db)).stats).toEqual([]);
    expect(reference.terminals.size).toBe(19); // the window dataset has the 17 of the default one and two gateways
    expect(settings.scuCapacity).toBe(696);
  });
});

describe('the no-records dataset', () => {
  it('has no run and no price of the player either: no session, no route, the market of UEX and the reference stay', async () => {
    const { db, reference, settings } = await statsData('no-records');
    expect(await db.select('SELECT id FROM run')).toEqual([]);
    expect(await db.select('SELECT id FROM observation')).toEqual([]);
    const history = await loadHistory(db);
    expect(history).toEqual({ runs: [], recordTs: [], losses: [] });
    expect(figuresOf(history).sessions).toEqual([]);
    expect(await db.select('SELECT terminal_id FROM uex_price LIMIT 1')).toHaveLength(1);
    expect(reference.terminals.size).toBe(19); // the window dataset has the 17 of the default one and two gateways
    expect(settings.scuCapacity).toBe(696);
  });
});

describe('the window dataset, whose history the stats dataset is made on', () => {
  it('has the two runs of the default history: one is a simple route of the statistics, the other (MEDS and STIM, two commodities) is the route of a mixed cargo', async () => {
    const { db, reference } = await statsData('window');
    const history = await loadHistory(db);
    expect(history.runs).toHaveLength(2);
    const rows = routeRows(figuresOf(history).stats, reference);
    expect(rows.map((r) => [r.route, r.commodity, r.commodityHint, r.runs])).toEqual([
      ['Port Tressler → TDD Area 18', 'GOLD', null, 1],
      ['HUR-L1 → ARC-L1', 'смеш.', 'Смешанный груз: MEDS, STIM', 1],
    ]);
    const titles = historyRows(history.runs, reference, STATS_NOW).map((r) => r.title);
    expect(titles.filter((t) => t.startsWith('смеш.: '))).toHaveLength(1);
  });

  it('gives the pair of the mixed run its time and its run, once: HUR-L1 to ARC-L1, 38:00', async () => {
    const f = figuresOf(await loadHistory((await statsData('window')).db));
    expect(f.runCounts.get(pairKey(HUR_L1, ARC_L1))).toBe(1);
    expect(f.ownMedian.get(pairKey(HUR_L1, ARC_L1))).toBe(38 * 60);
  });
});

describe('the stats dataset: the routes of mixed cargo (task 51)', () => {
  const LORVILLE = 6;
  const AREA_18 = 5;

  it('has two rows «смеш.»: MEDS and STIM from HUR-L1 (the default history) and GOLD and TUNG from Lorville, two runs', async () => {
    const { db, reference } = await statsData('stats');
    const rows = routeRows(figuresOf(await loadHistory(db)).stats, reference).filter((r) => r.commodity === 'смеш.');
    expect(rows.map((r) => [r.route, r.commodityHint, r.runs]).sort()).toEqual([
      ['HUR-L1 → ARC-L1', 'Смешанный груз: MEDS, STIM', 1],
      ['TDD Lorville → TDD Area 18', 'Смешанный груз: GOLD, TUNG', 2],
    ]);
  });

  it('keeps the rows of the Gold and of the Tungsten on the same two terminals as they were: three runs and four, the mixed runs are no part of them', async () => {
    const { db, reference } = await statsData('stats');
    const rows = routeRows(figuresOf(await loadHistory(db)).stats, reference).filter((r) => r.route === 'TDD Lorville → TDD Area 18');
    expect(rows.map((r) => [r.commodity, r.runs, r.time, r.profit.replace(/\s/g, ' ')]).sort()).toEqual([
      ['GOLD', 3, '28:00', '835 000'],
      ['TUNG', 4, '30:30', '1 155 300'],
      ['смеш.', 2, '30:00', '543 400'],
    ]);
  });

  it('counts the two mixed runs and the seven simple ones in the pair Lorville → Area 18, each run once, and the median stays 29:00', async () => {
    const f = figuresOf(await loadHistory((await statsData('stats')).db));
    expect(f.runCounts.get(pairKey(LORVILLE, AREA_18))).toBe(9);
    expect(f.stats.filter((s) => s.originId === LORVILLE && s.destId === AREA_18).reduce((sum, s) => sum + s.runs, 0)).toBe(9);
    expect(f.ownMedian.get(pairKey(LORVILLE, AREA_18))).toBe(1740);
  });

  it('has the mixed runs in a session of their own, and the sessions count them as they did', async () => {
    const history = await loadHistory((await statsData('stats')).db);
    const { sessions } = figuresOf(history);
    const goods = (events: RunEvent[]): number => new Set(events.flatMap((e) => (e.commodityId === null ? [] : [e.commodityId]))).size;
    const mixedIds = history.runs.filter((r) => goods(r.events) === 2 && r.run.status === 'done').map((r) => r.run.id);
    expect(mixedIds).toHaveLength(3);                                                       // the two of Lorville and the one of HUR-L1
    expect(sessions.some((s) => s.runIds.length === 2 && mixedIds.filter((id) => s.runIds.includes(id)).length === 2)).toBe(true);
  });
});
