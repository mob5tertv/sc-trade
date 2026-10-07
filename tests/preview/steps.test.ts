import { describe, expect, it } from 'vitest';
import { charKey, parseSteps, pressKey, splitSteps } from '../../scripts/preview/steps.mjs';

describe('splitSteps', () => {
  it('cuts at semicolons and drops empty pieces', () => {
    expect(splitSteps('click:.a;wait:300;;press:Enter;')).toEqual(['click:.a', 'wait:300', 'press:Enter']);
  });

  it('keeps a semicolon that is written as \\;', () => {
    expect(splitSteps('eval:a = 1\\; b = 2;wait:10')).toEqual(['eval:a = 1; b = 2', 'wait:10']);
  });

  it('leaves other backslashes as they are', () => {
    expect(splitSteps('eval:/\\d+/.test("12")')).toEqual(['eval:/\\d+/.test("12")']);
  });

  it('gives nothing for an empty text', () => {
    expect(splitSteps('')).toEqual([]);
    expect(splitSteps(' ; ;')).toEqual([]);
  });
});

describe('parseSteps', () => {
  it('reads every kind of step', () => {
    expect(parseSteps('click:.strip;hover:button.tab;type:abc;press:Enter;leave;game;wait:300;eval:document.title')).toEqual([
      { kind: 'click', selector: '.strip', source: 'click:.strip' },
      { kind: 'hover', selector: 'button.tab', source: 'hover:button.tab' },
      { kind: 'type', text: 'abc', source: 'type:abc' },
      { kind: 'press', key: 'Enter', source: 'press:Enter' },
      { kind: 'leave', source: 'leave' },
      { kind: 'game', source: 'game' },
      { kind: 'wait', ms: 300, source: 'wait:300' },
      { kind: 'eval', expression: 'document.title', source: 'eval:document.title' },
    ]);
  });

  it('keeps colons inside the argument (selectors, expressions)', () => {
    expect(parseSteps('click:#tab-settings:not(.x);eval:({a: 1}).a')).toMatchObject([
      { kind: 'click', selector: '#tab-settings:not(.x)' },
      { kind: 'eval', expression: '({a: 1}).a' },
    ]);
  });

  it('trims selectors and keys, but types the text exactly', () => {
    expect(parseSteps(' click: .strip ; press: Enter ; type: hi  ')).toMatchObject([
      { kind: 'click', selector: '.strip' },
      { kind: 'press', key: 'Enter' },
      { kind: 'type', text: ' hi  ' },
    ]);
  });

  it('allows an empty list', () => {
    expect(parseSteps('')).toEqual([]);
    expect(parseSteps(undefined)).toEqual([]);
  });

  it.each([
    ['click', 'a CSS selector'],
    ['hover:', 'a CSS selector'],
    ['type', 'the text'],
    ['press:', 'a key'],
    ['wait', 'milliseconds'],
    ['wait:soon', 'milliseconds'],
    ['wait:-5', 'milliseconds'],
    ['wait:999999', 'milliseconds'],
    ['eval:', 'an expression'],
    ['dance:now', 'dance'],
    ['leave:now', 'leave'],
    ['game:now', 'game'],
    ['press:Hyperspace', 'Hyperspace'],
  ])('rejects %j and says what is missing', (text, mention) => {
    expect(() => parseSteps(text)).toThrow(mention);
  });

  it('names the step that is wrong', () => {
    expect(() => parseSteps('click:.a;wait:x;leave')).toThrow(/step 2.*wait:x/);
  });
});

describe('pressKey', () => {
  it('describes the named keys the way the browser reports them', () => {
    expect(pressKey('Enter')).toMatchObject({ key: 'Enter', code: 'Enter', keyCode: 13, text: '\r', modifiers: 0 });
    expect(pressKey('Escape')).toMatchObject({ key: 'Escape', code: 'Escape', keyCode: 27, text: '' });
    expect(pressKey('Esc')).toMatchObject({ key: 'Escape' });
    expect(pressKey('Tab')).toMatchObject({ key: 'Tab', keyCode: 9, text: '' });
    expect(pressKey('ArrowDown')).toMatchObject({ key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 });
    expect(pressKey('Down')).toMatchObject({ key: 'ArrowDown' });
    expect(pressKey('Backspace')).toMatchObject({ keyCode: 8 });
    expect(pressKey('F8')).toMatchObject({ key: 'F8', code: 'F8', keyCode: 119 });
    expect(pressKey('Space')).toMatchObject({ key: ' ', code: 'Space', keyCode: 32, text: ' ' });
  });

  it('describes a letter or a digit', () => {
    expect(pressKey('a')).toMatchObject({ key: 'a', code: 'KeyA', keyCode: 65, text: 'a' });
    expect(pressKey('7')).toMatchObject({ key: '7', code: 'Digit7', keyCode: 55, text: '7' });
  });

  it('adds modifiers as a bit mask (Alt 1, Ctrl 2, Meta 4, Shift 8) and sends no text with Ctrl or Alt', () => {
    expect(pressKey('Ctrl+A')).toMatchObject({ key: 'a', code: 'KeyA', modifiers: 2, text: '' });
    expect(pressKey('Ctrl+Alt+T')).toMatchObject({ code: 'KeyT', modifiers: 3, text: '' });
    expect(pressKey('Shift+Tab')).toMatchObject({ key: 'Tab', modifiers: 8 });
  });

  it('rejects an unknown key and names it', () => {
    expect(() => pressKey('Hyperspace')).toThrow('Hyperspace');
    expect(() => pressKey('Ctrl+')).toThrow();
  });
});

describe('charKey', () => {
  it('types a character as text, whatever the alphabet', () => {
    expect(charKey('a')).toMatchObject({ key: 'a', text: 'a', code: 'KeyA', keyCode: 65 });
    expect(charKey('Я')).toMatchObject({ key: 'Я', text: 'Я' });
    expect(charKey(' ')).toMatchObject({ key: ' ', code: 'Space', text: ' ' });
  });

  it('types a line break as Enter', () => {
    expect(charKey('\n')).toMatchObject({ key: 'Enter', keyCode: 13, text: '\r' });
  });
});
