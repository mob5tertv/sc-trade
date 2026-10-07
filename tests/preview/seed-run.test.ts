import { describe, expect, it } from 'vitest';
import { cargoOf } from '../../src/core/run';
import { createLogger } from '../../src/data/logger';
import { getActiveRun } from '../../src/data/repo/runs';
import { loadSettings } from '../../src/data/repo/settings';
import { isDatasetName } from '../../src/preview/datasets';
import { prepareAnyDataset } from '../../src/preview/prepare';
import { phaseLine, runPhases } from '../../src/ui/vm/run-phase';
import { testDb } from '../helpers/test-db';

const NOW = 1_800_000_000;
const quiet = createLogger({ write() {} });

async function run(name: 'run-loading' | 'run-flight' | 'run-unloading') {
  const db = testDb();
  await prepareAnyDataset(db, name, NOW);
  const active = await getActiveRun(db);
  if (active === null) throw new Error('the dataset has no active run');
  return { db, active, phases: runPhases(active.run, active.events, NOW) };
}

describe('the datasets of a run in each phase', () => {
  it('are datasets of their own', () => {
    for (const name of ['run-loading', 'run-flight', 'run-unloading']) expect(isDatasetName(name)).toBe(true);
  });

  it('hold the same cargo and a target, whatever the phase', async () => {
    for (const name of ['run-loading', 'run-flight', 'run-unloading'] as const) {
      const { db, active } = await run(name);
      expect(cargoOf(active.events).map((l) => [l.commodityId, l.scu])).toEqual([[1, 120], [8, 80]]);
      expect((await loadSettings(db, quiet)).targetTerminalId).toBe(1);
    }
  });

  it('are loading 3:12 into the first purchase, flying 8:40 into the take-off, and unloading 2:05 after the arrival', async () => {
    expect((await run('run-loading')).phases).toMatchObject({ phase: 'loading', sinceSec: 192 });
    expect((await run('run-flight')).phases).toMatchObject({ phase: 'flight', sinceSec: 520, slots: { loading: 192, flight: 520, unloading: null } });
    expect((await run('run-unloading')).phases).toMatchObject({ phase: 'unloading', sinceSec: 125, slots: { loading: 192, flight: 520, unloading: 125 } });
  });

  it('read as the three timers of the section', async () => {
    const { phases } = await run('run-unloading');
    expect(phaseLine(phases).items.map((i) => i.text)).toEqual(['3:12', '8:40', '2:05']);
    expect(phaseLine(phases).total).toBe('13:57');
  });
});
