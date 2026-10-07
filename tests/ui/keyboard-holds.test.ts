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
  /** Each effect waits for the matching gate before it finishes. */
  slow?: boolean;
  failTake?: boolean;
  failGive?: boolean;
  failArm?: boolean;
  failDisarm?: boolean;
  /**
   * How long after a take or give a focus loss is still taken for the echo of our own focus juggling, and how long
   * after a disarm a press next to a field is still looked at.
   */
  settleMs?: number;
}

function setup(options: Options = {}) {
  const clock = { t: 0 };
  const calls: string[] = [];
  const gates: Gate[] = [];
  /**
   * What Windows answers; a test changes it. `foreground`: "is the overlay the foreground window". `refusals`: how
   * many of the next takes it refuses (the overlay is not brought to the front); after those it agrees. `restores`:
   * whether a give that hands the focus back gets it to the remembered window (it may be gone, Windows may refuse).
   */
  const windows = { foreground: false, refusals: 0, restores: true };
  const wait = async (): Promise<void> => {
    if (!options.slow) return;
    const g = gate();
    gates.push(g);
    await g.promise;
  };
  const effects: HoldEffects = {
    async arm() {
      calls.push('arm:start');
      await wait();
      if (options.failArm) throw new Error('arm failed');
      calls.push('arm:end');
    },
    async disarm() {
      calls.push('disarm:start');
      await wait();
      if (options.failDisarm) throw new Error('disarm failed');
      calls.push('disarm:end');
    },
    async take() {
      calls.push('take:start');
      await wait();
      if (options.failTake) throw new Error('take failed');
      if (windows.refusals > 0) {
        windows.refusals--;
        calls.push('take:refused');
        return false;
      }
      calls.push('take:end');
      return true;
    },
    async give(restore) {
      calls.push(`give:start:${restore}`);
      await wait();
      if (options.failGive) throw new Error('give failed');
      calls.push(`give:end:${restore}`);
      return restore && windows.restores;
    },
    async remember() {
      calls.push('remember:start');
      await wait();
      calls.push('remember:end');
    },
    async isForeground() {
      calls.push(`foreground?:${windows.foreground}`);
      return windows.foreground;
    },
  };
  const changes: boolean[] = [];
  /** The waits the holds have asked for and that are still running; `pass()` ends the oldest one (the clock moves with it). */
  const waits: Array<{ ms: number; pass: () => void }> = [];
  const holds = createKeyboardHolds(effects, (held) => changes.push(held), {
    settleMs: options.settleMs ?? 0,
    now: () => clock.t,
    wait: (ms) =>
      new Promise<void>((resolve) => {
        waits.push({
          ms,
          pass: () => {
            clock.t += ms;
            resolve();
          },
        });
      }),
  });
  return { holds, calls, changes, gates, clock, windows, waits };
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

  it('ignores a drop that is issued while a take is in progress: the holder that is being taken stays', async () => {
    const { holds, calls, gates } = setup({ slow: true });
    const holding = holds.hold('field');
    await settle();
    const dropped = holds.drop(); // the blur that comes with taking the focus is not the player
    await settle();
    expect(calls).toEqual(['take:start']);
    gates[0].open();
    await Promise.all([holding, dropped]);
    expect(await dropped).toBe(false);
    expect(calls).toEqual(['take:start', 'take:end']);
    expect(holds.held).toBe(true);
  });

  it('ignores a drop that is issued right behind a take that has not started yet', async () => {
    const { holds, calls } = setup();
    const holding = holds.hold('field');
    const dropped = holds.drop(); // decided when it is called, not when the queue reaches it
    await Promise.all([holding, dropped]);
    expect(await dropped).toBe(false);
    expect(calls).toEqual(['take:start', 'take:end']);
    expect(holds.held).toBe(true);
  });

  it('says whether it dropped: true when the holders were dropped, false when it was ignored or there were none', async () => {
    const { holds } = setup();
    expect(await holds.drop()).toBe(false);
    await holds.hold('field');
    expect(await holds.drop()).toBe(true);
    expect(holds.held).toBe(false);
  });

  describe('the echo of our own focus juggling', () => {
    const SETTLE = 500;

    it('click, Esc, click: the late blur of the first give does not drop the second hold, whenever it arrives', async () => {
      for (const arrivesAfter of [0, 40, 300, 499]) {
        const { holds, calls, clock } = setup({ settleMs: SETTLE });
        await holds.hold('field'); // click
        clock.t = 100;
        await holds.release('field'); // Esc: give, the blur it causes is on its way
        clock.t = 130;
        await holds.hold('field'); // click again
        clock.t = 130 + arrivesAfter;
        expect(await holds.drop(), `arrives ${arrivesAfter} ms after the take`).toBe(false); // the blur of the give arrives
        expect(holds.held, `arrives ${arrivesAfter} ms after the take`).toBe(true);
        expect(calls).toEqual(['take:start', 'take:end', 'give:start:true', 'give:end:true', 'take:start', 'take:end']);
      }
    });

    it('a late blur after a give does not drop the hold that is taken next', async () => {
      const { holds, clock } = setup({ settleMs: SETTLE });
      await holds.hold('field');
      clock.t = 100;
      await holds.release('field');
      clock.t = 400; // the blur of the give has not arrived yet; the player clicks a field
      await holds.hold('field');
      clock.t = 450; // now it arrives
      expect(await holds.drop()).toBe(false);
      expect(holds.held).toBe(true);
    });

    it('a blur after a take, when a settle time has passed, is the player: the holders are dropped without handing the focus back', async () => {
      const { holds, calls, clock } = setup({ settleMs: SETTLE });
      await holds.hold('field');
      clock.t = 5000; // long after the take
      expect(await holds.drop()).toBe(true);
      expect(holds.held).toBe(false);
      expect(calls).toEqual(['take:start', 'take:end', 'give:start:false', 'give:end:false']);
    });

    it('the settle time is counted from the end of the last take or give, not from its start', async () => {
      const { holds, clock, gates } = setup({ settleMs: SETTLE, slow: true });
      const holding = holds.hold('field');
      await settle();
      clock.t = 2000; // the take was slow
      gates[0].open();
      await holding;
      clock.t = 2400; // 400 ms after the take ended
      expect(await holds.drop()).toBe(false);
      clock.t = 2500; // exactly the settle time
      const dropping = holds.drop();
      await settle();
      gates[1].open(); // the give(false) of the drop
      expect(await dropping).toBe(true);
    });

    it('a request that changes nothing does not start a settle time', async () => {
      const { holds, clock } = setup({ settleMs: SETTLE });
      await holds.hold('field');
      clock.t = 5000;
      await holds.hold('field'); // already held
      await holds.release('dialog'); // not a holder
      expect(await holds.drop()).toBe(true);
    });
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

// The window is activated by the player's own click: while the pointer is over a text field the window is
// activatable ("armed"), so the press activates it the way Windows activates any window, with no request from us.
describe('the pointer over a text field', () => {
  it('starts idle: nothing is armed, nobody holds the keyboard', () => {
    const { holds, calls } = setup();
    expect(holds.state).toBe('idle');
    expect(holds.held).toBe(false);
    expect(calls).toEqual([]);
  });

  it('arms the window when the pointer comes over a field, and disarms it when the pointer leaves without a press', async () => {
    const { holds, calls, changes } = setup();
    await holds.pointerOverField(true);
    expect(calls).toEqual(['arm:start', 'arm:end']);
    expect(holds.state).toBe('armed');
    expect(holds.held).toBe(false);

    await holds.pointerOverField(false);
    expect(calls).toEqual(['arm:start', 'arm:end', 'disarm:start', 'disarm:end']);
    expect(holds.state).toBe('idle');
    // nobody took the keyboard, so nothing is given back and nobody is told
    expect(calls.some((c) => c.startsWith('give'))).toBe(false);
    expect(changes).toEqual([]);
  });

  it('does nothing when it is told the same thing again', async () => {
    const { holds, calls } = setup();
    await holds.pointerOverField(false);
    expect(calls).toEqual([]);
    await holds.pointerOverField(true);
    await holds.pointerOverField(true);
    expect(calls).toEqual(['arm:start', 'arm:end']);
    await holds.pointerOverField(false);
    await holds.pointerOverField(false);
    expect(calls).toEqual(['arm:start', 'arm:end', 'disarm:start', 'disarm:end']);
  });

  it('a press on the field of an armed window takes the keyboard: the take follows the arm, with no disarm between', async () => {
    const { holds, calls, changes } = setup();
    await holds.pointerOverField(true);
    await holds.hold('field');
    expect(calls).toEqual(['arm:start', 'arm:end', 'take:start', 'take:end']);
    expect(holds.state).toBe('held');
    expect(changes).toEqual([true]);
  });

  it('a press that comes before the pointer was seen over the field (touch, pen) takes the keyboard all the same', async () => {
    const { holds, calls } = setup();
    await holds.hold('field');
    expect(calls).toEqual(['take:start', 'take:end']);
    expect(holds.state).toBe('held');
  });

  it('a press that overtakes its own arm waits for it: arm, then take, never the two at once', async () => {
    const { holds, calls, gates } = setup({ slow: true });
    const arming = holds.pointerOverField(true);
    const holding = holds.hold('field');
    await settle();
    expect(calls).toEqual(['arm:start']);
    gates[0].open();
    await settle();
    expect(calls).toEqual(['arm:start', 'arm:end', 'take:start']);
    gates[1].open();
    await Promise.all([arming, holding]);
    expect(holds.state).toBe('held');
  });

  it('while somebody holds the keyboard the pointer coming and going changes nothing', async () => {
    const { holds, calls } = setup();
    await holds.hold('field');
    await holds.pointerOverField(true);
    await holds.pointerOverField(false);
    await holds.pointerOverField(true);
    expect(calls).toEqual(['take:start', 'take:end']);
    expect(holds.state).toBe('held');
  });

  it('after the last release the window is armed again when the pointer is still over a field', async () => {
    const { holds, calls, changes } = setup();
    await holds.pointerOverField(true);
    await holds.hold('field');
    await holds.release('field'); // Esc; the pointer has not moved
    expect(calls).toEqual([
      'arm:start', 'arm:end', 'take:start', 'take:end', 'give:start:true', 'give:end:true', 'arm:start', 'arm:end',
    ]);
    expect(holds.state).toBe('armed');
    expect(changes).toEqual([true, false]);
    // so the next press on the same field finds the window activatable
    await holds.hold('field');
    expect(calls.slice(8)).toEqual(['take:start', 'take:end']);
  });

  it('after the last release the window stays not activatable when the pointer has left the field', async () => {
    const { holds, calls } = setup();
    await holds.pointerOverField(true);
    await holds.hold('field');
    await holds.pointerOverField(false);
    await holds.release('field');
    expect(calls).toEqual(['arm:start', 'arm:end', 'take:start', 'take:end', 'give:start:true', 'give:end:true']);
    expect(holds.state).toBe('idle');
  });

  it('a pointer that came over a field while the keyboard was held arms the window after the release', async () => {
    const { holds, calls } = setup();
    await holds.hold('field'); // a press with no pointer seen before it
    await holds.pointerOverField(true);
    await holds.release('field');
    expect(calls.slice(-4)).toEqual(['give:start:true', 'give:end:true', 'arm:start', 'arm:end']);
    expect(holds.state).toBe('armed');
  });

  it('after a drop (the player went to the game) the window is not activatable, even with the pointer over a field', async () => {
    const { holds, calls } = setup();
    await holds.pointerOverField(true);
    await holds.hold('field');
    expect(await holds.drop()).toBe(true);
    expect(calls.slice(-2)).toEqual(['give:start:false', 'give:end:false']);
    expect(holds.state).toBe('idle');
    // the pointer leaves and comes back: the window is armed as usual
    await holds.pointerOverField(false);
    await holds.pointerOverField(true);
    expect(calls.slice(-2)).toEqual(['arm:start', 'arm:end']);
    expect(calls.filter((c) => c === 'disarm:start')).toHaveLength(0); // it was not armed, there was nothing to disarm
    expect(holds.state).toBe('armed');
  });

  it('a loss of the focus while the window is only armed drops nothing', async () => {
    const { holds, calls } = setup();
    await holds.pointerOverField(true);
    expect(await holds.drop()).toBe(false);
    expect(calls).toEqual(['arm:start', 'arm:end']);
    expect(holds.state).toBe('armed');
  });

  it('judges the pointer when its turn comes: a pointer that crossed a field while another request ran arms nothing', async () => {
    const { holds, calls, gates } = setup({ slow: true });
    const holding = holds.hold('field');
    await settle();
    const releasing = holds.release('field');
    const over = holds.pointerOverField(true);
    const away = holds.pointerOverField(false);
    gates[0].open(); // the take
    await settle();
    gates[1].open(); // the give
    await Promise.all([holding, releasing, over, away]);
    expect(calls).toEqual(['take:start', 'take:end', 'give:start:true', 'give:end:true']);
    expect(holds.state).toBe('idle');
  });

  it('arming and disarming move no focus: a pointer crossing the fields does not hide a real loss of the focus from drop', async () => {
    const { holds, clock } = setup({ settleMs: 500 });
    await holds.hold('field');
    clock.t = 5000;
    void holds.pointerOverField(true); // the pointer moves over the fields while one is edited
    void holds.pointerOverField(false);
    expect(await holds.drop()).toBe(true); // the player clicked the game at that very moment
  });

  it('a failed arm leaves the window not armed, and the next time the pointer comes it is tried again', async () => {
    const { holds, calls } = setup({ failArm: true });
    await expect(holds.pointerOverField(true)).rejects.toThrow('arm failed');
    expect(holds.state).toBe('idle');
    await holds.pointerOverField(false);
    expect(calls).toEqual(['arm:start']); // nothing was armed, so nothing is disarmed
    await expect(holds.pointerOverField(true)).rejects.toThrow('arm failed');
    expect(calls).toEqual(['arm:start', 'arm:start']);
  });

  it('a failed disarm still counts as disarmed, and the queue goes on', async () => {
    const { holds, calls } = setup({ failDisarm: true });
    await holds.pointerOverField(true);
    await expect(holds.pointerOverField(false)).rejects.toThrow('disarm failed');
    expect(holds.state).toBe('idle');
    await holds.hold('field');
    expect(calls.slice(-2)).toEqual(['take:start', 'take:end']);
  });

  it('a take that throws on an armed window leaves no holder and arms the window again under the pointer', async () => {
    const { holds, calls, changes } = setup({ failTake: true });
    await holds.pointerOverField(true);
    await expect(holds.hold('field')).rejects.toThrow('take failed');
    expect(holds.held).toBe(false);
    expect(changes).toEqual([true, false]);
    // the window layer has made the window not activatable (and handed the focus back); the pointer is still on the field
    expect(calls).toEqual(['arm:start', 'arm:end', 'take:start', 'arm:start', 'arm:end']);
    expect(holds.state).toBe('armed');
  });

  it('a take that throws with the pointer gone leaves the window idle', async () => {
    const { holds, calls } = setup({ failTake: true });
    await holds.pointerOverField(true);
    const holding = holds.hold('field');
    const leaving = holds.pointerOverField(false);
    await expect(holding).rejects.toThrow('take failed');
    await leaving;
    expect(calls).toEqual(['arm:start', 'arm:end', 'take:start']);
    expect(holds.state).toBe('idle');
  });

  it('a take that throws is the error the caller gets, even when arming again fails too', async () => {
    const { holds } = setup({ failTake: true, failArm: true });
    await expect(holds.pointerOverField(true)).rejects.toThrow('arm failed');
    await expect(holds.hold('field')).rejects.toThrow('take failed');
    expect(holds.state).toBe('idle');
  });

  it('a failed give is not followed by a new arm', async () => {
    const { holds, calls } = setup({ failGive: true });
    await holds.pointerOverField(true);
    await holds.hold('field');
    await expect(holds.release('field')).rejects.toThrow('give failed');
    expect(holds.state).toBe('idle');
    expect(calls.filter((c) => c === 'arm:start')).toHaveLength(1);
  });
});

// The window is armed, the pointer slides off the field and presses a button at once: the disarm has not reached
// Windows yet, the press activated the window, and nobody holds the keyboard. It must go back to the game.
describe('a press next to a field right after the window was armed', () => {
  const SETTLE = 500;

  it('asks Windows whether the window was activated and gives the keyboard back when it was', async () => {
    const { holds, calls, clock, windows } = setup({ settleMs: SETTLE });
    await holds.pointerOverField(true);
    clock.t = 100;
    await holds.pointerOverField(false);
    clock.t = 140;
    windows.foreground = true; // the press landed while the window was still activatable
    expect(await holds.pressOutsideField()).toBe('handed back');
    expect(calls.slice(4)).toEqual(['foreground?:true', 'give:start:true', 'give:end:true']);
    expect(holds.state).toBe('idle');
    expect(holds.held).toBe(false);
  });

  it('gives nothing back when Windows says the window was not activated', async () => {
    const { holds, calls, clock } = setup({ settleMs: SETTLE });
    await holds.pointerOverField(true);
    clock.t = 100;
    await holds.pointerOverField(false);
    clock.t = 140;
    expect(await holds.pressOutsideField()).toBe('none');
    expect(calls.slice(4)).toEqual(['foreground?:false']);
    expect(holds.state).toBe('idle');
  });

  it('asks whenever the press comes inside the settle time after the disarm, and never after it', async () => {
    for (const [after, asked] of [[0, true], [250, true], [499, true], [500, false], [5000, false]] as const) {
      const { holds, calls, clock } = setup({ settleMs: SETTLE });
      await holds.pointerOverField(true);
      clock.t = 100;
      await holds.pointerOverField(false);
      clock.t = 100 + after;
      await holds.pressOutsideField();
      expect(calls.some((c) => c.startsWith('foreground?')), `${after} ms after the disarm`).toBe(asked);
    }
  });

  it('counts the settle time from the end of the disarm, not from its start', async () => {
    const { holds, calls, clock, gates } = setup({ settleMs: SETTLE, slow: true });
    const arming = holds.pointerOverField(true);
    await settle();
    gates[0].open();
    await arming;
    const disarming = holds.pointerOverField(false);
    await settle();
    clock.t = 2000; // the disarm was slow
    gates[1].open();
    await disarming;
    clock.t = 2400;
    await holds.pressOutsideField();
    expect(calls.at(-1)).toBe('foreground?:false');
  });

  it('asks when the disarm is still on its way to Windows: the question waits for its turn behind it', async () => {
    const { holds, calls, gates, windows } = setup({ settleMs: SETTLE, slow: true });
    const arming = holds.pointerOverField(true);
    await settle();
    gates[0].open();
    await arming;
    windows.foreground = true;
    const disarming = holds.pointerOverField(false);
    const pressing = holds.pressOutsideField();
    await settle();
    expect(calls).toEqual(['arm:start', 'arm:end', 'disarm:start']);
    gates[1].open(); // the disarm
    await settle();
    expect(calls.slice(3)).toEqual(['disarm:end', 'foreground?:true', 'give:start:true']);
    gates[2].open(); // the give
    await disarming;
    expect(await pressing).toBe('handed back');
    expect(holds.state).toBe('idle');
  });

  it('asks while the disarm is running', async () => {
    const { holds, calls, gates, windows } = setup({ settleMs: SETTLE, slow: true });
    const arming = holds.pointerOverField(true);
    await settle();
    gates[0].open();
    await arming;
    const disarming = holds.pointerOverField(false);
    await settle();
    expect(calls.at(-1)).toBe('disarm:start');
    windows.foreground = true;
    const pressing = holds.pressOutsideField();
    gates[1].open();
    await settle();
    expect(calls.slice(3)).toEqual(['disarm:end', 'foreground?:true', 'give:start:true']);
    gates[2].open();
    await disarming;
    expect(await pressing).toBe('handed back');
  });

  it('asks while the window is still armed (the pointer was not seen leaving the field)', async () => {
    const { holds, calls, windows } = setup({ settleMs: SETTLE });
    await holds.pointerOverField(true);
    windows.foreground = true;
    expect(await holds.pressOutsideField()).toBe('handed back');
    // the keyboard went back; the pointer still counts as over a field, so the window is armed again
    expect(calls.slice(2)).toEqual(['foreground?:true', 'give:start:true', 'give:end:true', 'arm:start', 'arm:end']);
    expect(holds.state).toBe('armed');
  });

  it('makes no request at all when the window was not armed lately: plain clicks on buttons cost nothing', async () => {
    const { holds, calls, clock } = setup({ settleMs: SETTLE });
    expect(await holds.pressOutsideField()).toBe('none');
    await holds.pointerOverField(true);
    clock.t = 100;
    await holds.pointerOverField(false);
    clock.t = 1000;
    expect(await holds.pressOutsideField()).toBe('none');
    expect(await holds.pressOutsideField()).toBe('none');
    expect(calls).toEqual(['arm:start', 'arm:end', 'disarm:start', 'disarm:end']);
  });

  it('makes no request while somebody holds the keyboard: the window is active because it is wanted', async () => {
    const { holds, calls, windows } = setup({ settleMs: SETTLE });
    await holds.pointerOverField(true);
    await holds.hold('field');
    windows.foreground = true;
    expect(await holds.pressOutsideField()).toBe('none');
    expect(calls).toEqual(['arm:start', 'arm:end', 'take:start', 'take:end']);
    expect(holds.held).toBe(true);
  });

  it('gives nothing back when a field was pressed before its turn came', async () => {
    const { holds, calls, gates, windows } = setup({ settleMs: SETTLE, slow: true });
    windows.foreground = true;
    const arming = holds.pointerOverField(true);
    await settle(); // the arm is running
    const holding = holds.hold('field'); // waits behind the arm
    const pressing = holds.pressOutsideField(); // judged now (armed, nobody holds yet): waits behind the hold
    gates[0].open(); // the arm
    await settle();
    gates[1].open(); // the take
    await Promise.all([arming, holding]);
    expect(await pressing).toBe('none');
    expect(calls).toEqual(['arm:start', 'arm:end', 'take:start', 'take:end']);
    expect(holds.held).toBe(true);
  });

  it('with no settle time only a window that is still armed is looked at', async () => {
    const { holds, calls, windows } = setup(); // settleMs: 0
    windows.foreground = true;
    await holds.pointerOverField(true);
    await holds.pointerOverField(false);
    expect(await holds.pressOutsideField()).toBe('none');
    expect(calls).toEqual(['arm:start', 'arm:end', 'disarm:start', 'disarm:end']);
  });
});

// A press that Windows did not turn into an activation (the window was not armed in time: touch, a pen, a press faster
// than the arm) asks Windows once, and Windows may refuse. Nothing was taken then, so nobody holds anything: a holder
// that stayed would keep the window activatable with the game in front, show a caret in a field whose keys go to the
// game, and switch off the check that hands a stray activation back.
describe('a take that Windows refuses', () => {
  it('leaves no holder, and `hold` says that the keyboard was not taken', async () => {
    const { holds, calls, changes, windows } = setup();
    windows.refusals = 1;
    expect(await holds.hold('field')).toBe(false);
    expect(holds.held).toBe(false);
    expect(changes).toEqual([true, false]);
    expect(calls.slice(0, 2)).toEqual(['take:start', 'take:refused']);
    // nothing was taken, so nothing is given back
    expect(calls.some((c) => c.startsWith('give'))).toBe(false);
  });

  it('`hold` says yes when the keyboard is held: after the take, for another holder, for the same one again', async () => {
    const { holds } = setup();
    expect(await holds.hold('field')).toBe(true);
    expect(await holds.hold('dialog')).toBe(true);
    expect(await holds.hold('field')).toBe(true);
  });

  it('with the pointer still on the field the window stays armed: the take has made it activatable, the next press activates it', async () => {
    const { holds, calls, windows } = setup();
    windows.refusals = 1;
    const holding = holds.hold('field'); // a press with no pointer seen before it
    const over = holds.pointerOverField(true); // the page says where the pointer is right after the press
    expect(await holding).toBe(false);
    await over;
    expect(holds.state).toBe('armed');
    // no arm of its own and no disarm: the window is activatable already, and it stays so
    expect(calls).toEqual(['take:start', 'take:refused']);
    // the second press activates the window by itself: Windows has nothing to refuse
    expect(await holds.hold('field')).toBe(true);
    expect(calls.slice(2)).toEqual(['take:start', 'take:end']);
    expect(holds.state).toBe('held');
  });

  it('with the pointer gone the window is disarmed: it must not stay activatable with nobody holding the keyboard', async () => {
    const { holds, calls, windows } = setup();
    windows.refusals = 1;
    expect(await holds.hold('field')).toBe(false);
    expect(calls).toEqual(['take:start', 'take:refused', 'disarm:start', 'disarm:end']);
    expect(holds.state).toBe('idle');
  });

  it('on a window that was armed: it stays armed, with nothing sent to Windows', async () => {
    const { holds, calls, windows } = setup();
    await holds.pointerOverField(true);
    windows.refusals = 1;
    expect(await holds.hold('field')).toBe(false);
    expect(calls).toEqual(['arm:start', 'arm:end', 'take:start', 'take:refused']);
    expect(holds.state).toBe('armed');
    // the pointer leaves: the usual disarm
    await holds.pointerOverField(false);
    expect(calls.slice(4)).toEqual(['disarm:start', 'disarm:end']);
    expect(holds.state).toBe('idle');
  });

  it('two quick presses: the first is refused, the second waits for its turn and takes the keyboard', async () => {
    const { holds, calls, gates, windows, changes } = setup({ slow: true });
    windows.refusals = 1;
    const first = holds.hold('field');
    const over = holds.pointerOverField(true);
    const second = holds.hold('field'); // pressed while the first take is still on its way
    await settle();
    expect(calls).toEqual(['take:start']);
    gates[0].open();
    expect(await first).toBe(false);
    await settle();
    // the second press is a take of its own, not "already held": the holder of the first is gone
    expect(calls).toEqual(['take:start', 'take:refused', 'take:start']);
    expect(holds.held).toBe(true); // it holds from the moment its turn came
    gates[1].open();
    expect(await second).toBe(true);
    await over;
    expect(changes).toEqual([true, false, true]);
    expect(holds.state).toBe('held');
  });

  it('a press next to a field is looked at again after a refusal: no holder is in its way', async () => {
    const { holds, calls, clock, windows } = setup({ settleMs: 500 });
    windows.refusals = 1;
    await holds.hold('field'); // refused, the pointer is not on a field: disarmed at t = 0
    clock.t = 100;
    windows.foreground = true; // a press on a button landed before the disarm reached Windows
    expect(await holds.pressOutsideField()).toBe('handed back');
    expect(calls.slice(-3)).toEqual(['foreground?:true', 'give:start:true', 'give:end:true']);
  });

  it('a loss of the focus right after a refusal drops nothing: there is nothing to drop', async () => {
    const { holds, windows } = setup({ settleMs: 500 });
    windows.refusals = 1;
    await holds.hold('field');
    expect(await holds.drop()).toBe(false);
  });
});

// Windows activates an activatable window with no press of the player on it: the foreground window closes or is
// minimised while the pointer rests on a field, Alt+Tab passes over it. Nobody holds the keyboard then and no press
// follows that would notice, so the event of the window itself ("I got the focus") is what starts the look.
describe('the window says it got the focus', () => {
  const SETTLE = 500;

  it('armed, and no press on a field follows: after the settle time Windows is asked, and the keyboard is handed back', async () => {
    const { holds, calls, waits, windows } = setup({ settleMs: SETTLE });
    await holds.pointerOverField(true);
    windows.foreground = true; // the game was closed: Windows made the overlay the foreground window
    const looking = holds.focusGained();
    await settle();
    expect(waits.map((w) => w.ms)).toEqual([SETTLE]);
    expect(calls).toEqual(['arm:start', 'arm:end']); // nothing is asked before the time is over
    waits[0].pass();
    expect(await looking).toBe('handed back');
    // the pointer still rests on the field, so the window is armed again once the keyboard is back
    expect(calls.slice(2)).toEqual(['foreground?:true', 'give:start:true', 'give:end:true', 'arm:start', 'arm:end']);
    expect(holds.state).toBe('armed');
  });

  it('gives nothing back when Windows says the window is not in front: the web view reports a focus without an activation too', async () => {
    const { holds, calls, waits } = setup({ settleMs: SETTLE });
    await holds.pointerOverField(true);
    const looking = holds.focusGained();
    await settle();
    waits[0].pass();
    expect(await looking).toBe('none');
    expect(calls.slice(2)).toEqual(['foreground?:false']);
    expect(holds.state).toBe('armed');
  });

  it('costs nothing for a window that cannot be activated: no wait, no question (a plain click on a button)', async () => {
    const { holds, calls, waits, clock } = setup({ settleMs: SETTLE });
    expect(await holds.focusGained()).toBe('none');
    await holds.pointerOverField(true);
    clock.t = 100;
    await holds.pointerOverField(false);
    clock.t = 100 + SETTLE; // long enough after the disarm
    expect(await holds.focusGained()).toBe('none');
    expect(waits).toEqual([]);
    expect(calls).toEqual(['arm:start', 'arm:end', 'disarm:start', 'disarm:end']);
  });

  it('looks when the window was disarmed a moment ago: the disarm may not have reached Windows in time', async () => {
    const { holds, calls, waits, clock, windows } = setup({ settleMs: SETTLE });
    await holds.pointerOverField(true);
    clock.t = 100;
    await holds.pointerOverField(false);
    clock.t = 300;
    windows.foreground = true;
    const looking = holds.focusGained();
    await settle();
    waits[0].pass();
    expect(await looking).toBe('handed back');
    expect(calls.slice(4)).toEqual(['foreground?:true', 'give:start:true', 'give:end:true']);
    expect(holds.state).toBe('idle');
  });

  it('is the echo of a press on a field when the holder comes within the settle time: nothing is asked', async () => {
    const { holds, calls, waits, windows } = setup({ settleMs: SETTLE });
    await holds.pointerOverField(true);
    windows.foreground = true; // the press activated the window; its event came before the page heard of the press
    const looking = holds.focusGained();
    await holds.hold('field');
    waits[0].pass();
    expect(await looking).toBe('none');
    expect(calls).toEqual(['arm:start', 'arm:end', 'take:start', 'take:end']);
    expect(holds.held).toBe(true);
  });

  it('needs no look when somebody holds the keyboard already', async () => {
    const { holds, waits, windows } = setup({ settleMs: SETTLE });
    await holds.pointerOverField(true);
    await holds.hold('field');
    windows.foreground = true;
    expect(await holds.focusGained()).toBe('none');
    expect(waits).toEqual([]);
  });

  it('asks nothing while a request is still on its way when the time is over: that request decides', async () => {
    const { holds, calls, waits, gates, windows } = setup({ settleMs: SETTLE, slow: true });
    const arming = holds.pointerOverField(true);
    await settle();
    gates[0].open();
    await arming;
    windows.foreground = true;
    const looking = holds.focusGained();
    await settle();
    windows.refusals = 1;
    const holding = holds.hold('field'); // a slow take
    await settle();
    waits[0].pass();
    expect(await looking).toBe('none');
    expect(calls.some((c) => c.startsWith('foreground?'))).toBe(false);
    gates[1].open();
    await holding;
  });

  it('a second event while the first is still waiting starts no second look', async () => {
    const { holds, calls, waits, windows } = setup({ settleMs: SETTLE });
    await holds.pointerOverField(true);
    windows.foreground = true;
    const first = holds.focusGained();
    const second = holds.focusGained();
    await settle();
    expect(waits).toHaveLength(1);
    expect(await second).toBe('none');
    waits[0].pass();
    expect(await first).toBe('handed back');
    expect(calls.filter((c) => c.startsWith('foreground?'))).toHaveLength(1);
    // and once that look is over, the next event is looked at again
    const third = holds.focusGained();
    await settle();
    expect(waits).toHaveLength(2);
    waits[1].pass();
    await third;
  });

  it('with no settle time it looks at once, and only at a window that is armed', async () => {
    const { holds, calls, waits, windows } = setup(); // settleMs: 0
    windows.foreground = true;
    expect(await holds.focusGained()).toBe('none');
    await holds.pointerOverField(true);
    const looking = holds.focusGained();
    await settle();
    waits[0].pass();
    expect(await looking).toBe('handed back');
    expect(calls.slice(2, 5)).toEqual(['foreground?:true', 'give:start:true', 'give:end:true']);
  });
});

// "The keyboard went back to the game" is only true when it did: the remembered window may be gone (the game was
// closed: that is why Windows activated the overlay), or Windows may refuse to bring it to the front.
describe('an activation nobody asked for that cannot be handed back', () => {
  const SETTLE = 500;

  it('after a press next to a field: the window is made not activatable, and the answer says the focus did not go back', async () => {
    const { holds, calls, clock, windows } = setup({ settleMs: SETTLE });
    await holds.pointerOverField(true);
    clock.t = 100;
    await holds.pointerOverField(false);
    windows.foreground = true;
    windows.restores = false;
    expect(await holds.pressOutsideField()).toBe('not handed back');
    expect(calls.slice(4)).toEqual(['foreground?:true', 'give:start:true', 'give:end:true']);
    expect(holds.state).toBe('idle');
  });

  it('after the window said it got the focus: the same answer', async () => {
    const { holds, waits, windows } = setup({ settleMs: SETTLE });
    await holds.pointerOverField(true);
    windows.foreground = true;
    windows.restores = false;
    const looking = holds.focusGained();
    await settle();
    waits[0].pass();
    expect(await looking).toBe('not handed back');
  });
});

// The game window is remembered when the pointer comes over a field. While the pointer rests there the foreground
// window may change (the player switches to another program with the keyboard): `Esc` must give the focus to the
// window that had it last, not to the one of a minute ago.
describe('the remembered window while the window is armed', () => {
  it('is remembered again on request, and only while the window is armed', async () => {
    const { holds, calls } = setup();
    await holds.refreshRemembered(); // idle: nothing can take the focus, nothing to keep fresh
    expect(calls).toEqual([]);
    await holds.pointerOverField(true);
    await holds.refreshRemembered();
    await holds.refreshRemembered();
    expect(calls.slice(2)).toEqual(['remember:start', 'remember:end', 'remember:start', 'remember:end']);
    expect(holds.state).toBe('armed');
    await holds.hold('field');
    await holds.refreshRemembered(); // held: the foreground window is our own
    expect(calls.slice(6)).toEqual(['take:start', 'take:end']);
    await holds.release('field');
    await holds.pointerOverField(false);
    const before = calls.length;
    await holds.refreshRemembered();
    expect(calls).toHaveLength(before);
  });

  it('waits for its turn like every request, and is judged when the turn comes', async () => {
    const { holds, calls, gates } = setup({ slow: true });
    const arming = holds.pointerOverField(true);
    await settle(); // the arm is running: the window counts as armed
    const refreshing = holds.refreshRemembered();
    const leaving = holds.pointerOverField(false);
    await settle();
    expect(calls).toEqual(['arm:start']);
    gates[0].open(); // the arm
    await settle();
    expect(calls).toEqual(['arm:start', 'arm:end', 'remember:start']);
    gates[1].open(); // the refresh
    await settle();
    gates[2].open(); // the disarm
    await Promise.all([arming, refreshing, leaving]);
    expect(calls.slice(3)).toEqual(['remember:end', 'disarm:start', 'disarm:end']);

    // asked while armed, but a press took the keyboard before its turn: nothing is remembered
    const again = holds.pointerOverField(true);
    await settle();
    const holding = holds.hold('field');
    const late = holds.refreshRemembered();
    gates[3].open(); // the arm
    await settle();
    gates[4].open(); // the take
    await Promise.all([again, holding, late]);
    expect(calls.slice(6)).toEqual(['arm:start', 'arm:end', 'take:start', 'take:end']);
  });

  it('moves no focus: it does not hide a real loss of the focus from drop', async () => {
    const { holds, clock } = setup({ settleMs: 500 });
    await holds.pointerOverField(true);
    void holds.refreshRemembered();
    await holds.hold('field');
    clock.t = 5000;
    expect(await holds.drop()).toBe(true);
  });
});
