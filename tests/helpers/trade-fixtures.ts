import { DEFAULT_SETTINGS } from '../../src/core/settings';
import type { Db } from '../../src/data/db';
import { createLogger, memorySink } from '../../src/data/logger';
import type { TradeDeps, TradeInput } from '../../src/data/trade';
import { migratedDb } from './test-db';

// Fixtures for the trade service tests: a migrated database, a logger in memory and a clock the test moves by hand.
// The ship is the C2 Hercules of the shared reference (id 7, 696 SCU); Gold is commodity 10.

export const NOW = 1_000_000;

export interface Clock {
  now(): number;
  /** Moves the clock forward by `sec` seconds. */
  advance(sec: number): void;
}

/** A clock that stands still at `start` until the test advances it. */
export function createClock(start = NOW): Clock {
  let t = start;
  return {
    now: () => t,
    advance(sec) { t += sec; },
  };
}

export interface TradeFixture {
  db: Db;
  sink: ReturnType<typeof memorySink>;
  clock: Clock;
  deps: TradeDeps;
}

/** A fresh database, log sink and clock, and trade dependencies with the Hercules (7, 696 SCU) in the settings. */
export async function tradeFixture(): Promise<TradeFixture> {
  const db = await migratedDb();
  const sink = memorySink();
  const clock = createClock();
  const deps: TradeDeps = {
    db,
    log: createLogger(sink),
    now: clock.now,
    settings: { ...DEFAULT_SETTINGS, scuCapacity: 696, vehicleId: 7 },
  };
  return { db, sink, clock, deps };
}

/** A purchase of Gold at terminal 1. */
export const buyIn = (scu: number, price = 6000): TradeInput => ({ terminalId: 1, commodityId: 10, scu, price });

/** A sale of Gold at terminal 2. */
export const sellIn = (scu: number, price: number): TradeInput => ({ terminalId: 2, commodityId: 10, scu, price });
