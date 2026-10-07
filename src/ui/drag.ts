import { startDrag, type DragHost } from './vm/drag-session';

// The DOM side of dragging the window by its grip: any element with the attribute `data-drag`.
//
// The window is NOT moved by the system (`startDragging()` would make the overlay the active window and take
// the keyboard from the game); the page moves it itself. Pressing the grip captures the pointer; every move is
// measured on the SCREEN (`screenX` / `screenY` do not depend on where the window is right now, so the window
// following the pointer does not disturb them). What a drag does with those numbers (once per frame, only the
// latest rectangle, the end position from the release alone) is in `vm/drag-session.ts`. No keyboard is taken.

/** Starts listening; returns the function that stops. */
export function installDrag(host: DragHost): () => void {
  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const grip = event.target.closest('[data-drag]');
    if (!(grip instanceof HTMLElement)) return;
    // no text selection, no focus change: only the drag
    event.preventDefault();

    const { pointerId } = event;
    try {
      grip.setPointerCapture(pointerId);
    } catch {
      // the pointer is already gone: the release or the cancel below ends the drag
    }
    const session = startDrag(host, { x: event.screenX, y: event.screenY }, (run) => {
      const id = requestAnimationFrame(run);
      return () => cancelAnimationFrame(id);
    });

    const stop = (): void => {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onLost);
      grip.removeEventListener('lostpointercapture', onLost);
    };
    const onMove = (move: PointerEvent): void => {
      if (move.pointerId === pointerId) session.move({ x: move.screenX, y: move.screenY });
    };
    // The only event whose position is the end of the drag.
    const onUp = (up: PointerEvent): void => {
      if (up.pointerId !== pointerId) return;
      stop();
      try {
        grip.releasePointerCapture(pointerId);
      } catch {
        // the capture is gone with the pointer
      }
      void session.up({ x: up.screenX, y: up.screenY }).catch(() => undefined);
    };
    // A cancelled pointer or a capture taken away (the window was deactivated, the grip was removed) may carry zero or
    // stale coordinates: the drag simply stops where the window was last placed.
    const onLost = (lost: PointerEvent): void => {
      if (lost.pointerId !== pointerId) return;
      stop();
      void session.cancel().catch(() => undefined);
    };

    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onLost);
    grip.addEventListener('lostpointercapture', onLost);
  };

  document.addEventListener('pointerdown', onPointerDown, true);
  return () => document.removeEventListener('pointerdown', onPointerDown, true);
}

export type { DragHost };
