import type { Logger } from '../data/logger';
import { createHeldKeyGuard } from './vm/held-keys';
import type { KeyboardHolds } from './vm/keyboard-holds';
import { createTypingMemory, KEYBOARD_IDLE_MS, keyboardUnused, type EditedField, type FieldPlace } from './vm/keyboard-idle';

// The DOM side of the keyboard rules. The overlay never takes the keyboard from the game by itself; it
// does so only while the player edits a text field. Everything else (who holds the keyboard, what taking
// and giving it mean) is in `vm/keyboard-holds.ts` and `platform/window.ts`; here are the listeners:
//  - the pointer over a text field makes the window activatable, so that the player's own press activates it; the
//    pointer leaving the field makes it not activatable again;
//  - a press on a text field takes the keyboard first and puts the cursor into the field afterwards; when Windows
//    refuses the take, nobody holds the keyboard and the cursor is taken out of the field again;
//  - a button that opens an entry (`data-opens-entry`: «+ цена», «Купил», «Продал») is a field for all of the above: the
//    pointer over it arms the window, the player's press on it takes the keyboard, and the cursor goes into the field of
//    the entry once that field is there. What counts as a field or as such a button is decided in one place, `takerAt`;
//  - a press on anything else is told to the holds: right after the pointer left a field it may have activated the window;
//  - a number field (`data-select-on-focus`) that gets the cursor has its whole number selected, so that typing replaces
//    it; a click on a field that has the cursor already puts the caret where the click was;
//  - `Esc` in a field (when nothing else used it) leaves the field and gives the keyboard back to the game,
//    the window stays open;
//  - a watchdog gives the keyboard back when the field is gone (an answer was sent and the screen was redrawn), and
//    while the window is armed keeps the remembered window (the one the focus goes back to) up to date;
//  - the same watchdog gives the keyboard back, the way `Esc` does, when it is held and not used: no key for a while and
//    nothing that the player typed and did not confirm, in whatever field (the rule and its invariant are
//    `vm/keyboard-idle.ts`; here the fields are told to its memory: what was typed, Enter and Esc, a cell that is left);
//  - the guard against a game key that is still held down.

/** The holder name of a text field being edited. */
const FIELD = 'field';
const WATCHDOG_MS = 400;
/**
 * A press on a field gets this long to move the cursor into it before the watchdog may judge; a press on a button that
 * opens an entry gets as long for the field of the entry to appear.
 */
const PRESS_GRACE_MS = 1000;
/** How often the field of an entry is looked for after a press on its button. */
const ENTRY_LOOK_MS = 30;

const FIELDS = 'input, textarea, select, [contenteditable]';
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
  const hit = target instanceof Element ? target.closest(`${FIELDS}, label`) : null;
  // A click on the text of a label puts the focus into the control it belongs to (the settings screen is full of
  // them): that is a click on the field, and it needs the keyboard like one.
  const field = hit instanceof HTMLLabelElement ? hit.control : hit;
  return field instanceof HTMLElement && isEditable(field) ? field : null;
}

/**
 * The attribute of a button that opens an entry, with the name of the entry: «+ цена» (while the quick entry is closed),
 * «Купил» and «Продал» of an open row, and the button of the form of a trade while its next press only asks about the
 * price. The field the cursor goes into carries the same name in `data-entry-field`, on itself or on an element around
 * it (then the first field inside is meant).
 */
const OPENS_ENTRY = 'data-opens-entry';
const ENTRY_FIELD = 'data-entry-field';

/** What takes the keyboard when the player presses it: a text field, or a button that opens an entry. */
interface Taker {
  element: HTMLElement;
  /** The name of the entry the button opens; `null` for a text field. */
  entry: string | null;
}

/**
 * The field or the entry button at `target` (what a pointer event hit); `null` for anything else: a plain button, a row,
 * the glass. The one place that says what the keyboard rules treat as a field.
 */
function takerAt(target: EventTarget | null): Taker | null {
  const field = fieldAt(target);
  if (field !== null) return { element: field, entry: null };
  const button = target instanceof Element ? target.closest(`[${OPENS_ENTRY}]`) : null;
  const entry = button?.getAttribute(OPENS_ENTRY) ?? '';
  return button instanceof HTMLElement && entry !== '' ? { element: button, entry } : null;
}

