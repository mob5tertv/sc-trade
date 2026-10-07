// `npm run preview:sweep`: the pre-release gate of the preview. It loads EVERY scene of src/preview/scenes.ts and EVERY
// page of the component gallery (src/preview/gallery/page-names.ts), one after another, with the same strict check as
// `preview:shot`: an error nobody caught (the page's own, or a `[crash]` line of the application's log) fails the item.
// One line per item (name, exit code as `preview:shot` would give it, number of uncaught errors); the exit code of the
// whole run is not zero if any item failed.
//
//   npm run preview:sweep [-- --allow-crash "scene a,gallery b"] [--timeout 30] [--item-deadline 47]
//
// The lists are read from the code, never copied here, and through the dev server's own module loader (sweep-lists.mjs),
// because the scene modules are resolved the way Vite resolves them, not the way plain Node does. ONE dev server and ONE
// browser serve the whole run (each item is a fresh page load, so each has its own database); both are stopped at the
// end, with the throw-away profile. Every item has a deadline. A page that stops answering (its renderer is stuck in a
// loop) fails its item, and its tab is closed and replaced by a new one: nothing the old tab says later can reach the
// next item, and the next item does not meet a tab that cannot answer, so the sweep goes on. It takes no pictures: for
// those there is `preview:shot`.
import { parseArgs } from 'node:util';
import { findBrowser, launchBrowser, pageSocketUrl } from './browser.mjs';
import { connect } from './cdp.mjs';
import { withDeadline } from './deadline.mjs';
import { startDevServer } from './server.mjs';
import { loadSweepItems } from './sweep-lists.mjs';
import { exceptionText, findUncaughtErrors, formatItemLine, itemResult, sweepExitCode, sweepSummary } from './uncaught.mjs';

const HELP = `usage: npm run preview:sweep [-- options]
  --allow-crash <names>   items that show a crash on purpose, as printed ("scene boom") or by the bare name, separated by commas
  --timeout <seconds>     how long an item may take to get ready, default 30
  --item-deadline <sec>   how long a whole item may take before its tab is given up on, default --timeout + 17`;

const SETTLE_MS = 2000;
const ITEM_MARGIN_MS = 15_000;
/** The page of the desktop and the application inside it, as the browser's script sees them. */
const APP_FRAME = "document.querySelector('#overlay')";

