import { describe, expect, it } from 'vitest';
import { temperature } from '../../src/core/temperature';
import { distKey } from '../../src/core/types';
import { DATASET_NAMES, isDatasetName } from '../../src/preview/datasets';
import { prepareDataset } from '../../src/preview/seed';
import { createLogger, memorySink } from '../../src/data/logger';
import { listRuns, getActiveRun } from '../../src/data/repo/runs';
import { loadSettings } from '../../src/data/repo/settings';
import { getMeta, loadDistances, loadReference, loadUexPrices } from '../../src/data/repo/uex-cache';
import { latestObservations } from '../../src/data/repo/diary';
import { syncPlan } from '../../src/ui/vm/sync-plan';
import { priceMoves } from '../helpers/price-trend-fixtures';
import { testDb } from '../helpers/test-db';

const NOW = 1_800_000_000;
const log = () => createLogger(memorySink());

async function dataset(name: Parameters<typeof prepareDataset>[1]) {
  const db = testDb();
  await prepareDataset(db, name, NOW);
  return db;
}

describe('datasets', () => {
  it('are default, run, empty, window (seed-window.ts), stats, no-runs, no-records (seed-stats.ts) and the three run phases (seed-run.ts)', () => {
    expect([...DATASET_NAMES]).toEqual([
      'default', 'run', 'empty', 'window', 'stats', 'no-runs', 'no-records', 'run-loading', 'run-flight', 'run-unloading',
    ]);
    expect(isDatasetName('run')).toBe(true);
    expect(isDatasetName('other')).toBe(false);
  });
});

describe('the empty dataset', () => {
  it('is a database nobody has touched: no tables, no schema version (the app runs its own migrations)', async () => {
    const db = await dataset('empty');
    expect(await db.select('SELECT name FROM sqlite_master')).toEqual([]);
    expect(await db.select('PRAGMA user_version')).toEqual([{ user_version: 0 }]);
  });
});