/** The field of the entry `name`, the one the cursor goes into; `null` while the entry is not on the screen. */
function entryField(name: string): HTMLElement | null {
  for (const marked of document.querySelectorAll<HTMLElement>(`[${ENTRY_FIELD}]`)) {
    if (marked.getAttribute(ENTRY_FIELD) !== name) continue;
    if (isEditable(marked)) return marked;
    for (const inner of marked.querySelectorAll<HTMLElement>(FIELDS)) if (isEditable(inner)) return inner;
  }
  return null;
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

/** A field that holds text the player types: every field but a select, whose choice is applied at once and is never "typed and not saved". */
const holdsTypedText = (field: Element | null): boolean => isEditable(field) && !(field instanceof HTMLSelectElement);

/** What stands in a field; a list holds a choice, not a text. */
function textOf(field: Element): string {
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) return field.value;
  return holdsTypedText(field) ? (field.textContent ?? '') : '';
}

/**
 * The attribute by which the table marks the two fields of one cell of an open row (price and quantity): they are saved
 * together, by Enter in either of them and when the cursor leaves both.
 */
const cellOf = (field: Element): string | null => (field instanceof HTMLElement ? (field.dataset.cell ?? null) : null);

/** Where a field stands for the memory of what was typed: in a form, in a cell of the table, or alone. */
const placeOf = (field: Element): FieldPlace => ({ inForm: field.closest('form') !== null, cell: cellOf(field) });

/**
 * The field, or one of its cell, is marked as refused. Every field of the window marks a refused entry with
 * `aria-invalid` (the cells of the table, the form of a trade, the quick entry, the settings); a cell is refused whole.
 */
function refusedAt(field: Element): boolean {
  if (field.getAttribute('aria-invalid') === 'true') return true;
  const cell = cellOf(field);
  if (cell === null) return false;
  for (const other of document.querySelectorAll<HTMLElement>('[data-cell][aria-invalid="true"]')) if (cellOf(other) === cell) return true;
  return false;
}

