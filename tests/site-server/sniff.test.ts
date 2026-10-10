import { isUtf8 } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { createTextChecker, IMAGE_HEAD_BYTES, imageType, MIME } from '../../site/server/src/sniff.mjs';
import { JPEG, PNG, WEBP } from './helpers';

/** A text judged in pieces of a size, the way it arrives from the network. */
function isText(bytes: Buffer, piece = bytes.length || 1): boolean {
  const checker = createTextChecker();
  for (let at = 0; at < bytes.length; at += piece) if (!checker.push(bytes.subarray(at, at + piece))) return false;
  return checker.end();
}

describe('what a picture is: its first bytes, nothing else', () => {
  it('knows PNG, JPEG and WebP', () => {
    expect(imageType(PNG)).toBe('png');
    expect(imageType(JPEG)).toBe('jpg');
    expect(imageType(WEBP)).toBe('webp');
    expect(IMAGE_HEAD_BYTES).toBe(12);
    for (const bytes of [PNG, JPEG, WEBP]) expect(imageType(bytes.subarray(0, IMAGE_HEAD_BYTES))).not.toBeNull();
  });

  it('gives each kind the type it is served with', () => {
    expect(MIME).toEqual({ png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', txt: 'text/plain; charset=utf-8' });
  });

  it('takes nothing else for a picture', () => {
    const not = [
      '<?php system($_GET["c"]); ?>',
      '<!doctype html><html><script>alert(1)</script></html>',
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>',
      'GIF89a\u0001\u0000\u0001\u0000\u0000\u0000\u0000',
      'BM' + '\u0000'.repeat(30),
      'MZ\u0090\u0000\u0003\u0000\u0000\u0000\u0004\u0000\u0000\u0000',
      '%PDF-1.7\n1 0 obj',
      'PK\u0003\u0004' + '\u0000'.repeat(20),
      'RIFF\u0010\u0000\u0000\u0000WAVEfmt ',
      'RIFF\u0010\u0000\u0000\u0000AVI LIST',
      '',
    ];
    for (const text of not) expect(imageType(Buffer.from(text, 'latin1')), text.slice(0, 12)).toBeNull();
    // the beginning of a signature is not the signature
    expect(imageType(PNG.subarray(0, 7))).toBeNull();
    expect(imageType(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(imageType(WEBP.subarray(0, 11))).toBeNull();
    // a signature that does not stand at the very start
    expect(imageType(Buffer.concat([Buffer.from(' '), PNG]))).toBeNull();
  });
});

describe('what a log is: text in UTF-8 with no control characters but the tab and the ends of lines', () => {
  it('takes plain text in any language', () => {
    for (const text of ['[info] started\n', 'Привет, мир\r\n', '日本語のログ', '\u{1F680} launch', 'tab\there', 'a', 'old\rmac\rlines', 'a tilde ~ and a no-break space   are text', '«кавычки» ¡hola! ÿ']) {
      expect(isText(Buffer.from(text)), text).toBe(true);
    }
  });

  it('refuses the control characters above the letters as well: the "delete" and the 32 that follow it', () => {
    for (let code = 0x7f; code <= 0x9f; code++) {
      const char = String.fromCharCode(code);
      expect(isText(Buffer.from(`a${char}b`)), `U+00${code.toString(16)}`).toBe(false);
      expect(isText(Buffer.from(char)), `U+00${code.toString(16)} alone`).toBe(false);
      // also when its two bytes arrive in two pieces
      expect(isText(Buffer.from(`Журнал ${char} дальше`), 1), `U+00${code.toString(16)} byte by byte`).toBe(false);
    }
    // the neighbours on both sides are plain characters
    for (const code of [0x7e, 0xa0, 0xa1, 0xff]) expect(isText(Buffer.from(`a${String.fromCharCode(code)}b`), 1), `U+00${code.toString(16)}`).toBe(true);
    // what a terminal takes for the start of a command in eight bits, a "next line", a "delete"
    for (const text of ['\u009b31mred', 'one\u0085two', 'gone\u007f']) expect(isText(Buffer.from(text)), JSON.stringify(text)).toBe(false);
    // a longer character that merely ends in such a byte is not one of them (U+0440 is D1 80, U+2080 is E2 82 80)
    for (const text of ['р', '₀', '\u{1F680}', 'Ā']) expect(isText(Buffer.from(text), 1), text).toBe(true);
  });

  it('refuses a zero byte, wherever it stands', () => {
    expect(isText(Buffer.from('abc\u0000def'))).toBe(false);
    expect(isText(Buffer.from([0]))).toBe(false);
    expect(isText(Buffer.concat([Buffer.from('x'.repeat(5000)), Buffer.from([0])]))).toBe(false);
  });

  it('refuses every other control character below the space: a log of the application has none, a file that is not text has many', () => {
    for (let byte = 0; byte < 0x20; byte++) {
      const allowed = byte === 0x09 || byte === 0x0a || byte === 0x0d;
      expect(isText(Buffer.from([0x61, byte, 0x62])), `byte ${byte}`).toBe(allowed);
      expect(isText(Buffer.from([byte])), `byte ${byte} alone`).toBe(allowed);
      expect(isText(Buffer.concat([Buffer.from('Журнал '), Buffer.from([byte])]), 1), `byte ${byte} after a letter of two bytes`).toBe(allowed);
    }
    // the escape that colours a terminal, a bell, a form feed
    for (const text of ['\u001b[31mred\u001b[0m', 'ding\u0007', 'page\u000cbreak', 'back\u0008space']) expect(isText(Buffer.from(text)), JSON.stringify(text)).toBe(false);
    // Cyrillic in UTF-16 without its mark has no zero byte, but every letter of it carries a byte 04
    expect(isText(Buffer.from('Журнал', 'utf16le'))).toBe(false);
  });

  it('refuses bytes that are not UTF-8', () => {
    const bad = [
      [0xff],
      [0xfe, 0xff, 0x00, 0x41], // UTF-16 with its mark
      [0xc0, 0xaf], // a slash written longer than it is
      [0xe0, 0x80, 0xaf],
      [0xed, 0xa0, 0x80], // half of a pair
      [0xf4, 0x90, 0x80, 0x80], // beyond the last character
      [0xf8, 0x88, 0x80, 0x80, 0x80],
      [0x80],
      [0xc3], // cut in the middle
      [0xe2, 0x82],
      [0xf0, 0x9f, 0x9a],
      [0xc3, 0x28],
    ];
    for (const bytes of bad) expect(isText(Buffer.from(bytes)), bytes.map((byte) => byte.toString(16)).join(' ')).toBe(false);
    expect(isText(PNG)).toBe(false);
    // UTF-16: its mark is not UTF-8, and every Latin letter in it carries a zero byte
    expect(isText(Buffer.from('﻿Журнал', 'utf16le'))).toBe(false);
    expect(isText(Buffer.from('log', 'utf16le'))).toBe(false);
    expect(isText(Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]))).toBe(false); // «Привет» in Windows-1251
  });

  it('judges a character the same whether it arrives whole or cut between two pieces', () => {
    const text = Buffer.from('Журнал \u{1F680} программы — 日本語\n'.repeat(50));
    for (const piece of [1, 2, 3, 5, 7, 64]) expect(isText(text, piece), `pieces of ${piece}`).toBe(true);
    const broken = Buffer.concat([text, Buffer.from([0xf0, 0x9f]), Buffer.from('tail')]);
    for (const piece of [1, 2, 3, 5, 7, 64]) expect(isText(broken, piece), `pieces of ${piece}`).toBe(false);
  });

  it('agrees with Node about every short sequence of bytes that matters', () => {
    // every pair of bytes, and triples and quadruples around the edges of the encoding
    const edges = [0x00, 0x01, 0x41, 0x7f, 0x80, 0x8f, 0x90, 0x9f, 0xa0, 0xbf, 0xc0, 0xc1, 0xc2, 0xdf, 0xe0, 0xe1, 0xec, 0xed, 0xee, 0xef, 0xf0, 0xf1, 0xf3, 0xf4, 0xf5, 0xff];
    const same = (bytes: number[]) => {
      const buffer = Buffer.from(bytes);
      // well-formed, and with no control character but the tab and the two ends of a line
      const expected = isUtf8(buffer) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(buffer.toString('utf8'));
      if (isText(buffer) !== expected) throw new Error(`differs for ${bytes.map((byte) => byte.toString(16)).join(' ')}: Node says ${expected}`);
    };
    for (let a = 0; a < 256; a++) for (let b = 0; b < 256; b++) same([a, b]);
    for (const a of edges) for (const b of edges) for (const c of edges) same([a, b, c]);
    for (const a of edges.filter((byte) => byte >= 0xe0)) for (const b of edges) for (const c of edges) for (const d of edges) same([a, b, c, d]);
  });
});
