import { describe, expect, it } from 'vitest';
import { createLimiter, DAY, HOUR } from '../../site/server/src/limiter.mjs';

const START = Date.parse('2026-10-10T12:00:00Z');

function limiter(options: { maxKeys?: number } = {}) {
  const clock = { now: START };
  return { clock, limiter: createLimiter({ now: () => clock.now, ...options }) };
}

describe('the limiter', () => {
  it('counts the marks of a key inside a window of time', () => {
    const { clock, limiter: marks } = limiter();
    expect(marks.count('a', HOUR)).toBe(0);
    marks.mark('a', DAY);
    clock.now += 30 * 60_000;
    marks.mark('a', DAY);
    marks.mark('b', DAY);
    expect(marks.count('a', HOUR)).toBe(2);
    expect(marks.count('b', HOUR)).toBe(1);
    clock.now += 31 * 60_000; // the first mark is 61 minutes old
    expect(marks.count('a', HOUR)).toBe(1);
    expect(marks.count('a', DAY)).toBe(2);
    clock.now += HOUR;
    expect(marks.count('a', HOUR)).toBe(0);
    expect(marks.count('a', DAY)).toBe(2);
  });

  it('never keeps an address as it is: only its HMAC under a secret of this very run', () => {
    const one = limiter().limiter;
    const other = limiter().limiter;
    const key = one.addressKey('203.0.113.7');
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    // the same address gives the same key while the service runs…
    expect(one.addressKey('203.0.113.7')).toBe(key);
    expect(one.addressKey('203.0.113.8')).not.toBe(key);
    // …and another key after a restart: the secret is made anew and is written nowhere
    expect(other.addressKey('203.0.113.7')).not.toBe(key);
    one.mark(`sent:${key}`, DAY);
    expect(JSON.stringify(one.keys())).not.toContain('203.0.113.7');
  });

  it('forgets every mark after the time it was made for, and none lives longer than a day', () => {
    const { clock, limiter: marks } = limiter();
    marks.mark('login:x', 15 * 60_000);
    marks.mark('try:x', HOUR);
    marks.mark('sent:x', DAY);
    marks.mark('greedy:x', 30 * DAY); // asked to be kept for a month: kept for a day
    expect(marks.size()).toBe(4);

    clock.now += 15 * 60_000 + 1;
    marks.prune();
    expect(marks.keys().sort()).toEqual(['greedy:x', 'sent:x', 'try:x']);

    clock.now = START + HOUR + 1;
    marks.prune();
    expect(marks.keys().sort()).toEqual(['greedy:x', 'sent:x']);

    clock.now = START + DAY - 1;
    marks.prune();
    expect(marks.size()).toBe(2);

    clock.now = START + DAY + 1;
    marks.prune();
    expect(marks.size()).toBe(0);
    expect(marks.keys()).toEqual([]);
    expect(marks.count('greedy:x', 30 * DAY)).toBe(0);
  });

  it('keeps a key that is still marked: only the marks that are too old go', () => {
    const { clock, limiter: marks } = limiter();
    marks.mark('sent:x', DAY);
    clock.now += DAY - 60_000;
    marks.mark('sent:x', DAY);
    clock.now += 2 * 60_000;
    marks.prune();
    expect(marks.size()).toBe(1);
    expect(marks.count('sent:x', DAY)).toBe(1);
  });

  it('holds a number of keys and no more — and a full table never shuts a new key out: the one marked longest ago makes room', () => {
    const { clock, limiter: marks } = limiter({ maxKeys: 3 });
    for (const key of ['a', 'b', 'c']) {
      clock.now += 1000;
      marks.mark(key, HOUR);
    }
    expect(marks.keys()).toEqual(['a', 'b', 'c']);
    // a key that is there is counted on, and is now the one marked last
    clock.now += 1000;
    marks.mark('a', HOUR);
    expect(marks.count('a', HOUR)).toBe(2);
    expect(marks.keys()).toEqual(['b', 'c', 'a']);
    // a new key at the ceiling: "b", marked longest ago, goes — "d" is taken, nobody is refused
    clock.now += 1000;
    marks.mark('d', HOUR);
    expect(marks.size()).toBe(3);
    expect(marks.keys()).toEqual(['c', 'a', 'd']);
    expect(marks.count('b', HOUR)).toBe(0);
    expect(marks.count('d', HOUR)).toBe(1);
    // looking at a key makes none: a flood of questions about unknown keys changes nothing
    for (let n = 0; n < 100; n++) expect(marks.count(`unknown-${n}`, HOUR)).toBe(0);
    expect(marks.keys()).toEqual(['c', 'a', 'd']);
  });

  it('does not look through the whole table when a new key comes to a full one', () => {
    const { clock, limiter: marks } = limiter({ maxKeys: 2000 });
    for (let n = 0; n < 2000; n++) marks.mark(`k${n}`, HOUR);
    // every key is long out of date, and still a new key costs one step: the oldest goes, the rest wait for the
    // sweep that runs by the clock
    clock.now += 2 * HOUR;
    marks.mark('new', HOUR);
    expect(marks.size()).toBe(2000);
    expect(marks.keys()[0]).toBe('k1');
    marks.prune();
    expect(marks.keys()).toEqual(['new']);
  });

  it('adds up what the marks weigh, for a budget of bytes', () => {
    const { clock, limiter: marks } = limiter();
    expect(marks.sum('bytes:x', DAY)).toBe(0);
    marks.mark('bytes:x', DAY, 1500);
    clock.now += 2 * HOUR;
    marks.mark('bytes:x', DAY, 700);
    marks.mark('sent:x', DAY);
    expect(marks.sum('bytes:x', DAY)).toBe(2200);
    expect(marks.sum('bytes:x', HOUR)).toBe(700);
    expect(marks.count('bytes:x', DAY)).toBe(2);
    // a mark that is not given a weight weighs one
    expect(marks.sum('sent:x', DAY)).toBe(1);
    clock.now = START + DAY + 1;
    expect(marks.sum('bytes:x', DAY)).toBe(700);
  });
});
