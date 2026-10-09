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
const CLEAR = { kind: 'clear' } as const;
const NOT_SUITABLE = 'Эта клавиша не подходит: ';

/** What the field says of a key it does not write: the refusal, its reason after the fixed beginning. */
const reasonOf = (capture: ReturnType<typeof captureKey>): string => {
  expect(capture.kind).toBe('refuse');
  return capture.kind === 'refuse' ? capture.reason : '';
};

// The Rust side (src-tauri/src/keys.rs) decides what can be assigned. The rules below are its rules, and the first tests keep them together.
const RUST = readFileSync('src-tauri/src/keys.rs', 'utf8');

describe('captureKey: the rules are those of the check of the keys of the Rust side', () => {
  it('knows exactly the named keys the Rust check knows (the list is the names of the keys of an event)', () => {
    const rust = [...RUST.matchAll(/"(\w+)" => return named\(/g)].map((m) => m[1]).sort();
    expect(rust).toEqual(['ScrollLock', 'Pause', 'Insert', 'Home', 'End', 'PageUp', 'PageDown'].map((name) => name.toLowerCase()).sort());
  });

  it('knows the range of the function keys the Rust check takes, and that a letter or a digit needs Ctrl or Alt there', () => {
    expect(RUST).toContain('const FUNCTION_KEYS: u32 = 24;');
    expect(RUST).toContain('works_alone: false');
    expect(RUST).toContain('"нужен Ctrl или Alt"');
    expect(RUST).toContain('неизвестная клавиша');
  });
});

describe('captureKey: what is written', () => {
  it('writes a function key as it is: F1 to F24', () => {
    for (let n = 1; n <= 24; n++) {
      if ([5, 11, 12].includes(n)) continue; // the keys of the window itself: below
      expect(captureKey(press(`F${n}`, `F${n}`)), `F${n}`).toEqual(set(`F${n}`));
    }
  });

  it('writes the named keys the check knows: ScrollLock, Pause, Insert, Home, End, PageUp, PageDown', () => {
    for (const name of ['ScrollLock', 'Pause', 'Insert', 'Home', 'End', 'PageUp', 'PageDown']) {
      expect(captureKey(press(name, name)), name).toEqual(set(name));
    }
  });

  it('writes Ctrl+Pause as Pause: the browser calls the key «Cancel» then', () => {
    expect(captureKey(press('Cancel', 'Pause', CTRL))).toEqual(set('Ctrl+Pause'));
    expect(captureKey(press('Cancel', 'Pause'))).toEqual(set('Pause'));
  });

  it('writes a letter or a digit with Ctrl or Alt, as a capital letter', () => {
    for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      if (letter === 'R') continue; // Ctrl+R reloads the page: below
      expect(captureKey(press(letter.toLowerCase(), `Key${letter}`, CTRL)), letter).toEqual(set(`Ctrl+${letter}`));
      expect(captureKey(press(letter, `Key${letter}`, { altKey: true, shiftKey: true })), letter).toEqual(set(`Alt+Shift+${letter}`));
    }
    for (const digit of '0123456789') expect(captureKey(press(digit, `Digit${digit}`, ALT)), digit).toEqual(set(`Alt+${digit}`));
  });

  it('writes the modifiers in one order, Ctrl, Alt, Shift, whichever order they were pressed in', () => {
    expect(captureKey(press('F9', 'F9', SHIFT))).toEqual(set('Shift+F9'));
    expect(captureKey(press('t', 'KeyT', { ctrlKey: true, altKey: true }))).toEqual(set('Ctrl+Alt+T'));
    expect(captureKey(press('t', 'KeyT', { altKey: true, ctrlKey: true }))).toEqual(set('Ctrl+Alt+T'));
    expect(captureKey(press('F8', 'F8', { shiftKey: true, altKey: true, ctrlKey: true }))).toEqual(set('Ctrl+Alt+Shift+F8'));
    expect(captureKey(press('F8', 'F8', { shiftKey: true, ctrlKey: true }))).toEqual(set('Ctrl+Shift+F8'));
  });

  describe('the letter is the one the layout shows, because the key the hook compares is the one of the layout', () => {
    it('is the letter the key says when that is an ASCII letter or digit: AZERTY, QWERTZ, Dvorak', () => {
      // AZERTY: the key in the place of Q says «a»
      expect(captureKey(press('a', 'KeyQ', CTRL))).toEqual(set('Ctrl+A'));
      // QWERTZ: the key in the place of Y says «z»
      expect(captureKey(press('z', 'KeyY', ALT))).toEqual(set('Alt+Z'));
      // Dvorak: the key in the place of S says «o»
      expect(captureKey(press('o', 'KeyS', CTRL))).toEqual(set('Ctrl+O'));
      // Shift makes the letter a capital: the same letter
      expect(captureKey(press('A', 'KeyQ', { ctrlKey: true, shiftKey: true }))).toEqual(set('Ctrl+Shift+A'));
    });

    it('is the place of the key only where the key says nothing in ASCII: the Russian layout, the digit row of AZERTY, Shift on the digits', () => {
      expect(captureKey(press('ф', 'KeyA', CTRL))).toEqual(set('Ctrl+A'));
      expect(captureKey(press('&', 'Digit1', CTRL))).toEqual(set('Ctrl+1')); // AZERTY: the key of the 1 says «&»
      expect(captureKey(press('!', 'Digit1', { ctrlKey: true, shiftKey: true }))).toEqual(set('Ctrl+Shift+1'));
    });

    it('knows a letter of an event that has no place of the key (a made-up event): the key says it', () => {
      expect(captureKey(press('t', '', CTRL))).toEqual(set('Ctrl+T'));
      expect(captureKey(press('7', '', ALT))).toEqual(set('Alt+7'));
    });
  });

  it('writes Home, End and the other named keys of the numeric pad with NumLock off: they are the keys of the same name', () => {
    expect(captureKey(press('Home', 'Numpad7'))).toEqual(set('Home'));
    expect(captureKey(press('PageUp', 'Numpad9', CTRL))).toEqual(set('Ctrl+PageUp'));
  });
});

