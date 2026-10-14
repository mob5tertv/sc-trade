// The field of a key in the settings takes the key that is pressed: the press is turned into the text the check of the keys reads
// (`parse_key` of src-tauri/src/keys.rs: "F9", "Shift+F9", "Ctrl+Alt+T"). Pure; the field decides what to do with the answer.
//
// Only what that check takes is ever written. A text it refuses unbinds the action, so a key that is not suitable is not written at
// all: the key that was saved stays, and the field says why. The rules here are its rules: F1–F24, the named keys, a letter or a digit
// only together with Ctrl or Alt, and the modifiers Ctrl, Alt and Shift; the reasons are its words («нужен Ctrl или Alt», «неизвестная клавиша»).
// Three things the check would take are not written, because they would never work: F5, F11 and F12 and Ctrl+R / Ctrl+Shift+R are the window's own
// (reload, full screen, tools), and Pause with Ctrl, which Windows reports as another virtual key.

/** What a `keydown` says: `key` is what the layout makes of the press, `code` is the place of the key on the keyboard. */
import { tr } from '../../i18n';

export interface KeyPress {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/**
 * What the field does with a press:
 *  - `pass`: it is none of the field's business: it is not written and not stopped (Enter, Esc, Tab, a modifier alone, Alt+F4, ...);
 *  - `clear`: Backspace or Delete take the key off the action;
 *  - `set`: the text to write, a key that can be assigned;
 *  - `refuse`: not written, the key stays as it was and is stopped (so that it does not do its own work in the window); `reason`
 *    is a sentence for the field, with the reason in the words of the check.
 */
export type KeyCapture = { kind: 'pass' } | { kind: 'clear' } | { kind: 'set'; text: string } | { kind: 'refuse'; reason: string };

/**
 * Not the field's business, whatever else is held: Enter does in a key field what it does in the other fields of the settings, Esc
 * gives the keyboard back to the game, Tab goes to the next field (Shift+Tab to the previous), a modifier alone is not a key yet, the
 * Windows key belongs to Windows, and a dead key or a key of an input method is not a key of its own.
 */
const PASS = new Set(['Enter', 'Escape', 'Tab', 'Control', 'Alt', 'Shift', 'Meta', 'OS', 'AltGraph', 'Dead', 'Process', 'Unidentified']);

/** The keys that have a name of their own for the check (`lookup_key` of keys.rs), as the browser names them. */
const NAMED = new Set(['ScrollLock', 'Pause', 'Insert', 'Home', 'End', 'PageUp', 'PageDown']);

/** The keys of the window itself: the page is reloaded, shown full screen, its tools opened. They could be assigned, and the window would not let them be. */
const WINDOW_KEYS = new Set(['F5', 'F11', 'F12']);

const FUNCTION_KEY = /^F([1-9]|1\d|2[0-4])$/;
const LETTER_OR_DIGIT = /^[a-zA-Z0-9]$/;
const LETTER_CODE = /^Key([A-Z])$/;
const DIGIT_CODE = /^Digit([0-9])$/;

const NOT_SUITABLE = (): string => tr('Эта клавиша не подходит: ');
const SUITABLE = (): string => tr('Подходят F1–F24, кроме F5, F11 и F12, ScrollLock, Pause, Insert, Home, End, PageUp, PageDown, а также буква или цифра с Ctrl или Alt.');

const refuse = (reason: string): KeyCapture => ({ kind: 'refuse', reason: `${NOT_SUITABLE()}${reason}` });

/** The main key: its name (for the text or for the refusal), whether the check knows it, and whether it is a letter or a digit (those need Ctrl or Alt). */
interface Main { name: string; known: boolean; alnum: boolean }

/**
 * The main key. A letter or a digit is the one the LAYOUT shows (`key`), because the key the hook compares is the virtual key of the
 * layout: the AZERTY key that says «a» is A. Only where the key says nothing in ASCII (the Russian layout, the digit row of AZERTY
 * that says «&», a digit under Shift) the place of the key (`code`) stands in for it.
 */
function mainKey({ key, code }: Pick<KeyPress, 'key' | 'code'>): Main {
  const named = (name: string): Main => ({ name, known: true, alnum: false });
  if (key === 'Cancel' && code === 'Pause') return named('Pause'); // Ctrl+Pause: named here to be refused with its own reason
  if (FUNCTION_KEY.test(key) || NAMED.has(key)) return named(key);
  // the key of the numeric pad is not the key of the main row: the check does not know it, and its name says so
  if (code.startsWith('Numpad')) return { name: code, known: false, alnum: false };
  if (LETTER_OR_DIGIT.test(key)) return { name: key.toUpperCase(), known: true, alnum: true };
  const place = LETTER_CODE.exec(code) ?? DIGIT_CODE.exec(code);
  if (place !== null) return { name: place[1], known: true, alnum: true };
  // a plus is the separator of the text, a space cannot be read in it
  if (key === '+') return { name: 'Plus', known: false, alnum: false };
  if (key === ' ') return { name: 'Space', known: false, alnum: false };
  return { name: key === '' ? code : key, known: false, alnum: false };
}

export function captureKey(press: KeyPress): KeyCapture {
  if (PASS.has(press.key)) return { kind: 'pass' };
  if (press.altKey && press.key === 'F4') return { kind: 'pass' }; // closes the window: Windows does it, the field does not stand in the way

  const { ctrlKey, altKey, shiftKey, metaKey } = press;
  if (!ctrlKey && !altKey && !shiftKey && !metaKey && (press.key === 'Backspace' || press.key === 'Delete')) return { kind: 'clear' };

  const main = mainKey(press);
  if (metaKey) return refuse(tr('клавиша Win в записи не используется.'));
  if (!main.known) return refuse(tr('неизвестная клавиша: {name}. {suitable}', { name: main.name, suitable: SUITABLE() }));
  // Ctrl+R and Ctrl+Shift+R reload the page; with Alt as well (Ctrl+Alt+R) the press is not a reload
  if (WINDOW_KEYS.has(main.name) || (main.name === 'R' && ctrlKey && !altKey)) return refuse(tr('{name} — её занимает окно.', { name: main.name }));
  // Windows reports Ctrl+Pause as another virtual key (Break), the check of the Rust side would bind Pause, and the bound key would never fire
  if (main.name === 'Pause' && ctrlKey) return refuse(tr('Pause с Ctrl Windows передаёт как другую клавишу, и запись не сработала бы. Pause подходит сама, с Alt или с Shift.'));
  if (main.alnum && !ctrlKey && !altKey) return refuse(tr('нужен Ctrl или Alt (буква или цифра сама по себе не подходит).'));

  const modifiers = [ctrlKey && 'Ctrl', altKey && 'Alt', shiftKey && 'Shift'].filter((name): name is string => name !== false);
  return { kind: 'set', text: [...modifiers, main.name].join('+') };
}
