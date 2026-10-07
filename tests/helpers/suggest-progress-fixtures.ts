import { expect } from 'vitest';
import type { Db } from '../../src/data/db';
import type { SuggestProgress } from '../../src/data/suggest';

/**
 * The same database that counts its reads of the distance table and of the meta table (where the route-list
 * attempts are kept), to show how much a call spends on planning.
 */
export function countingDb(db: Db): { db: Db; reads: () => { distances: number; meta: number } } {
  const reads = { distances: 0, meta: 0 };
  return {
    db: {
      select<T>(sql: string, params?: unknown[]): Promise<T[]> {
        if (sql.includes('FROM uex_distance')) reads.distances++;
        if (sql.includes('FROM uex_meta')) reads.meta++;
        return db.select<T>(sql, params);
      },
      execute: (sql, params) => db.execute(sql, params),
    },
    reads: () => ({ ...reads }),
  };
}

/** An `onProgress` callback that keeps a copy of every point it is given. */
export function recordProgress(): { points: SuggestProgress[]; onProgress: (p: SuggestProgress) => void } {
  const points: SuggestProgress[] = [];
  return { points, onProgress: (p) => { points.push({ ...p }); } };
}

/**
 * What a progress series promises the screen: it starts at zero, `done` only grows, `total` only
 * shrinks, `done` never passes `total`, and the last point is the complete one.
 */
export function expectSoundProgress(points: SuggestProgress[]): void {
  expect(points.length).toBeGreaterThan(0);
  expect(points[0].done).toBe(0);
  const last = points[points.length - 1];
  expect(last.done).toBe(last.total);
  points.forEach((p, i) => {
    expect(p.done).toBeLessThanOrEqual(p.total);
    if (i === 0) return;
    expect(p.done).toBeGreaterThanOrEqual(points[i - 1].done);
    expect(p.total).toBeLessThanOrEqual(points[i - 1].total);
  });
}
