// Errors nobody caught during a run of `npm run preview:shot`. Such an error is a bug even when the picture looks
// fine (a throw inside the effect pass of Svelte can leave the screen half updated), so the script fails on it.
// Two witnesses are read and put together here, without a browser, so that it is unit-tested (tests/preview/uncaught.test.ts):
//   - the DevTools protocol event `Runtime.exceptionThrown` (a throw in a handler or an effect, a rejected promise);
//   - the `[crash]` lines that the application's own handler (src/platform/crash.ts) writes to `window.__preview.log`.
// The application sees the error through `window.addEventListener('error')`, the page through the protocol: the same
// error is seen twice where the handler is installed (the application) and once where it is not (the gallery).

/** @typedef {{ source: 'page' | 'log', text: string }} UncaughtError */

/** `<ms>ms [<level>] [crash] <message>`: the log of the preview is `<ms>ms [<level>] ` and then what the application logged. */
const CRASH_LINE = /^\s*\d+ms \[[a-z]+\] \[crash\] /;

/** The message of an error may list the components it passed through (Svelte does); the stack follows it. */
const MAX_MESSAGE_LINES = 8;
const MAX_FRAMES = 3;
const MAX_LINE_WIDTH = 200;

/**
 * The lines of the log of the application that tell about an uncaught error or a rejected promise.
 * @param {string[]} log
 * @returns {string[]}
 */
export function crashLines(log) {
  return log.filter((line) => CRASH_LINE.test(line));
}

/**
 * What to say about `exceptionDetails` of `Runtime.exceptionThrown`: the description of the error (it has the stack).
 * @param {{ text?: string, exception?: { type?: string, description?: string, value?: unknown } }} details
 * @returns {string}
 */
export function exceptionText(details) {
  const exception = details.exception;
  if (exception?.description) return exception.description;
  if (exception?.value !== undefined) return `${details.text ?? 'Uncaught'}: ${String(exception.value)}`;
  return details.text || 'an error with no text';
}

/**
 * Every uncaught error of the run. An error the application logged AND the page saw is one error: the larger of the
 * two counts is the number of errors, and the text of the page (with the stack) is kept where it exists.
 * @param {{ log: string[], exceptions: string[] }} seen `exceptions`: `exceptionText` of every `Runtime.exceptionThrown`
 * @returns {UncaughtError[]}
 */
export function findUncaughtErrors({ log, exceptions }) {
  const logged = crashLines(log);
  /** @type {UncaughtError[]} */
  const errors = [];
  for (let i = 0; i < Math.max(logged.length, exceptions.length); i++) {
    errors.push(i < exceptions.length ? { source: 'page', text: exceptions[i] } : { source: 'log', text: logged[i] });
  }
  return errors;
}

/** @param {string} line */
const cut = (line) => (line.length > MAX_LINE_WIDTH ? `${line.slice(0, MAX_LINE_WIDTH - 1)}…` : line);

/**
 * The message of the failure: how many, and the head of each (the message and the first frames of its stack).
 * @param {UncaughtError[]} errors
 * @returns {string} empty when there is nothing to report
 */
export function describeUncaught(errors) {
  if (errors.length === 0) return '';
  const lines = [
    `${errors.length} uncaught error${errors.length === 1 ? '' : 's'} while the scene and the steps ran ` +
      '(--allow-crash for a scene that shows a crash on purpose):',
  ];
  errors.forEach((error, i) => {
    const where = error.source === 'page' ? 'seen by the page' : 'from the log of the application';
    lines.push(`  error ${i + 1}/${errors.length}, ${where}:`);
    const text = error.text.split('\n').filter((line) => line.trim() !== '');
    const firstFrame = text.findIndex((line) => /^\s*at /.test(line));
    const message = firstFrame === -1 ? text : text.slice(0, firstFrame);
    const frames = firstFrame === -1 ? [] : text.slice(firstFrame);
    const shown = [...message.slice(0, MAX_MESSAGE_LINES), ...frames.slice(0, MAX_FRAMES)];
    for (const line of shown) lines.push(`    ${cut(line.trimEnd())}`);
    if (shown.length < text.length) lines.push(`    ... ${text.length - shown.length} more lines`);
  });
  return lines.join('\n');
}

