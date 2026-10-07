// The steps of `npm run preview:shot -- --do "<steps>"`: what is done in the application before the picture is
// taken. Pure text handling, no browser here, so it is unit-tested (tests/preview/steps.test.ts).
//
//   click:<css selector>   a real mouse click at the centre of the element
//   hover:<css selector>   the mouse over the centre of the element
//   drag:<css>:<dx>,<dy>   a real drag: the button goes down at the centre of the element, the mouse moves by the shift
//                          (page pixels, in several moves) and the button goes up
//   type:<text>            real key presses into whatever holds the focus
//   press:<Key>            one key: Enter, Escape, Tab, ArrowDown, F8, a, Ctrl+A ...
//   leave                  the mouse leaves the overlay window for the game
//   game                   the player clicks the game (the same as the button of the desktop page)
//   wait:<ms>              a pause
//   eval:<js expression>   run in the page of the application; the value is printed
//
// Steps are separated by `;`. A `;` inside a step is written `\;`.

/**
 * @typedef {{ key: string, code: string, keyCode: number, text: string, modifiers: number }} KeyPress
 *   `modifiers` is the bit mask of the DevTools protocol: Alt 1, Ctrl 2, Meta 4, Shift 8.
 *
 * @typedef {{ kind: 'click' | 'hover', selector: string, source: string }
 *   | { kind: 'drag', selector: string, dx: number, dy: number, source: string }
 *   | { kind: 'type', text: string, source: string }
 *   | { kind: 'press', key: string, source: string }
 *   | { kind: 'leave' | 'game', source: string }
 *   | { kind: 'wait', ms: number, source: string }
 *   | { kind: 'eval', expression: string, source: string }} Step
 */

const MAX_WAIT_MS = 60_000;

/**
 * Cuts the text into steps at `;` (a `\;` stays inside its step) and drops empty ones.
 * @param {string} text
 * @returns {string[]}
 */
export function splitSteps(text) {
  const steps = [];
  let current = '';
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && text[i + 1] === ';') {
      current += ';';
      i++;
    } else if (text[i] === ';') {
      steps.push(current);
      current = '';
    } else {
      current += text[i];
    }
  }
  steps.push(current);
  return steps.filter((step) => step.trim() !== '');
}

/** @type {Record<string, { key: string, code: string, keyCode: number, text: string }>} */
const NAMED_KEYS = {
  enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
  escape: { key: 'Escape', code: 'Escape', keyCode: 27, text: '' },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9, text: '' },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8, text: '' },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46, text: '' },
  insert: { key: 'Insert', code: 'Insert', keyCode: 45, text: '' },
  space: { key: ' ', code: 'Space', keyCode: 32, text: ' ' },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38, text: '' },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, text: '' },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, text: '' },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, text: '' },
  home: { key: 'Home', code: 'Home', keyCode: 36, text: '' },
  end: { key: 'End', code: 'End', keyCode: 35, text: '' },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33, text: '' },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34, text: '' },
};
for (let n = 1; n <= 12; n++) NAMED_KEYS[`f${n}`] = { key: `F${n}`, code: `F${n}`, keyCode: 111 + n, text: '' };

