import { describe, expect, it } from 'vitest';
import type { Rect, Size } from '../../src/core/layout';
import { dragInput, startDrag, type DragHost } from '../../src/ui/vm/drag-session';

const MONITOR: Size = { width: 1920, height: 1080 };
const START: Rect = { x: 1464, y: 16, width: 440, height: 300 };

/** Lets every pending microtask run. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

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

interface Options {
  /** What `begin` answers; `null` is a locked window. */
  begin?: { rect: Rect; monitor: Size } | null;
  /** Each placement waits for its own gate (a slow `place_window`). */
  slowMoves?: boolean;
  failMoves?: boolean;
  failBegin?: boolean;
  /** `begin` waits for this gate. */
  beginGate?: Gate;
}

function setup(options: Options = {}) {
  const calls: string[] = [];
  const placed: Rect[] = [];
  const ended: Array<Rect | null> = [];
  const moveGates: Gate[] = [];
  const frames: Array<() => void> = [];
  let cancelled = 0;

  const host: DragHost = {
    async begin() {
      calls.push('begin');
      await options.beginGate?.promise;
      if (options.failBegin) throw new Error('begin failed');
      return options.begin === undefined ? { rect: START, monitor: MONITOR } : options.begin;
    },
    async move(rect) {
      calls.push('move');
      placed.push(rect);
      if (options.slowMoves) {
        const g = gate();
        moveGates.push(g);
        await g.promise;
      }
      if (options.failMoves) throw new Error('move failed');
    },
    async end(rect) {
      calls.push('end');
      ended.push(rect);
    },
  };

  const session = startDrag(host, { x: 1000, y: 500 }, (run) => {
    frames.push(run);
    const index = frames.length - 1;
    return () => {
      cancelled++;
      frames[index] = () => {};
    };
  });
  /** One animation frame: runs what was asked for it. */
  const frame = async (): Promise<void> => {
    const due = frames.splice(0);
    for (const run of due) run();
    await settle();
  };
  return { session, calls, placed, ended, moveGates, frame, cancelledFrames: () => cancelled };
}

