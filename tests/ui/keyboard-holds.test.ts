import { describe, expect, it } from 'vitest';
import { createKeyboardHolds, type HoldEffects } from '../../src/ui/vm/keyboard-holds';

interface Gate {
  promise: Promise<void>;
  open(): void;
}

function gate(): Gate {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

/** Lets every pending microtask run. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

interface Options {
  /** Each take / give waits for the matching gate before it finishes. */
  slow?: boolean;
  failTake?: boolean;
  failGive?: boolean;
}

function setup(options: Options = {}) {
  const calls: string[] = [];
  const gates: Gate[] = [];
  const wait = async (): Promise<void> => {
    if (!options.slow) return;
    const g = gate();
    gates.push(g);
    await g.promise;
  };
  const effects: HoldEffects = {
    async take() {
      calls.push('take:start');
      await wait();
      if (options.failTake) throw new Error('take failed');
      calls.push('take:end');
    },
    async give(restore) {
      calls.push(`give:start:${restore}`);
      await wait();
      if (options.failGive) throw new Error('give failed');
      calls.push(`give:end:${restore}`);
    },
  };
  const changes: boolean[] = [];
  const holds = createKeyboardHolds(effects, (held) => changes.push(held));
  return { holds, calls, changes, gates };
}

describe('createKeyboardHolds', () => {
  it('takes the keyboard when the first holder arrives', async () => {
    const { holds, calls } = setup();
    expect(holds.held).toBe(false);
    await holds.hold('field');
    expect(calls).toEqual(['take:start', 'take:end']);
    expect(holds.held).toBe(true);
  });

  it('does not take again for a second holder, and keeps the keyboard until the last one leaves', async () => {
    const { holds, calls } = setup();
    await holds.hold('field');
    await holds.hold('dialog');
    expect(calls).toEqual(['take:start', 'take:end']);
    await holds.release('field');
    expect(calls).toEqual(['take:start', 'take:end']);
    expect(holds.held).toBe(true);
    await holds.release('dialog');
    expect(calls).toEqual(['take:start', 'take:end', 'give:start:true', 'give:end:true']);
    expect(holds.held).toBe(false);
  });

  it('does nothing when the same holder asks again', async () => {
    const { holds, calls, changes } = setup();
    await holds.hold('field');
    await holds.hold('field');
    await holds.hold('field');
    expect(calls).toEqual(['take:start', 'take:end']);
    expect(changes).toEqual([true]);
    // one release is enough: the holder was counted once
    await holds.release('field');
    expect(holds.held).toBe(false);
    expect(calls.filter((c) => c.startsWith('give:start'))).toHaveLength(1);
  });

  it('hands the focus back to the remembered window when the last holder releases', async () => {
    const { holds, calls } = setup();
    await holds.hold('field');
    await holds.release('field');
    expect(calls.at(-1)).toBe('give:end:true');
  });

  it('ignores the release of a holder that is not there', async () => {
    const { holds, calls, changes } = setup();
    await holds.release('field');
    expect(calls).toEqual([]);
    expect(changes).toEqual([]);
    await holds.hold('dialog');
    await holds.release('field');
    expect(holds.held).toBe(true);
    expect(calls).toEqual(['take:start', 'take:end']);
  });

  it('on drop (the player went to the game) forgets every holder and does not give the focus back', async () => {
    const { holds, calls, changes } = setup();
    await holds.hold('field');
    await holds.hold('dialog');
    await holds.drop();
    expect(calls).toEqual(['take:start', 'take:end', 'give:start:false', 'give:end:false']);
    expect(holds.held).toBe(false);
    expect(changes).toEqual([true, false]);
    // the old holders are gone: their release is not a second give
    await holds.release('field');
    await holds.release('dialog');
    expect(calls).toHaveLength(4);
    // and the next holder takes the keyboard again
    await holds.hold('field');
    expect(calls.slice(4)).toEqual(['take:start', 'take:end']);
  });

  it('does nothing on drop when nobody holds the keyboard', async () => {
    const { holds, calls, changes } = setup();
    await holds.drop();
    expect(calls).toEqual([]);
    expect(changes).toEqual([]);
  });

  it('never runs a give in the middle of a slow take: the calls go strictly one after another', async () => {
    const { holds, calls, gates } = setup({ slow: true });
    const holding = holds.hold('field');
    const releasing = holds.release('field');
    await settle();
    expect(calls).toEqual(['take:start']);
    gates[0].open();
    await settle();
    expect(calls).toEqual(['take:start', 'take:end', 'give:start:true']);
    gates[1].open();
    await Promise.all([holding, releasing]);
    expect(calls).toEqual(['take:start', 'take:end', 'give:start:true', 'give:end:true']);
    expect(holds.held).toBe(false);
  });

  it('never runs a take in the middle of a slow give', async () => {
    const { holds, calls, gates } = setup({ slow: true });
    const first = holds.hold('field');
    await settle();
    gates[0].open();
    await first;
    const releasing = holds.release('field');
    const holdingAgain = holds.hold('field');
    await settle();
    expect(calls).toEqual(['take:start', 'take:end', 'give:start:true']);
    gates[1].open();
    await settle();
    expect(calls).toEqual(['take:start', 'take:end', 'give:start:true', 'give:end:true', 'take:start']);
    gates[2].open();
    await Promise.all([releasing, holdingAgain]);
    expect(holds.held).toBe(true);
  });

  it('judges a request when its turn comes: a hold and a release that cancel each other still keep the order', async () => {
    const { holds, calls, gates } = setup({ slow: true });
    const a = holds.hold('field');
    const b = holds.release('field');
    const c = holds.hold('field');
    await settle();
    gates[0].open();
    await settle();
    gates[1].open();
    await settle();
    gates[2].open();
    await Promise.all([a, b, c]);
    expect(calls).toEqual([
      'take:start', 'take:end', 'give:start:true', 'give:end:true', 'take:start', 'take:end',
    ]);
    expect(holds.held).toBe(true);
  });

  it('lets a drop wait for the take in progress, then gives without restoring', async () => {
    const { holds, calls, gates } = setup({ slow: true });
    const holding = holds.hold('field');
    const dropping = holds.drop();
    await settle();
    expect(calls).toEqual(['take:start']);
    gates[0].open();
    await settle();
    gates[1].open();
    await Promise.all([holding, dropping]);
    expect(calls).toEqual(['take:start', 'take:end', 'give:start:false', 'give:end:false']);
    expect(holds.held).toBe(false);
  });

  it('reports a change of `held` only when it flips', async () => {
    const { holds, changes } = setup();
    await holds.hold('field');
    await holds.hold('dialog');
    await holds.release('dialog');
    expect(changes).toEqual([true]);
    await holds.release('field');
    expect(changes).toEqual([true, false]);
  });

  it('forgets the holder when the take failed, so the next holder tries again and the queue goes on', async () => {
    const failing = setup({ failTake: true });
    await expect(failing.holds.hold('field')).rejects.toThrow('take failed');
    expect(failing.holds.held).toBe(false);
    expect(failing.changes).toEqual([true, false]);
    await expect(failing.holds.hold('field')).rejects.toThrow('take failed');
    expect(failing.calls).toEqual(['take:start', 'take:start']);
  });

  it('counts the keyboard as given when the give failed, and the queue goes on', async () => {
    const { holds, calls } = setup({ failGive: true });
    await holds.hold('field');
    await expect(holds.release('field')).rejects.toThrow('give failed');
    expect(holds.held).toBe(false);
    await holds.hold('field');
    expect(calls.filter((c) => c === 'take:start')).toHaveLength(2);
  });
});