const sleep = (/** @type {number} */ ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

/**
 * One tab of the browser as the sweep drives it: the connection, the id of the target (to close it) and the uncaught
 * errors this tab has reported. Each tab has its own list, so an old tab cannot add to the errors of a new one.
 * @typedef {{ id: string, cdp: import('./cdp.mjs').Cdp, exceptions: string[] }} Tab
 */

/** Connects to a page target and sets it up as `preview:shot` sets up its page. */
async function attach(/** @type {string} */ socketUrl) {
  const cdp = await connect(socketUrl);
  /** @type {string[]} */
  const exceptions = [];
  cdp.on('Runtime.exceptionThrown', (event) => exceptions.push(exceptionText(event.exceptionDetails)));
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  // the page believes it is in the focused window, as in `preview:shot`
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  return /** @type {Tab} */ ({ id: socketUrl.slice(socketUrl.lastIndexOf('/') + 1), cdp, exceptions });
}

/**
 * Gives up on a tab that cannot answer: a new blank tab first (the browser never has none), then the old one is closed
 * from the browser's side (its renderer cannot be asked) and its connection dropped.
 * @param {number} port the debugging port of the browser
 * @param {Tab} tab
 * @returns {Promise<Tab>}
 */
async function replaceTab(port, tab) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
  const target = /** @type {{ webSocketDebuggerUrl?: string }} */ (await response.json());
  if (!target.webSocketDebuggerUrl) throw new Error('the browser did not open a new tab to go on with');
  const fresh = await attach(target.webSocketDebuggerUrl);
  tab.cdp.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${tab.id}`).catch(() => {});
  return fresh;
}

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
 * `signal`: the item was given up on, stop asking.
 * @returns {Promise<{ failure: { exitCode: number, message: string } | null }>}
 */
async function waitReady(/** @type {import('./cdp.mjs').Cdp} */ cdp, /** @type {number} */ timeoutSec, /** @type {AbortSignal} */ signal) {
  const deadline = Date.now() + timeoutSec * 1000;
  for (;;) {
    if (signal.aborted) return { failure: { exitCode: 1, message: 'the item was given up on' } };
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

/**
 * One item: a blank page, then the item's page; wait until it is ready and settled; judge it by what it threw and logged.
 * @returns {Promise<import('./uncaught.mjs').ItemResult>}
 */
async function visit(
  /** @type {Tab} */ tab, /** @type {string} */ url, /** @type {import('./uncaught.mjs').SweepItem} */ item,
  /** @type {number} */ timeout, /** @type {boolean} */ allowCrash, /** @type {AbortSignal} */ signal,
) {
  await clear(tab.cdp);
  tab.exceptions.length = 0;
  await tab.cdp.send('Page.navigate', { url: `${url}/preview.html?${new URLSearchParams({ ...item.params, monitor: item.monitor, zoom: '1' })}` });
  const { failure } = await waitReady(tab.cdp, timeout, signal);
  const log = await tryEvaluate(tab.cdp, `${APP_FRAME}.contentWindow.__preview?.log ?? []`);
  const errors = findUncaughtErrors({ log: log ?? [], exceptions: tab.exceptions });
  return itemResult({ name: item.name, errors, allowCrash, failure });
}

async function main() {
  const { values } = parseArgs({
    options: { 'allow-crash': { type: 'string' }, timeout: { type: 'string' }, 'item-deadline': { type: 'string' }, help: { type: 'boolean' } },
  });
  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }
  const timeout = Number(values.timeout ?? 30);
  if (!(timeout > 0)) throw new Error(`--timeout must be a number of seconds, not "${values.timeout}"`);
  // by default: getting ready (`--timeout`), settling, and a margin for the page to go blank and the answers to come back
  const itemDeadlineSec = Number(values['item-deadline'] ?? (timeout * 1000 + SETTLE_MS + ITEM_MARGIN_MS) / 1000);
  if (!(itemDeadlineSec > 0)) throw new Error(`--item-deadline must be a number of seconds, not "${values['item-deadline']}"`);
  const allowed = new Set((values['allow-crash'] ?? '').split(',').map((name) => name.trim()).filter((name) => name !== ''));

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
    // the lists come from the code, through the module loader of this very server (see sweep-lists.mjs)
    const items = await loadSweepItems(server);
    const width = Math.max(0, ...items.map((item) => item.name.length));
    const browser = await launchBrowser(findBrowser());
    cleanups.push(() => browser.close());
    let tab = await attach(await pageSocketUrl(browser.port));
    cleanups.push(async () => tab.cdp.close()); // the tab of the moment: `tab` changes when one is given up on

    for (const item of items) {
      const bare = item.name.slice(item.name.indexOf(' ') + 1); // "scene boom" -> "boom"
      const allowCrash = allowed.has(item.name) || allowed.has(bare);
      const abandoned = new AbortController();
      let result;
      try {
        // one deadline around the whole item: a page that stops answering must not hang the sweep
        result = await withDeadline(visit(tab, url, item, timeout, allowCrash, abandoned.signal), itemDeadlineSec * 1000, `item "${item.name}"`);
      } catch (err) {
        abandoned.abort();
        const errors = findUncaughtErrors({ log: [], exceptions: tab.exceptions }); // what the page threw before it went quiet still counts
        result = itemResult({ name: item.name, errors, allowCrash, failure: { exitCode: 1, message: err instanceof Error ? err.message : String(err) } });
        // the tab is in an unknown state (its renderer may be stuck): go on with a new one
        tab = await replaceTab(browser.port, tab);
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
