// When a keyboard the window holds and nobody uses goes back to the game by itself. Pure: the clock, the keys and the
// field are read by the watchdog of `ui/keyboard.ts`, which asks here every time it comes round and gives the keyboard
// back the way `Esc` does (the field loses the cursor, whatever is open stays open).
//
// The window keeps the keyboard after an entry so that prices can be typed one after another. A player who is done and
// flies on finds his keys going nowhere. So: no key for `KEYBOARD_IDLE_MS`, and nothing in the field that he typed
// and has not saved, and the keyboard is the game's again. What he typed and did not save is never taken from under
// his hands: the keyboard stays, however long he is away.

/** How long the window keeps a keyboard that is not used, in milliseconds. The one place this limit is written. */
export const KEYBOARD_IDLE_MS = 15_000;

/** The field that has the cursor, as far as the rule needs it. */
export interface EditedField {
  /** What stands in the field now. */
  text: string;
  /**
   * The player typed into the field since it got the cursor, or since a key last settled what was typed
   * (`settlesTyping`). A number that merely stands in the field, selected or not, is not typed.
   */
  typed: boolean;
  /** The field is marked as refused: what stands in it was not saved. */
  refused: boolean;
  /**
   * The field is a list the player may still be choosing from: he pressed it, which opens it, and has chosen nothing since.
   * The options of an open list are drawn outside the page, so the page hears nothing while he reads them, and taking the
   * cursor out of the list would shut it under his pointer.
   */
  choosing: boolean;
}

export interface KeyboardUse {
  /** The clock, in milliseconds; the two moments below are of the same clock, `-Infinity` for "never". */
  now: number;
  /** When a key was last pressed in the window. */
  lastKeyAt: number;
  /** When the keyboard was last taken: the player pressed a field, or a button that opens an entry. */
  takenAt: number;
  field: EditedField;
}

/** The keys after which what was typed is typed no more: `Enter` sends it (or the field is marked as refused), `Esc` takes it back. */
export function settlesTyping(key: string): boolean {
  return key === 'Enter' || key === 'Escape';
}

/** Whether the field holds something of the player's that is not saved: he typed it, or it was refused. An empty field holds nothing. */
export function hasUnsavedTyping(field: EditedField): boolean {
  return field.text.trim() !== '' && (field.typed || field.refused);
}

/**
 * Whether the keyboard goes back to the game now: no key was pressed for `KEYBOARD_IDLE_MS`, counted from the last key
 * or from the take, whichever is later, and the field with the cursor holds nothing typed and unsaved and is not a
 * list the player may still be choosing from.
 */
export function keyboardUnused(use: KeyboardUse): boolean {
  if (use.now - Math.max(use.lastKeyAt, use.takenAt) < KEYBOARD_IDLE_MS) return false;
  return !hasUnsavedTyping(use.field) && !use.field.choosing;
}
