// When a keyboard the window holds and nobody uses goes back to the game by itself. Pure: the clock, the keys and the
// fields are read by the watchdog of `ui/keyboard.ts`, which asks here every time it comes round and gives the keyboard
// back the way `Esc` does (the field loses the cursor, whatever is open stays open).
//
// The window keeps the keyboard after an entry so that prices can be typed one after another. A player who is done and
// flies on finds his keys going nowhere. So: no key for `KEYBOARD_IDLE_MS`, and the keyboard is the game's again.
//
// THE INVARIANT: that return must never cause a write, and never cause the loss, of something the player entered and
// did not confirm. Taking the cursor out of a field is not harmless: the table saves a cell that is left, the settings
// save a field that is left, and a window without the keyboard may fold over a line that was typed. So what was typed
// is remembered by its FIELD (`createTypingMemory`): what stood there before, what he typed, wherever the cursor has
// gone since. While any of it still waits the keyboard stays, however long. When in doubt it stays: the worst case is
// the keyboard staying with the window until `Esc`, as it always did.
//
// THE ONE EXCEPTION, a ruling and not a hole (task 54, on the word of a player): a QUERY that is typed into a search box
// and not picked is a search, not an entry. It does not hold the keyboard. «Я записал цену и сразу пошёл в корабль, нажал
// W: буква встала в пустой „Товар“, выпал список, и клавиатура не вернётся сама никогда»: after the same time without a
// key the keyboard goes now, and the box, having lost the cursor, drops the query (the location of the header shows its
// place again, «Товар» of the quick entry is empty again). This is the only place where the return loses something that
// was typed, and nothing else may be added to it without a ruling of its own. What is PICKED in a search box is no query:
// the commodity picked in the quick entry is the player's entry and holds as before, also while a new query is typed over
// it. A search box says itself what is picked in it, and the rules are told that and never the query (`entryText`).

/** How long the window keeps a keyboard that is not used, in milliseconds. The one place this limit is written. */
export const KEYBOARD_IDLE_MS = 15_000;

/**
 * What a field holds as far as these rules go: what the memory is told to have stood in it, to have been typed into it and
 * to stand in it now. `shown` is the text in the field. `picked`: the field is a search box, and this is what is picked in
 * it, the text the box shows when nothing is typed over it (empty: nothing is picked); `null`: the field is no search box.
 *
 * A search box holds its pick, whatever is typed over it: THE EXCEPTION above. So a query never differs from what stood
 * in the box before it was typed, and nothing of it waits; a pick does, where a pick is an entry (in a form).
 */
export function entryText(shown: string, picked: string | null): string {
  return picked ?? shown;
}

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

/**
 * Where a field stands when it comes to confirming what was typed into it. Three kinds of place, and the page itself
 * says which: a field of a form; a field that the page MARKS as saved by Enter and when it is left; anything else, of
 * which nothing is known.
 */
export interface FieldPlace {
  /**
   * The field is part of a form (the quick entry, the form of a trade). Enter submits the form and leaving the field does
   * nothing, so no key and no leaving says that its text was dealt with: only the form does, by putting the field back
   * to what it held before the player began (it empties its fields after a save) or by going away.
   */
  inForm: boolean;
  /**
   * The page says that the component of this field saves it at Enter and when the cursor leaves it, and deals with it at
   * Esc too (the table drops the draft, the settings take the saved number back): a cell of the table, a field of the
   * settings. Only there do those acts of the player settle what he typed.
   * Without that mark nothing is assumed: a component that does not save at those events would lose the text.
   */
  commits: boolean;
  /**
   * The key of the cell the field is saved together with: the two fields of an open row of the table, which are saved by
   * Enter in either of them and when the cursor leaves both. `null`: the field is saved alone.
   */
  cell: string | null;
}