/** The field with the cursor as the rule of the unused keyboard reads it; `listPressed` is what the listeners have kept. */
const editedField = (field: Element, listPressed: boolean): EditedField => ({
  text: textOf(field), refused: refusedAt(field), choosing: listPressed && field instanceof HTMLSelectElement,
});

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
  /** When the player last pressed a field or a button that opens an entry: the press that takes the keyboard, or keeps it. */
  let lastPressAt = Number.NEGATIVE_INFINITY;
  /** When a key was last pressed in the window (a key that the guard of the held keys let through), or a choice made from a list. */
  let lastKeyAt = Number.NEGATIVE_INFINITY;
  /**
   * What the player typed, by field, until he confirms it or it is gone (`TypingMemory`). It is not forgotten when the
   * cursor moves on: a price typed into a row still waits while the cursor stands in the quantity.
   */
  const typing = createTypingMemory<Element>();
  /** The last press was on a list (a select), which opens it, and nothing was chosen from it since: it may still be open. */
  let listPressed = false;
  // the window layer has already logged a failure of its own; the listeners have nothing to add
  const quietly = (job: Promise<void>): Promise<void> => job.catch(() => undefined);

  // Capture phase on the window: it runs before the field, the search list and the Esc handler.
  const onKeyDownCapture = (event: KeyboardEvent): void => {
    if (!heldKeys.shouldSwallow(event)) {
      // a key of the player: the keyboard is in use. Enter and Esc in a field deal with what was typed there (the memory
      // knows where they really do)
      lastKeyAt = performance.now();
      if (event.target instanceof Element && holdsTypedText(event.target)) typing.key(event.target, event.key, placeOf(event.target));
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (!heldKeyLogged) {
      heldKeyLogged = true;
      log.debug('ui', 'held key ignored');
    }
  };
  const onKeyUpCapture = (event: KeyboardEvent): void => heldKeys.released(event.code);
  // The player typed into a field (a key, a paste): what stands in it now is his, and waits to be confirmed. It is heard
  // twice: before the field's own handlers, so that no typing is ever missed, and after them, so that what they made of
  // the text is what is remembered. A choice from a list is applied at once and closes the list; it counts as a key,
  // because the keys or the click that made it went to the open list, which is drawn outside the page, and the page heard
  // none of them.
  const onInput = (event: Event): void => {
    const field = event.target;
    if (field instanceof HTMLSelectElement) {
      listPressed = false;
      lastKeyAt = performance.now();
    } else if (field instanceof Element && holdsTypedText(field)) typing.typed(field, textOf(field), placeOf(field));
  };
  // The cursor leaves a field. From one field of a cell to the other is not leaving the cell (the table saves nothing
  // then, and neither does the memory count it); anything else is told. It is the player who takes the cursor out: the
  // automatic return below does not happen while something typed still waits.
  const onFocusOut = (event: FocusEvent): void => {
    const field = event.target;
    if (!(field instanceof Element) || !holdsTypedText(field)) return;
    const place = placeOf(field);
    const next = event.relatedTarget;
    if (place.cell !== null && next instanceof Element && isEditable(next) && cellOf(next) === place.cell) return;
    typing.left(field, place);
  };

  /**
   * The keyboard goes back to the game and the window stays as it is: the field loses the cursor (a field that suspends
   * something while it has the cursor, like a key field of the settings, hears of it the usual way, by its blur) and the
   * holder of the fields is released.
   */
  const giveBack = (): void => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    void quietly(holds.release(FIELD));
  };

  /** What the pointer was last seen on, whatever it is; `null` when it is not over the window. */
  let under: Element | null = null;
  /** The text field or the entry button the pointer is over; `null` when it is over neither, or not over the window at all. */
  let hovered: HTMLElement | null = null;
  /**
   * Tells the holds whether the pointer is over a field (an entry button is one for them). They are told every time, and
   * they ignore what they know already (from one field straight to another nothing changes): the state tells them too,
   * when the window is folded or hidden, so what was said here last is not what they know.
   */
  const pointerAt = (field: HTMLElement | null): void => {
    hovered = field;
    void quietly(holds.pointerOverField(field !== null));
  };
  /** The pointer is on `target` now. */
  const pointerOn = (target: EventTarget | null): void => {
    under = target instanceof Element ? target : null;
    pointerAt(takerAt(under)?.element ?? null);
  };

  const onPointerOver = (event: PointerEvent): void => pointerOn(event.target);
  // the pointer left the window altogether (inside the window the next `pointerover` says where it is)
  const onPointerOut = (event: PointerEvent): void => {
    if (event.relatedTarget === null) pointerOn(null);
  };

  /** The look for the field of an entry whose button was pressed; one at a time. */
  let entryLook: number | undefined;
  const stopEntryLook = (): void => {
    window.clearInterval(entryLook);
    entryLook = undefined;
  };
  /**
   * The button of the entry `entry` was pressed at `pressedAt` and the window holds the keyboard: the cursor goes into the
   * field of the entry as soon as it is on the screen (the click that opens the entry comes after the press, and the entry
   * is drawn after the click). A number field selects its number when it gets the cursor (`onFocusIn`). An entry that does
   * not open within the grace of the press gets no cursor; the watchdog then gives the keyboard back, as it does whenever
   * no field is being edited.
   *
   * The first look is never made here, at once: this may still be the press itself (the keyboard was held already, so
   * nothing had to be waited for), and the browser gives the focus to the pressed button when it carries the press out,
   * right after its listeners. A cursor put into a field that is on the screen already would be taken out of it again.
   */
  const cursorIntoEntry = (entry: string, pressedAt: number): void => {
    stopEntryLook();
    entryLook = window.setInterval(() => {
      const field = entryField(entry);
      if (!holds.held) {
        // the keyboard went away meanwhile (`Esc`, a click on the game): the cursor does not follow it
        stopEntryLook();
      } else if (field !== null) {
        stopEntryLook();
        field.focus();
        log.debug('ui', 'the cursor goes into the entry', { entry });
      } else if (performance.now() - pressedAt >= PRESS_GRACE_MS) {
        stopEntryLook();
        log.debug('ui', 'the entry did not open: there is no field to put the cursor into', { entry });
      }
    }, ENTRY_LOOK_MS);
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
    // a new press is a new intention: the cursor does not go into the entry of an earlier press behind it
    stopEntryLook();
    const taker = takerAt(event.target);
    listPressed = taker?.element instanceof HTMLSelectElement;
    const number = numberFieldAt(taker?.element ?? null);
    // read before the hold: it is this press that makes the window hold the keyboard
    pressedNumber = number === null
      ? null
      : { field: number, broughtCursor: pressBringsCursor({ focused: document.activeElement === number, keyboardHeld: holds.held }) };
    if (taker === null) {
      // whatever was seen last, the pointer is over no field now
      pointerOn(event.target);
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
    const { element: field, entry } = taker;
    const pressedAt = performance.now();
    lastPressAt = pressedAt;
    if (!holds.held) {
      const armed = holds.state === 'armed';
      if (entry === null) log.debug('ui', 'field pressed, the window needs the keyboard', { field: field.id || field.tagName, armed });
      else log.debug('ui', 'entry button pressed, the window needs the keyboard', { entry, armed });
    }
    void holds
      .hold(FIELD)
      .then(
        (taken) => taken,
        () => false, // the take failed; the window layer has logged it
      )
      .then((taken) => {
        if (entry !== null) {
          // Not taken: the click opens the entry all the same, with no cursor in it, and the keys go to the game; nobody
          // holds the keyboard, so the next press (on the button, or on a field of the entry) takes it the usual way.
          if (taken) cursorIntoEntry(entry, pressedAt);
          return;
        }
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
    pointerOn(event.target);
  };

  // Bubble phase: a field or a search list that used Esc itself (closed its list, dropped a draft) comes first.
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.defaultPrevented || !holds.held) return;
    log.info('ui', 'escape: the keyboard goes back to the game');
    giveBack();
  };

  // The field may vanish with a redraw (an answer was sent): there is no event for that, so look.
  const watchdog = window.setInterval(() => {
    // The same goes for what is under the pointer, which changes with no move of the pointer: the field is gone (the
    // window was folded), or the button the pointer rests on has stopped opening an entry (the entry is open now, the
    // button closes it) or opens one again.
    const resting = under !== null && under.isConnected ? (takerAt(under)?.element ?? null) : null;
    if (resting !== hovered) pointerAt(resting);
    // While the pointer rests on a field the window that gets the focus back is the one remembered when the pointer
    // came; the foreground may have changed since. Quiet: no line unless it did.
    if (holds.state === 'armed') void quietly(holds.refreshRemembered());
    if (!holds.held) return;
    const now = performance.now();
    const active = document.activeElement;
    if (active === null || !isEditable(active)) {
      if (now - lastPressAt < PRESS_GRACE_MS) return;
      log.debug('ui', 'no field is being edited, the keyboard goes back to the game');
      void quietly(holds.release(FIELD));
      return;
    }
    // A field has the cursor, but the player may be gone: he typed a price, pressed Enter and flies on, and his keys go
    // to the window. The keyboard was taken by the last press on a field (or on an entry button); a look while that take
    // is still on its way counts from the press too. Nothing is written per look, one line when the keyboard goes.
    // What was typed is read against the page as it is now, in every field that was typed into, not only this one.
    const typed = typing.read((field) => ({ text: field.isConnected ? textOf(field) : null, refused: refusedAt(field) }));
    if (!keyboardUnused({ now, lastKeyAt, takenAt: lastPressAt, field: editedField(active, listPressed), typed })) return;
    log.info('ui', `the keyboard was not used for ${KEYBOARD_IDLE_MS / 1000} s: it goes back to the game`);
    giveBack();
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
  document.addEventListener('focusout', onFocusOut, true);
  document.addEventListener('input', onInput, true);
  window.addEventListener('input', onInput);
  document.addEventListener('mouseup', onMouseUp, true);
  document.addEventListener('pointercancel', onPressGone, true);
  document.addEventListener('dragend', onPressGone, true);
  window.addEventListener('keydown', onKeyDown);
  resetHeldKeys();

  return () => {
    window.clearInterval(watchdog);
    stopEntryLook();
    window.removeEventListener('keydown', onKeyDownCapture, true);
    window.removeEventListener('keyup', onKeyUpCapture, true);
    window.removeEventListener('focus', resetHeldKeys);
    document.removeEventListener('pointerover', onPointerOver, true);
    document.removeEventListener('pointerout', onPointerOut, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('focusin', onFocusIn, true);
    document.removeEventListener('focusout', onFocusOut, true);
    document.removeEventListener('input', onInput, true);
    window.removeEventListener('input', onInput);
    document.removeEventListener('mouseup', onMouseUp, true);
    document.removeEventListener('pointercancel', onPressGone, true);
    document.removeEventListener('dragend', onPressGone, true);
    window.removeEventListener('keydown', onKeyDown);
  };
}
