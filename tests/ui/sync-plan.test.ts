import { describe, expect, it } from 'vitest';
import { metaSeconds, refreshPlan, reloadsMidSync, syncPlan } from '../../src/ui/vm/sync-plan';

const NOW = 1_790_000_000;
const HOUR = 3600;

describe('metaSeconds', () => {
  it('reads Unix seconds from a meta value', () => {
    expect(metaSeconds('1790000000')).toBe(1_790_000_000);
  });
  it('is null for a missing or unreadable value', () => {
    expect(metaSeconds(null)).toBeNull();
    expect(metaSeconds('')).toBeNull();
    expect(metaSeconds('abc')).toBeNull();
  });
});

describe('syncPlan', () => {
  it('asks for both on a first launch', () => {
    expect(syncPlan(null, null, NOW)).toEqual({ reference: true, prices: true });
  });
  it('asks for nothing while both are fresh', () => {
    expect(syncPlan(String(NOW - HOUR), String(NOW - 10 * 60), NOW)).toEqual({ reference: false, prices: false });
  });
  it('asks for prices after an hour and for the reference after a day', () => {
    expect(syncPlan(String(NOW - 2 * HOUR), String(NOW - 2 * HOUR), NOW)).toEqual({ reference: false, prices: true });
    expect(syncPlan(String(NOW - 25 * HOUR), String(NOW - 10 * 60), NOW)).toEqual({ reference: true, prices: false });
  });
  it('asks for prices again when the migration deleted their mark', () => {
    expect(syncPlan(String(NOW - HOUR), null, NOW)).toEqual({ reference: false, prices: true });
  });
});

describe('refreshPlan: the price sync of the hourly timer and of the click on the indicator', () => {
  it('only refreshes the prices while the last reference sync worked', () => {
    expect(refreshPlan(true)).toEqual({ reference: false, prices: true });
  });
  it('repeats the reference first when the last reference sync failed, and refreshes the prices after it in any case', () => {
    expect(refreshPlan(false)).toEqual({ reference: true, prices: true });
  });
});

describe('reloadsMidSync: the first sync shows what has come as it goes', () => {
  const at = (done: number, total = 70) => ({ done, total });

  it('reads the market again every ten batches of a sync that started with no price of UEX in the cache', () => {
    const reloads = Array.from({ length: 71 }, (_, done) => done).filter((done) => reloadsMidSync(true, at(done)));
    expect(reloads).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it('does not read it at the last batch: the end of the sync reads it anyway', () => {
    expect(reloadsMidSync(true, at(70))).toBe(false);
    expect(reloadsMidSync(true, at(20, 20))).toBe(false);
  });

  it('leaves an ordinary sync as it was: the market is read once, at the end', () => {
    for (let done = 0; done <= 70; done++) expect(reloadsMidSync(false, at(done))).toBe(false);
  });

  it('does not read it before the first batch is done', () => {
    expect(reloadsMidSync(true, at(0))).toBe(false);
  });
});
