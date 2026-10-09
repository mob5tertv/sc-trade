// The field of a key in the settings takes the key that is pressed: the press is turned into the text the check of the
// keys reads (`parse_key` of src-tauri/src/keys.rs: "F9", "Shift+F9", "Ctrl+Alt+T"). Pure; the field decides what to do with the answer.

/** What a `keydown` says: `key` is what the layout makes of the press, `code` is the place of the key on the keyboard. */
export interface KeyPress {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/**
 * What the field does with a press: `pass` leaves it to the page (it is not written, it is not stopped), `clear` takes the key off the
 * action, `set` writes the text. A key the check does not take is `set` too: the check says why, next to the field.
 */
export type KeyCapture = { kind: 'pass' } | { kind: 'clear' } | { kind: 'set'; text: string };

/**
 * Not written whatever else is held: Esc gives the keyboard back to the game, Tab goes to the next field (Shift+Tab to the previous),
 * a modifier alone is not a key yet, and a dead key or a key of an input method is not a key of its own.
 */
const PASS = new Set(['Escape', 'Tab', 'Control', 'Alt', 'Shift', 'Meta', 'OS', 'AltGraph', 'Dead', 'Process', 'Unidentified']);

/** The keys that have a name of their own for the check (`lookup_key` of keys.rs), as the browser names them. */
const NAMED = new Set(['ScrollLock', 'Pause', 'Insert', 'Home', 'End', 'PageUp', 'PageDown']);

const FUNCTION_KEY = /^F([1-9]|1\d|2[0-4])$/;
const LETTER_CODE = /^Key([A-Z])$/;
const DIGIT_CODE = /^Digit([0-9])$/;

/** The name of the main key; for a key the check does not take it is a name that says which key it was. */
function mainKey({ key, code }: Pick<KeyPress, 'key' | 'code'>): string {
  if (FUNCTION_KEY.test(key) || NAMED.has(key)) return key;
  // the key of the numeric pad is not the key of the main row: the check does not take it, and its name says so
  if (code.startsWith('Numpad')) return code;
  const place = LETTER_CODE.exec(code) ?? DIGIT_CODE.exec(code);
  if (place !== null) return place[1];
  if (code === '' && /^[a-zA-Z0-9]$/.test(key)) return key.toUpperCase();
  // a plus is the separator of the text, a space cannot be read in it
  if (key === '+') return 'Plus';
  if (key === ' ') return 'Space';
  return key === '' ? code : key;
}

/** The modifiers in one order, whichever order they were pressed in. */
function modifiersOf(press: KeyPress): string[] {
  return [press.ctrlKey && 'Ctrl', press.altKey && 'Alt', press.shiftKey && 'Shift', press.metaKey && 'Win'].filter((name): name is string => name !== false);
}

export function captureKey(press: KeyPress): KeyCapture {
  if (PASS.has(press.key)) return { kind: 'pass' };
  const modifiers = modifiersOf(press);
  if (modifiers.length === 0 && (press.key === 'Backspace' || press.key === 'Delete')) return { kind: 'clear' };
  return { kind: 'set', text: [...modifiers, mainKey(press)].join('+') };
}
