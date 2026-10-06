import type { Market, Observation, QuantityReading, Side } from '../../src/core/types';

// Helpers that build a changed copy of a market with `buildMarket` have to hand the quantity readings over, or the
// copy forgets every reading that is older than the latest observation of its stock (spec 14.6).

/** The quantity readings of `m` as `buildMarket` takes them; `except` is the `obsKey` of a stock whose reading is left out. */
export function quantitiesOf(m: Market, except?: string): QuantityReading[] {
  return [...m.ownScu]
    .filter(([key]) => key !== except)
    .map(([key, { ts, scu }]) => {
      const [terminalId, commodityId, side] = key.split(':');
      return { terminalId: Number(terminalId), commodityId: Number(commodityId), side: side as Side, ts, scu };
    });
}

/** The readings the observations make: one for each that has a quantity (a known zero included). */
export function readingsOf(...observations: Observation[]): QuantityReading[] {
  return observations.flatMap(({ terminalId, commodityId, side, ts, scu }) => (scu === null ? [] : [{ terminalId, commodityId, side, ts, scu }]));
}
