import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLogger, memorySink } from '../../src/data/logger';
import { UEX_MIN_GAP_MS, createUexClient } from '../../src/data/uex-client';
import { appPacing, setAppMinGapMs, timerSleep } from '../../src/data/uex-pacing';

afterEach(() => {
  setAppMinGapMs(UEX_MIN_GAP_MS);
  vi.useRealTimers();
});

describe('the pacing of the application', () => {
  it('is the gap UEX asks for by default', () => {
    expect(appPacing().minGapMs).toBe(500);
  });

  it('can be taken away for the clients created afterwards (the preview does)', () => {
    setAppMinGapMs(0);
    expect(appPacing().minGapMs).toBe(0);
  });

  describe('the timer', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('resolves after the time asked for, not before', async () => {
      let done = false;
      void timerSleep(500).then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(499);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(done).toBe(true);
    });

    it('is what keeps a real client half a second apart', async () => {
      const starts: number[] = [];
      const client = createUexClient(async () => {
        starts.push(Date.now());
        return { status: 200, body: { status: 'ok', data: [] } };
      }, createLogger(memorySink()), Date.now, appPacing());

      const all = Promise.all([client.commodities(), client.commodities(), client.commodities()]);
      await vi.advanceTimersByTimeAsync(1000);
      await all;

      expect(starts.map((t) => t - starts[0])).toEqual([0, 500, 1000]);
    });
  });
});