/** Something the player typed into a field, read against the page as it is now (`TypingMemory.read`). */
export interface TypedText {
  /** What stood in the field after his last typing into it. */
  typed: string;
  /** What stood in the field before he began to type into it; `null` when nobody saw it. */
  start: string | null;
  /** What stands in it now; `null` when the field has left the page. */
  now: string | null;
  place: FieldPlace;
  /** He dealt with it himself after the typing, where the page says such an act saves: Enter, Esc, leaving the cell. */
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
 * Whether what the player entered into a field still waits to be confirmed. It depends on where the field stands:
 *
 *  - in a form: while the field holds anything else than before he began. A text the program put in place of what he
 *    typed (a commodity picked from the list) is his entry too. Nothing but the form lets go: back at the starting text
 *    (emptied after a save, or deleted by him) nothing waits. With no starting text known, it waits;
 *  - where the page says the field is saved by Enter and when it is left: while the text he typed still stands there
 *    and he has not settled it; or he has, and was refused. Whatever the text: an EMPTIED field waits (leaving it would
 *    save "nothing" over what stood there), and so does a text typed back to what stood there (the table saves a typed
 *    price that equals a reference price). A text the program put in its place waits for nothing;
 *  - anywhere else: while the text he typed still stands there and differs from what stood there before. No key and no
 *    leaving settles it, for nobody said the field is saved then; only the program lets go, by replacing the text.
 *
 * A field that left the page waits for nothing.
 */
export function isUnconfirmed(text: TypedText): boolean {
  if (text.now === null) return false;
  if (text.place.inForm) return text.now !== text.start;
  if (text.now !== text.typed) return false;
  return text.place.commits ? !text.settled || text.refused : text.typed !== text.start;
}

/**
 * Whether the keyboard goes back to the game now: no key was pressed for `KEYBOARD_IDLE_MS`, counted from the last key
 * or from the take, whichever is later; nothing the player entered still waits to be confirmed, in any field; the field
 * with the cursor is not marked as refused with something in it, and is not a list he may still be choosing from.
 */
export function keyboardUnused(use: KeyboardUse): boolean {
  if (use.now - Math.max(use.lastKeyAt, use.takenAt) < KEYBOARD_IDLE_MS) return false;
  if (use.field.choosing || (use.field.refused && use.field.text.trim() !== '')) return false;
  return !use.typed.some(isUnconfirmed);
}

/**
 * What the player typed, by field. `F` is whatever names a field (the element itself on the page). It only remembers
 * and reads; when the keyboard may go is `keyboardUnused`, and what still waits is `isUnconfirmed`.
 *
 * A text is settled by the player's own acts, and only where the page says such an act saves the field
 * (`FieldPlace.commits`): `Enter` or `Esc` in the field settles it and the fields of its cell, and so does the cursor
 * leaving it for something outside its cell. That leaving is the player's, never the automatic return, which does not
 * happen while anything waits. In a form and anywhere else a key and a leaving settle nothing.
 */
export interface TypingMemory<F> {
  /**
   * The cursor came into `field`, or the player is about to type into it: `text` is what stands in it. It is remembered
   * as the text the field started with, unless what he entered there before still stands (the cursor merely came back).
   */
  begins(field: F, text: string): void;
  /** The player typed into `field`; `text` is what stands in it now. Every key is told: the last text is what counts. */
  typed(field: F, text: string, place: FieldPlace): void;
  /** A key was pressed in `field`. */
  key(field: F, key: string, place: FieldPlace): void;
  /** The cursor left `field` and went to something that is not a field of its cell. */
  left(field: F, place: FieldPlace): void;
  /**
   * What is remembered, against the page as it is now: `look` says what stands in a field (`null`: it has left the page)
   * and whether it, or a field saved together with it, is marked as refused. A field that left the page is forgotten;
   * outside a form so is a text the program has replaced. A field of a form is remembered while it is on the page, with
   * the text it started with.
   */
  read(look: (field: F) => { text: string | null; refused: boolean }): TypedText[];
}

interface Remembered<F> { field: F; start: string | null; text: string; place: FieldPlace; settled: boolean }

export function createTypingMemory<F>(): TypingMemory<F> {
  let remembered: Remembered<F>[] = [];
  /** The field the cursor is in (or that is about to be typed into) and what stood in it then; one at a time. */
  let begun: { field: F; text: string } | null = null;

  const settle = (field: F, place: FieldPlace): void => {
    if (place.inForm || !place.commits) return;
    for (const record of remembered) {
      const sameCell = place.cell !== null && record.place.commits && !record.place.inForm && record.place.cell === place.cell;
      if (record.field === field || sameCell) record.settled = true;
    }
  };

  return {
    begins(field, text) {
      const record = remembered.find((known) => known.field === field);
      if (record !== undefined) {
        // what he entered still stands (in a form whatever stands in its place is his entry too): nothing new begins
        if (record.place.inForm || record.text === text) return;
        // the program has put another text in place of what he typed: that typing is over
        remembered = remembered.filter((known) => known !== record);
      }
      begun = { field, text };
    },
    typed(field, text, place) {
      const record = remembered.find((known) => known.field === field);
      if (record !== undefined) {
        record.text = text;
        record.place = place;
        record.settled = false;
        return;
      }
      remembered.push({ field, start: begun !== null && begun.field === field ? begun.text : null, text, place, settled: false });
    },
    key(field, key, place) {
      if (settlesTyping(key)) settle(field, place);
    },
    left: settle,
    read(look) {
      const seen = remembered.map((record) => ({ record, ...look(record.field) }));
      remembered = seen
        .filter(({ record, text }) => text !== null && (record.place.inForm || text === record.text))
        .map(({ record }) => record);
      return seen.map(({ record, text, refused }) => ({
        typed: record.text, start: record.start, now: text, place: record.place, settled: record.settled, refused,
      }));
    },
  };
}
