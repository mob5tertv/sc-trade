import type { Db } from '../../src/data/db';
import type {
  Commodity, Observation, Reference, Run, RunEvent, StarSystem, Terminal, UexPrice, UexSideStats, Vehicle,
} from '../../src/core/types';

// ---------------------------------------------------------------------------
// Factories. Defaults are neutral: zeros, empty strings, nulls; live where the flag exists.
// ---------------------------------------------------------------------------

const zeroStats = (): UexSideStats => ({
  last: 0, minWeek: 0, maxWeek: 0, avgWeek: 0, minMonth: 0, maxMonth: 0, avgMonth: 0, min: 0, max: 0, avg: 0,
});

export interface PxPartial {
  buy?: Partial<UexSideStats>;
  sell?: Partial<UexSideStats>;
  scuBuy?: number;
  scuSell?: number;
  dateModified?: number;
}

/** A UEX price row with every number zero; `buy` / `sell` are merged over zeroed stats. */
export function px(terminalId: number, commodityId: number, partial: PxPartial = {}): UexPrice {
  return {
    terminalId,
    commodityId,
    buy: { ...zeroStats(), ...partial.buy },
    sell: { ...zeroStats(), ...partial.sell },
    scuBuy: partial.scuBuy ?? 0,
    scuSell: partial.scuSell ?? 0,
    dateModified: partial.dateModified ?? 0,
  };
}

/** One own price observation: sell price at terminal 1 for commodity 10, no quantity, unless overridden. */
export function obs(partial: Partial<Observation> = {}): Observation {
  return { id: 1, ts: 0, terminalId: 1, commodityId: 10, side: 'sell', price: 0, scu: null, ...partial };
}

export function term(id: number, partial: Partial<Terminal> = {}): Terminal {
  return {
    id, starSystemId: 0, planetId: 0, orbitId: 0,
    name: '', nickname: '', displayname: '', code: '',
    starSystemName: null, planetName: null, orbitName: null,
    moonName: null, spaceStationName: null, outpostName: null, cityName: null,
    hasFreightElevator: false, hasLoadingDock: false, isAutoLoad: false, isAvailableLive: true,
    ...partial,
  };
}

export function veh(id: number, partial: Partial<Vehicle> = {}): Vehicle {
  return { id, name: '', nameFull: '', scu: 0, ...partial };
}

export function run(partial: Partial<Run> = {}): Run {
  return { id: 1, vehicleId: null, scuCapacity: 0, startedAt: 0, endedAt: null, status: 'active', ...partial };
}

export function ev(partial: Partial<RunEvent> = {}): RunEvent {
  return { id: 1, runId: 1, ts: 0, type: 'buy', terminalId: null, commodityId: null, scu: null, price: null, ...partial };
}

// ---------------------------------------------------------------------------
// The shared reference every test uses: shared-types-and-fixtures.md, "Test Fixtures".
// ---------------------------------------------------------------------------

const starSystems: StarSystem[] = [
  { id: 68, name: 'Stanton', code: '', isAvailableLive: true },
  { id: 99, name: 'Pyro', code: '', isAvailableLive: true },
];

const terminals: Terminal[] = [
  term(1, { nickname: 'ARC-L1', displayname: 'ARC-L1 Wide Forest Station', starSystemId: 68, planetId: 10 }),
  term(2, { nickname: 'TDD Area 18', displayname: 'TDD Area 18', starSystemId: 68, planetId: 20 }),
  term(3, { nickname: 'CRU-L1', starSystemId: 68, planetId: 20 }),
  term(4, { nickname: 'Ruin Station', starSystemId: 99, planetId: 30 }),
  term(5, { nickname: 'Baijini Point', starSystemId: 68, planetId: 10 }),
  term(6, { nickname: 'HUR-L2', starSystemId: 68, planetId: 40 }),
];

const commodity = (id: number, code: string, name: string): Commodity => (
  { id, name, code, isIllegal: false, isBuyable: true, isSellable: true, isAvailableLive: true }
);

export const ref: Reference = {
  starSystems,
  terminals: new Map(terminals.map(t => [t.id, t])),
  commodities: new Map([
    commodity(10, 'GOLD', 'Gold'),
    commodity(20, 'TITA', 'Titanium'),
    commodity(30, 'TUNG', 'Tungsten'),
  ].map(c => [c.id, c])),
  vehicles: [veh(7, { name: 'C2 Hercules', scu: 696 })],
};

// ---------------------------------------------------------------------------
// Database seeding.
// ---------------------------------------------------------------------------

const INSERT_TERMINAL = `INSERT INTO uex_terminal (
  id, star_system_id, planet_id, orbit_id, name, nickname, displayname, code,
  star_system_name, planet_name, orbit_name, moon_name, space_station_name, outpost_name, city_name,
  has_freight_elevator, has_loading_dock, is_auto_load, is_available_live
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/** Inserts `n` live terminals with ids 1..n into `uex_terminal` (the schema must already be migrated). */
export async function seedTerminals(db: Db, n: number): Promise<void> {
  for (let id = 1; id <= n; id++) {
    const t = term(id, { name: `Terminal ${id}`, nickname: `Terminal ${id}`, displayname: `Terminal ${id}`, code: `T${id}` });
    await db.execute(INSERT_TERMINAL, [
      t.id, t.starSystemId, t.planetId, t.orbitId, t.name, t.nickname, t.displayname, t.code,
      t.starSystemName, t.planetName, t.orbitName, t.moonName, t.spaceStationName, t.outpostName, t.cityName,
      Number(t.hasFreightElevator), Number(t.hasLoadingDock), Number(t.isAutoLoad), Number(t.isAvailableLive),
    ]);
  }
}
