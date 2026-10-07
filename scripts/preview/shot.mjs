// `npm run preview:shot`: opens a scene of the browser preview in a headless Edge or Chrome, optionally acts in it,
// and writes a PNG, so that the real interface can be looked at without Tauri and without the game.
//
//   npm run preview:shot -- --scene expanded [--monitor 1920x1080@1] [--view window|desktop] [--scale 2] [--out path.png]
//                           [--do "click:.strip;wait:300"] [--state] [--timeout 30] [--allow-crash]
//   npm run preview:shot -- --gallery terminal-table[/buy-expanded] [--bg light] [--opacity 0.6] [--scale 2]
//                           the component gallery (src/preview/gallery/) instead of a scene of the application
//
// It starts its own Vite dev server on a free port and its own browser on a throw-away profile, and stops both.
// `--do` runs steps in the application before the picture (see steps.mjs); `--state` prints the mocked state of
// the window as one JSON line at the very end. An error nobody caught (a `[crash]` line in the log of the scene, or an
// uncaught error of the page) while the scene and the steps ran fails the run with exit code 4 (see uncaught.mjs).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { findBrowser, launchBrowser, pageSocketUrl } from './browser.mjs';
import { connect } from './cdp.mjs';
import { projectRoot, startDevServer } from './server.mjs';
import { charKey, parseSteps, pressKey } from './steps.mjs';
import { describeUncaught, exceptionText, findUncaughtErrors } from './uncaught.mjs';

const HELP = `usage: npm run preview:shot -- --scene <name> [options]
  --scene <name>        scene of src/preview/scenes.ts (mini, mini-run, expanded, settings, boot-failed, idle, ...)
  --gallery <page[/state]>  the component gallery instead of a scene (pages: src/preview/gallery/registry.ts);
                        with --bg dark|light (what is under the glass) and --opacity 0.3..1 (the glass)
  --monitor <WxH@s>     monitor in physical pixels and scale, default 1920x1080@1
  --view window|desktop only the overlay window (8 px around it, the game under it), or the whole field; default window
  --scale <n>           pixel density of the picture, default 1
  --out <file.png>      default .superpowers/preview/<scene>-<view>.png
  --do "<steps>"        steps before the picture, separated by ";": click:<css>, type:<text>, press:<Key>, hover:<css>,
                        drag:<css>:<dx>,<dy>, leave, game, wait:<ms>, eval:<js>
  --state               print the mocked state of the window as one JSON line at the end (uncaughtErrors: how many)
  --allow-crash         do not fail on uncaught errors (a scene that shows a crash on purpose); they are still counted
  --timeout <seconds>   wait for the scene to be ready, default 30`;

/**
 * Exit codes: 1 the scene did not become ready or something broke, 2 the scene started with an error, 3 a step failed,
 * 4 an error nobody caught happened while the scene and the steps ran.
 */
