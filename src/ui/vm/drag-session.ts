import { movedRect, type Rect, type Size } from '../../core/layout';

// One drag of the window by its grip, from the press to the release, without the DOM: the page feeds it the pointer
// (screen coordinates) and the frames, the host places the window. Rules:
//  - the window follows the pointer at most once per frame, always from where the drag began;
//  - while a placement is in progress only the LATEST wanted rectangle is kept (a stale one never replays);
//  - the end position comes from the release (`up`) and nowhere else; a drag that is cancelled keeps the rectangle
//    that was last placed, because the coordinates of a cancelled pointer may be zero or stale;
//  - begin, placements and end go strictly one after another.

export interface Point {
  x: number;
  y: number;
}

export interface DragHost {
  /** The grip was pressed: where the window is and how big the monitor is (logical px), or `null` when nothing may move (locked). */
  begin(): Promise<{ rect: Rect; monitor: Size } | null>;
  /** Put the window here. */
  move(rect: Rect): Promise<void>;
  /** The drag is over: the window ended in `rect`, or `null` when the grip was pressed and released without moving the window. */
  end(rect: Rect | null): Promise<void>;
}

export interface DragSession {
  /** The pointer moved to this screen point. */
  move(point: Point): void;
  /** The pointer was released at this screen point: the window goes there and the drag ends. */
  up(point: Point): Promise<void>;
  /** The pointer was cancelled or lost (no usable coordinates): the drag ends where the window was last placed. */
  cancel(): Promise<void>;
}

const sameRect = (a: Rect, b: Rect): boolean =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * `origin` is the pointer where the grip was pressed. `requestFrame(run)` runs `run` before the next frame and
 * returns what takes the request back.
 */
export function startDrag(host: DragHost, origin: Point, requestFrame: (run: () => void) => () => void): DragSession {
  let start: { rect: Rect; monitor: Size } | null = null;
  let latest = origin;
  /** The rectangle the window is to be placed in as soon as the placement in progress is done. */
  let wanted: Rect | null = null;
  /** The rectangle that was last handed to `host.move`. */
  let lastPlaced: Rect | null = null;
  let placing: Promise<void> | null = null;
  let cancelFrame: (() => void) | null = null;
  let finished = false;

  const ready = host.begin().then(
    (found) => {
      start = found;
    },
    () => {
      start = null;
    },
  );

  const rectAt = (point: Point): Rect | null =>
    start === null ? null : movedRect(start.rect, { dx: point.x - origin.x, dy: point.y - origin.y }, start.monitor);

  /** Places `wanted` unless something is being placed; when that is done, whatever is wanted by then. */
  const pump = (): void => {
    if (placing !== null || wanted === null) return;
    const rect = wanted;
    wanted = null;
    if (lastPlaced !== null && sameRect(lastPlaced, rect)) return;
    lastPlaced = rect;
    placing = host.move(rect).then(
      () => undefined,
      () => undefined, // the host has logged it
    ).then(() => {
      placing = null;
      pump();
    });
  };

  /** Everything handed over so far has been placed. */
  const idle = async (): Promise<void> => {
    while (placing !== null) await placing;
  };

  const frame = (): void => {
    cancelFrame = null;
    if (finished) return;
    const rect = rectAt(latest);
    if (rect === null) return;
    wanted = rect;
    pump();
  };

  const scheduleFrame = (): void => {
    if (cancelFrame !== null || finished || start === null) return;
    cancelFrame = requestFrame(frame);
  };

  void ready.then(() => {
    // the pointer may have moved before the window answered
    if (latest !== origin) scheduleFrame();
  });

  /**
   * Ends the drag once: stops the frames, lets the placement in progress finish, asks `decide` for the rectangle the
   * window ends in (it may hand a last rectangle to `pump`), waits until that is placed, then tells the host.
   */
  const end = async (decide: (began: { rect: Rect; monitor: Size }) => Rect | null): Promise<void> => {
    finished = true;
    cancelFrame?.();
    cancelFrame = null;
    await ready;
    const began = start;
    if (began === null) return; // nothing was begun: nothing to end
    wanted = null; // a rectangle that was never placed is not placed now
    await idle();
    const rect = decide(began);
    await idle();
    await host.end(rect);
  };

  return {
    move(point) {
      if (finished) return;
      latest = point;
      scheduleFrame();
    },

    async up(point) {
      if (finished) return;
      latest = point;
      await end((began) => {
        const rect = movedRect(began.rect, { dx: point.x - origin.x, dy: point.y - origin.y }, began.monitor);
        // pressed and released without moving the window: nothing to place, nothing to save
        if (lastPlaced === null && sameRect(rect, began.rect)) return null;
        wanted = rect;
        pump();
        return rect;
      });
    },

    async cancel() {
      if (finished) return;
      await end(() => lastPlaced);
    },
  };
}
