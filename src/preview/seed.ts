import { DEFAULT_SETTINGS, type Settings } from '../core/settings';
import type { Db } from '../data/db';
import { createLogger } from '../data/logger';
import { migrate } from '../data/migrations';
import { saveSetting } from '../data/repo/settings';
import { recordBuy, recordMark, recordSell, type TradeDeps } from '../data/trade';
import { ago, C2_HERCULES, commodityId, MIN, STANTON, writeObservations, writeReference } from '../demo/world';
import type { DatasetName } from './datasets';

// The test data of the preview: the demo world (`src/demo/world.ts`) and, on it, the settings of the player, two finished runs and,
// in the dataset `run`, a run in progress. It runs on the dev server, against a database made by the REAL migrations and written by
// the REAL repository and trade functions, so a dataset cannot drift away from the schema.

const log = createLogger({ write() {} });

/**
 * The player's settings: the C2 Hercules in Stanton, standing at HUR-L1, Russian chosen (a scene with settings is not a first start,
 * which asks for the language: the dataset `empty` is; `lang=en` in the address switches a scene to English, see `entry.ts`).
 */
async function writeSettings(db: Db, extra: Partial<Settings> = {}): Promise<Settings> {
  const settings: Settings = {
    ...DEFAULT_SETTINGS, vehicleId: C2_HERCULES, scuCapacity: 696, starSystemId: STANTON, currentTerminalId: 3, language: 'ru', ...extra,
  };
  for (const key of ['vehicleId', 'scuCapacity', 'starSystemId', 'currentTerminalId', 'targetTerminalId', 'language'] as const) {
    if (settings[key] !== DEFAULT_SETTINGS[key]) await saveSetting(db, log, key, settings[key]);
  }
  return settings;
}

/** A trade at `at`: the clock the trade service reads is set to it for the call. */
function tradeClock(db: Db, settings: Settings) {
  let clock = 0;
  const deps: TradeDeps = { db, log, now: () => clock, settings };
  return {
    buy: (at: number, terminalId: number, code: string, scu: number, price: number, knownScu?: number) => {
      clock = at;
      return recordBuy(deps, { terminalId, commodityId: commodityId(code), scu, price, knownScu });
    },
    sell: (at: number, terminalId: number, code: string, scu: number, price: number, knownScu?: number) => {
      clock = at;
      return recordSell(deps, { terminalId, commodityId: commodityId(code), scu, price, knownScu });
    },
    mark: (at: number, type: 'depart' | 'arrive') => {
      clock = at;
      return recordMark(deps, type);
    },
  };
}

/** Two finished runs: gold from Port Tressler to Area 18 two days ago, medicine and stims from HUR-L1 to ARC-L1 yesterday. */
async function writeHistory(db: Db, now: number, settings: Settings): Promise<void> {
  const trade = tradeClock(db, settings);

  const first = now - ago.d(2);
  await trade.buy(first, 11, 'GOLD', 150, 5320, 420);
  await trade.mark(first + 6 * MIN, 'depart');
  await trade.mark(first + 31 * MIN, 'arrive');
  await trade.sell(first + 34 * MIN, 5, 'GOLD', 150, 6410, 0);

  const second = now - ago.d(1);
  await trade.buy(second, 3, 'MEDS', 200, 2105, 560);
  await trade.buy(second + 2 * MIN, 3, 'STIM', 100, 2790);
  await trade.mark(second + 8 * MIN, 'depart');
  await trade.mark(second + 33 * MIN, 'arrive');
  await trade.sell(second + 36 * MIN, 1, 'MEDS', 200, 2540, 90);
  await trade.sell(second + 38 * MIN, 1, 'STIM', 100, 3320);
}

/** The run in progress: two commodities bought at HUR-L1 25 minutes ago, ARC-L1 is the target. */
async function writeActiveRun(db: Db, now: number, settings: Settings): Promise<void> {
  const trade = tradeClock(db, settings);
  const start = now - ago.m(25);
  await trade.buy(start, 3, 'MEDS', 120, 2115, 380);
  await trade.buy(start + MIN, 3, 'STIM', 80, 2810);
}

/**
 * Fills a fresh database with a named dataset:
 * - `default`: the reference (3 star systems, 17 terminals, 15 commodities, 8 ships), UEX prices, distances, own observations of
 *   every age, the settings of the player and two finished runs;
 * - `run`: the same plus an active run;
 * - `empty`: nothing at all, not even the schema (a first launch; the application migrates by itself).
 */
export async function prepareDataset(db: Db, dataset: DatasetName, now: number): Promise<void> {
  if (dataset === 'empty') return;
  await migrate(db, log);
  const prices = await writeReference(db, now);
  await writeObservations(db, prices, now);
  const settings = await writeSettings(db, dataset === 'run' ? { targetTerminalId: 1 } : {});
  await writeHistory(db, now, settings);
  if (dataset === 'run') await writeActiveRun(db, now, settings);
}
