import { describe, expect, it } from 'vitest';
import { answerLookup } from '../../src/ui/vm/lookup-flow';
import { CACHED_ANSWER, FINAL_ANSWER, flowHarness } from '../helpers/window-layout-fixtures';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('answerLookup: the two steps', () => {
  it('answers from the cache first, then fetches once inside the UEX queue and replaces the answer', async () => {
    const h = flowHarness();
    await answerLookup(h.flow);
    expect(h.events).toEqual([
      'suggest:cached', 'answer:12:preliminary',
      'queue:wait', 'queue:run', 'suggest:fetch', 'answer:213:final',
    ]);
    expect(h.runs).toEqual(['cached', 'fetch']);
  });

  it('makes no second step when the cache already holds every distance', async () => {
    const h = flowHarness();
    h.state.firstAnswer = { ...CACHED_ANSWER, missing: 0 };
    await answerLookup(h.flow);
    expect(h.events).toEqual(['suggest:cached', 'answer:12:final']);
    expect(h.runs).toEqual(['cached']);
  });

  it('never asks the UEX queue for the first step: it answers while the queue is busy', async () => {
    const h = flowHarness();
    let free!: () => void;
    h.state.queueBusy = new Promise<void>((resolve) => (free = resolve));
    const done = answerLookup(h.flow);
    await tick();
    // the cached answer is on the screen although a sync is holding the queue
    expect(h.events).toEqual(['suggest:cached', 'answer:12:preliminary', 'queue:wait']);
    free();
    await done;
    expect(h.events.at(-1)).toBe('answer:213:final');
  });

  it('fetches ONCE even when distances are still missing afterwards', async () => {
    const h = flowHarness();
    h.state.secondAnswer = { ...FINAL_ANSWER, missing: 4 };
    await answerLookup(h.flow);
    expect(h.runs).toEqual(['cached', 'fetch']);
  });

  it('keeps the answer preliminary while distances are still missing after the fetching (UEX did not answer for some pair)', async () => {
    for (const missing of [1, 4]) {
      const h = flowHarness();
      h.state.secondAnswer = { ...FINAL_ANSWER, missing };
      await answerLookup(h.flow);
      expect(h.events.at(-1)).toBe('answer:213:preliminary');
      expect(h.runs).toEqual(['cached', 'fetch']); // and it is not asked again
    }
  });

  it('makes the answer final only when the fetching left no distance missing', async () => {
    const h = flowHarness();
    h.state.secondAnswer = { ...FINAL_ANSWER, missing: 0 };
    await answerLookup(h.flow);
    expect(h.events.at(-1)).toBe('answer:213:final');
  });

  it('passes the progress of the fetching on', async () => {
    const h = flowHarness();
    h.state.progress = [{ done: 0, total: 15 }, { done: 7, total: 15 }, { done: 15, total: 15 }];
    await answerLookup(h.flow);
    expect(h.events.filter((e) => e.startsWith('progress:'))).toEqual(['progress:0/15', 'progress:7/15', 'progress:15/15']);
    // the points come after the preliminary answer and before the final one
    const at = (event: string) => h.events.indexOf(event);
    expect(at('answer:12:preliminary')).toBeLessThan(at('progress:0/15'));
    expect(at('progress:15/15')).toBeLessThan(at('answer:213:final'));
  });
});

describe('answerLookup: a newer request wins', () => {
  it('shows nothing and does not go on when it is superseded during the first step', async () => {
    const h = flowHarness();
    let go!: () => void;
    h.hold.first = new Promise<void>((resolve) => (go = resolve));
    const done = answerLookup(h.flow);
    await tick();
    h.state.newest = false;
    go();
    await done;
    expect(h.events).toEqual(['suggest:cached']);
  });

  it('does not fetch when it is superseded while it waits in the UEX queue', async () => {
    const h = flowHarness();
    let free!: () => void;
    h.state.queueBusy = new Promise<void>((resolve) => (free = resolve));
    const done = answerLookup(h.flow);
    await tick();
    h.state.newest = false;
    free();
    await done;
    expect(h.runs).toEqual(['cached']);
    expect(h.events).toEqual(['suggest:cached', 'answer:12:preliminary', 'queue:wait', 'queue:run']);
  });

  it('does not show the final answer, nor the progress, when it is superseded during the fetching', async () => {
    const h = flowHarness();
    h.state.progress = [{ done: 1, total: 2 }];
    let go!: () => void;
    h.hold.second = new Promise<void>((resolve) => (go = resolve));
    const done = answerLookup(h.flow);
    await tick();
    h.state.newest = false;
    go();
    await done;
    expect(h.events.some((e) => e.startsWith('answer:213'))).toBe(false);
  });

  it('does not fetch when the cargo space was cleared while it waited', async () => {
    const h = flowHarness();
    let free!: () => void;
    h.state.queueBusy = new Promise<void>((resolve) => (free = resolve));
    const done = answerLookup(h.flow);
    await tick();
    h.state.capacity = false;
    free();
    await done;
    expect(h.runs).toEqual(['cached']);
  });
});