describe('startDrag', () => {
  it('moves the window by the shift of the pointer from where the drag began, once per frame', async () => {
    const { session, placed, frame } = setup();
    await settle();
    session.move({ x: 900, y: 550 });
    session.move({ x: 700, y: 600 });
    session.move({ x: 600, y: 700 });
    expect(placed).toEqual([]); // nothing before the frame
    await frame();
    expect(placed).toEqual([{ x: 1064, y: 216, width: 440, height: 300 }]); // the latest of the three: -400, +200
  });

  it('keeps the window on the monitor', async () => {
    const { session, placed, frame } = setup();
    await settle();
    session.move({ x: -5000, y: 5000 });
    await frame();
    expect(placed).toEqual([{ x: 0, y: 780, width: 440, height: 300 }]);
  });

  it('puts the window where the pointer is let go (pointerup) and ends the drag there', async () => {
    const { session, calls, placed, ended, frame } = setup();
    await settle();
    session.move({ x: 800, y: 600 });
    await frame();
    await session.up({ x: 700, y: 650 });
    expect(placed.at(-1)).toEqual({ x: 1164, y: 166, width: 440, height: 300 });
    expect(ended).toEqual([{ x: 1164, y: 166, width: 440, height: 300 }]);
    expect(calls.at(-1)).toBe('end');
  });

  it('does not place the same rectangle twice', async () => {
    const { session, placed, frame } = setup();
    await settle();
    session.move({ x: 800, y: 600 });
    await frame();
    await session.up({ x: 800, y: 600 });
    expect(placed).toHaveLength(1);
  });

  it('presses and releases the grip without moving: nothing is placed and nothing is saved', async () => {
    const { session, calls, placed, ended } = setup();
    await settle();
    await session.up({ x: 1000, y: 500 });
    expect(placed).toEqual([]);
    expect(ended).toEqual([null]);
    expect(calls).toEqual(['begin', 'end']);
  });

  describe('a drag that is cancelled', () => {
    it('keeps the rectangle that was last placed, and does not look at where the pointer is', async () => {
      const { session, placed, ended, frame } = setup();
      await settle();
      session.move({ x: 900, y: 600 });
      await frame();
      session.move({ x: 500, y: 100 }); // seen, but the frame has not come: never placed
      await session.cancel();
      expect(placed).toEqual([{ x: 1364, y: 116, width: 440, height: 300 }]);
      expect(ended).toEqual([{ x: 1364, y: 116, width: 440, height: 300 }]);
    });

    it('saves nothing when the window has not been moved yet', async () => {
      const { session, placed, ended } = setup();
      await settle();
      session.move({ x: 900, y: 600 }); // no frame yet
      await session.cancel();
      expect(placed).toEqual([]);
      expect(ended).toEqual([null]);
    });

    it('stops asking for frames', async () => {
      const { session, cancelledFrames } = setup();
      await settle();
      session.move({ x: 900, y: 600 });
      await session.cancel();
      expect(cancelledFrames()).toBe(1);
    });
  });

  it('ends only once: the release after a cancel (or the other way round) does nothing', async () => {
    const { session, ended } = setup();
    await settle();
    await session.cancel();
    await session.up({ x: 0, y: 0 });
    await session.cancel();
    expect(ended).toEqual([null]);
  });

  describe('a window that cannot be moved (locked)', () => {
    it('is not placed and not ended', async () => {
      const { session, calls, frame } = setup({ begin: null });
      await settle();
      session.move({ x: 500, y: 500 });
      await frame();
      await session.up({ x: 400, y: 400 });
      expect(calls).toEqual(['begin']);
    });

    it('is also left alone when begin fails', async () => {
      const { session, calls, frame } = setup({ failBegin: true });
      await settle();
      session.move({ x: 500, y: 500 });
      await frame();
      await session.up({ x: 400, y: 400 });
      expect(calls).toEqual(['begin']);
    });
  });

  describe('a placement that is slower than a frame', () => {
    it('keeps only the latest rectangle that came while one was being placed', async () => {
      const { session, placed, moveGates, frame } = setup({ slowMoves: true });
      await settle();
      session.move({ x: 900, y: 500 });
      await frame(); // first placement starts and is slow
      expect(placed).toHaveLength(1);
      session.move({ x: 800, y: 500 });
      await frame();
      session.move({ x: 700, y: 500 });
      await frame();
      session.move({ x: 600, y: 500 });
      await frame();
      expect(placed).toHaveLength(1); // nothing is queued behind the slow one
      moveGates[0].open();
      await settle();
      expect(placed.map((r) => r.x)).toEqual([1364, 1064]); // the first, then the latest only: the stale -200 and -300 never replay
      moveGates[1].open();
      await settle();
      expect(placed).toHaveLength(2);
    });

    it('waits for the placement in progress, places the final rectangle once, then ends', async () => {
      const { session, calls, placed, ended, moveGates, frame } = setup({ slowMoves: true });
      await settle();
      session.move({ x: 900, y: 500 });
      await frame();
      const up = session.up({ x: 600, y: 500 });
      await settle();
      expect(calls).toEqual(['begin', 'move']); // not ended while the first placement is not done
      moveGates[0].open();
      await settle();
      moveGates[1].open();
      await up;
      expect(calls).toEqual(['begin', 'move', 'move', 'end']);
      expect(placed.map((r) => r.x)).toEqual([1364, 1064]);
      expect(ended).toEqual([{ x: 1064, y: 16, width: 440, height: 300 }]);
    });

    it('still ends the drag when a placement fails', async () => {
      const { session, calls, ended, frame } = setup({ failMoves: true });
      await settle();
      session.move({ x: 900, y: 500 });
      await frame();
      await session.up({ x: 800, y: 500 });
      expect(calls.at(-1)).toBe('end');
      expect(ended).toHaveLength(1);
    });
  });

  it('a release that comes before the window answered `begin` waits for it, then places and ends', async () => {
    const beginGate = gate();
    const { session, calls, placed, ended } = setup({ beginGate });
    session.move({ x: 900, y: 500 });
    const up = session.up({ x: 800, y: 500 });
    await settle();
    expect(calls).toEqual(['begin']);
    beginGate.open();
    await up;
    expect(calls).toEqual(['begin', 'move', 'end']);
    expect(placed).toEqual([{ x: 1264, y: 16, width: 440, height: 300 }]);
    expect(ended).toEqual([{ x: 1264, y: 16, width: 440, height: 300 }]);
  });
});

describe('dragInput: what an event of the pointer means for the drag of one pointer', () => {
  const event = (type: string, pointerId = 7, screenX = 640, screenY = 380) => ({ type, pointerId, screenX, screenY });

  it('takes a move of the pointer as the place the window follows to', () => {
    expect(dragInput(7, event('pointermove'))).toEqual({ kind: 'move', point: { x: 640, y: 380 } });
  });

  it('takes the release as the end of the drag at the place of the release: the only event with a position that counts', () => {
    expect(dragInput(7, event('pointerup'))).toEqual({ kind: 'up', point: { x: 640, y: 380 } });
  });

  it('takes a cancelled pointer and a lost capture as the end where the window stands, without a position', () => {
    // a capture is lost also when the grip is taken out of the page during the drag (the window changes its mode): the drag must end then too
    expect(dragInput(7, event('pointercancel'))).toEqual({ kind: 'cancel' });
    expect(dragInput(7, event('lostpointercapture'))).toEqual({ kind: 'cancel' });
  });

  it('hears nothing of another pointer (a second finger, a pen)', () => {
    for (const type of ['pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) {
      expect(dragInput(7, event(type, 8))).toBeNull();
    }
  });

  it('hears nothing of other events', () => {
    expect(dragInput(7, event('pointerdown'))).toBeNull();
    expect(dragInput(7, event('gotpointercapture'))).toBeNull();
    expect(dragInput(7, event('pointerleave'))).toBeNull();
  });
});