// ---- what a run is worth ----------------------------------------------------------------------------------

/** The exit code of a run in which an error nobody caught happened (`shot.mjs`; in a sweep it is the code of the item). */
export const EXIT_UNCAUGHT = 4;

/**
 * Whether the uncaught errors of a run fail it. A scene that shows a crash on purpose is run with `allowCrash`: its
 * errors are still counted, but they do not fail it.
 * @param {{ errors: UncaughtError[], allowCrash: boolean }} run
 * @returns {{ exitCode: 0 | 4, note: string }} `note`: what to say (the errors when it fails, a line when they are let through, nothing when there are none)
 */
export function uncaughtVerdict({ errors, allowCrash }) {
  if (errors.length === 0) return { exitCode: 0, note: '' };
  if (allowCrash) return { exitCode: 0, note: `${errors.length} uncaught error${errors.length === 1 ? '' : 's'} not counted against the run (--allow-crash)` };
  return { exitCode: EXIT_UNCAUGHT, note: describeUncaught(errors) };
}

/**
 * @typedef {{ name: string, exitCode: number, uncaught: number, detail: string }} ItemResult
 *   One item of a sweep. `exitCode` is what `shot.mjs` would have exited with: 0 passed, 1 the scene was not ready,
 *   2 it started with an error, 4 an uncaught error. `detail` is what to print under the line (empty when there is none).
 */

/**
 * The result of one scene or gallery page of a sweep.
 * @param {{ name: string, errors: UncaughtError[], allowCrash?: boolean, failure?: { exitCode: number, message: string } | null }} item
 *   `failure`: the item did not get as far as being judged by its errors (not ready in time, started with an error)
 * @returns {ItemResult}
 */
export function itemResult({ name, errors, allowCrash = false, failure = null }) {
  const verdict = uncaughtVerdict({ errors, allowCrash });
  if (failure === null) return { name, exitCode: verdict.exitCode, uncaught: errors.length, detail: verdict.note };
  const detail = verdict.exitCode === 0 ? failure.message : `${failure.message}\n${verdict.note}`;
  return { name, exitCode: failure.exitCode, uncaught: errors.length, detail };
}

/**
 * `scene expanded-row        exit=0 uncaught=0`
 * @param {ItemResult} result
 * @param {number} width the width the names are padded to, so that the columns line up
 */
export const formatItemLine = (result, width) => `${result.name.padEnd(width)} exit=${result.exitCode} uncaught=${result.uncaught}`;

/**
 * 0 when every item passed. A sweep of nothing is not a pass: the lists it reads have gone stale or empty.
 * @param {ItemResult[]} results
 * @returns {0 | 1}
 */
export const sweepExitCode = (results) => (results.length > 0 && results.every((r) => r.exitCode === 0) ? 0 : 1);

/** @param {ItemResult[]} results */
export function sweepSummary(results) {
  if (results.length === 0) return 'nothing was swept: the lists of scenes and gallery pages are empty';
  const failed = results.filter((r) => r.exitCode !== 0);
  const count = `${results.length} item${results.length === 1 ? '' : 's'}`;
  return failed.length === 0 ? `${count}, all passed` : `${count}, ${failed.length} failed: ${failed.map((r) => r.name).join(', ')}`;
}

/**
 * @typedef {{ name: string, params: Record<string, string>, monitor: string }} SweepItem
 *   `params`: what goes into the address of the preview page (`scene`, and `gallery` for a page of the gallery)
 */

/**
 * What a sweep visits: every scene, then every page of the gallery (all its states stacked). The lists come from the
 * code (`src/preview/scenes.ts`, `src/preview/gallery/page-names.ts`), `sweep.mjs` reads them.
 * @param {{ scenes: string[], pages: string[] }} lists
 * @returns {SweepItem[]}
 */
export function sweepItems({ scenes, pages }) {
  return [
    ...scenes.map((scene) => ({ name: `scene ${scene}`, params: { scene }, monitor: '1920x1080@1' })),
    // a page is taller than a monitor of 1080: the states are stacked
    ...pages.map((page) => ({ name: `gallery ${page}`, params: { scene: `gallery-${page}`, gallery: page }, monitor: '1920x3200@1' })),
  ];
}
