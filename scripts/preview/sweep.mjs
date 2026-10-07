// `npm run preview:sweep`: the pre-release gate of the preview. It loads EVERY scene of src/preview/scenes.ts and EVERY
// page of the component gallery (src/preview/gallery/page-names.ts), one after another, with the same strict check as
// `preview:shot`: an error nobody caught (the page's own, or a `[crash]` line of the application's log) fails the item.
// One line per item (name, exit code as `preview:shot` would give it, number of uncaught errors); the exit code of the
// whole run is not zero if any item failed.
//
//   npm run preview:sweep [-- --allow-crash "scene a,gallery b"] [--timeout 30]
//
// The lists are read from the code, never copied here. ONE dev server and ONE browser serve the whole run (each item is
// a fresh page load, so each has its own database); both are stopped at the end, with the throw-away profile.
// It takes no pictures: for those there is `preview:shot`.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { findBrowser, launchBrowser, pageSocketUrl } from './browser.mjs';
import { connect } from './cdp.mjs';
import { projectRoot, startDevServer } from './server.mjs';
import { exceptionText, findUncaughtErrors, formatItemLine, itemResult, sweepExitCode, sweepItems, sweepSummary } from './uncaught.mjs';

const HELP = `usage: npm run preview:sweep [-- options]
  --allow-crash <names>  items that show a crash on purpose, as printed ("scene boom") or by the bare name, separated by commas
  --timeout <seconds>    how long an item may take to get ready, default 30`;

const SETTLE_MS = 2000;
/** The page of the desktop and the application inside it, as the browser's script sees them. */
const APP_FRAME = "document.querySelector('#overlay')";

const sleep = (/** @type {number} */ ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

/** Runs `expression` in the page; the value comes back as JSON. */
async function evaluate(/** @type {import('./cdp.mjs').Cdp} */ cdp, /** @type {string} */ expression) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
}

/** Like `evaluate`, but a page that is being replaced answers "not yet" instead of failing. */
const tryEvaluate = (/** @type {import('./cdp.mjs').Cdp} */ cdp, /** @type {string} */ expression) => evaluate(cdp, expression).catch(() => undefined);

/**
 * Waits until the application of the page just opened says it is ready (or has failed to start) and the screen has settled.
 * @returns {Promise<{ failure: { exitCode: number, message: string } | null }>}
 */
async function waitReady(/** @type {import('./cdp.mjs').Cdp} */ cdp, /** @type {number} */ timeoutSec) {
  const deadline = Date.now() + timeoutSec * 1000;
  for (;;) {
    const status = await tryEvaluate(cdp, `(() => {
      const host = window.__previewHost;
      if (!host) return { stage: 'loading' };
      if (host.error) return { stage: 'host-error', error: host.error };
      const app = ${APP_FRAME}?.contentWindow?.__preview;
      if (!app) return { stage: 'loading' };
      return app.ready ? { stage: 'ready', error: app.error } : { stage: 'starting' };
    })()`);
    if (status?.stage === 'host-error') return { failure: { exitCode: 1, message: `the desktop page: ${status.error}` } };
    if (status?.stage === 'ready') {
      await evaluate(cdp, 'window.__previewHost.settled.then(() => true)');
      if (status.error !== null) return { failure: { exitCode: 2, message: `the scene started with an error: ${status.error}` } };
      await evaluate(cdp, `window.__previewHost.settle(${SETTLE_MS})`);
      return { failure: null };
    }
    if (Date.now() > deadline) return { failure: { exitCode: 1, message: `not ready in ${timeoutSec} s (stage: ${status?.stage ?? 'unknown'})` } };
    await sleep(100);
  }
}

/** Opens `about:blank` first, so that nothing the previous item's page still says can land in the next item. */
async function clear(/** @type {import('./cdp.mjs').Cdp} */ cdp) {
  await cdp.send('Page.navigate', { url: 'about:blank' });
  for (let i = 0; i < 100; i++) {
    if ((await tryEvaluate(cdp, 'location.href')) === 'about:blank') return;
    await sleep(20);
  }
}

async function main() {
  const { values } = parseArgs({ options: { 'allow-crash': { type: 'string' }, timeout: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }
  const timeout = Number(values.timeout ?? 30);
  if (!(timeout > 0)) throw new Error(`--timeout must be a number of seconds, not "${values.timeout}"`);
  const allowed = new Set((values['allow-crash'] ?? '').split(',').map((name) => name.trim()).filter((name) => name !== ''));

  // the lists come from the code: Node reads the TypeScript files as they are (they import nothing at run time)
  const { SCENES } = await import(pathToFileURL(resolve(projectRoot, 'src/preview/scenes.ts')).href);
  const { GALLERY_PAGES } = await import(pathToFileURL(resolve(projectRoot, 'src/preview/gallery/page-names.ts')).href);
  const items = sweepItems({ scenes: SCENES.map((/** @type {{ name: string }} */ s) => s.name), pages: [...GALLERY_PAGES] });
  const width = Math.max(0, ...items.map((item) => item.name.length));

  /** @type {Array<() => Promise<void>>} */
  const cleanups = [];
  const stop = async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup().catch(() => {});
  };
  process.once('SIGINT', () => void stop().then(() => process.exit(130)));

  /** @type {import('./uncaught.mjs').ItemResult[]} */
  const results = [];
  try {
    const { server, url } = await startDevServer({ quiet: true });
    cleanups.push(() => server.close());
    const browser = await launchBrowser(findBrowser());
    cleanups.push(() => browser.close());
    const cdp = await connect(await pageSocketUrl(browser.port));
    cleanups.push(async () => cdp.close());

    /** @type {string[]} */
    const exceptions = [];
    cdp.on('Runtime.exceptionThrown', (event) => exceptions.push(exceptionText(event.exceptionDetails)));
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    // the page believes it is in the focused window, as in `preview:shot`
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

    for (const item of items) {
      let result;
      try {
        await clear(cdp);
        exceptions.length = 0;
        await cdp.send('Page.navigate', { url: `${url}/preview.html?${new URLSearchParams({ ...item.params, monitor: item.monitor, zoom: '1' })}` });
        const { failure } = await waitReady(cdp, timeout);
        const log = await tryEvaluate(cdp, `${APP_FRAME}.contentWindow.__preview?.log ?? []`);
        const errors = findUncaughtErrors({ log: log ?? [], exceptions });
        const bare = item.name.slice(item.name.indexOf(' ') + 1); // "scene boom" -> "boom"
        result = itemResult({ name: item.name, errors, allowCrash: allowed.has(item.name) || allowed.has(bare), failure });
      } catch (err) {
        result = itemResult({ name: item.name, errors: [], failure: { exitCode: 1, message: err instanceof Error ? err.message : String(err) } });
      }
      results.push(result);
      console.log(formatItemLine(result, width));
      if (result.detail !== '') console.log(result.detail.split('\n').map((line) => `    ${line}`).join('\n'));
    }
  } finally {
    await stop();
  }
  console.log(sweepSummary(results));
  process.exit(sweepExitCode(results));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
