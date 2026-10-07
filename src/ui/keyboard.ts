import type { Logger } from '../data/logger';
import { createHeldKeyGuard } from './vm/held-keys';
import type { KeyboardHolds } from './vm/keyboard-holds';

// The DOM side of the keyboard rules. The overlay never takes the keyboard from the game by itself; it
// does so only while the player edits a text field. Everything else (who holds the keyboard, what taking
// and giving it mean) is in `vm/keyboard-holds.ts` and `platform/window.ts`; here are the listeners:
//  - a press on a text field takes the keyboard first and puts the cursor into the field afterwards;
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

  const onPointerDown = (event: PointerEvent): void => {
    const field = event.target instanceof Element ? event.target.closest('input, textarea, select, [contenteditable]') : null;
    if (!(field instanceof HTMLElement) || !isEditable(field)) return;
    lastPressAt = performance.now();
    if (!holds.held) log.debug('ui', 'field pressed, the window needs the keyboard', { field: field.id || field.tagName });
    void quietly(holds.hold(FIELD)).then(() => {
      if (field.isConnected) field.focus();
    });
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
    if (!holds.held || isEditable(document.activeElement)) return;
    if (performance.now() - lastPressAt < PRESS_GRACE_MS) return;
    log.debug('ui', 'no field is being edited, the keyboard goes back to the game');
    void quietly(holds.release(FIELD));
  }, WATCHDOG_MS);

  window.addEventListener('keydown', onKeyDownCapture, true);
  window.addEventListener('keyup', onKeyUpCapture, true);
  // the window got the focus again (the player came back to it): keys held by then are not ours
  window.addEventListener('focus', resetHeldKeys);
  document.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('keydown', onKeyDown);
  resetHeldKeys();

  return () => {
    window.clearInterval(watchdog);
    window.removeEventListener('keydown', onKeyDownCapture, true);
    window.removeEventListener('keyup', onKeyUpCapture, true);
    window.removeEventListener('focus', resetHeldKeys);
    document.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('keydown', onKeyDown);
  };
}