describe('the default dataset', () => {
  it('has the schema the real migrations make', async () => {
    const db = await dataset('default');
    expect(await db.select('PRAGMA user_version')).toEqual([{ user_version: 2 }]);
  });

  it('has three star systems, real terminals, commodities and ships', async () => {
    const ref = await loadReference(await dataset('default'));
    expect(ref.starSystems.map((s) => s.name)).toEqual(['Stanton', 'Pyro', 'Nyx']);
    expect(ref.starSystems.every((s) => s.isAvailableLive)).toBe(true);

    const terminals = [...ref.terminals.values()];
    expect(terminals.length).toBeGreaterThanOrEqual(12);
    expect(terminals.length).toBeLessThanOrEqual(18);
    const nicknames = terminals.map((t) => t.nickname);
    for (const name of [
      'HUR-L1', 'ARC-L1', 'CRU-L1', 'MIC-L1', 'TDD Area 18', 'TDD Lorville', 'TDD New Babbage', 'TDD Orison',
      'Everus Harbor', 'Baijini Point', 'Port Tressler', 'Seraphim Station', 'GrimHEX',
    ]) expect(nicknames).toContain(name);
    expect(terminals.filter((t) => t.starSystemId === ref.starSystems[1].id).length).toBeGreaterThanOrEqual(2);
    expect(terminals.every((t) => t.isAvailableLive && t.displayname !== '' && t.code !== '')).toBe(true);

    const commodities = [...ref.commodities.values()];
    expect(commodities.length).toBeGreaterThanOrEqual(14);
    expect(commodities.length).toBeLessThanOrEqual(16);
    const byName = new Map(commodities.map((c) => [c.name, c.code]));
    for (const name of ['Medical Supplies', 'Gold', 'Tungsten', 'Laranite', 'Agricium', 'Titanium', 'Diamond',
      'Stims', 'Quartz', 'Hydrogen', 'Processed Food', 'Scrap', 'Waste', 'Beryl']) expect(byName.get(name)).toBeTruthy();

    expect(ref.vehicles.length).toBeGreaterThanOrEqual(6);
    expect(ref.vehicles.length).toBeLessThanOrEqual(8);
    const scuOf = (name: string) => ref.vehicles.find((v) => v.name === name)?.scu;
    expect(scuOf('C2 Hercules')).toBe(696);
    expect(scuOf('Cutlass Black')).toBe(46);
    expect(scuOf('Freelancer MAX')).toBe(120);
    expect(scuOf('Caterpillar')).toBe(576);
  });

  it('has UEX prices for 6 to 10 commodities at every terminal, with quantities and a few unknown dates', async () => {
    const db = await dataset('default');
    const ref = await loadReference(db);
    const prices = await loadUexPrices(db);
    for (const id of ref.terminals.keys()) {
      const count = prices.filter((p) => p.terminalId === id).length;
      expect(count, `terminal ${id}`).toBeGreaterThanOrEqual(6);
      expect(count, `terminal ${id}`).toBeLessThanOrEqual(10);
    }
    expect(prices.every((p) => p.buy.last > 0 || p.sell.last > 0)).toBe(true);
    expect(prices.every((p) => !(p.buy.last > 0 && p.sell.last > 0))).toBe(true); // a terminal either sells or buys a commodity
    expect(prices.some((p) => p.buy.last > 0 && p.scuBuy > 0 && p.scuBuyMax >= p.scuBuy)).toBe(true);
    expect(prices.some((p) => p.sell.last > 0 && p.scuSell > 0)).toBe(true);
    expect(prices.filter((p) => p.dateModified === 0).length).toBeGreaterThanOrEqual(2);
    expect(prices.some((p) => p.dateModified > 0)).toBe(true);
    for (const p of prices) {
      const side = p.buy.last > 0 ? p.buy : p.sell;
      expect(side.minWeek).toBeLessThanOrEqual(side.last);
      expect(side.maxWeek).toBeGreaterThanOrEqual(side.last);
      expect(side.minMonth).toBeLessThanOrEqual(side.minWeek);
      expect(side.maxMonth).toBeGreaterThanOrEqual(side.maxWeek);
    }
  });

  it('knows the distance of every pair of terminals inside a system', async () => {
    const db = await dataset('default');
    const ref = await loadReference(db);
    const distances = await loadDistances(db);
    for (const system of ref.starSystems) {
      const ids = [...ref.terminals.values()].filter((t) => t.starSystemId === system.id).map((t) => t.id);
      for (const a of ids) {
        for (const b of ids) {
          if (a >= b) continue;
          const gm = distances.get(distKey(a, b));
          expect(typeof gm, `${a}-${b}`).toBe('number');
          expect(gm as number).toBeGreaterThan(0);
        }
      }
    }
  });

  it('has own observations of every age, with quantities, without, and with zero', async () => {
    const db = await dataset('default');
    const own = await latestObservations(db);
    const thresholds = { hotMin: 60, warmMin: 180, coolingMin: 240 };
    const temps = new Set(own.map((o) => temperature(o.ts, NOW, thresholds, null)));
    expect([...temps].sort()).toEqual(['cold', 'cooling', 'hot', 'warm']);
    expect(own.some((o) => o.scu === null)).toBe(true);
    expect(own.some((o) => o.scu === 0)).toBe(true);
    expect(own.some((o) => o.scu !== null && o.scu > 0)).toBe(true);
    expect(own.every((o) => o.ts <= NOW)).toBe(true);
    expect(own.some((o) => o.side === 'buy') && own.some((o) => o.side === 'sell')).toBe(true);
  });

  describe('own prices seen again after a while (the triangle next to a price)', () => {
    // each seeded pair: the stock, the price of the earlier reading, the price of the latest one. The sale prices of
    // Stims are the ones of the trips from HUR-L1, the purchase prices of Diamond and Gold those of the trips to it.
    const PAIRS = [
      { terminal: 4, code: 'STIM', side: 'sell', was: 3475, now: 3730 }, // MIC-L1, sold dearer: rose
      { terminal: 11, code: 'STIM', side: 'sell', was: 3675, now: 3395 }, // Port Tressler, fell
      { terminal: 6, code: 'STIM', side: 'sell', was: 3365, now: 3365 }, // TDD Lorville, stayed
      { terminal: 9, code: 'DIAM', side: 'buy', was: 6410, now: 5825 }, // Everus Harbor, bought cheaper: fell
      { terminal: 1, code: 'GOLD', side: 'buy', was: 5475, now: 5885 }, // ARC-L1, bought dearer: rose
      { terminal: 11, code: 'GOLD', side: 'buy', was: 5310, now: 5310 }, // Port Tressler, stayed
    ] as const;

    it.each(PAIRS)('has $code at terminal $terminal ($side): $was, then $now', async (pair) => {
      const moves = await priceMoves(await dataset('default'));
      const found = moves.find((m) => m.terminal === pair.terminal && m.code === pair.code && m.side === pair.side);
      expect(found).toMatchObject({ was: pair.was, now: pair.now });
      expect(found!.gapSec, 'a correction is not a move').toBeGreaterThanOrEqual(120);
    });
  });

  it('measures every age from the moment the database was made, a few seconds past the minute', async () => {
    const own = await latestObservations(await dataset('default'));
    for (const o of own) {
      const ageSec = NOW - o.ts;
      if (ageSec > 0 && ageSec < 3 * 86_400) expect(ageSec % 60, `observation ${o.id}`).toBeGreaterThanOrEqual(1);
    }
    const later = testDb();
    await prepareDataset(later, 'default', NOW + 3600);
    const shifted = await latestObservations(later);
    expect(shifted.map((o) => o.ts - 3600)).toEqual(own.map((o) => o.ts));
  });

  it('is marked as just synced, so no background sync starts', async () => {
    const db = await dataset('default');
    const plan = syncPlan(await getMeta(db, 'reference_synced_at'), await getMeta(db, 'prices_synced_at'), NOW);
    expect(plan).toEqual({ reference: false, prices: false });
  });

  it('has the settings of the player: C2 Hercules, Stanton, at HUR-L1', async () => {
    const db = await dataset('default');
    const ref = await loadReference(db);
    const settings = await loadSettings(db, log());
    expect(ref.vehicles.find((v) => v.id === settings.vehicleId)?.name).toBe('C2 Hercules');
    expect(settings.scuCapacity).toBe(696);
    expect(ref.starSystems.find((s) => s.id === settings.starSystemId)?.name).toBe('Stanton');
    expect(ref.terminals.get(settings.currentTerminalId ?? -1)?.nickname).toBe('HUR-L1');
  });

  it('has two finished runs and no active one', async () => {
    const db = await dataset('default');
    expect(await getActiveRun(db)).toBeNull();
    const runs = await listRuns(db);
    expect(runs).toHaveLength(2);
    expect(runs.every((r) => r.run.status === 'done' && r.run.endedAt !== null)).toBe(true);
    for (const { events } of runs) {
      const bought = events.filter((e) => e.type === 'buy').reduce((sum, e) => sum + (e.scu ?? 0), 0);
      const sold = events.filter((e) => e.type === 'sell').reduce((sum, e) => sum + (e.scu ?? 0), 0);
      expect(bought).toBeGreaterThan(0);
      expect(sold).toBe(bought);
    }
  });
});

describe('the run dataset', () => {
  it('is the default one plus an active run: two commodities bought 25 minutes ago, a target set', async () => {
    const db = await dataset('run');
    const active = await getActiveRun(db);
    expect(active).not.toBeNull();
    const buys = active!.events.filter((e) => e.type === 'buy');
    expect(buys).toHaveLength(2);
    expect(new Set(buys.map((e) => e.commodityId)).size).toBe(2);
    const startedAgo = NOW - active!.run.startedAt;
    expect(startedAgo).toBeGreaterThanOrEqual(25 * 60);
    expect(startedAgo).toBeLessThan(26 * 60);
    expect(active!.events.every((e) => NOW - e.ts < 26 * 60 && NOW - e.ts >= 24 * 60)).toBe(true);

    const settings = await loadSettings(db, log());
    expect(settings.targetTerminalId).not.toBeNull();
    expect((await listRuns(db)).filter((r) => r.run.status === 'done')).toHaveLength(2);
  });
});
