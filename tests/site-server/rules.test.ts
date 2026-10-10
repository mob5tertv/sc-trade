import { describe, expect, it } from 'vitest';
import { ERROR_CODES as PAGE_CODES, LIMITS as PAGE_LIMITS } from '../../site/js/feedback-rules.js';
import {
  checkContact,
  checkMessage,
  cleanContact,
  cleanFileName,
  cleanLang,
  cleanMessage,
  countChars,
  ERROR_CODES,
  FILE_NAME_MAX,
  isTooFast,
  LIMITS,
  MIN_FILL_MS,
  STATUS,
} from '../../site/server/src/rules.mjs';

const NOW = Date.parse('2026-10-10T12:00:00Z');

describe('the contract of the form, as the service keeps it', () => {
  it('has the very limits the page has', () => {
    expect({ ...LIMITS }).toEqual({ ...PAGE_LIMITS });
  });

  it('answers with the very codes the page knows, each with a status that is not a success', () => {
    expect([...ERROR_CODES].sort()).toEqual([...PAGE_CODES].sort());
    for (const code of ERROR_CODES) expect(STATUS[code], code).toBeGreaterThanOrEqual(400);
    // the two statuses the page reads even without JSON
    expect(STATUS.file_too_big).toBe(413);
    expect(STATUS.rate_limited).toBe(429);
  });
});

describe('the text of a message', () => {
  it('counts a line break a browser sent as CR LF as one character', () => {
    // six letters and five line breaks: eleven characters, sixteen as it travels
    const sent = 'a\r\nb\r\nc\r\nd\r\ne\r\nf';
    expect(sent).toHaveLength(16);
    expect(cleanMessage(sent)).toBe('a\nb\nc\nd\ne\nf');
    expect(countChars(cleanMessage(sent))).toBe(11);
    expect(checkMessage(cleanMessage(sent))).toBeNull();
    // five letters and four line breaks: nine, though fourteen bytes arrived
    expect(checkMessage(cleanMessage('a\r\nb\r\nc\r\nd\r\ne'))).toBe('too_short');
  });

  it('lets 4000 characters through however many of them are line breaks, and refuses 4001', () => {
    const lines = Array.from({ length: 2000 }, () => 'x').join('\r\n'); // 2000 letters, 1999 breaks: 5998 as sent
    expect(lines.length).toBe(5998);
    expect(countChars(cleanMessage(lines))).toBe(3999);
    expect(checkMessage(cleanMessage(lines))).toBeNull();
    expect(checkMessage(cleanMessage(`${lines}\r\nyz`))).toBe('too_long'); // 4002
    expect(checkMessage(cleanMessage(`${lines}\r\n`))).toBeNull(); // the break at the end is cut: 3999
    expect(checkMessage('x'.repeat(4000))).toBeNull();
    expect(checkMessage('x'.repeat(4001))).toBe('too_long');
  });

  it('counts a character of two code units as one', () => {
    const rocket = '\u{1F680}';
    expect(rocket).toHaveLength(2);
    expect(countChars(rocket.repeat(9))).toBe(9);
    expect(checkMessage(rocket.repeat(9))).toBe('too_short');
    expect(checkMessage(rocket.repeat(10))).toBeNull();
    expect(checkMessage(rocket.repeat(4000))).toBeNull(); // 8000 code units
    expect(checkMessage(rocket.repeat(4001))).toBe('too_long');
  });

  it('is judged after the spaces around it are cut, as the page does', () => {
    expect(cleanMessage('  \r\n  hello  \r\n\r\n ')).toBe('hello');
    expect(checkMessage(cleanMessage(`   ${'x'.repeat(9)}   `))).toBe('too_short');
    expect(checkMessage(cleanMessage(` \r\n${'x'.repeat(10)}\r\n `))).toBeNull();
  });

  it('keeps line breaks and tabs and drops what is not text', () => {
    expect(cleanMessage('one\ttwo\nthree')).toBe('one\ttwo\nthree');
    expect(cleanMessage('old\rmac')).toBe('old\nmac');
    expect(cleanMessage('a\u0000b\u0007c\u001bd\u007fe\u0085f')).toBe('abcdef');
    // a text that is controls only is no text
    expect(checkMessage(cleanMessage('\u0000'.repeat(20)))).toBe('too_short');
  });
});

