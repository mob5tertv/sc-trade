import { describe, expect, it } from 'vitest';
import { createLogger, memorySink } from '../../src/data/logger';
import type { Db } from '../../src/data/db';
import { clearHistory } from '../../src/data/trade';
import { DATASET_NAMES } from '../../src/preview/datasets';
import { prepareAnyDataset } from '../../src/preview/prepare';
import { loadSettings } from '../../src/data/repo/settings';
import { loadHistory } from '../../src/ui/stats-history';
import { historyCounts, oldRunsBefore } from '../../src/ui/vm/history-clearing';
import { testDb } from '../helpers/test-db';

// The `stats-old` dataset (spec 14.14): the `stats` dataset with runs that ended long ago, for the scenes of the clearing of the history.

const NOW = 1_800_000_000;
const DAY = 86_400;

async function dataset(name: 'stats' | 'stats-old'): Promise<Db> {
  const db = testDb();
  await prepareAnyDataset(db, name, NOW);
  return db;
}

describe('the stats-old dataset', () => {
  it('is a dataset of its own', () => {
    expect(DATASET_NAMES).toContain('stats-old');
  });

  it('is the stats dataset and runs that ended more than thirty days ago, seven of them, one of them lost, and one sale without a purchase', async () => {
    const plain = historyCounts((await loadHistory(await dataset('stats'))).runs, NOW);
    const { runs } = await loadHistory(await dataset('stats-old'));
    const counts = historyCounts(runs, NOW);

    expect(plain.old).toBe(0);                                                   // `stats` has nothing older than nine days
    expect(counts.old).toBe(7);
    expect(counts.finished).toBe(plain.finished + 8);                            // the seven and the one that began long ago and ended 29 days ago

    const old = runs.filter(({ run }) => run.status !== 'active' && run.endedAt !== null && run.endedAt < oldRunsBefore(NOW));
    expect(old.filter(({ run }) => run.status === 'lost')).toHaveLength(1);
    expect(old.filter(({ events }) => events.length === 1 && events[0].type === 'sell')).toHaveLength(1);   // the income
  });

  it('holds a run that began 31 days ago and ended 29 days ago: "older than thirty days" keeps it, the end counts', async () => {
    const { runs } = await loadHistory(await dataset('stats-old'));
    const straddling = runs.filter(({ run }) => run.startedAt === NOW - 31 * DAY);
    expect(straddling).toHaveLength(1);
    expect(straddling[0].run).toMatchObject({ status: 'done', endedAt: NOW - 29 * DAY });
  });

  it('starts 75 days ago and still has one run that is going', async () => {
    const { runs } = await loadHistory(await dataset('stats-old'));
    expect(historyCounts(runs, NOW).since).toBe(NOW - 75 * DAY - 4 * 3600);
    expect(runs.filter(({ run }) => run.status === 'active')).toHaveLength(1);
  });

  it('is cleared by the real service to exactly what the stats dataset holds, plus the run that began long ago', async () => {
    const db = await dataset('stats-old');
    const log = createLogger(memorySink());
    const cleared = await clearHistory({ db, log }, oldRunsBefore(NOW));
    expect(cleared.runs).toBe(7);
    const { runs } = await loadHistory(db);
    const plain = (await loadHistory(await dataset('stats'))).runs;
    expect(runs).toHaveLength(plain.length + 1);
    expect(runs.filter(({ run }) => run.startedAt === NOW - 31 * DAY)).toHaveLength(1);
    expect(await loadSettings(db, log)).toEqual(await loadSettings(await dataset('stats'), log));
  });
});