describe('captureKey: what is taken off, and what is let through untouched', () => {
  it('takes the key off with Backspace or Delete, bare', () => {
    expect(captureKey(press('Backspace', 'Backspace'))).toEqual(CLEAR);
    expect(captureKey(press('Delete', 'Delete'))).toEqual(CLEAR);
  });

  it('is refused for Backspace or Delete with a modifier: only the bare key takes the assignment off, the others are no key', () => {
    expect(reasonOf(captureKey(press('Backspace', 'Backspace', CTRL)))).toContain('неизвестная клавиша: Backspace');
    expect(reasonOf(captureKey(press('Delete', 'Delete', SHIFT)))).toContain('неизвестная клавиша: Delete');
  });

  it('lets Enter and Enter of the pad through: they do in a key field what they do in the other fields of the settings', () => {
    expect(captureKey(press('Enter', 'Enter'))).toEqual(PASS);
    expect(captureKey(press('Enter', 'NumpadEnter'))).toEqual(PASS);
  });

  it('lets Esc and Tab through, with any modifier: Esc gives the keyboard back to the game, Tab goes to the next field, Shift+Tab to the previous', () => {
    expect(captureKey(press('Escape', 'Escape'))).toEqual(PASS);
    expect(captureKey(press('Tab', 'Tab'))).toEqual(PASS);
    expect(captureKey(press('Tab', 'Tab', SHIFT))).toEqual(PASS);
    expect(captureKey(press('Tab', 'Tab', ALT))).toEqual(PASS);
    expect(captureKey(press('Escape', 'Escape', CTRL))).toEqual(PASS);
  });

  it('lets a lone modifier through: the main key has not been pressed yet', () => {
    for (const key of ['Control', 'Alt', 'Shift', 'AltGraph']) {
      expect(captureKey(press(key, `${key}Left`, { ctrlKey: key === 'Control', altKey: key === 'Alt', shiftKey: key === 'Shift' })), key).toEqual(PASS);
    }
  });

  it('lets the Windows key through, alone: it belongs to Windows', () => {
    expect(captureKey(press('Meta', 'MetaLeft', { metaKey: true }))).toEqual(PASS);
    expect(captureKey(press('OS', 'OSLeft', { metaKey: true }))).toEqual(PASS);
  });

  it('lets Alt+F4 through: it closes the window, and the field neither writes it nor stops it', () => {
    expect(captureKey(press('F4', 'F4', ALT))).toEqual(PASS);
    expect(captureKey(press('F4', 'F4', { altKey: true, shiftKey: true }))).toEqual(PASS);
    // F4 alone, and with Ctrl, are keys like the others
    expect(captureKey(press('F4', 'F4'))).toEqual(set('F4'));
    expect(captureKey(press('F4', 'F4', CTRL))).toEqual(set('Ctrl+F4'));
  });

  it('lets a dead key and a key of an input method through: they are not keys of their own', () => {
    for (const key of ['Dead', 'Process', 'Unidentified']) expect(captureKey(press(key, 'Quote')), key).toEqual(PASS);
  });
});

