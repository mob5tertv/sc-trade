import { estimate } from './estimate';
import type { EstimateCtx } from './estimate';
import type { Estimate, Market, Side, Terminal } from './types';

// The commodity reference (spec 14.19, item 9): for one commodity, the best places to buy it or to sell it, by the prices
// that are already loaded (the player's own first, as everywhere, then UEX). Nothing is asked of UEX here.

export interface PlaceFilters {
  /** Only the terminals of this star system; `null`: everywhere. */
  starSystemId: number | null;
  /** Where to BUY: only the places whose stock is known and is not empty. It says nothing of a place to sell at (what a buyer holds limits no sale, spec 14.5). */
  onlyStock: boolean;
}

export interface Place {
  terminalId: number;
  /** The price there on the asked side, with whose it is, how old, and the quantity beside it. */
  estimate: Estimate;
}

/** How many places the reference lists. */
export const PLACES_MAX = 10;

/**
 * The best `limit` terminals for `commodityId` on one side: to BUY, the cheapest first; to SELL, the dearest first. A terminal
 * that left the reference is skipped, and so is a price of zero ("unknown", as everywhere). Equal prices keep the order of the
 * terminal ids, so that the list does not jump.
 */
export function bestPlaces(
  m: Market, commodityId: number, side: Side, ctx: EstimateCtx, terminals: Map<number, Terminal>, filters: PlaceFilters, limit = PLACES_MAX,
): Place[] {
  const places: Place[] = [];
  for (const terminalId of m.byCommodity.get(commodityId) ?? []) {
    const terminal = terminals.get(terminalId);
    if (terminal === undefined) continue;
    if (filters.starSystemId !== null && terminal.starSystemId !== filters.starSystemId) continue;
    const e = estimate(m, terminalId, commodityId, side, ctx);
    if (e === null || !(e.price > 0)) continue;
    if (side === 'buy' && filters.onlyStock && !(e.scu !== null && e.scu > 0)) continue;
    places.push({ terminalId, estimate: e });
  }
  const sign = side === 'buy' ? 1 : -1;
  return places.sort((a, b) => sign * (a.estimate.price - b.estimate.price) || a.terminalId - b.terminalId).slice(0, limit);
}
