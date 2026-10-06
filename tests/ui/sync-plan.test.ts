import { describe, expect, it } from 'vitest';
import { metaSeconds, syncPlan } from '../../src/ui/vm/sync-plan';

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