describe('captureKey: what is not written, because the Rust check would refuse it and unbind the action', () => {
  it('refuses a letter or a digit without Ctrl or Alt, in the words of the check: «нужен Ctrl или Alt»', () => {
    expect(reasonOf(captureKey(press('t', 'KeyT')))).toContain('нужен Ctrl или Alt');
    expect(reasonOf(captureKey(press('5', 'Digit5')))).toContain('нужен Ctrl или Alt');
    // Shift alone is not enough: Shift+T is a capital letter
    expect(reasonOf(captureKey(press('T', 'KeyT', SHIFT)))).toContain('нужен Ctrl или Alt');
    expect(reasonOf(captureKey(press('!', 'Digit1', SHIFT)))).toContain('нужен Ctrl или Alt');
  });

  it('refuses the keys that are no key for the check, in its words: «неизвестная клавиша»', () => {
    for (const [key, code, name] of [
      [' ', 'Space', 'Space'], ['ArrowUp', 'ArrowUp', 'ArrowUp'], ['ArrowLeft', 'ArrowLeft', 'ArrowLeft'], ['CapsLock', 'CapsLock', 'CapsLock'],
      ['NumLock', 'NumLock', 'NumLock'], ['ContextMenu', 'ContextMenu', 'ContextMenu'], [';', 'Semicolon', ';'], ['+', 'Equal', 'Plus'],
      ['PrintScreen', 'PrintScreen', 'PrintScreen'], ['Clear', 'Clear', 'Clear'], ['F25', 'F25', 'F25'],
    ] as const) {
      expect(reasonOf(captureKey(press(key, code, CTRL))), name).toContain(`неизвестная клавиша: ${name}`);
    }
  });

  it('lists what is suitable in the refusal of an unknown key', () => {
    const reason = reasonOf(captureKey(press(' ', 'Space')));
    expect(reason.startsWith(NOT_SUITABLE)).toBe(true);
    for (const word of ['F1–F24', 'ScrollLock', 'Pause', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'Ctrl или Alt']) expect(reason, word).toContain(word);
  });

  it('refuses the keys of the numeric pad: they are other keys than those of the main row, and the check does not know them', () => {
    expect(reasonOf(captureKey(press('1', 'Numpad1', CTRL)))).toContain('неизвестная клавиша: Numpad1');
    expect(reasonOf(captureKey(press('+', 'NumpadAdd', CTRL)))).toContain('неизвестная клавиша: NumpadAdd');
  });

  it('refuses a combination with the Windows key: it is no modifier of the notation', () => {
    expect(reasonOf(captureKey(press('t', 'KeyT', { metaKey: true, ctrlKey: true })))).toContain('Win');
    expect(captureKey(press('F8', 'F8', { metaKey: true })).kind).toBe('refuse');
  });

  it('refuses F5, F11, F12 and Ctrl+R, which are the window\'s own (reload, full screen, tools), with any modifier', () => {
    for (const name of ['F5', 'F11', 'F12']) {
      expect(reasonOf(captureKey(press(name, name))), name).toContain('занимает окно');
      expect(captureKey(press(name, name, CTRL)).kind, `Ctrl+${name}`).toBe('refuse');
      expect(captureKey(press(name, name, SHIFT)).kind, `Shift+${name}`).toBe('refuse');
    }
    expect(reasonOf(captureKey(press('r', 'KeyR', CTRL)))).toContain('занимает окно');
    expect(captureKey(press('R', 'KeyR', { ctrlKey: true, shiftKey: true })).kind).toBe('refuse');
    // Alt+R and Ctrl+Alt+R reload nothing
    expect(captureKey(press('r', 'KeyR', ALT))).toEqual(set('Alt+R'));
  });

  it('says every refusal in the same beginning, so that the field can show it as one kind of message', () => {
    for (const capture of [
      captureKey(press('t', 'KeyT')), captureKey(press(' ', 'Space')), captureKey(press('F5', 'F5')), captureKey(press('t', 'KeyT', { metaKey: true })),
    ]) expect(reasonOf(capture).startsWith(NOT_SUITABLE)).toBe(true);
  });

  it('writes nothing the Rust check would refuse: every `set` is a function key, a named key, or a letter or digit with Ctrl or Alt', () => {
    const MODS = [{}, CTRL, ALT, SHIFT, { ctrlKey: true, altKey: true }, { ctrlKey: true, shiftKey: true }];
    const KEYS: Array<[string, string]> = [
      ['F1', 'F1'], ['F24', 'F24'], ['ScrollLock', 'ScrollLock'], ['Pause', 'Pause'], ['PageDown', 'PageDown'],
      ['a', 'KeyA'], ['z', 'KeyZ'], ['0', 'Digit0'], ['9', 'Digit9'], [' ', 'Space'], ['Enter', 'Enter'], ['ArrowDown', 'ArrowDown'], ['q', 'KeyQ'],
    ];
    for (const [key, code] of KEYS) {
      for (const mods of MODS) {
        const capture = captureKey(press(key, code, mods));
        if (capture.kind !== 'set') continue;
        const parts = capture.text.split('+');
        const main = parts[parts.length - 1];
        const named = /^F([1-9]|1\d|2[0-4])$/.test(main) || ['ScrollLock', 'Pause', 'Insert', 'Home', 'End', 'PageUp', 'PageDown'].includes(main);
        const alnum = /^[A-Z0-9]$/.test(main);
        expect(named || (alnum && (parts.includes('Ctrl') || parts.includes('Alt'))), capture.text).toBe(true);
        expect(parts.slice(0, -1).every((part) => ['Ctrl', 'Alt', 'Shift'].includes(part)), capture.text).toBe(true);
      }
    }
  });
});
