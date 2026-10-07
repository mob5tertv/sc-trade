import { describe, expect, it } from 'vitest';
import { pairKey } from '../../src/core/types';
import { suggestFromDetailed } from '../../src/data/suggest';
import { DATASET_NAMES } from '../../src/preview/datasets';
import { historyRows } from '../../src/ui/vm/stats-rows';
import { figuresOf } from '../../src/ui/vm/stats-view';
import { loadHistory } from '../../src/ui/stats-history';
import { STATS_NOW, statsData } from '../helpers/stats-wiring-fixtures';

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
    const titles = historyRows(runs, reference, STATS_NOW).map((r) => r.title);
    expect(titles.some((t) => t.endsWith(': рейс без продаж'))).toBe(true);
    expect(titles.some((t) => t === 'GOLD, TUNG: смешанный рейс')).toBe(true);
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
    expect(reference.terminals.size).toBe(17);
    expect(settings.scuCapacity).toBe(696);
  });
});

describe('the no-records dataset', () => {
  it('has no run and no price of the player either: no session, no route, the market of UEX and the reference stay', async () => {
    const { db, reference, settings } = await statsData('no-records');
    expect(await db.select('SELECT id FROM run')).toEqual([]);
    expect(await db.select('SELECT id FROM observation')).toEqual([]);
    const history = await loadHistory(db);
    expect(history).toEqual({ runs: [], recordTs: [] });
    expect(figuresOf(history).sessions).toEqual([]);
    expect(await db.select('SELECT terminal_id FROM uex_price LIMIT 1')).toHaveLength(1);
    expect(reference.terminals.size).toBe(17);
    expect(settings.scuCapacity).toBe(696);
  });
});

describe('the window dataset keeps its two runs of the default history', () => {
  it('one of them a simple route, the other a mixed one', async () => {
    const { db } = await statsData('window');
    const { stats } = figuresOf(await loadHistory(db));
    expect(stats).toHaveLength(1);
  });
});
