import type { RouteStat } from '../../src/core/stats';

// Fixtures for the statistics view models. The runs R1–R6 come from stats-fixtures.ts, the reference from factories.ts.

/** Unix seconds, after every run of stats-fixtures.ts has started. */
export const NOW = 100_000;

/** Gold from terminal 1 to terminal 2: two finished runs, 545 000 profit in 4 200 s (35:00 median, phases 5:00 · 16:40 · 8:20). */
export const stat: RouteStat = {
  originId: 1, destId: 2, commodityIds: [10], runs: 2,
  medianDurationSec: 2100,
  medianPhases: { loadingSec: 300, flightSec: 1000, unloadingSec: 500 },
  totalProfit: 545_000,
  avgRoi: 0.1207,
  uecPerHour: 467_143,
};
