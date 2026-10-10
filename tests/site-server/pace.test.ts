import { describe, expect, it } from 'vitest';
import { createPace } from '../../site/server/src/pace.mjs';

// The least rate a body must arrive at. A sender that only keeps the line alive — a byte now and then — must not
// keep one of the few places the form has: after the first five seconds every five seconds of listening have to
// bring 80 KB (16 KB a second), or the body is ended. Judged here with a clock of the test: no real time passes.

const KB = 1024;
const WINDOW = 5000;
const LEAST = 80 * KB;

/** A clock and its timers, moved by the test. */
function fakeClock() {
  let time = 0;
  let last = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => time,
    set: (fn: () => void, ms: number) => {
      timers.set(++last, { at: time + ms, fn });
      return last;
    },
    clear: (timer: unknown) => void timers.delete(timer as number),
    /** Moves the time on by so many milliseconds; what falls due on the way is done, in its order, at its moment. */
    advance(ms: number) {
      const end = time + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (due === undefined) break;
        timers.delete(due[0]);
        time = due[1].at;
        due[1].fn();
      }
      time = end;
    },
    waiting: () => timers.size,
  };
}

/** A body that has just begun to be read. */
function body() {
  const clock = fakeClock();
  const cut: number[] = [];
  const pace = createPace({ windowMs: WINDOW, minBytes: LEAST, onSlow: () => cut.push(clock.now()), clock });
  pace.start();
  return { clock, pace, cut };
}

describe('the least rate of a body', () => {
  it('a trickle is cut at the end of the first window that brings too little — a byte every fourteen seconds, or every second', () => {
    // the head of a form, then one byte every fourteen seconds: enough to look alive for ever
    const slow = body();
    slow.pace.took(400);
    slow.clock.advance(4999);
    expect(slow.cut).toEqual([]);
    // the first five seconds ask for nothing
    slow.clock.advance(1);
    expect(slow.cut).toEqual([]);
    slow.clock.advance(4999);
    expect(slow.cut).toEqual([]);
    slow.clock.advance(1);
    // ten seconds after it began: the first window that had to bring something brought nothing
    expect(slow.cut).toEqual([10_000]);
    // said once, and nothing is left running
    slow.pace.took(1);
    slow.clock.advance(60_000);
    expect(slow.cut).toEqual([10_000]);
    expect(slow.clock.waiting()).toBe(0);

    const drip = body();
    for (let second = 0; second < 20 && drip.cut.length === 0; second++) {
      drip.pace.took(1);
      drip.clock.advance(1000);
    }
    expect(drip.cut).toEqual([10_000]);
  });

  it('a body at 20 KB a second goes through, however long it takes', () => {
    const steady = body();
    // a full message of 18 MB at that rate takes fifteen minutes
    for (let second = 0; second < 15 * 60; second++) {
      steady.pace.took(20 * KB);
      steady.clock.advance(1000);
    }
    expect(steady.cut).toEqual([]);
    steady.pace.stop();
    expect(steady.clock.waiting()).toBe(0);
  });

  it('the very rate is enough; a byte less in one window is not', () => {
    const exact = body();
    exact.clock.advance(WINDOW);
    for (let window = 0; window < 10; window++) {
      exact.pace.took(LEAST);
      exact.clock.advance(WINDOW);
    }
    expect(exact.cut).toEqual([]);
    exact.pace.took(LEAST - 1);
    exact.clock.advance(WINDOW);
    expect(exact.cut).toEqual([WINDOW * 12]);
  });

  it('what came in the first five seconds does not pay for the window after them', () => {
    const burst = body();
    burst.clock.advance(1000);
    burst.pace.took(10 * 1024 * KB);
    burst.clock.advance(8999);
    expect(burst.cut).toEqual([]);
    burst.clock.advance(1);
    expect(burst.cut).toEqual([10_000]);
  });

  it('the time the service itself made the sender wait is not counted against the sender', () => {
    // a big body: the disk is behind, the service stops reading for a whole minute
    const big = body();
    big.clock.advance(6000);
    big.pace.took(50 * KB);
    big.pace.pause();
    expect(big.clock.waiting()).toBe(0);
    big.clock.advance(60_000);
    expect(big.cut).toEqual([]);
    // it reads again: the window goes on where it stopped, with the four seconds it had left
    big.pace.resume();
    big.clock.advance(1000);
    big.pace.took(40 * KB);
    big.clock.advance(2999);
    expect(big.cut).toEqual([]);
    big.clock.advance(1);
    // 90 KB in that window: enough. The next one brings nothing
    expect(big.cut).toEqual([]);
    big.clock.advance(4999);
    expect(big.cut).toEqual([]);
    big.clock.advance(1);
    expect(big.cut).toEqual([75_000]);

    // the wait does not excuse a sender that is slow while it is listened to
    const slow = body();
    slow.clock.advance(6000);
    slow.pace.took(50 * KB);
    slow.pace.pause();
    slow.clock.advance(60_000);
    slow.pace.resume();
    slow.clock.advance(3999);
    expect(slow.cut).toEqual([]);
    slow.clock.advance(1);
    expect(slow.cut).toEqual([70_000]);

    // a wait within the first five seconds: they are five seconds of listening as well
    const early = body();
    early.clock.advance(2000);
    early.pace.pause();
    early.pace.pause();
    early.clock.advance(100_000);
    early.pace.resume();
    early.pace.resume();
    early.clock.advance(7999);
    expect(early.cut).toEqual([]);
    early.clock.advance(1);
    expect(early.cut).toEqual([110_000]);
  });

  it('asks nothing of a body that has ended', () => {
    const done = body();
    done.pace.took(300);
    done.clock.advance(7000);
    done.pace.stop();
    expect(done.clock.waiting()).toBe(0);
    // whatever is called after the end starts nothing again
    done.pace.resume();
    done.pace.pause();
    done.pace.took(1);
    done.pace.start();
    done.clock.advance(600_000);
    expect(done.cut).toEqual([]);
    expect(done.clock.waiting()).toBe(0);
  });

  it('runs by the clock of the machine when it is given none', async () => {
    let cut = 0;
    const pace = createPace({ windowMs: 30, minBytes: 10, onSlow: () => cut++ });
    pace.start();
    pace.took(5);
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(cut).toBe(1);
    // and a body that ends leaves no timer behind
    const other = createPace({ windowMs: 30, minBytes: 10, onSlow: () => cut++ });
    other.start();
    other.stop();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(cut).toBe(1);
  });
});
