// The named sets of test data a scene can ask for. The data itself is written by `seed.ts` (and, for `window`, extended
// by `seed-window.ts`; the runs in each phase by `seed-run.ts`) on the dev server; the browser only needs the names.

export const DATASET_NAMES = ['default', 'run', 'empty', 'window', 'run-loading', 'run-flight', 'run-unloading'] as const;

export type DatasetName = (typeof DATASET_NAMES)[number];

export const isDatasetName = (value: unknown): value is DatasetName =>
  typeof value === 'string' && (DATASET_NAMES as readonly string[]).includes(value);
