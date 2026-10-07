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
