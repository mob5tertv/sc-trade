import { DEFAULT_SETTINGS } from '../../src/core/settings';
import type { Db } from '../../src/data/db';
import type { Logger } from '../../src/data/logger';
import { addObservation } from '../../src/data/repo/diary';
import { upsertPrices } from '../../src/data/repo/uex-cache';
import type { SuggestDeps } from '../../src/data/suggest';
import type { UexClient } from '../../src/data/uex-client';
import { px, ref } from './factories';
import { market, NOW } from './route-fixtures';

// The route scenario of task 8 (tests/helpers/route-fixtures.ts), but stored in the database:
// the UEX rows of the fixture market go to `uex_price`, its own observations to `observation`.
// Terminals come from the shared reference; the distance cache starts empty.

/** Writes the UEX prices and the diary of the route scenario; the diary rows keep their fixture order. */
export async function seedRouteScenario(db: Db, log: Logger): Promise<void> {
  // No terminal ids: nothing is deleted, so rows added later by `addUexBuy` / `addUexSell` stay.
  await upsertPrices(db, [], [...market.uex.values()], NOW);
  const diary = [...market.own.values()].sort((a, b) => a.id - b.id);
  for (const { id: _id, ...o } of diary) await addObservation(db, log, o);
}

/** The terminal sells the commodity to the player: a UEX BUY-side row with a weekly average of `price`. */
export async function addUexBuy(db: Db, terminalId: number, commodityId: number, price: number): Promise<void> {
  const side = { last: price, avgWeek: price, minWeek: price, maxWeek: price };
  await upsertPrices(db, [], [px(terminalId, commodityId, { buy: side, dateModified: NOW - 3600 })], NOW);
}

/** The terminal buys the commodity from the player: a UEX SELL-side row with a weekly average of `price`. */
export async function addUexSell(db: Db, terminalId: number, commodityId: number, price: number): Promise<void> {
  const side = { last: price, avgWeek: price, minWeek: price, maxWeek: price };
  await upsertPrices(db, [], [px(terminalId, commodityId, { sell: side, dateModified: NOW - 3600 })], NOW);
}

/** Dependencies of the scenario: the shared reference, default settings limited to Stanton, standing at terminal 1. */
export function suggestDeps(db: Db, uex: UexClient, log: Logger): SuggestDeps {
  return {
    db, uex, log,
    now: () => NOW,
    reference: ref,
    settings: { ...DEFAULT_SETTINGS, starSystemId: 68, currentTerminalId: 1 },
    ownMedian: new Map(),
  };
}
