import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { captureKey, type KeyPress } from '../../src/ui/vm/key-capture';

// A key press as the browser reports it: `key` is what the layout says, `code` is the place of the key on the keyboard.
const press = (key: string, code = '', mods: Partial<Pick<KeyPress, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>> = {}): KeyPress => ({
  key, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods,
});
const CTRL = { ctrlKey: true } as const;
const ALT = { altKey: true } as const;
const SHIFT = { shiftKey: true } as const;

const set = (text: string) => ({ kind: 'set', text });
const PASS = { kind: 'pass' } as const;

describe('captureKey: the key that is pressed, in the text the check of the keys takes', () => {
  it('writes a function key as it is: F1 to F24', () => {
    for (let n = 1; n <= 24; n++) expect(captureKey(press(`F${n}`, `F${n}`)), `F${n}`).toEqual(set(`F${n}`));
  });

  it('writes the named keys the check knows: ScrollLock, Pause, Insert, Home, End, PageUp, PageDown', () => {
    for (const name of ['ScrollLock', 'Pause', 'Insert', 'Home', 'End', 'PageUp', 'PageDown']) {
      expect(captureKey(press(name, name)), name).toEqual(set(name));
    }
  });

  it('writes a letter as a capital and a digit as it is, by the place of the key (the layout does not matter)', () => {
    for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      expect(captureKey(press(letter.toLowerCase(), `Key${letter}`, CTRL)), letter).toEqual(set(`Ctrl+${letter}`));
    }
    for (const digit of '0123456789') expect(captureKey(press(digit, `Digit${digit}`, ALT)), digit).toEqual(set(`Alt+${digit}`));
    // the Russian layout: the key says «ф», it is the key A
    expect(captureKey(press('ф', 'KeyA', CTRL))).toEqual(set('Ctrl+A'));
    // Shift changes what the layout says, not the key: Shift+1 says «!», it is the key 1
    expect(captureKey(press('!', 'Digit1', { ctrlKey: true, shiftKey: true }))).toEqual(set('Ctrl+Shift+1'));
  });

  it('knows a letter of an event that has no place of the key (a made-up event): the key says it', () => {
    expect(captureKey(press('t', '', CTRL))).toEqual(set('Ctrl+T'));
    expect(captureKey(press('7', '', ALT))).toEqual(set('Alt+7'));
  });

  it('writes the modifiers in one order, Ctrl, Alt, Shift, whichever order they were pressed in', () => {
    expect(captureKey(press('F9', 'F9', SHIFT))).toEqual(set('Shift+F9'));
    expect(captureKey(press('t', 'KeyT', { ctrlKey: true, altKey: true }))).toEqual(set('Ctrl+Alt+T'));
    expect(captureKey(press('t', 'KeyT', { altKey: true, ctrlKey: true }))).toEqual(set('Ctrl+Alt+T'));
    expect(captureKey(press('F8', 'F8', { shiftKey: true, altKey: true, ctrlKey: true }))).toEqual(set('Ctrl+Alt+Shift+F8'));
    expect(captureKey(press('F8', 'F8', { shiftKey: true, ctrlKey: true }))).toEqual(set('Ctrl+Shift+F8'));
  });

  it('takes a lone modifier for nothing: the main key has not been pressed yet', () => {
    for (const key of ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph']) {
      expect(captureKey(press(key, `${key}Left`, { ctrlKey: key === 'Control', altKey: key === 'Alt', shiftKey: key === 'Shift' })), key).toEqual(PASS);
    }
  });

  it('leaves Esc and Tab alone, with any modifier: Esc gives the keyboard back to the game, Tab goes to the next field', () => {
    expect(captureKey(press('Escape', 'Escape'))).toEqual(PASS);
    expect(captureKey(press('Tab', 'Tab'))).toEqual(PASS);
    expect(captureKey(press('Tab', 'Tab', SHIFT))).toEqual(PASS); // Shift+Tab goes back
    expect(captureKey(press('Tab', 'Tab', ALT))).toEqual(PASS);
    expect(captureKey(press('Escape', 'Escape', CTRL))).toEqual(PASS);
  });

  it('leaves alone what is not a key of its own: a dead key, a key of an input method', () => {
    for (const key of ['Dead', 'Process', 'Unidentified']) expect(captureKey(press(key, 'Quote')), key).toEqual(PASS);
  });

  it('takes the key off with Backspace or Delete', () => {
    expect(captureKey(press('Backspace', 'Backspace'))).toEqual({ kind: 'clear' });
    expect(captureKey(press('Delete', 'Delete'))).toEqual({ kind: 'clear' });
  });

  it('writes Backspace or Delete with a modifier as a key, for the check to refuse: only the bare key takes the assignment off', () => {
    expect(captureKey(press('Backspace', 'Backspace', CTRL))).toEqual(set('Ctrl+Backspace'));
    expect(captureKey(press('Delete', 'Delete', SHIFT))).toEqual(set('Shift+Delete'));
  });

  it('writes a key the check does not take under a name of its own, so that the check can say why', () => {
    expect(captureKey(press('ArrowUp', 'ArrowUp'))).toEqual(set('ArrowUp'));
    expect(captureKey(press('Enter', 'Enter'))).toEqual(set('Enter'));
    expect(captureKey(press(' ', 'Space', CTRL))).toEqual(set('Ctrl+Space'));
    expect(captureKey(press(';', 'Semicolon', ALT))).toEqual(set('Alt+;'));
    expect(captureKey(press('CapsLock', 'CapsLock'))).toEqual(set('CapsLock'));
  });

  it('never writes a plus as a plus: it is the separator of the text', () => {
    expect(captureKey(press('+', 'Equal', { ctrlKey: true, shiftKey: true }))).toEqual(set('Ctrl+Shift+Plus'));
    expect(captureKey(press('+', 'NumpadAdd', CTRL))).toEqual(set('Ctrl+NumpadAdd'));
  });

  it('names a key of the numeric pad by its place: it is another key than the digit of the main row, and the check says so', () => {
    expect(captureKey(press('1', 'Numpad1', CTRL))).toEqual(set('Ctrl+Numpad1'));
    expect(captureKey(press('Enter', 'NumpadEnter'))).toEqual(set('NumpadEnter'));
  });

  it('names the Windows key as a modifier, for the check to refuse', () => {
    expect(captureKey(press('t', 'KeyT', { metaKey: true, ctrlKey: true }))).toEqual(set('Ctrl+Win+T'));
  });
});

describe('captureKey against the check of the keys', () => {
  // The Rust side (src-tauri/src/keys.rs) decides what is a key. The text made here must be one it takes, for every key it takes.
  const RUST = readFileSync('src-tauri/src/keys.rs', 'utf8');

  it('knows exactly the named keys the Rust check knows (the list below is the names of the keys of an event)', () => {
    const rust = [...RUST.matchAll(/"(\w+)" => return named\(/g)].map((m) => m[1]).sort();
    expect(rust).toEqual(['ScrollLock', 'Pause', 'Insert', 'Home', 'End', 'PageUp', 'PageDown'].map((name) => name.toLowerCase()).sort());
  });

  it('knows the range of the function keys the Rust check takes', () => {
    expect(RUST).toContain('const FUNCTION_KEYS: u32 = 24;');
  });

  it('knows that a letter or a digit needs Ctrl or Alt there: it writes them with the modifiers that were pressed and no others', () => {
    expect(RUST).toContain('works_alone: false');
    expect(captureKey(press('t', 'KeyT'))).toEqual(set('T')); // written as pressed: the check says «нужен Ctrl или Alt»
    expect(captureKey(press('T', 'KeyT', SHIFT))).toEqual(set('Shift+T'));
  });
});
