import { describe, expect, it } from 'vitest';
import {
  crashLines, describeUncaught, exceptionText, findUncaughtErrors, formatItemLine, itemResult, sweepExitCode, sweepItems, sweepSummary,
  uncaughtVerdict,
} from '../../scripts/preview/uncaught.mjs';
import { SCENES } from '../../src/preview/scenes';
import { GALLERY_PAGES } from '../../src/preview/gallery/page-names';

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

const ONE = [{ source: 'page' as const, text: NULL_CLOSEST }];
const TWO = [...ONE, { source: 'log' as const, text: crash(30) }];

describe('uncaughtVerdict', () => {
  it('passes a clean run without a word', () => {
    expect(uncaughtVerdict({ errors: [], allowCrash: false })).toEqual({ exitCode: 0, note: '' });
    expect(uncaughtVerdict({ errors: [], allowCrash: true })).toEqual({ exitCode: 0, note: '' });
  });

  it('fails a run with an uncaught error with the exit code 4 and says what happened', () => {
    const verdict = uncaughtVerdict({ errors: ONE, allowCrash: false });
    expect(verdict.exitCode).toBe(4);
    expect(verdict.note).toBe(describeUncaught(ONE));
  });

  it('lets a scene that shows a crash on purpose pass, and says how many errors it did not count', () => {
    expect(uncaughtVerdict({ errors: ONE, allowCrash: true })).toEqual({
      exitCode: 0, note: '1 uncaught error not counted against the run (--allow-crash)',
    });
    expect(uncaughtVerdict({ errors: TWO, allowCrash: true }).note).toBe('2 uncaught errors not counted against the run (--allow-crash)');
  });
});

describe('itemResult', () => {
  it('is a pass with no errors', () => {
    expect(itemResult({ name: 'scene mini', errors: [] })).toEqual({ name: 'scene mini', exitCode: 0, uncaught: 0, detail: '' });
  });

  it('fails with the exit code 4 for an uncaught error and keeps the number and the text of them', () => {
    expect(itemResult({ name: 'scene a', errors: TWO })).toEqual({ name: 'scene a', exitCode: 4, uncaught: 2, detail: describeUncaught(TWO) });
  });

  it('passes an allowed crash but still counts it', () => {
    const result = itemResult({ name: 'scene a', errors: ONE, allowCrash: true });
    expect(result).toMatchObject({ exitCode: 0, uncaught: 1 });
    expect(result.detail).toContain('--allow-crash');
  });

  it('fails with the exit code of the failure when the scene did not get that far, and still counts the errors', () => {
    const notReady = itemResult({ name: 'scene a', errors: [], failure: { exitCode: 1, message: 'not ready in 30 s' } });
    expect(notReady).toEqual({ name: 'scene a', exitCode: 1, uncaught: 0, detail: 'not ready in 30 s' });
    const started = itemResult({ name: 'scene a', errors: ONE, failure: { exitCode: 2, message: 'the scene started with an error: boom' } });
    expect(started).toMatchObject({ exitCode: 2, uncaught: 1 });
    expect(started.detail).toContain('the scene started with an error: boom');
    expect(started.detail).toContain('1 uncaught error');
  });
});

describe('the lines and the verdict of a sweep', () => {
  const ok = itemResult({ name: 'scene mini', errors: [] });
  const bad = itemResult({ name: 'gallery search-box', errors: ONE });

  it('writes one line per item: name, exit code, number of uncaught errors', () => {
    expect(formatItemLine(ok, 20)).toBe('scene mini           exit=0 uncaught=0');
    expect(formatItemLine(bad, 20)).toBe('gallery search-box   exit=4 uncaught=1');
  });

  it('does not cut a name that is longer than the width', () => {
    expect(formatItemLine(bad, 5)).toBe('gallery search-box exit=4 uncaught=1');
  });

  it('is zero only when every item passed', () => {
    expect(sweepExitCode([ok, ok])).toBe(0);
    expect(sweepExitCode([ok, bad])).toBe(1);
  });

  it('does not count a sweep of nothing as a pass: an empty list is a list that went stale', () => {
    expect(sweepExitCode([])).toBe(1);
  });

  it('says how many items failed and which', () => {
    expect(sweepSummary([ok, ok])).toBe('2 items, all passed');
    expect(sweepSummary([ok, bad])).toBe('2 items, 1 failed: gallery search-box');
    expect(sweepSummary([])).toBe('nothing was swept: the lists of scenes and gallery pages are empty');
  });
});

describe('sweepItems', () => {
  it('lists the scenes, then the gallery pages, each with the address parameters shot.mjs would give it', () => {
    const items = sweepItems({ scenes: ['mini', 'expanded'], pages: ['badge'] });
    expect(items.map((i) => i.name)).toEqual(['scene mini', 'scene expanded', 'gallery badge']);
    expect(items[0].params).toEqual({ scene: 'mini' });
    expect(items[2].params).toEqual({ scene: 'gallery-badge', gallery: 'badge' });
  });

  it('gives the gallery a monitor tall enough for a page of stacked states', () => {
    const [scene, page] = sweepItems({ scenes: ['mini'], pages: ['badge'] });
    expect(scene.monitor).toBe('1920x1080@1');
    expect(page.monitor).toBe('1920x3200@1');
  });

  it('covers every scene of src/preview/scenes.ts and every page of the gallery, because the script reads them from there', () => {
    const items = sweepItems({ scenes: SCENES.map((s) => s.name), pages: [...GALLERY_PAGES] });
    expect(items).toHaveLength(SCENES.length + GALLERY_PAGES.length);
    expect(new Set(items.map((i) => i.name)).size).toBe(items.length);
  });
});
