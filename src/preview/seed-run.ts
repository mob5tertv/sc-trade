import type { RunPhase } from '../ui/vm/run-phase';
import type { Db } from '../data/db';
import { createLogger } from '../data/logger';
import { loadSettings, saveSetting } from '../data/repo/settings';
import { loadReference } from '../data/repo/uex-cache';
import { recordBuy, recordMark, type TradeDeps } from '../data/trade';

// The runs of the scenes of task 15c: a run in each of its three phases, with a target set. They are written on top of the
// default dataset by the REAL trade service, with a clock that is set to the time of each event, so the timers on the
// screen are what a player would see: loading 3:12, flight 8:40, unloading 2:05 (and the whole run the sum of those that
// have gone).

const quiet = createLogger({ write() {} });

/** The datasets of the phases and the phase each one is in. */
export const RUN_PHASE_DATASETS = {
  'run-loading': 'loading',
  'run-flight': 'flight',
  'run-unloading': 'unloading',
} as const satisfies Record<string, RunPhase>;

export type RunPhaseDatasetName = keyof typeof RUN_PHASE_DATASETS;

export const isRunPhaseDataset = (name: string): name is RunPhaseDatasetName => name in RUN_PHASE_DATASETS;

const HUR_L1 = 3;
const ARC_L1 = 1;
const LOADING_SEC = 192;
const FLIGHT_SEC = 520;
const UNLOADING_SEC = 125;

/**
 * The seconds before `now` of each event: the first purchase, the second one, the take-off and the arrival. The run is in
 * the phase the dataset is named for, `LOADING_SEC` (or `FLIGHT_SEC`, `UNLOADING_SEC`) into it.
 */
function timeline(phase: RunPhase): { firstBuy: number; secondBuy: number; depart: number | null; arrive: number | null } {
  const sinceLoading = LOADING_SEC + (phase === 'loading' ? 0 : FLIGHT_SEC + (phase === 'flight' ? 0 : UNLOADING_SEC));
  return {
    firstBuy: sinceLoading,
    secondBuy: sinceLoading - 42,
    depart: phase === 'loading' ? null : FLIGHT_SEC + (phase === 'flight' ? 0 : UNLOADING_SEC),
    arrive: phase === 'unloading' ? UNLOADING_SEC : null,
  };
}

/** Medical Supplies and Stims bought at HUR-L1 with ARC-L1 as the target, the run in `phase` (`extendForRun` is called on the default dataset). */
export async function extendForRun(db: Db, now: number, phase: RunPhase): Promise<void> {
  const reference = await loadReference(db);
  const idOf = (code: string): number => {
    const found = [...reference.commodities.values()].find((c) => c.code === code);
    if (found === undefined) throw new Error(`preview seed: unknown commodity code ${code}`);
    return found.id;
  };
  await saveSetting(db, quiet, 'targetTerminalId', ARC_L1);
  const settings = await loadSettings(db, quiet);

  let clock = 0;
  const deps: TradeDeps = { db, log: quiet, now: () => clock, settings };
  const at = (secondsAgo: number): number => {
    clock = now - secondsAgo;
    return clock;
  };
  const t = timeline(phase);
  at(t.firstBuy);
  await recordBuy(deps, { terminalId: HUR_L1, commodityId: idOf('MEDS'), scu: 120, price: 2115, knownScu: 380 });
  at(t.secondBuy);
  await recordBuy(deps, { terminalId: HUR_L1, commodityId: idOf('STIM'), scu: 80, price: 2810 });
  if (t.depart !== null) {
    at(t.depart);
    await recordMark(deps, 'depart');
  }
  if (t.arrive !== null) {
    at(t.arrive);
    await recordMark(deps, 'arrive');
  }
}
