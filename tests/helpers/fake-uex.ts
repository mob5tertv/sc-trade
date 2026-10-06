import type { Commodity, StarSystem, Terminal, UexPrice, Vehicle } from '../../src/core/types';
import { distKey } from '../../src/core/types';
import { UexError, type UexClient } from '../../src/data/uex-client';
import { px, term, veh } from './factories';

const system = (id: number, name: string, isAvailableLive: boolean): StarSystem => ({ id, name, code: '', isAvailableLive });

const commodity = (id: number, name: string): Commodity => (
  { id, name, code: name.toUpperCase(), isIllegal: false, isBuyable: true, isSellable: true, isAvailableLive: true }
);

/**
 * A scripted `UexClient` for sync tests: it answers from plain data fields, records every request
 * (also the ones that fail) and fails on demand. The defaults mirror the live game: three live
 * star systems (Nyx 55, Pyro 64, Stanton 68) and one that is not live, two vehicle manufacturers.
 */
export class FakeUex implements UexClient {
  // --- scripted answers -----------------------------------------------------------------------
  starSystemList: StarSystem[] = [
    system(55, 'Nyx', true), system(64, 'Pyro', true), system(68, 'Stanton', true), system(70, 'Terra', false),
  ];
  terminalsBySystem = new Map<number, Terminal[]>([
    [55, [term(5501, { starSystemId: 55 })]],
    [64, [term(6401, { starSystemId: 64 }), term(6402, { starSystemId: 64 })]],
    [68, [term(6801, { starSystemId: 68 }), term(6802, { starSystemId: 68 }), term(6803, { starSystemId: 68 })]],
    [70, [term(7001, { starSystemId: 70 })]],
  ]);
  commodityList: Commodity[] = [commodity(10, 'Gold'), commodity(20, 'Titanium')];
  manufacturerIds: number[] = [195, 196];
  vehiclesByCompany = new Map<number, Vehicle[]>([
    [195, [veh(1, { name: 'Aurora' }), veh(2, { name: 'Mustang' })]],
    [196, [veh(3, { name: 'Hercules' })]],
  ]);
  /** The price rows a terminal answers with. */
  priceRows: (terminalId: number) => UexPrice[] = (id) => [px(id, 10)];
  routes: Array<{ destId: number; gm: number }> = [];
  /** The answer to `distance(a, b)`, by `distKey`; a pair that is not listed answers `distanceDefault`. */
  distances = new Map<string, number | null>();
  distanceDefault: number | null = 7;

  // --- failure switches -----------------------------------------------------------------------
  failStarSystems = false;
  failCommodities = false;
  failManufacturers = false;
  failTerminalsOf = new Set<number>();
  failVehiclesOf = new Set<number>();
  /** Decides per request whether `prices(ids)` fails. */
  failPrices: (terminalIds: number[]) => boolean = () => false;
  failRoutes = false;
  /** Decides per pair whether `distance(a, b)` fails. */
  failDistances: (a: number, b: number) => boolean = () => false;

  // --- request log ----------------------------------------------------------------------------
  starSystemCalls = 0;
  terminalCalls: number[] = [];
  commodityCalls = 0;
  manufacturerCalls = 0;
  vehicleCalls: number[] = [];
  priceCalls: number[][] = [];
  routeCalls: number[] = [];
  distanceCalls: Array<[number, number]> = [];
  /** The highest number of requests that were in flight at the same moment (1 means strictly sequential). */
  maxInFlight = 0;
  private inFlight = 0;

  private async request<T>(fails: boolean, answer: () => T): Promise<T> {
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      await Promise.resolve(); // a real request takes time: overlapping requests would show in `maxInFlight`
      if (fails) throw new UexError('network', 'request failed: stalled');
      return answer();
    } finally {
      this.inFlight--;
    }
  }

  starSystems(): Promise<StarSystem[]> {
    this.starSystemCalls++;
    return this.request(this.failStarSystems, () => this.starSystemList);
  }

  terminals(starSystemId: number): Promise<Terminal[]> {
    this.terminalCalls.push(starSystemId);
    return this.request(this.failTerminalsOf.has(starSystemId), () => this.terminalsBySystem.get(starSystemId) ?? []);
  }

  commodities(): Promise<Commodity[]> {
    this.commodityCalls++;
    return this.request(this.failCommodities, () => this.commodityList);
  }

  vehicleManufacturers(): Promise<number[]> {
    this.manufacturerCalls++;
    return this.request(this.failManufacturers, () => this.manufacturerIds);
  }

  vehicles(companyId: number): Promise<Vehicle[]> {
    this.vehicleCalls.push(companyId);
    return this.request(this.failVehiclesOf.has(companyId), () => this.vehiclesByCompany.get(companyId) ?? []);
  }

  prices(terminalIds: number[]): Promise<UexPrice[]> {
    this.priceCalls.push([...terminalIds]);
    return this.request(this.failPrices(terminalIds), () => terminalIds.flatMap((id) => this.priceRows(id)));
  }

  distancesFrom(terminalId: number): Promise<Array<{ destId: number; gm: number }>> {
    this.routeCalls.push(terminalId);
    return this.request(this.failRoutes, () => this.routes);
  }

  distance(a: number, b: number): Promise<number | null> {
    this.distanceCalls.push([a, b]);
    const key = distKey(a, b);
    return this.request(this.failDistances(a, b), () => (this.distances.has(key) ? (this.distances.get(key) ?? null) : this.distanceDefault));
  }
}
