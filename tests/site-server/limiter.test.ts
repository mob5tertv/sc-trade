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

  it('holds a number of keys and no more: a flood of addresses cannot fill the memory', () => {
    const { clock, limiter: marks } = limiter({ maxKeys: 3 });
    expect(marks.mark('a', HOUR)).toBe(true);
    expect(marks.mark('b', HOUR)).toBe(true);
    expect(marks.mark('c', HOUR)).toBe(true);
    // no room for a new key; a key that is already there is still counted
    expect(marks.hasRoom('d')).toBe(false);
    expect(marks.hasRoom('a')).toBe(true);
    expect(marks.mark('d', HOUR)).toBe(false);
    expect(marks.mark('a', HOUR)).toBe(true);
    expect(marks.size()).toBe(3);
    expect(marks.count('a', HOUR)).toBe(2);
    // room comes back when the old marks have run out
    clock.now += HOUR + 1;
    expect(marks.mark('d', HOUR)).toBe(true);
    expect(marks.keys()).toEqual(['d']);
  });
});
