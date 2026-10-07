import type { Logger } from '../data/logger';
import { createHeldKeyGuard } from './vm/held-keys';
import type { KeyboardHolds } from './vm/keyboard-holds';

// The DOM side of the keyboard rules. The overlay never takes the keyboard from the game by itself; it
// does so only while the player edits a text field. Everything else (who holds the keyboard, what taking
// and giving it mean) is in `vm/keyboard-holds.ts` and `platform/window.ts`; here are the listeners:
//  - the pointer over a text field makes the window activatable, so that the player's own press activates it; the
//    pointer leaving the field makes it not activatable again;
//  - a press on a text field takes the keyboard first and puts the cursor into the field afterwards; when Windows
//    refuses the take, nobody holds the keyboard and the cursor is taken out of the field again;
//  - a press on anything else is told to the holds: right after the pointer left a field it may have activated the window;
//  - `Esc` in a field (when nothing else used it) leaves the field and gives the keyboard back to the game,
//    the window stays open;
//  - a watchdog gives the keyboard back when the field is gone (an answer was sent and the screen was redrawn);
//  - the guard against a game key that is still held down.

/** The holder name of a text field being edited. */
const FIELD = 'field';
const WATCHDOG_MS = 400;
/** A press on a field gets this long to move the cursor into it before the watchdog may judge. */
const PRESS_GRACE_MS = 1000;

const NOT_TEXT_INPUTS: ReadonlySet<string> = new Set(['checkbox', 'radio', 'range', 'button']);

/** A field the player types into or picks from with the keyboard: a text input, a textarea, a select, an editable element. */
export function isEditable(element: Element | null): boolean {
  if (element === null) return false;
  if (element instanceof HTMLInputElement) return !NOT_TEXT_INPUTS.has(element.type);
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) return true;
  return element instanceof HTMLElement && element.isContentEditable;
}

/** The text field at `target` (what a pointer event hit): the field itself or the one its label belongs to; `null` when there is none. */
function fieldAt(target: EventTarget | null): HTMLElement | null {
  const hit = target instanceof Element ? target.closest('input, textarea, select, [contenteditable], label') : null;
  // A click on the text of a label puts the focus into the control it belongs to (the settings screen is full of
  // them): that is a click on the field, and it needs the keyboard like one.
  const field = hit instanceof HTMLLabelElement ? hit.control : hit;
  return field instanceof HTMLElement && isEditable(field) ? field : null;
}

// The player opens the window with a click while still holding a key of the game (`F` shows its
// cursor), and Windows keeps repeating that key into the window. A key types only after it was pressed
// again inside the window; `Esc` and the other keys pressed fresh work as usual.
const heldKeys = createHeldKeyGuard();
let heldKeyLogged = false;

/** Forgets the keys held before the keyboard came to the window; call it at every `take`. */
export function resetHeldKeys(): void {
  heldKeys.reset();
  heldKeyLogged = false;
}

/** Starts listening; returns the function that stops. */
export function installKeyboard(holds: KeyboardHolds, log: Logger): () => void {
  let lastPressAt = Number.NEGATIVE_INFINITY;
  // the window layer has already logged a failure of its own; the listeners have nothing to add
  const quietly = (job: Promise<void>): Promise<void> => job.catch(() => undefined);

  // Capture phase on the window: it runs before the field, the search list and the Esc handler.
  const onKeyDownCapture = (event: KeyboardEvent): void => {
    if (!heldKeys.shouldSwallow(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!heldKeyLogged) {
      heldKeyLogged = true;
      log.debug('ui', 'held key ignored');
    }
  };
  const onKeyUpCapture = (event: KeyboardEvent): void => heldKeys.released(event.code);

  /** The text field the pointer is over; `null` when it is over none, or not over the window at all. */
  let hovered: HTMLElement | null = null;
  /** Tells the holds when the pointer comes over a field or leaves it; from one field straight to another nothing changes. */
  const pointerAt = (field: HTMLElement | null): void => {
    const wasOver = hovered !== null;
    hovered = field;
    if (wasOver !== (field !== null)) void quietly(holds.pointerOverField(field !== null));
  };

  const onPointerOver = (event: PointerEvent): void => pointerAt(fieldAt(event.target));
  // the pointer left the window altogether (inside the window the next `pointerover` says where it is)
  const onPointerOut = (event: PointerEvent): void => {
    if (event.relatedTarget === null) pointerAt(null);
  };

  const onPointerDown = (event: PointerEvent): void => {
    const field = fieldAt(event.target);
    if (field === null) {
      // whatever was seen last, the pointer is over no field now
      pointerAt(null);
      void holds.pressOutsideField().then(
        (givenBack) => {
          if (givenBack) log.info('ui', 'a press next to a field had activated the window, the keyboard went back to the game');
        },
        () => undefined, // the window layer has logged it
      );
      return;
    }
    lastPressAt = performance.now();
    if (!holds.held) {
      log.debug('ui', 'field pressed, the window needs the keyboard', { field: field.id || field.tagName, armed: holds.state === 'armed' });
    }
    void holds
      .hold(FIELD)
      .then(
        (taken) => taken,
        () => false, // the take failed; the window layer has logged it
      )
      .then((taken) => {
        if (taken) {
          if (field.isConnected) field.focus();
          return;
        }
        // Not taken (Windows refused to bring the window to the front): the keys still go to the game, so the field must
        // not look as if it were being edited, and the browser has put the cursor into it at the press. Looked at NOW,
        // not at the press: a second press may have taken the keyboard meanwhile, and then the field is edited after all.
        if (!holds.held && document.activeElement === field) field.blur();
      });
    // A press with no pointer seen over the field before it (touch, a pen): it is over the field now. Told after the
    // hold, so that the hold is not kept waiting for an arm of its own.
    pointerAt(field);
  };

  // Bubble phase: a field or a search list that used Esc itself (closed its list, dropped a draft) comes first.
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.defaultPrevented || !holds.held) return;
    log.info('ui', 'escape: the keyboard goes back to the game');
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    void quietly(holds.release(FIELD));
  };

  // The field may vanish with a redraw (an answer was sent): there is no event for that, so look.
  const watchdog = window.setInterval(() => {
    // the same goes for the field under the pointer (the window was folded): the pointer is over no field then
    if (hovered !== null && !hovered.isConnected) pointerAt(null);
    if (!holds.held || isEditable(document.activeElement)) return;
    if (performance.now() - lastPressAt < PRESS_GRACE_MS) return;
    log.debug('ui', 'no field is being edited, the keyboard goes back to the game');
    void quietly(holds.release(FIELD));
  }, WATCHDOG_MS);

  window.addEventListener('keydown', onKeyDownCapture, true);
  window.addEventListener('keyup', onKeyUpCapture, true);
  // the window got the focus again (the player came back to it): keys held by then are not ours
  window.addEventListener('focus', resetHeldKeys);
  // delegated on the document, like the press: no listener per field
  document.addEventListener('pointerover', onPointerOver, true);
  document.addEventListener('pointerout', onPointerOut, true);
  document.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('keydown', onKeyDown);
  resetHeldKeys();

  return () => {
    window.clearInterval(watchdog);
    window.removeEventListener('keydown', onKeyDownCapture, true);
    window.removeEventListener('keyup', onKeyUpCapture, true);
    window.removeEventListener('focus', resetHeldKeys);
    document.removeEventListener('pointerover', onPointerOver, true);
    document.removeEventListener('pointerout', onPointerOut, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('keydown', onKeyDown);
  };
}