class ShotError extends Error {
  /** @param {string} message @param {number} code */
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/** `gallery`, `bg` and `opacity` for the address: the desktop page hands every parameter on to the page inside it. */
const galleryParams = /** @type {Record<string, string>} */ ({});

const MARGIN = 8;
const SETTLE_MS = 2000;
/** The page of the desktop and the application inside it, as the browser's script sees them. */
const APP_FRAME = "document.querySelector('#overlay')";

const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readOptions() {
  const { values } = parseArgs({
    options: {
      scene: { type: 'string' }, monitor: { type: 'string' }, view: { type: 'string' }, scale: { type: 'string' },
      out: { type: 'string' }, do: { type: 'string' }, state: { type: 'boolean' }, timeout: { type: 'string' },
      gallery: { type: 'string' }, bg: { type: 'string' }, opacity: { type: 'string' }, 'allow-crash': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }
  if (values.gallery) {
    if (values.scene) throw new ShotError('--scene and --gallery are two different pages: give one of them', 1);
    if (values.bg !== undefined && values.bg !== 'dark' && values.bg !== 'light') throw new ShotError(`--bg must be dark or light, not "${values.bg}"`, 1);
    if (values.opacity !== undefined && !(Number(values.opacity) >= 0.3 && Number(values.opacity) <= 1)) {
      throw new ShotError(`--opacity must be between 0.3 and 1, not "${values.opacity}"`, 1);
    }
    galleryParams.gallery = values.gallery;
    if (values.bg) galleryParams.bg = values.bg;
    if (values.opacity) galleryParams.opacity = values.opacity;
    // the name of the page stands in for the scene: the default file name and the desktop page's selector read it
    values.scene = `gallery-${values.gallery.replace(/[^\w-]+/g, '_')}${values.bg === 'light' ? '-light' : ''}${values.opacity ? `-o${values.opacity}` : ''}`;
  } else if (values.bg !== undefined || values.opacity !== undefined) {
    throw new ShotError('--bg and --opacity are for --gallery pages only', 1);
  }
  if (!values.scene) throw new ShotError(`--scene is required\n${HELP}`, 1);
  const view = values.view ?? 'window';
  if (view !== 'window' && view !== 'desktop') throw new ShotError(`--view must be window or desktop, not "${view}"`, 1);
  const scale = Number(values.scale ?? 1);
  if (!(scale >= 0.5 && scale <= 4)) throw new ShotError(`--scale must be between 0.5 and 4, not "${values.scale}"`, 1);
  const timeout = Number(values.timeout ?? 30);
  if (!(timeout > 0)) throw new ShotError(`--timeout must be a number of seconds, not "${values.timeout}"`, 1);
  let steps;
  try {
    steps = parseSteps(values.do);
  } catch (err) {
    throw new ShotError(`--do: ${err instanceof Error ? err.message : err}`, 1);
  }
  const out = resolve(projectRoot, values.out ?? `.superpowers/preview/${values.scene}-${view}.png`);
  return {
    scene: values.scene, monitor: values.monitor ?? '1920x1080@1', view, scale, out, steps, state: values.state === true, timeout,
    allowCrash: values['allow-crash'] === true,
  };
}

/** Everything the page said that is worth reading when something goes wrong. */
function watchDiagnostics(/** @type {import('./cdp.mjs').Cdp} */ cdp) {
  /** @type {string[]} */
  const lines = [];
  cdp.on('Runtime.consoleAPICalled', (event) => {
    if (event.type !== 'error' && event.type !== 'assert') return;
    lines.push(`console.${event.type}: ${event.args.map((/** @type {any} */ a) => a.value ?? a.description ?? '').join(' ')}`);
  });
  cdp.on('Runtime.exceptionThrown', (event) => {
    lines.push(`exception: ${event.exceptionDetails.exception?.description ?? event.exceptionDetails.text}`);
  });
  cdp.on('Log.entryAdded', (event) => {
    if (event.entry.level === 'error') lines.push(`log: ${event.entry.text} ${event.entry.url ?? ''}`.trim());
  });
  return lines;
}

/** The text of every error nobody caught on the page (a throw in a handler or an effect, a rejected promise). */
function watchUncaught(/** @type {import('./cdp.mjs').Cdp} */ cdp) {
  /** @type {string[]} */
  const texts = [];
  cdp.on('Runtime.exceptionThrown', (event) => texts.push(exceptionText(event.exceptionDetails)));
  return texts;
}

/** Runs `expression` in the desktop page; the value comes back as JSON. */
async function evaluate(/** @type {import('./cdp.mjs').Cdp} */ cdp, /** @type {string} */ expression) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
}

/** The last lines of `window.__preview.log`, for the output of a failure. */
async function appLog(/** @type {import('./cdp.mjs').Cdp} */ cdp) {
  try {
    return /** @type {string[]} */ (await evaluate(cdp, `(${APP_FRAME}.contentWindow.__preview?.log ?? []).slice(-40)`));
  } catch {
    return [];
  }
}

/** The errors nobody caught so far: what the page threw and what the crash handler of the application logged. */
async function uncaughtErrors(/** @type {import('./cdp.mjs').Cdp} */ cdp, /** @type {string[]} */ exceptions) {
  const log = await evaluate(cdp, `${APP_FRAME}.contentWindow.__preview?.log ?? []`).catch(() => []);
  return findUncaughtErrors({ log, exceptions });
}

async function failureReport(/** @type {import('./cdp.mjs').Cdp} */ cdp, /** @type {string[]} */ diagnostics) {
  const log = await appLog(cdp);
  const lines = [];
  if (log.length > 0) lines.push('last lines of window.__preview.log:', ...log.map((line) => `  ${line}`));
  if (diagnostics.length > 0) lines.push('errors of the page:', ...diagnostics.slice(-20).map((line) => `  ${line}`));
  return lines.join('\n');
}

/** Waits until the application says it is ready (or has failed to start), the desktop page is set up and its picture loaded. */
async function waitReady(/** @type {import('./cdp.mjs').Cdp} */ cdp, /** @type {number} */ timeoutSec, /** @type {string[]} */ diagnostics) {
  const deadline = Date.now() + timeoutSec * 1000;
  for (;;) {
    const status = await evaluate(cdp, `(() => {
      const host = window.__previewHost;
      if (!host) return { stage: 'loading' };
      if (host.error) return { stage: 'host-error', error: host.error };
      const app = ${APP_FRAME}?.contentWindow?.__preview;
      if (!app) return { stage: 'loading' };
      return app.ready ? { stage: 'ready', error: app.error } : { stage: 'starting' };
    })()`);
    if (status.stage === 'host-error') throw new ShotError(`the desktop page: ${status.error}`, 1);
    if (status.stage === 'ready') {
      await evaluate(cdp, 'window.__previewHost.settled.then(() => true)');
      return /** @type {string | null} */ (status.error);
    }
    if (Date.now() > deadline) {
      throw new ShotError(`the scene was not ready in ${timeoutSec} s (stage: ${status.stage})\n${await failureReport(cdp, diagnostics)}`, 1);
    }
    await sleep(100);
  }
}

// ---- acting in the application ---------------------------------------------------------------------------

/** Where an element of the application is on the page, or why it cannot be clicked. */
async function locate(/** @type {import('./cdp.mjs').Cdp} */ cdp, /** @type {string} */ selector) {
  const found = await evaluate(cdp, `(() => {
    const frame = ${APP_FRAME};
    if (!frame || getComputedStyle(frame).visibility === 'hidden') return { error: 'the overlay window is not on screen' };
    const doc = frame.contentDocument;
    const el = doc.querySelector(${JSON.stringify(selector)});
    if (!el) return { error: 'no element matches the selector' };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return { error: 'the element has no size' };
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const hit = doc.elementFromPoint(cx, cy);
    if (!hit || !(el === hit || el.contains(hit))) {
      const name = hit ? hit.tagName.toLowerCase() + (hit.classList.length ? '.' + hit.classList[0] : '') : 'nothing';
      return { error: 'the centre of the element is covered by ' + name };
    }
    const f = frame.getBoundingClientRect();
    const k = frame.offsetWidth ? f.width / frame.offsetWidth : 1;
    return { x: f.left + cx * k, y: f.top + cy * k };
  })()`);
  if (found.error) throw new Error(found.error);
  return /** @type {{ x: number, y: number }} */ (found);
}

const mouse = (/** @type {import('./cdp.mjs').Cdp} */ cdp, /** @type {object} */ event) => cdp.send('Input.dispatchMouseEvent', event);

/** A drag is made of this many mouse moves, with a pause after each so that the page can react (a frame is 16 ms). */
const DRAG_MOVES = 8;
const DRAG_PAUSE_MS = 40;

async function click(/** @type {import('./cdp.mjs').Cdp} */ cdp, /** @type {string} */ selector) {
  const { x, y } = await locate(cdp, selector);
  await mouse(cdp, { type: 'mouseMoved', x, y });
  await mouse(cdp, { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await mouse(cdp, { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}

/** A key goes down and up through the real input pipeline, like a key of the keyboard. */
async function pressed(/** @type {import('./cdp.mjs').Cdp} */ cdp, /** @type {import('./steps.mjs').KeyPress} */ key) {
  const base = { key: key.key, code: key.code, windowsVirtualKeyCode: key.keyCode, nativeVirtualKeyCode: key.keyCode, modifiers: key.modifiers };
  await cdp.send('Input.dispatchKeyEvent', { type: key.text ? 'keyDown' : 'rawKeyDown', ...base, text: key.text, unmodifiedText: key.text });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

/** Runs one step; returns something worth printing, or nothing. */
async function perform(/** @type {import('./cdp.mjs').Cdp} */ cdp, /** @type {import('./steps.mjs').Step} */ step) {
  switch (step.kind) {
    case 'click':
      await click(cdp, step.selector);
      return;
    case 'hover': {
      const { x, y } = await locate(cdp, step.selector);
      await mouse(cdp, { type: 'mouseMoved', x, y });
      return;
    }
    case 'drag': {
      // The button goes down on the element, the mouse moves in several increments (the page follows between them,
      // as the window follows the pointer in life), the button goes up where the mouse ended.
      const { x, y } = await locate(cdp, step.selector);
      await mouse(cdp, { type: 'mouseMoved', x, y });
      await mouse(cdp, { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      for (let i = 1; i <= DRAG_MOVES; i++) {
        await mouse(cdp, { type: 'mouseMoved', x: x + (step.dx * i) / DRAG_MOVES, y: y + (step.dy * i) / DRAG_MOVES, button: 'left', buttons: 1 });
        await sleep(DRAG_PAUSE_MS);
      }
      await mouse(cdp, { type: 'mouseReleased', x: x + step.dx, y: y + step.dy, button: 'left', buttons: 0, clickCount: 1 });
      return;
    }
    case 'type':
      for (const char of step.text) await pressed(cdp, charKey(char));
      return;
    case 'press':
      await pressed(cdp, pressKey(step.key));
      return;
    case 'leave': {
      const { x, y } = await evaluate(cdp, 'window.__previewHost.gamePoint()');
      await mouse(cdp, { type: 'mouseMoved', x, y });
      return;
    }
    case 'game':
      await evaluate(cdp, 'window.__previewHost.clickGame()');
      return;
    case 'wait':
      await sleep(step.ms);
      return;
    case 'eval': {
      const value = await evaluate(cdp, `(async () => {
        const result = await ${APP_FRAME}.contentWindow.eval(${JSON.stringify(step.expression)});
        try { return JSON.stringify(result) ?? 'undefined'; } catch { return String(result); }
      })()`);
      return `-> ${value}`;
    }
  }
}

// ---- the picture -------------------------------------------------------------------------------------

/** The rectangle of the picture in pixels of the page: the whole field, or the window with its margin, inside the field. */
async function clipOf(/** @type {import('./cdp.mjs').Cdp} */ cdp, /** @type {'window' | 'desktop'} */ view) {
  const field = await evaluate(cdp, 'window.__previewHost.fieldRect()');
  let area = field;
  if (view === 'window') {
    const win = await evaluate(cdp, 'window.__previewHost.windowRect()');
    if (win === null) throw new ShotError('the overlay window is hidden, there is nothing to take a picture of (try --view desktop)', 1);
    const left = Math.max(field.x, win.x - MARGIN);
    const top = Math.max(field.y, win.y - MARGIN);
    const right = Math.min(field.x + field.width, win.x + win.width + MARGIN);
    const bottom = Math.min(field.y + field.height, win.y + win.height + MARGIN);
    area = { x: left, y: top, width: right - left, height: bottom - top };
  }
  const x = Math.floor(area.x);
  const y = Math.floor(area.y);
  return { x, y, width: Math.ceil(area.x + area.width) - x, height: Math.ceil(area.y + area.height) - y, scale: 1 };
}

async function capture(/** @type {import('./cdp.mjs').Cdp} */ cdp, /** @type {string} */ out, /** @type {'window' | 'desktop'} */ view) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: await clipOf(cdp, view), fromSurface: true });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(data, 'base64'));
}

/** Makes the browser window exactly as big as the page needs, so the clip always lies inside it. */
async function fitViewport(/** @type {import('./cdp.mjs').Cdp} */ cdp, /** @type {number} */ scale) {
  const field = await evaluate(cdp, 'window.__previewHost.fieldRect()');
  const bar = await evaluate(cdp, 'window.__previewHost.barHeight()');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    // at least 1000 px wide, so the service bar never wraps and keeps its height
    width: Math.max(1000, Math.ceil(field.x + field.width)),
    height: Math.ceil(bar + field.height),
    deviceScaleFactor: scale,
    mobile: false,
  });
}

// ---- the whole run --------------------------------------------------------------------------------------

async function main() {
  const options = readOptions();
  /** @type {Array<() => Promise<void>>} */
  const cleanups = [];
  let exitCode = 0;
  let stateLine = null;

  const stop = async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup().catch(() => {});
  };
  process.once('SIGINT', () => void stop().then(() => process.exit(130)));

  try {
    const { server, url } = await startDevServer({ quiet: true });
    cleanups.push(() => server.close());

    const browser = await launchBrowser(findBrowser());
    cleanups.push(() => browser.close());
    const cdp = await connect(await pageSocketUrl(browser.port));
    cleanups.push(async () => cdp.close());
    const diagnostics = watchDiagnostics(cdp);
    const uncaught = watchUncaught(cdp);

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    // the page believes it is in the focused window: focus events, `document.hasFocus()` and typing behave as in life
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: options.scale, mobile: false });

    const address = `${url}/preview.html?${new URLSearchParams({ scene: options.scene, monitor: options.monitor, zoom: '1', ...galleryParams })}`;
    await cdp.send('Page.navigate', { url: address });

    const sceneError = await waitReady(cdp, options.timeout, diagnostics);
    await fitViewport(cdp, options.scale);

    if (sceneError !== null) {
      // The scene failed to start: its own error is what the user must read, not "the window is hidden" (a scene
      // that failed before the window was shown has none). There is nothing to act on, so the steps are skipped.
      // A picture is only a bonus, and `--state` may have nothing to say yet.
      if (await capture(cdp, options.out, options.view).then(() => true, () => false)) {
        const written = relative(process.cwd(), options.out);
        console.log(`picture: ${isAbsolute(written) || written === '' ? options.out : written}`);
      }
      if (options.state) {
        stateLine = await evaluate(cdp, `JSON.stringify(${APP_FRAME}.contentWindow.__preview.state())`).catch(() => null);
      }
      throw new ShotError(`the scene started with an error: ${sceneError}\n${await failureReport(cdp, diagnostics)}`, 2);
    }

    let failedStep = null;
    for (const [i, step] of options.steps.entries()) {
      try {
        const note = await perform(cdp, step);
        console.log(`step ${i + 1}/${options.steps.length} ${step.source} ok${note ? ` ${note}` : ''}`);
        await sleep(50);
      } catch (err) {
        failedStep = new ShotError(`step ${i + 1}/${options.steps.length} "${step.source}" failed: ${err instanceof Error ? err.message : err}`, 3);
        break;
      }
    }
    await evaluate(cdp, `window.__previewHost.settle(${SETTLE_MS})`);

    const out = failedStep === null ? options.out : options.out.replace(/\.png$/i, '') + '-failed.png';
    await capture(cdp, out, options.view);
    const errors = await uncaughtErrors(cdp, uncaught);
    if (options.state) {
      stateLine = JSON.stringify({ ...(await evaluate(cdp, `${APP_FRAME}.contentWindow.__preview.state()`)), uncaughtErrors: errors.length });
    }
    const shown = relative(process.cwd(), out);
    console.log(`${failedStep === null ? 'picture' : 'picture at the moment of the failure'}: ${isAbsolute(shown) || shown === '' ? out : shown}`);

    // a failed step is reported first; an uncaught error is told about too (it is often what made the step fail)
    if (errors.length > 0 && options.allowCrash) console.log(`${errors.length} uncaught error${errors.length === 1 ? '' : 's'} not counted against the run (--allow-crash)`);
    if (errors.length > 0 && !options.allowCrash && failedStep !== null) console.error(describeUncaught(errors));
    if (failedStep !== null) throw failedStep;
    if (errors.length > 0 && !options.allowCrash) throw new ShotError(describeUncaught(errors), 4);
  } catch (err) {
    exitCode = err instanceof ShotError ? err.code : 1;
    console.error(err instanceof Error ? err.message : String(err));
  } finally {
    await stop();
  }
  if (stateLine !== null) console.log(stateLine);
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(err instanceof ShotError ? err.code : 1);
});