describe('answerLookup: failures', () => {
  it('reports a failed first step and goes no further', async () => {
    const h = flowHarness();
    h.state.firstAnswer = new Error('the database is gone');
    await answerLookup(h.flow);
    expect(h.events).toEqual(['suggest:cached', 'failed']);
  });

  it('keeps the preliminary answer when the fetching fails, and says so', async () => {
    const h = flowHarness();
    h.state.secondAnswer = new Error('no network');
    await answerLookup(h.flow);
    expect(h.events).toEqual([
      'suggest:cached', 'answer:12:preliminary',
      'queue:wait', 'queue:run', 'suggest:fetch', 'refine-failed',
    ]);
    // no answer after the preliminary one: nothing marks it final (the owner leaves the mark where it is)
    expect(h.events.some((e) => e.endsWith(':final'))).toBe(false);
  });

  it('is silent about a failure of a request that was superseded', async () => {
    const h = flowHarness();
    h.state.firstAnswer = new Error('boom');
    let go!: () => void;
    h.hold.first = new Promise<void>((resolve) => (go = resolve));
    const done = answerLookup(h.flow);
    await tick();
    h.state.newest = false;
    go();
    await done;
    expect(h.events).toEqual(['suggest:cached']);
  });
});

describe('answerLookup: the distances the fetching wrote reach the owner', () => {
  /** The harness flow that also tells when the owner is asked to read the distances again. */
  const withDistances = (h: ReturnType<typeof flowHarness>) => ({
    ...h.flow,
    distancesChanged: async () => {
      h.events.push('distances');
    },
  });

  it('asks for them to be read again once the fetching has answered, outside the job of the UEX queue', async () => {
    const h = flowHarness();
    await answerLookup(withDistances(h));
    expect(h.events).toEqual([
      'suggest:cached', 'answer:12:preliminary',
      'queue:wait', 'queue:run', 'suggest:fetch', 'answer:213:final', 'distances',
    ]);
  });

  it('asks for them also when the fetching failed: what was fetched before the failure is in the database', async () => {
    const h = flowHarness();
    h.state.secondAnswer = new Error('no network');
    await answerLookup(withDistances(h));
    expect(h.events.slice(-2)).toEqual(['refine-failed', 'distances']);
  });

  it('asks for them also when a newer request has taken the screen: the distances are stored all the same', async () => {
    const h = flowHarness();
    let go!: () => void;
    h.hold.second = new Promise<void>((resolve) => (go = resolve));
    const done = answerLookup(withDistances(h));
    await tick();
    h.state.newest = false;
    go();
    await done;
    expect(h.events.some((e) => e.startsWith('answer:213'))).toBe(false);
    expect(h.events.at(-1)).toBe('distances');
  });

  it('does not ask when nothing was fetched: no distances were missing, or the fetching never started', async () => {
    const complete = flowHarness();
    complete.state.firstAnswer = { ...CACHED_ANSWER, missing: 0 };
    await answerLookup(withDistances(complete));
    expect(complete.events).not.toContain('distances');

    const waiting = flowHarness();
    let free!: () => void;
    waiting.state.queueBusy = new Promise<void>((resolve) => (free = resolve));
    const done = answerLookup(withDistances(waiting));
    await tick();
    waiting.state.capacity = false;
    free();
    await done;
    expect(waiting.events).not.toContain('distances');
  });
});
