import { describe, expect, it } from 'vitest';
import { createLatestRequest } from '../../src/ui/vm/latest-request';

describe('createLatestRequest', () => {
  it('keeps the newest request current and drops every older one', () => {
    const latest = createLatestRequest();
    const first = latest.begin();
    expect(first()).toBe(true);

    const second = latest.begin();
    expect(first()).toBe(false);
    expect(second()).toBe(true);

    const third = latest.begin();
    expect(first()).toBe(false);
    expect(second()).toBe(false);
    expect(third()).toBe(true);
  });

  it('does not let one tracker supersede the requests of another', () => {
    const a = createLatestRequest();
    const b = createLatestRequest();
    const fromA = a.begin();
    b.begin();
    expect(fromA()).toBe(true);
  });

  it('lets a superseded request be told apart after it has finished waiting', async () => {
    const latest = createLatestRequest();
    const applied: string[] = [];
    const run = async (name: string, delayMs: number): Promise<void> => {
      const isCurrent = latest.begin();
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (isCurrent()) applied.push(name);
    };
    // the older request answers last, and must not overwrite the newer answer
    await Promise.all([run('old', 20), run('new', 1)]);
    expect(applied).toEqual(['new']);
  });
});