describe('the contact', () => {
  it('is one line of up to 200 characters', () => {
    expect(cleanContact('  nick#1234  ')).toBe('nick#1234');
    expect(cleanContact('one\r\ntwo\tthree')).toBe('one two three');
    expect(cleanContact('a\u0000b\u202Ec')).toBe('abc');
    expect(checkContact('x'.repeat(200))).toBeNull();
    expect(checkContact('x'.repeat(201))).toBe('too_long');
    expect(checkContact('\u{1F680}'.repeat(200))).toBeNull();
    expect(checkContact('')).toBeNull();
  });
});

describe('the name a sender gave a file', () => {
  it('is kept as a short piece of text: no folders, no controls, no marks that turn the text around', () => {
    expect(cleanFileName('shot.png')).toBe('shot.png');
    expect(cleanFileName('../../etc/passwd')).toBe('passwd');
    expect(cleanFileName('C:\\Users\\me\\shot.png')).toBe('shot.png');
    expect(cleanFileName('a\u0000b.png')).toBe('ab.png');
    expect(cleanFileName('photo\u202Egnp.exe')).toBe('photognp.exe');
    expect(cleanFileName('line\r\nbreak.png')).toBe('linebreak.png');
    expect(cleanFileName('<script>alert(1)</script>.png')).toBe('script>.png'); // what stood before the slash is gone; the rest is text
    expect(cleanFileName(undefined)).toBe('');
    for (const name of ['/', '.', '..', 'a/..', ' . ']) expect(cleanFileName(name), name).toBe('');
    expect(cleanFileName('.htaccess')).toBe('.htaccess');
  });

  it('is cut to a length, never through the middle of a character', () => {
    expect(countChars(cleanFileName(`${'x'.repeat(10_000)}.png`))).toBe(FILE_NAME_MAX);
    const rockets = cleanFileName('\u{1F680}'.repeat(500));
    expect(countChars(rockets)).toBe(FILE_NAME_MAX);
    expect(rockets).toBe('\u{1F680}'.repeat(FILE_NAME_MAX));
  });
});

describe('the time the form was shown', () => {
  it('gives a robot away only when it is less than three seconds ago', () => {
    expect(MIN_FILL_MS).toBe(3000);
    expect(isTooFast(String(NOW), NOW)).toBe(true);
    expect(isTooFast(String(NOW - 2999), NOW)).toBe(true);
    expect(isTooFast(String(NOW - 3000), NOW)).toBe(false);
    expect(isTooFast(String(NOW - 60_000), NOW)).toBe(false);
  });

  it('is no sign of a robot when the clock of the visitor is wrong or the page stood open for days', () => {
    // a clock that runs ahead: the form was "shown" in the future
    expect(isTooFast(String(NOW + 1), NOW)).toBe(false);
    expect(isTooFast(String(NOW + 5 * 60_000), NOW)).toBe(false);
    expect(isTooFast(String(NOW + 400 * 86_400_000), NOW)).toBe(false);
    // a clock that runs behind, a page left open for a week, a clock that was never set
    expect(isTooFast(String(NOW - 7 * 86_400_000), NOW)).toBe(false);
    expect(isTooFast('0', NOW)).toBe(false);
  });

  it('is no sign of a robot when it is missing or is not a number', () => {
    for (const value of [undefined, '', 'soon', '-5', '1e3', '12.5', ' 1 ', '9'.repeat(40), 'NaN']) expect(isTooFast(value, NOW), String(value)).toBe(false);
  });
});

describe('the language of the page', () => {
  it('is one of the two the site has, or nothing: never a text of the sender', () => {
    expect(cleanLang('ru')).toBe('ru');
    expect(cleanLang('en')).toBe('en');
    for (const value of [undefined, '', 'RU', 'de', '<script>', 'ru ']) expect(cleanLang(value)).toBe('');
  });
});
