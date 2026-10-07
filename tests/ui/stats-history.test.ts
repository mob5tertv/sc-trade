import { describe, expect, it } from 'vitest';
import { sessions } from '../../src/core/stats';
import { createLogger, memorySink } from '../../src/data/logger';
import { loadHistory, loadHistorySafely } from '../../src/ui/stats-history';
import { EMPTY_HISTORY } from '../../src/ui/vm/stats-view';
import { migratedDb } from '../helpers/test-db';
import { dbWithRuns, failingOn } from '../helpers/stats-wiring-fixtures';

const T0 = 1_000_000;
const HOUR = 3600;

describe('loadHistory', () => {
  it('reads the runs, the newest first, each with its events', async () => {
    const db = await dbWithRuns([{ startedAt: T0, lastsSec: 600 }, { startedAt: T0 + 10 * HOUR, lastsSec: 900 }, { startedAt: T0 + 20 * HOUR, lastsSec: null }]);
    const { runs } = await loadHistory(db);
    expect(runs.map((r) => r.run.startedAt)).toEqual([T0 + 20 * HOUR, T0 + 10 * HOUR, T0]);
    expect(runs.map((r) => r.run.status)).toEqual(['active', 'done', 'done']);
    expect(runs[1].events.map((e) => e.type)).toEqual(['buy', 'sell']);
  });

  it('reads the time of every record, run events included, ascending', async () => {
    const db = await dbWithRuns([{ startedAt: T0 + HOUR, lastsSec: 600 }, { startedAt: T0, lastsSec: 300 }]);
    const { recordTs } = await loadHistory(db);
    expect(recordTs).toEqual([T0, T0 + 300, T0 + HOUR, T0 + HOUR + 600]);
  });

  it('is empty on a new database', async () => {
    expect(await loadHistory(await migratedDb())).toEqual(EMPTY_HISTORY);
  });

  it('gives sessions the runs, even when the diary has no price at all (the events cut the sessions)', async () => {
    // two runs far apart and nothing else in the database: with the timestamps of the run events there are two
    // sessions of one run each; with the timestamps of the diary alone (none here) no session would hold a run
    const db = await dbWithRuns([{ startedAt: T0, lastsSec: 1200 }, { startedAt: T0 + 10 * HOUR, lastsSec: 1800, status: 'lost' }]);
    const { runs, recordTs } = await loadHistory(db);

    const list = sessions(recordTs, runs);
    expect(list.map((s) => s.runIds.length)).toEqual([1, 1]);
    expect(list[0]).toMatchObject({ startTs: T0 + 10 * HOUR, endTs: T0 + 10 * HOUR + 1800 });
    expect(list[1]).toMatchObject({ startTs: T0, endTs: T0 + 1200, profit: 100 * (5600 - 5000) });

    expect(sessions([], runs)).toEqual([]);
  });
});

describe('loadHistorySafely', () => {
  const quiet = () => {
    const sink = memorySink();
    return { sink, log: createLogger(sink) };
  };

  it('gives what loadHistory gives', async () => {
    const { log } = quiet();
    const db = await dbWithRuns([{ startedAt: T0, lastsSec: 600 }]);
    expect(await loadHistorySafely(db, log)).toEqual(await loadHistory(db));
  });

  it('answers null and logs the failure under ui when the runs cannot be read', async () => {
    const { sink, log } = quiet();
    const db = failingOn(await dbWithRuns([{ startedAt: T0, lastsSec: 600 }]), 'SELECT id, vehicle_id');
    await expect(loadHistorySafely(db, log)).resolves.toBeNull();
    const line = sink.lines.find((l) => l.level === 'error');
    expect(line?.line).toMatch(/^\[ui\] cannot load the statistics/);
    expect(line?.line).toContain('disk image is malformed');
  });

  it('answers null when the timestamps cannot be read', async () => {
    const { sink, log } = quiet();
    const db = failingOn(await dbWithRuns([{ startedAt: T0, lastsSec: 600 }]), 'SELECT ts FROM');
    await expect(loadHistorySafely(db, log)).resolves.toBeNull();
    expect(sink.lines.filter((l) => l.level === 'error')).toHaveLength(1);
  });
});
