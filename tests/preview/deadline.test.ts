import { describe, expect, it } from 'vitest';
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

  it('does not keep the process alive for its timer after the job is done', async () => {
    // a 60 s timer left behind would hold the test process open; the call must clear it (the run would hang otherwise)
    await withDeadline(later(1, 'x'), 60_000, 'the job');
  });
});
