import { dragInput, startDrag, type DragHost } from './vm/drag-session';

// The DOM side of dragging the window by its grip: any element with the attribute `data-drag`.
//
// The window is NOT moved by the system (`startDragging()` would make the overlay the active window and take
// the keyboard from the game); the page moves it itself. Pressing the grip captures the pointer; every move is
// measured on the SCREEN (`screenX` / `screenY` do not depend on where the window is right now, so the window
// following the pointer does not disturb them). What a drag does with those numbers (once per frame, only the
// latest rectangle, the end position from the release alone) is in `vm/drag-session.ts`, and so is what counts as
// its end. No keyboard is taken.
//
// The pointer is listened to on the WINDOW, not on the grip: the grip may be taken out of the page during the drag (the
// window changes its mode, or the start screen gives way to the header). It then loses the capture, and the release that
// follows goes to whatever is under the pointer, never to the grip; a listener on the grip would never hear the end,
// and the window would stay "being dragged" (and unfitted) until the application is restarted.

const POINTER_EVENTS = ['pointermove', 'pointerup', 'pointercancel', 'lostpointercapture'] as const;

/** Starts listening; returns the function that stops. A drag that is going when it is called is ended. */
export function installDrag(host: DragHost): () => void {
  /** What ends each drag that is going, for the case that the page is torn down first. */
  const going = new Set<() => void>();

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

    /**
     * The drag ends once, whichever way, and its listeners go with it. The release is the only event whose position is the
     * end of the drag. A cancelled pointer or a capture taken away (the window was deactivated, the grip was removed) may carry
     * zero or stale coordinates: the drag then stops where the window was last placed.
     */
    const end = (how: { kind: 'up'; point: { x: number; y: number } } | { kind: 'cancel' }): void => {
      for (const type of POINTER_EVENTS) window.removeEventListener(type, onEvent, true);
      going.delete(abandon);
      if (how.kind === 'up') {
        try {
          grip.releasePointerCapture(pointerId);
        } catch {
          // the capture is gone with the pointer
        }
        void session.up(how.point).catch(() => undefined);
      } else {
        void session.cancel().catch(() => undefined);
      }
    };
    const onEvent = (e: PointerEvent): void => {
      const input = dragInput(pointerId, e);
      if (input === null) return;
      if (input.kind === 'move') session.move(input.point);
      else end(input);
    };
    const abandon = (): void => end({ kind: 'cancel' });

    going.add(abandon);
    for (const type of POINTER_EVENTS) window.addEventListener(type, onEvent, true);
  };

  document.addEventListener('pointerdown', onPointerDown, true);
  return () => {
    document.removeEventListener('pointerdown', onPointerDown, true);
    for (const abandon of [...going]) abandon();
  };
}

export type { DragHost };
