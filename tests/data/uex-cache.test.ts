import { beforeEach, describe, expect, it } from 'vitest';
import { distKey, priceKey, type Commodity, type StarSystem } from '../../src/core/types';
import type { Db } from '../../src/data/db';
import {
  getMeta, loadDistances, loadReference, loadUexPrices, putDistances, saveReference, setMeta, upsertPrices,
  upsertVehicles,
} from '../../src/data/repo/uex-cache';
import { px, term, veh } from '../helpers/factories';
import { migratedDb } from '../helpers/test-db';

let db: Db;

beforeEach(async () => {
  db = await migratedDb();
});

/** The same database, with every executed statement recorded. */
function spied(inner: Db): { db: Db; executed: Array<{ sql: string; params: unknown[] }> } {
  const executed: Array<{ sql: string; params: unknown[] }> = [];
  return {
    executed,
    db: {
      select: (sql, params) => inner.select(sql, params),
      execute(sql, params = []) {
        executed.push({ sql, params });
        return inner.execute(sql, params);
      },
    },
  };
}

const commodity = (id: number): Commodity => (
  { id, name: `C${id}`, code: `C${id}`, isIllegal: false, isBuyable: true, isSellable: true, isAvailableLive: true }
);

describe('uex cache: prices', () => {
  it('removes a commodity that vanished from a synced terminal but keeps other terminals', async () => {
    await upsertPrices(db, [1, 2], [px(1, 10), px(1, 11), px(2, 10)], 100);
    await upsertPrices(db, [1], [px(1, 10)], 200);
    expect((await loadUexPrices(db)).map((p) => priceKey(p.terminalId, p.commodityId)).sort()).toEqual(['1:10', '2:10']);
  });

  it('round-trips every price field', async () => {
    const p = px(1, 10, {
      sell: { last: 7000, minWeek: 6400, maxWeek: 7100, avgWeek: 6900, minMonth: 6000, maxMonth: 7200, avgMonth: 6800, min: 5000, max: 8000, avg: 6500 },
      buy: { last: 1, minWeek: 2, maxWeek: 3, avgWeek: 4, minMonth: 5, maxMonth: 6, avgMonth: 7, min: 8, max: 9, avg: 10 },
      scuBuy: 11, scuSell: 500, dateModified: 1_700_000_000,
    });
    await upsertPrices(db, [1], [p], 100);
    expect((await loadUexPrices(db))[0]).toEqual(p);
  });

  it('overwrites a row that is synced again', async () => {
    await upsertPrices(db, [1], [px(1, 10, { sell: { last: 1 } })], 100);
    await upsertPrices(db, [1], [px(1, 10, { sell: { last: 2 } })], 200);
    expect((await loadUexPrices(db)).map((p) => p.sell.last)).toEqual([2]);
  });

  it('keeps the rows of a terminal that is not in the synced list, however old', async () => {
    await upsertPrices(db, [1, 2], [px(1, 10), px(2, 10), px(2, 11)], 100);
    await upsertPrices(db, [1], [px(1, 10)], 900);
    expect((await loadUexPrices(db)).map((p) => priceKey(p.terminalId, p.commodityId))).toEqual(['1:10', '2:10', '2:11']);
  });

  it('writes at most one hundred rows per statement', async () => {
    const spy = spied(db);
    const rows = Array.from({ length: 250 }, (_, i) => px(1 + Math.floor(i / 50), 100 + i));
    await upsertPrices(spy.db, [1, 2, 3, 4, 5], rows, 100);
    expect(await loadUexPrices(db)).toHaveLength(250);
    const inserts = spy.executed.filter((s) => s.sql.startsWith('INSERT'));
    expect(inserts).toHaveLength(3);
    for (const s of inserts) {
      expect(s.sql).toContain('ON CONFLICT');
      expect(s.params.length).toBeLessThanOrEqual(100 * 26);
    }
  });

  it('does nothing for an empty batch', async () => {
    const spy = spied(db);
    await upsertPrices(spy.db, [], [], 100);
    expect(spy.executed).toEqual([]);
  });
});

