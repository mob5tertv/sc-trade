import { describe, expect, it } from 'vitest';
import { crashLines, describeUncaught, exceptionText, findUncaughtErrors } from '../../scripts/preview/uncaught.mjs';

// Lines as `window.__preview.log` holds them: `<ms>ms [<level>] <what the application logged>`, and what the
// application logs is `[module] message {json}`.
const crash = (ms: number, what = 'uncaught error') =>
  `${String(ms).padStart(6)}ms [error] [crash] ${what} {"message":"Uncaught TypeError: Cannot read properties of null (reading 'closest')"}`;
const ui = (ms: number, text: string) => `${String(ms).padStart(6)}ms [info] [ui] ${text}`;

const NULL_CLOSEST = `TypeError: Cannot read properties of null (reading 'closest')
    at $effect (http://localhost:50531/src/ui/components/SearchBox.svelte:58:24)
    at update_reaction (http://localhost:50531/node_modules/.vite/deps/runtime.js:4209:16)`;

describe('crashLines', () => {
  it('finds the lines the crash handler of the application writes', () => {
    const log = [ui(10, 'view terminal {"terminalId":18}'), crash(20), crash(30, 'unhandled rejection'), ui(40, 'set current terminal')];
    expect(crashLines(log)).toEqual([crash(20), crash(30, 'unhandled rejection')]);
  });

  it('does not mistake a line that only mentions the word for a crash', () => {
    const log = [
      ui(10, 'note [crash] is a module name'),
      '    20ms [info] [preview] scene crash-demo, dataset default',
      '    30ms [error] [crashes] not it either',
      'no timestamp [crash] here',
    ];
    expect(crashLines(log)).toEqual([]);
  });

  it('finds a crash written at any level', () => {
    expect(crashLines(['    5ms [warn] [crash] uncaught error {}'])).toHaveLength(1);
  });

  it('gives nothing for an empty log', () => {
    expect(crashLines([])).toEqual([]);
  });
});

describe('exceptionText', () => {
  it('takes the description of the error, which has the stack', () => {
    expect(exceptionText({ text: 'Uncaught', exception: { type: 'object', description: NULL_CLOSEST } })).toBe(NULL_CLOSEST);
  });

  it('shows what was thrown when it is not an Error', () => {
    expect(exceptionText({ text: 'Uncaught', exception: { type: 'string', value: 'plain text' } })).toBe('Uncaught: plain text');
  });

  it('says what the browser said when there is no exception object', () => {
    expect(exceptionText({ text: 'Uncaught SyntaxError: Unexpected token' })).toBe('Uncaught SyntaxError: Unexpected token');
  });

  it('never gives an empty text', () => {
    expect(exceptionText({})).toBe('an error with no text');
  });
});

describe('findUncaughtErrors', () => {
  it('finds nothing in a clean run', () => {
    expect(findUncaughtErrors({ log: [ui(1, 'boot')], exceptions: [] })).toEqual([]);
  });

  it('finds a crash the application logged', () => {
    expect(findUncaughtErrors({ log: [ui(1, 'boot'), crash(20)], exceptions: [] })).toEqual([{ source: 'log', text: crash(20) }]);
  });

  it('finds an error of the page where the application has no crash handler (the gallery)', () => {
    expect(findUncaughtErrors({ log: [], exceptions: [NULL_CLOSEST] })).toEqual([{ source: 'page', text: NULL_CLOSEST }]);
  });

  it('counts the same error once when both the page and the crash handler saw it, and keeps the page text (it has the stack)', () => {
    expect(findUncaughtErrors({ log: [crash(20)], exceptions: [NULL_CLOSEST] })).toEqual([{ source: 'page', text: NULL_CLOSEST }]);
  });

  it('counts every error when there are several', () => {
    const errors = findUncaughtErrors({ log: [crash(20), crash(30), crash(40)], exceptions: ['first', 'second'] });
    expect(errors).toEqual([
      { source: 'page', text: 'first' },
      { source: 'page', text: 'second' },
      { source: 'log', text: crash(40) },
    ]);
  });

  it('counts the errors of the page that the crash handler missed', () => {
    expect(findUncaughtErrors({ log: [crash(20)], exceptions: ['a', 'b', 'c'] })).toHaveLength(3);
  });
});

describe('describeUncaught', () => {
  it('names the count, shows the error with the head of its stack and says how to allow it', () => {
    const text = describeUncaught([{ source: 'page', text: NULL_CLOSEST }]);
    expect(text).toContain('1 uncaught error');
    expect(text).toContain("TypeError: Cannot read properties of null (reading 'closest')");
    expect(text).toContain('SearchBox.svelte:58:24');
    expect(text).toContain('--allow-crash');
  });

  it('says which of them came from the log of the application', () => {
    const text = describeUncaught([{ source: 'log', text: crash(20) }]);
    expect(text).toContain('[crash] uncaught error');
    expect(text).toContain('log of the application');
  });

  it('puts the count in the plural and numbers the errors', () => {
    const text = describeUncaught([
      { source: 'page', text: 'Error: one' },
      { source: 'page', text: 'Error: two' },
    ]);
    expect(text).toContain('2 uncaught errors');
    expect(text).toMatch(/1\/2/);
    expect(text).toMatch(/2\/2/);
  });

  it('cuts a long stack to its first lines and a long line to a readable width', () => {
    const stack = ['Error: deep', ...Array.from({ length: 30 }, (_, i) => `    at frame${i} (${'x'.repeat(400)})`)].join('\n');
    const text = describeUncaught([{ source: 'page', text: stack }]);
    expect(text).toContain('at frame0');
    expect(text).not.toContain('at frame29');
    expect(Math.max(...text.split('\n').map((line) => line.length))).toBeLessThan(260);
  });

  it('keeps the first frames of the stack when the message itself is long (Svelte lists the components in it)', () => {
    const svelte = [
      "TypeError: Cannot read properties of null (reading 'closest')",
      '',
      '\tin $effect',
      '\tin SearchBox.svelte',
      '\tin Header.svelte',
      '\tin Panel.svelte',
      '\tin App.svelte',
      '\tin undefined',
      '',
      '    at $effect (http://localhost:50531/src/ui/components/SearchBox.svelte:58:24)',
      '    at update_reaction (http://localhost:50531/node_modules/.vite/deps/runtime.js:4209:16)',
      '    at update_effect (http://localhost:50531/node_modules/.vite/deps/runtime.js:4319:18)',
      '    at flush_queued_effects (http://localhost:50531/node_modules/.vite/deps/runtime.js:2510:4)',
      '    at #process (http://localhost:50531/node_modules/.vite/deps/runtime.js:2114:3)',
    ].join('\n');
    const text = describeUncaught([{ source: 'page', text: svelte }]);
    expect(text).toContain('in SearchBox.svelte');
    expect(text).toContain('at $effect (http://localhost:50531/src/ui/components/SearchBox.svelte:58:24)');
    expect(text).toContain('at update_effect');
    expect(text).not.toContain('at #process');
  });

  it('gives an empty text when there is nothing to say', () => {
    expect(describeUncaught([])).toBe('');
  });
});
