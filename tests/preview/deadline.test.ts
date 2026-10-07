import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeadlineError, withDeadline } from '../../scripts/preview/deadline.mjs';

const later = <T>(ms: number, value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));
const never = () => new Promise<never>(() => {});

describe('withDeadline', () => {
  it('gives the value of a job that finishes in time', async () => {
    await expect(withDeadline(later(5, 'done'), 500, 'the job')).resolves.toBe('done');
  });

  it('passes on the error of a job that fails in time', async () => {
    await expect(withDeadline(Promise.reject(new Error('boom')), 500, 'the job')).rejects.toThrow('boom');
  });

  it('gives up on a job that never answers, and says which job and how long', async () => {
    const started = Date.now();
    const failure = withDeadline(never(), 40, 'item "scene mini"');
    await expect(failure).rejects.toBeInstanceOf(DeadlineError);
    await expect(failure).rejects.toThrow('item "scene mini" did not finish in 0.04 s');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('gives up on a job that answers too late', async () => {
    await expect(withDeadline(later(200, 'late'), 20, 'the job')).rejects.toBeInstanceOf(DeadlineError);
  });

  describe('does not leave its timer behind (it would hold the process open until it fires)', () => {
    afterEach(() => vi.useRealTimers());

    it('when the job succeeds', async () => {
      vi.useFakeTimers();
      await withDeadline(Promise.resolve('x'), 60_000, 'the job');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('when the job fails', async () => {
      vi.useFakeTimers();
      await expect(withDeadline(Promise.reject(new Error('boom')), 60_000, 'the job')).rejects.toThrow('boom');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('when the deadline itself fires', async () => {
      vi.useFakeTimers();
      const failure = withDeadline(never(), 1000, 'the job');
      const caught = expect(failure).rejects.toBeInstanceOf(DeadlineError);
      expect(vi.getTimerCount()).toBe(1); // armed while the job runs
      await vi.advanceTimersByTimeAsync(1000);
      await caught;
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
