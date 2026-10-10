// The least rate a body must arrive at.
//
// The form has a few places for bodies that are being read (config.mjs: uploadsAtOnce). A sender that only keeps
// its line alive — a byte now and then — would hold a place for as long as a request may take, and a handful of
// such senders would close the form to everybody. So a body is not asked merely to show a sign of life: after a
// first stretch that asks for nothing, every stretch of the same length has to bring a least number of bytes. The
// first stretch that brings less ends the body.
//
// Only the time the service spends LISTENING is counted. While the service itself has asked the sender to wait
// (the disk is behind), the clock stands still: a big body on a slow disk is not the sender's fault.

/**
 * A clock and its timers. The service uses the ones of the machine; a test brings its own.
 * @typedef {{ now: () => number, set: (fn: () => void, ms: number) => unknown, clear: (timer: unknown) => void }} Clock
 */

/** The clock of the machine: one that only runs forward, whatever is done to the time of the system. @type {Clock} */
const MACHINE = {
  now: () => performance.now(),
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (timer) => clearTimeout(/** @type {NodeJS.Timeout | undefined} */ (timer)),
};

/**
 * @param {{ windowMs: number, minBytes: number, onSlow: () => void, clock?: Clock }} options `windowMs`: the length of
 *   the first stretch, which asks for nothing, and of every stretch after it; `minBytes`: what each of those must
 *   bring; `onSlow`: called once, when a stretch has ended with less
 */
export function createPace({ windowMs, minBytes, onSlow, clock = MACHINE }) {
  /** 'idle' before the body, 'on' while the clock runs, 'held' while the service makes the sender wait, 'over'. */
  let state = 'idle';
  /** Is the stretch that is running the first one, which asks for nothing? */
  let first = true;
  /** What the stretch that is running has brought. */
  let bytes = 0;
  /** How much listening the running stretch still has before it, and since when that has been running. */
  let left = windowMs;
  let since = 0;
  /** @type {unknown} */
  let timer;

  const run = () => {
    state = 'on';
    since = clock.now();
    timer = clock.set(edge, left);
  };

  /** A stretch of listening is over. */
  function edge() {
    if (state !== 'on') return;
    if (!first && bytes < minBytes) {
      state = 'over';
      onSlow();
      return;
    }
    first = false;
    bytes = 0;
    left = windowMs;
    run();
  }

  return {
    /** The body begins to be read. */
    start() {
      if (state === 'idle') run();
    },
    /** So many bytes of the body have come. @param {number} count */
    took(count) {
      if (state !== 'over' && !first) bytes += count;
    },
    /** The service asks the sender to wait: the clock stands still. */
    pause() {
      if (state !== 'on') return;
      clock.clear(timer);
      left = Math.min(left, Math.max(0, left - (clock.now() - since)));
      state = 'held';
    },
    /** The service listens again: the stretch goes on with what it had left. */
    resume() {
      if (state === 'held') run();
    },
    /** The body is all here, or the request is over: nothing more is asked. */
    stop() {
      clock.clear(timer);
      state = 'over';
    },
  };
}

/** @typedef {ReturnType<typeof createPace>} Pace */
