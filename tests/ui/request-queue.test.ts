import { describe, expect, it } from 'vitest';
import { createRequestQueue } from '../../src/ui/vm/request-queue';

/** A job that stays open until `finish` is called, and records when it started and ended. */
function gate(log: string[], name: string) {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => { finish = resolve; });
  const job = async () => {
    log.push(`${name}:start`);
    await done;
    log.push(`${name}:end`);
    return name;
  };
  return { job, finish };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('createRequestQueue', () => {
  it('never runs two jobs at the same time and keeps the order', async () => {
    const log: string[] = [];
    const queue = createRequestQueue();
    const a = gate(log, 'a');
    const b = gate(log, 'b');
    const resultA = queue(a.job);
    const resultB = queue(b.job);

    await flush();
    expect(log).toEqual(['a:start']);
    a.finish();
    await flush();
    expect(log).toEqual(['a:start', 'a:end', 'b:start']);
    b.finish();
    expect(await resultA).toBe('a');
    expect(await resultB).toBe('b');
  });

  it('hands each caller the result or the error of its own job', async () => {
    const queue = createRequestQueue();
    await expect(queue(async () => 42)).resolves.toBe(42);
    await expect(queue(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });

  it('runs the next job after one failed', async () => {
    const queue = createRequestQueue();
    const failed = queue(async () => { throw new Error('boom'); });
    const next = queue(async () => 'ok');
    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });

  it('turns a job that throws before its first await into a rejection of its own', async () => {
    const queue = createRequestQueue();
    const failed = queue(() => { throw new Error('sync boom'); });
    const next = queue(async () => 'ok');
    await expect(failed).rejects.toThrow('sync boom');
    await expect(next).resolves.toBe('ok');
  });

  it('counts the jobs that have not finished yet', async () => {
    const queue = createRequestQueue();
    const log: string[] = [];
    const a = gate(log, 'a');
    expect(queue.pending()).toBe(0);
    const resultA = queue(a.job);
    void queue(async () => 'b');
    expect(queue.pending()).toBe(2);
    a.finish();
    await resultA;
    await flush();
    expect(queue.pending()).toBe(0);
  });
});
