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
//  - a number field (`data-select-on-focus`) that gets the cursor has its whole number selected, so that typing replaces
//    it; a click on a field that has the cursor already puts the caret where the click was;
//  - `Esc` in a field (when nothing else used it) leaves the field and gives the keyboard back to the game,
//    the window stays open;
//  - a watchdog gives the keyboard back when the field is gone (an answer was sent and the screen was redrawn), and
//    while the window is armed keeps the remembered window (the one the focus goes back to) up to date;
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

/**
 * The attribute of a number field whose whole content is selected when it gets the cursor: the price and the quantity of
 * the open row of the table, of the form of a trade and of the quick entry. The fields of the settings and the search
 * boxes do not carry it (a search box has a rule of its own).
 */
const SELECT_ON_FOCUS = 'data-select-on-focus';

/** The number field at `target` (what an event hit); `null` when it is no such field. */
function numberFieldAt(target: EventTarget | null): HTMLInputElement | null {
  return target instanceof HTMLInputElement && target.hasAttribute(SELECT_ON_FOCUS) ? target : null;
}

/**
 * Whether a press on a number field is the one that brings it the cursor (and so selects its number), or a click on a
 * field that is being edited already (the caret goes where the click was). `focused`: the field has the focus of the
 * page. That alone is not "being edited": a field keeps the focus of the page while the keyboard is with the game (the
 * player clicked the game and came back), and the press that brings the keyboard back is a first click again.
 */
export function pressBringsCursor(press: { focused: boolean; keyboardHeld: boolean }): boolean {
  return !press.focused || !press.keyboardHeld;
}

/**
 * Whether the press that has just ended leaves the whole number selected. `start`, `end`: the selection of the field
 * when the button goes up (`null` when the field cannot say), `length`: how long its text is.
 *
 * The browser works against a selection made when the field gets the focus: the same press that gave the focus puts
 * a caret where the mouse is, and a press that landed inside the selection takes it away when the button goes up. So
 * the press that brought the cursor ends with everything selected once more (and the release is kept from undoing it),
 * unless the player dragged over a part of the number with that very press: that part is what he wants. A press on a
 * field that had the cursor already changes nothing: the caret stays where the browser put it.
 */
export function pressSelectsAll(press: { broughtCursor: boolean; start: number | null; end: number | null; length: number }): boolean {
  if (!press.broughtCursor) return false;
  const { start, end, length } = press;
  if (start === null || end === null || start === end) return true;
  return start === 0 && end === length;
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
  /**
   * Tells the holds whether the pointer is over a field. They are told every time, and they ignore what they know
   * already (from one field straight to another nothing changes): the state tells them too, when the window is folded
   * or hidden, so what was said here last is not what they know.
   */
  const pointerAt = (field: HTMLElement | null): void => {
    hovered = field;
    void quietly(holds.pointerOverField(field !== null));
  };

  const onPointerOver = (event: PointerEvent): void => pointerAt(fieldAt(event.target));
  // the pointer left the window altogether (inside the window the next `pointerover` says where it is)
  const onPointerOut = (event: PointerEvent): void => {
    if (event.relatedTarget === null) pointerAt(null);
  };

  /** The number field the mouse button went down on, and whether that press is the one that brings it the cursor. */
  let pressedNumber: { field: HTMLInputElement; broughtCursor: boolean } | null = null;

  // The whole number is selected when the field gets the cursor from Tab or from the program. A press of the mouse that
  // is going on selects when its button goes up: selected now, the number would be dragged away by the rest of the press
  // (a press inside a selection starts a drag of the selected text), and the player could not select a part of it.
  const onFocusIn = (event: FocusEvent): void => {
    const field = numberFieldAt(event.target);
    if (field !== null && pressedNumber?.field !== field) field.select();
  };

  // The button of a press on a number field goes up (see `pressSelectsAll`).
  const onMouseUp = (event: MouseEvent): void => {
    const press = pressedNumber;
    pressedNumber = null;
    // the cursor is not in the field after all: Windows refused the keyboard and it was taken out, or it has moved on
    if (press === null || document.activeElement !== press.field) return;
    const { field, broughtCursor } = press;
    if (!pressSelectsAll({ broughtCursor, start: field.selectionStart, end: field.selectionEnd, length: field.value.length })) return;
    field.select();
    // the release of the button must not take the selection away again
    event.preventDefault();
  };
  // a press that ends with no release of the button (the browser took it over) is over all the same
  const onPressGone = (): void => {
    pressedNumber = null;
  };

  const onPointerDown = (event: PointerEvent): void => {
    const field = fieldAt(event.target);
    const number = numberFieldAt(field);
    // read before the hold: it is this press that makes the window hold the keyboard
    pressedNumber = number === null
      ? null
      : { field: number, broughtCursor: pressBringsCursor({ focused: document.activeElement === number, keyboardHeld: holds.held }) };
    if (field === null) {
      // whatever was seen last, the pointer is over no field now
      pointerAt(null);
      void holds.pressOutsideField().then(
        (stray) => {
          if (stray === 'handed back') {
            log.info('ui', 'a press next to a field had activated the window with nobody holding the keyboard: the keyboard went back to the game');
          } else if (stray === 'not handed back') {
            log.warn('ui', 'a press next to a field had activated the window with nobody holding the keyboard. The window cannot be activated any more, but the focus did NOT go back to the game: click the game');
          }
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
    // While the pointer rests on a field the window that gets the focus back is the one remembered when the pointer
    // came; the foreground may have changed since. Quiet: no line unless it did.
    if (holds.state === 'armed') void quietly(holds.refreshRemembered());
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
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('mouseup', onMouseUp, true);
  document.addEventListener('pointercancel', onPressGone, true);
  document.addEventListener('dragend', onPressGone, true);
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
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('mouseup', onMouseUp, true);
    document.removeEventListener('pointercancel', onPressGone, true);
    document.removeEventListener('dragend', onPressGone, true);
    window.removeEventListener('keydown', onKeyDown);
  };
}
