// The named sets of test data a scene can ask for. The data itself is written by `seed.ts` on the dev server;
// the browser only needs the names.

export const DATASET_NAMES = ['default', 'run', 'empty'] as const;

export type DatasetName = (typeof DATASET_NAMES)[number];

export const isDatasetName = (value: unknown): value is DatasetName =>
  typeof value === 'string' && (DATASET_NAMES as readonly string[]).includes(value);