/** @type {Record<string, string>} */
const ALIASES = { esc: 'escape', return: 'enter', up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright', del: 'delete' };

/** @type {Record<string, number>} */
const MODIFIERS = { alt: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, shift: 8 };

/**
 * A character typed as text. A letter or a digit also carries its key code; anything else (punctuation, Cyrillic)
 * is just text. A line break is the Enter key.
 * @param {string} char
 * @returns {KeyPress}
 */
export function charKey(char) {
  if (char === '\n') return { ...NAMED_KEYS.enter, modifiers: 0 };
  if (char === ' ') return { ...NAMED_KEYS.space, modifiers: 0 };
  if (/^[a-z]$/i.test(char)) return { key: char, code: `Key${char.toUpperCase()}`, keyCode: char.toUpperCase().charCodeAt(0), text: char, modifiers: 0 };
  if (/^[0-9]$/.test(char)) return { key: char, code: `Digit${char}`, keyCode: char.charCodeAt(0), text: char, modifiers: 0 };
  return { key: char, code: '', keyCode: 0, text: char, modifiers: 0 };
}

/**
 * What a `press:` step presses: a key name with optional modifiers (`Ctrl+Alt+T`, `Shift+Tab`).
 * With Ctrl or Alt held, no text is produced.
 * @param {string} spec
 * @returns {KeyPress}
 */
export function pressKey(spec) {
  let rest = spec.trim();
  let modifiers = 0;
  for (;;) {
    const plus = rest.indexOf('+');
    const bit = plus > 0 ? MODIFIERS[rest.slice(0, plus).toLowerCase()] : undefined;
    if (bit === undefined) break;
    modifiers |= bit;
    rest = rest.slice(plus + 1);
  }
  if (rest === '') throw new Error(`the key is missing in "${spec}"`);

  const name = rest.toLowerCase();
  const named = NAMED_KEYS[ALIASES[name] ?? name];
  /** @type {Omit<KeyPress, 'modifiers'>} */
  let press;
  if (named) {
    press = { ...named };
  } else if (/^[a-z0-9]$/i.test(rest)) {
    // letters are not case-sensitive here: only Shift makes a capital
    const key = modifiers & 8 ? rest.toUpperCase() : rest.toLowerCase();
    press = { ...charKey(key) };
  } else {
    throw new Error(`unknown key "${rest}" (use Enter, Escape, Tab, Backspace, Delete, Space, ArrowUp/Down/Left/Right, Home, End, PageUp, PageDown, F1-F12 or a letter or digit)`);
  }
  if (modifiers & (1 | 2)) press.text = '';
  return { ...press, modifiers };
}

/**
 * @param {number} index
 * @param {string} sourceText
 * @param {string} message
 */
const stepError = (index, sourceText, message) => new Error(`step ${index} "${sourceText}": ${message}`);

/**
 * Reads the text of `--do` into steps; a step that cannot be read fails with its number and its text.
 * @param {string | undefined} text
 * @returns {Step[]}
 */
export function parseSteps(text) {
  return splitSteps(text ?? '').map((piece, i) => parseStep(piece, i + 1));
}

/**
 * @param {string} piece
 * @param {number} index
 * @returns {Step}
 */
function parseStep(piece, index) {
  const colon = piece.indexOf(':');
  const kind = (colon < 0 ? piece : piece.slice(0, colon)).trim();
  const raw = colon < 0 ? null : piece.slice(colon + 1);
  // the text to type is taken exactly; for the rest the spaces around the argument mean nothing
  const arg = raw === null ? '' : kind === 'type' ? raw : raw.trim();
  const source = kind === 'type' ? piece.trimStart() : piece.trim();
  const fail = (/** @type {string} */ message) => stepError(index, source, message);

  switch (kind) {
    case 'click':
    case 'hover':
      if (arg === '') throw fail(`${kind} needs a CSS selector, like ${kind}:.strip`);
      return { kind, selector: arg, source };
    case 'drag': {
      // the shift is after the LAST colon: a selector may have colons of its own (`button:not(.x)`)
      const match = /^(.*):\s*(-?\d+)\s*,\s*(-?\d+)\s*$/.exec(arg);
      if (match === null) throw fail('drag needs a selector and a shift of the mouse in pixels, like drag:[data-drag]:-300,200');
      const selector = match[1].trim();
      if (selector === '') throw fail('drag needs the CSS selector of what to drag, like drag:[data-drag]:-300,200');
      return { kind, selector, dx: Number(match[2]), dy: Number(match[3]), source };
    }
    case 'type':
      if (arg === '') throw fail('type needs the text to type, like type:HUR');
      return { kind, text: arg, source };
    case 'press':
      if (arg === '') throw fail('press needs a key, like press:Enter');
      try {
        pressKey(arg);
      } catch (err) {
        throw fail(err instanceof Error ? err.message : String(err));
      }
      return { kind, key: arg, source };
    case 'leave':
    case 'game':
      if (raw !== null) throw fail(`${kind} takes no argument`);
      return { kind, source };
    case 'wait': {
      const ms = Number(arg);
      if (arg === '' || !Number.isFinite(ms) || ms < 0 || ms > MAX_WAIT_MS) throw fail(`wait needs milliseconds from 0 to ${MAX_WAIT_MS}, like wait:300`);
      return { kind, ms, source };
    }
    case 'eval':
      if (arg === '') throw fail('eval needs an expression, like eval:document.title');
      return { kind, expression: arg, source };
    default:
      throw fail(`unknown step "${kind}" (click, hover, drag, type, press, leave, game, wait, eval)`);
  }
}