describe('uex cache: reference', () => {
  it('saveReference drops rows missing from the new list', async () => {
    await saveReference(db, { vehicles: [veh(1), veh(2)] });
    await saveReference(db, { vehicles: [veh(2)] });
    expect((await loadReference(db)).vehicles.map((v) => v.id)).toEqual([2]);
  });

  it('round-trips star systems, terminals, commodities and vehicles', async () => {
    const starSystems: StarSystem[] = [
      { id: 68, name: 'Stanton', code: 'ST', isAvailableLive: true },
      { id: 1, name: '78 Leonis', code: 'LEO', isAvailableLive: false },
    ];
    const terminal = term(5, {
      starSystemId: 68, planetId: 4, orbitId: 326, name: 'Admin - ARC-L1', nickname: 'ARC-L1',
      displayname: 'ARC-L1 Wide Forest Station', code: 'ARCL1', starSystemName: 'Stanton', planetName: 'ArcCorp',
      spaceStationName: 'ARC-L1 Wide Forest Station', hasFreightElevator: true, isAutoLoad: true,
    });
    const gold = { ...commodity(10), isIllegal: true, isSellable: false };
    await saveReference(db, { starSystems, terminals: [terminal, term(6)], commodities: [gold], vehicles: [veh(7, { name: 'C2', nameFull: 'Caterpillar C2', scu: 696 })] });

    const loaded = await loadReference(db);
    expect(loaded.starSystems).toEqual([starSystems[1], starSystems[0]]); // by id
    expect(loaded.terminals.get(5)).toEqual(terminal);
    expect([...loaded.terminals.keys()]).toEqual([5, 6]);
    expect(loaded.commodities.get(10)).toEqual(gold);
    expect(loaded.vehicles).toEqual([veh(7, { name: 'C2', nameFull: 'Caterpillar C2', scu: 696 })]);
  });

  it('leaves the lists that are not part of the call untouched', async () => {
    await saveReference(db, { terminals: [term(1)], commodities: [commodity(10)], vehicles: [veh(1)] });
    await saveReference(db, { terminals: [term(2)] });
    const loaded = await loadReference(db);
    expect([...loaded.terminals.keys()]).toEqual([2]);
    expect([...loaded.commodities.keys()]).toEqual([10]);
    expect(loaded.vehicles.map((v) => v.id)).toEqual([1]);
  });

  it('updates a changed row in place', async () => {
    await saveReference(db, { commodities: [commodity(10)] });
    await saveReference(db, { commodities: [{ ...commodity(10), name: 'Renamed' }] });
    expect((await loadReference(db)).commodities.get(10)?.name).toBe('Renamed');
  });

  it('handles more rows than fit into one statement', async () => {
    const spy = spied(db);
    await saveReference(spy.db, { commodities: Array.from({ length: 250 }, (_, i) => commodity(i + 1)) });
    expect((await loadReference(db)).commodities.size).toBe(250);
    await saveReference(spy.db, { commodities: [commodity(1)] }); // 249 ids to delete
    expect((await loadReference(db)).commodities.size).toBe(1);
    for (const s of spy.executed) expect(s.params.length).toBeLessThanOrEqual(100 * 7);
  });

  it('upsertVehicles adds and updates without deleting the vehicles that are not in the list', async () => {
    await saveReference(db, { vehicles: [veh(1), veh(2)] });
    await upsertVehicles(db, [veh(2, { name: 'Renamed' }), veh(3)]);
    expect((await loadReference(db)).vehicles.map((v) => [v.id, v.name])).toEqual([[1, ''], [2, 'Renamed'], [3, '']]);
  });

  it('loads an empty reference from an empty database', async () => {
    expect(await loadReference(db)).toEqual({ starSystems: [], terminals: new Map(), commodities: new Map(), vehicles: [] });
  });
});

describe('uex cache: distances', () => {
  it('stores distances symmetrically, including unknown', async () => {
    await putDistances(db, [{ a: 85, b: 12, gm: 59 }, { a: 3, b: 4, gm: null }]);
    const d = await loadDistances(db);
    expect(d.get(distKey(12, 85))).toBe(59);
    expect(d.get(distKey(3, 4))).toBeNull();
    expect(d.has(distKey(1, 2))).toBe(false);
  });

  it('overwrites a stored distance', async () => {
    await putDistances(db, [{ a: 3, b: 4, gm: null }]);
    await putDistances(db, [{ a: 4, b: 3, gm: 12 }]);
    expect((await loadDistances(db)).get(distKey(3, 4))).toBe(12);
  });

  it('ignores a terminal paired with itself', async () => {
    await putDistances(db, [{ a: 5, b: 5, gm: 0 }, { a: 1, b: 2, gm: 3 }]);
    expect([...(await loadDistances(db)).keys()]).toEqual([distKey(1, 2)]);
  });

  it('writes at most one hundred rows per statement', async () => {
    const spy = spied(db);
    await putDistances(spy.db, Array.from({ length: 250 }, (_, i) => ({ a: 1, b: 2 + i, gm: i })));
    expect((await loadDistances(db)).size).toBe(250);
    expect(spy.executed).toHaveLength(3);
    for (const s of spy.executed) expect(s.params.length).toBeLessThanOrEqual(100 * 3);
  });
});

describe('uex cache: meta', () => {
  it('is null for an unknown key and returns what was set', async () => {
    expect(await getMeta(db, 'prices_synced_at')).toBeNull();
    await setMeta(db, 'prices_synced_at', '100');
    expect(await getMeta(db, 'prices_synced_at')).toBe('100');
  });

  it('overwrites a value', async () => {
    await setMeta(db, 'k', '1');
    await setMeta(db, 'k', '2');
    expect(await getMeta(db, 'k')).toBe('2');
  });
});
