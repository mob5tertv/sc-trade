import { movedRect, type Rect, type Size } from '../core/layout';

// The DOM side of dragging the window by its grip: any element with the attribute `data-drag`.
//
// The window is NOT moved by the system (`startDragging()` would make the overlay the active window and take
// the keyboard from the game); the page moves it itself. Pressing the grip captures the pointer; every move is
// measured on the SCREEN (`screenX` / `screenY` do not depend on where the window is right now, so the window
// following the pointer does not disturb them); the window is placed at most once per animation frame, always
// from where the drag began; releasing the pointer ends the drag. No keyboard is taken for any of this.

export interface DragHost {
  /** The grip was pressed: where the window is and how big the monitor is (logical px), or `null` when nothing may move (locked). */
  begin(): Promise<{ rect: Rect; monitor: Size } | null>;
  /** Put the window here. */
  move(rect: Rect): Promise<void>;
  /** The drag is over: the window ended in `rect`, or `null` when the grip was pressed and released without moving. */
  end(rect: Rect | null): Promise<void>;
}

/** Starts listening; returns the function that stops. */
export function installDrag(host: DragHost): () => void {
  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const grip = event.target.closest('[data-drag]');
    if (!(grip instanceof HTMLElement)) return;
    // no text selection, no focus change: only the drag
    event.preventDefault();
    follow(grip, event);
  };

  /** One drag, from the press to the release. */
  function follow(grip: HTMLElement, down: PointerEvent): void {
    const { pointerId } = down;
    const origin = { x: down.screenX, y: down.screenY };
    let latest = origin;
    let start: { rect: Rect; monitor: Size } | null = null;
    let frame = 0;
    let finished = false;

    try {
      grip.setPointerCapture(pointerId);
    } catch {
      // the pointer is already gone: the release below ends the drag
    }

    const rectNow = (): Rect | null =>
      start === null ? null : movedRect(start.rect, { dx: latest.x - origin.x, dy: latest.y - origin.y }, start.monitor);
    const moved = (): boolean => latest.x !== origin.x || latest.y !== origin.y;

    // Everything the drag does to the window is one chain: the begin, the moves, the end, in this order.
    const ready = host.begin().then(
      (found) => {
        start = found;
      },
      () => {
        start = null;
      },
    );
    let chain: Promise<void> = ready;

    const schedule = (): void => {
      if (frame !== 0 || finished || start === null) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const rect = rectNow();
        if (rect !== null && !finished) chain = chain.then(() => host.move(rect));
      });
    };

    void ready.then(() => {
      if (moved()) schedule();
    });

    const onMove = (event: PointerEvent): void => {
      if (event.pointerId !== pointerId) return;
      latest = { x: event.screenX, y: event.screenY };
      schedule();
    };

    const onEnd = (event: PointerEvent): void => {
      if (event.pointerId !== pointerId || finished) return;
      finished = true;
      latest = { x: event.screenX, y: event.screenY };
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onEnd);
      grip.removeEventListener('pointercancel', onEnd);
      grip.removeEventListener('lostpointercapture', onEnd);
      cancelAnimationFrame(frame);
      try {
        grip.releasePointerCapture(pointerId);
      } catch {
        // the capture is gone with the pointer
      }
      chain = chain
        .then(async () => {
          if (start === null) return; // nothing was begun: nothing to end
          const rect = moved() ? rectNow() : null;
          if (rect !== null) await host.move(rect);
          await host.end(rect);
        })
        .catch(() => undefined);
    };

    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onEnd);
    grip.addEventListener('pointercancel', onEnd);
    // the capture can be taken away without a release (the window was deactivated, the grip was removed): that ends the drag too
    grip.addEventListener('lostpointercapture', onEnd);
  }

  document.addEventListener('pointerdown', onPointerDown, true);
  return () => document.removeEventListener('pointerdown', onPointerDown, true);
}
