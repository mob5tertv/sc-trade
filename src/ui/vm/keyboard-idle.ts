// When a keyboard the window holds and nobody uses goes back to the game by itself. Pure: the clock, the keys and the
// fields are read by the watchdog of `ui/keyboard.ts`, which asks here every time it comes round and gives the keyboard
// back the way `Esc` does (the field loses the cursor, whatever is open stays open).
//
// The window keeps the keyboard after an entry so that prices can be typed one after another. A player who is done and
// flies on finds his keys going nowhere. So: no key for `KEYBOARD_IDLE_MS`, and the keyboard is the game's again.
//
// THE INVARIANT: that return must never cause a write, and never cause the loss, of something the player typed and did
// not confirm. Taking the cursor out of a field is not harmless: the table saves a cell that is left, and a window
// without the keyboard may fold over a line that was typed. So what was typed is remembered by its FIELD and its text
// (`createTypingMemory`), wherever the cursor has gone since, and while any of it still waits the keyboard stays, however
// long. When in doubt it stays: the worst case is the keyboard staying with the window until `Esc`, as it always did.

/** How long the window keeps a keyboard that is not used, in milliseconds. The one place this limit is written. */
export const KEYBOARD_IDLE_MS = 15_000;

/** The field that has the cursor, as far as the rule needs it. */
export interface EditedField {
  /** What stands in the field now. */
  text: string;
  /** The field, or one saved together with it, is marked as refused: what stands in it was not saved. */
  refused: boolean;
  /**
   * The field is a list the player may still be choosing from: he pressed it, which opens it, and has chosen nothing since.
   * The options of an open list are drawn outside the page, so the page hears nothing while he reads them, and taking the
   * cursor out of the list would shut it under his pointer.
   */
  choosing: boolean;
}

/** Something the player typed into a field, read against the page as it is now (`TypingMemory.read`). */
export interface TypedText {
  /** What stood in the field after his last typing into it. */
  typed: string;
  /** What stands in it now; `null` when the field has left the page. */
  now: string | null;
  /** He dealt with it himself after the typing: Enter, Esc, or leaving the cell (see `TypingMemory`). */
  settled: boolean;
  /** The field, or one saved together with it, is marked as refused. */
  refused: boolean;
}

export interface KeyboardUse {
  /** The clock, in milliseconds; the two moments below are of the same clock, `-Infinity` for "never". */
  now: number;
  /** When a key was last pressed in the window (or a choice made from a list). */
  lastKeyAt: number;
  /** When the keyboard was last taken: the player pressed a field, or a button that opens an entry. */
  takenAt: number;
  field: EditedField;
  /** Everything the player typed that is remembered, in whatever field: `TypingMemory.read`. */
  typed: readonly TypedText[];
}

/** The keys after which what was typed is typed no more: `Enter` sends it (or the field is marked as refused), `Esc` takes it back. */
export function settlesTyping(key: string): boolean {
  return key === 'Enter' || key === 'Escape';
}

/**
 * Whether a typed text still waits to be confirmed: it stands in its field exactly as the player left it, it is not empty,
 * and he has not settled it himself; or he has, and was refused. A text the program has replaced (a place picked from a
 * list, a form that emptied its fields after a save) and the text of a field that left the page wait for nothing.
 */
export function isUnconfirmed(text: TypedText): boolean {
  if (text.now === null || text.now !== text.typed || text.typed.trim() === '') return false;
  return !text.settled || text.refused;
}

/**
 * Whether the keyboard goes back to the game now: no key was pressed for `KEYBOARD_IDLE_MS`, counted from the last key
 * or from the take, whichever is later; nothing the player typed still waits to be confirmed, in any field; the field
 * with the cursor is not marked as refused with something in it, and is not a list he may still be choosing from.
 */
export function keyboardUnused(use: KeyboardUse): boolean {
  if (use.now - Math.max(use.lastKeyAt, use.takenAt) < KEYBOARD_IDLE_MS) return false;
  if (use.field.choosing || (use.field.refused && use.field.text.trim() !== '')) return false;
  return !use.typed.some(isUnconfirmed);
}

/** Where a field stands when it comes to confirming what was typed into it. */
export interface FieldPlace {
  /**
   * The field is part of a form (the quick entry, the form of a trade). Enter submits the form and leaving the field does
   * nothing, so no key and no leaving says that its text was dealt with: only the form does, by what becomes of the text
   * (it empties its fields after a save, or goes away; a refused entry keeps its text).
   */
  inForm: boolean;
  /**
   * The key of the cell the field is saved together with: the two fields of an open row of the table, which are saved by
   * Enter in either of them and when the cursor leaves both. `null`: the field is saved alone.
   */
  cell: string | null;
}

/**
 * What the player typed, by field. `F` is whatever names a field (the element itself on the page). It only remembers
 * and reads; when the keyboard may go is `keyboardUnused`.
 *
 * A text is settled by the player's own acts, and only where such an act really deals with it:
 *  - `Enter` or `Esc` in a field that is not part of a form settles that field and the ones of its cell;
 *  - the cursor leaving such a field for something outside its cell does the same (the table saves a cell that is
 *    left, a field of the settings is saved when it is left): that leaving is the player's, never the automatic return,
 *    which does not happen while anything waits;
 *  - in a form nothing is settled by a key or by leaving: Enter in ANOTHER field of the quick entry (a commodity is picked)
 *    confirms no price, and a line that is left is still a line that was typed. What the form does with the text decides.
 * A settled text that was refused still waits (`isUnconfirmed`).
 */
export interface TypingMemory<F> {
  /** The player typed into `field`; `text` is what stands in it now. Every key is told: the last text is what counts. */
  typed(field: F, text: string, place: FieldPlace): void;
  /** A key was pressed in `field`. */
  key(field: F, key: string, place: FieldPlace): void;
  /** The cursor left `field` and went to something that is not a field of its cell. */
  left(field: F, place: FieldPlace): void;
  /**
   * What is remembered, against the page as it is now: `look` says what stands in a field (`null`: it has left the page)
   * and whether it, or a field saved together with it, is marked as refused. A text that the page no longer shows (the
   * field is gone, or holds something else) is forgotten for good.
   */
  read(look: (field: F) => { text: string | null; refused: boolean }): TypedText[];
}

interface Remembered<F> { field: F; text: string; place: FieldPlace; settled: boolean }

export function createTypingMemory<F>(): TypingMemory<F> {
  let remembered: Remembered<F>[] = [];

  const settle = (field: F, place: FieldPlace): void => {
    if (place.inForm) return;
    for (const record of remembered) {
      const sameCell = place.cell !== null && !record.place.inForm && record.place.cell === place.cell;
      if (record.field === field || sameCell) record.settled = true;
    }
  };

  return {
    typed(field, text, place) {
      remembered = remembered.filter((record) => record.field !== field);
      remembered.push({ field, text, place, settled: false });
    },
    key(field, key, place) {
      if (settlesTyping(key)) settle(field, place);
    },
    left: settle,
    read(look) {
      const seen = remembered.map((record) => ({ record, ...look(record.field) }));
      remembered = seen.filter(({ record, text }) => text === record.text).map(({ record }) => record);
      return seen.map(({ record, text, refused }) => ({ typed: record.text, now: text, settled: record.settled, refused }));
    },
  };
}
