// `npm run site:check`: builds the site into a temporary folder and looks at it in a headless browser, the pages
// opened from the disk: takes pictures of the first screen and of every section at 1440 x 900 and 390 x 844 in both
// languages, opens a picture of the gallery, asks about analytics (a build with a made-up GA4 id), fills the feedback
// form in against a stand-in server on this computer, and measures the contrast of the text of the first screen —
// over the still background and over a pure white video, the worst a frame can be.
//
//   npm run site:check [-- --out <folder>] [--no-video] [--installer <file>]
//
// The pictures go to .superpowers/site-check/ (not in the repository), or to the folder `--out` names. Whatever
// folder that is, the script only writes its own pictures there and, before a run, removes its own pictures of the
// run before: no other file is touched, and the folder itself is never removed.
//
// The script ends with "all passed" or with the list of what is wrong and exit code 1. The browser is cut off from
// the network (chrome.mjs): the only addresses a page may ask for are files and the stand-in server.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { launchBrowser, pageSocketUrl } from '../preview/browser.mjs';
import { connect } from '../preview/cdp.mjs';
import { buildSite } from './build.mjs';
import { browserPath, isolatedArguments } from './chrome.mjs';
import { loadDictionaries, projectRoot, siteDir } from './config.mjs';
import { decodePng } from './png.mjs';
import { makeHeroVideo } from './video.mjs';

/** @typedef {import('../preview/cdp.mjs').Cdp} Cdp */
/** @typedef {{ name: string, width: number, height: number, scale: number, mobile: boolean }} Viewport */

/** @type {Viewport} */
const DESKTOP = { name: '1440', width: 1440, height: 900, scale: 1, mobile: false };
/** @type {Viewport} */
const PHONE = { name: '390', width: 390, height: 844, scale: 2, mobile: true };
const LANGS = /** @type {const} */ ([{ lang: 'ru', home: 'index.html', data: 'data.html' }, { lang: 'en', home: 'en/index.html', data: 'en/data.html' }]);
const SECTIONS = ['features', 'gallery', 'safety', 'download', 'feedback', 'support'];
/** Widths at which nothing may stick out of the page sideways. */
const WIDTHS = [320, 360, 390, 480, 720, 768, 1024, 1280, 1440, 1920];
/** A section taller than this is cut into several pictures, so that each stays readable. */
const TILE = { [DESKTOP.name]: 2000, [PHONE.name]: 1500 };
const GA4_ID = 'G-TEST123456';
const MIN_CONTRAST = 7;

// ---- the pictures and their folder ----------------------------------------------------------------------------

/**
 * What a picture shows: the last part of its name. Every picture the script writes is named
 * `<width>-<language>-<what>.png`, with `-<n>` before `.png` when a tall section is cut into tiles, or `1440-404.png`.
 */
const SHOWN = [
  '1-hero', '1-hero-whole', ...SECTIONS.map((id, index) => `${index + 2}-${id}`), '8-footer', '9-data', 'menu', 'hero-other-font', 'lightbox',
  'form-error', 'form-success', 'hero-no-installer', 'download-no-installer', 'consent', 'footer-change-choice', 'hero-white-video',
  'focus-support', 'focus-gallery',
];
const NOT_FOUND_PICTURE = `${DESKTOP.name}-404`;
const OWN_PICTURES = new Set([NOT_FOUND_PICTURE, ...[DESKTOP, PHONE].flatMap((viewport) => LANGS.flatMap(({ lang }) => SHOWN.map((what) => `${viewport.name}-${lang}-${what}`)))]);

/** Whether a file name is the name of a picture this script writes. */
export function isOwnPicture(/** @type {string} */ name) {
  if (!name.endsWith('.png')) return false;
  const stem = name.slice(0, -'.png'.length);
  if (OWN_PICTURES.has(stem)) return true;
  const tile = /^(.+)-\d+$/.exec(stem);
  return tile !== null && tile[1] !== NOT_FOUND_PICTURE && OWN_PICTURES.has(tile[1]);
}

/**
 * Makes the folder of the pictures ready: makes it when it is not there, and removes from it the pictures of the run
 * before — files in the folder itself that carry the names of this script — and nothing else. The folder may be
 * anyone's (`--out`): it is never removed, and no other file and no folder inside it is touched.
 * @param {string} out
 * @returns {string[]} the names of the old pictures that were removed
 */
export function preparePictureFolder(out) {
  if (existsSync(out) && !statSync(out).isDirectory()) throw new Error(`--out ${out} is a file, not a folder: name a folder for the pictures`);
  mkdirSync(out, { recursive: true });
  const old = readdirSync(out, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isOwnPicture(entry.name))
    .map((entry) => entry.name)
    .sort();
  for (const name of old) rmSync(join(out, name));
  return old;
}

/** Writes one picture. Only the names of this script are ever written: the folder may hold other people's files. */
function writePicture(/** @type {string} */ file, /** @type {Buffer} */ bytes) {
  if (!isOwnPicture(basename(file))) throw new Error(`"${basename(file)}" is not the name of a picture of this script: add it to the list of names first`);
  writeFileSync(file, bytes);
  pictures.push(file);
}

const sleep = (/** @type {number} */ ms) => new Promise((done) => setTimeout(done, ms));

/** @type {string[]} */
const problems = [];
/** @type {string[]} */
const pictures = [];
/** @type {string[]} */
const notes = [];

// ---- the browser ---------------------------------------------------------------------------------------------

/** Runs `expression` in the page; the value comes back as JSON. */
async function evaluate(/** @type {Cdp} */ cdp, /** @type {string} */ expression) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
}

/** One press of Tab, through the input of the browser, as from a keyboard. */
async function pressTab(/** @type {Cdp} */ cdp) {
  const key = { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 };
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  await sleep(40);
}

/** Waits until `expression` is true in the page. */
async function until(/** @type {Cdp} */ cdp, /** @type {string} */ expression, /** @type {string} */ what, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await evaluate(cdp, `Boolean(${expression})`))) {
    if (Date.now() > deadline) throw new Error(`waited ${timeoutMs / 1000} s for: ${what}`);
    await sleep(50);
  }
}

/**
 * Opens a page at a size. `allowed` is the one http address a page may ask for (the stand-in server).
 * @param {{ cdp: Cdp, onLoad: { wait: () => Promise<void> } }} browser
 * @param {string} url
 * @param {Viewport} viewport
 * @param {{ reducedMotion?: boolean }} [options]
 */
async function open(browser, url, viewport, options = {}) {
  const { cdp } = browser;
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.scale, mobile: viewport.mobile });
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: options.reducedMotion ? 'reduce' : 'no-preference' }] });
  const loaded = browser.onLoad.wait();
  await cdp.send('Page.navigate', { url });
  await loaded;
  // everything a picture needs is there: the font, and every image, the lazy ones too
  await evaluate(cdp, `(async () => {
    await document.fonts.ready;
    for (const image of document.images) image.loading = 'eager';
    await Promise.all([...document.images].map((image) => image.decode().catch(() => {})));
  })()`);
  await sleep(120);
}

/** @param {Cdp} cdp @param {string} file @param {{ x: number, y: number, width: number, height: number }} clip in CSS pixels of the page */
async function capture(cdp, file, clip) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 }, captureBeyondViewport: true });
  const bytes = Buffer.from(data, 'base64');
  writePicture(file, bytes);
  return bytes;
}

/** A picture of the screen as it is now, wherever the page is scrolled to: what lies over the page (a dialog) is in it, in its place. */
async function captureVisible(/** @type {Cdp} */ cdp, /** @type {string} */ file) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writePicture(file, Buffer.from(data, 'base64'));
}

/** A picture of what the visitor sees without scrolling. */
const captureScreen = (/** @type {Cdp} */ cdp, /** @type {string} */ file, /** @type {Viewport} */ viewport) => capture(cdp, file, { x: 0, y: 0, width: viewport.width, height: viewport.height });

/** Pictures of one element of the page, cut into tiles when it is tall. */
async function captureElement(/** @type {Cdp} */ cdp, /** @type {string} */ selector, /** @type {string} */ file, /** @type {Viewport} */ viewport) {
  const box = await evaluate(cdp, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { y: Math.floor(rect.top + scrollY), height: Math.ceil(rect.height) };
  })()`);
  if (box === null) return void problems.push(`${file}: the page has no ${selector}`);
  const tile = TILE[viewport.name];
  const count = Math.ceil(box.height / tile);
  for (let i = 0; i < count; i++) {
    const height = Math.min(tile, box.height - i * tile);
    await capture(cdp, count === 1 ? file : file.replace(/\.png$/, `-${i + 1}.png`), { x: 0, y: box.y + i * tile, width: viewport.width, height });
  }
}

/** Nothing of the page may be wider than the screen. */
async function checkOverflow(/** @type {Cdp} */ cdp, /** @type {string} */ where) {
  const wide = await evaluate(cdp, `(() => {
    const limit = document.documentElement.clientWidth;
    if (document.documentElement.scrollWidth <= limit) return null;
    const culprits = [...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > limit + 0.5 && getComputedStyle(el).position !== 'fixed');
    return document.documentElement.scrollWidth + ' > ' + limit + ': ' + culprits.slice(0, 4).map((el) => el.tagName.toLowerCase() + '.' + el.className).join(', ');
  })()`);
  if (wide !== null) problems.push(`${where}: the page is wider than the screen (${wide})`);
}

// ---- contrast of the first screen ----------------------------------------------------------------------------

const channel = (/** @type {number} */ value) => (value / 255 <= 0.04045 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4);
const luminance = (/** @type {number} */ r, /** @type {number} */ g, /** @type {number} */ b) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

/**
 * The lowest contrast between a line of text of the first screen and the brightest pixel behind it (WCAG), measured
 * on a picture taken with the letters made invisible. The text of the main button is dark on the accent, a pair that
 * never changes, and is left out.
 * @param {Cdp} cdp
 * @param {Viewport} viewport
 * @returns {Promise<{ ratio: number, text: string, lines: number }>}
 */
async function heroContrast(cdp, viewport) {
  const lines = await evaluate(cdp, `(() => {
    const hero = document.querySelector('.hero');
    const top = hero.getBoundingClientRect().top + scrollY;
    const found = [];
    const walker = document.createTreeWalker(hero, NodeFilter.SHOW_TEXT);
    for (let node; (node = walker.nextNode()); ) {
      const text = node.nodeValue.trim();
      const element = node.parentElement;
      if (text === '' || element.closest('.button')) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.width < 1 || rect.height < 1) continue;
        found.push({ x: rect.left, y: rect.top + scrollY - top, width: rect.width, height: rect.height, colour: getComputedStyle(element).color, text: text.slice(0, 40) });
      }
    }
    const style = document.createElement('style');
    style.id = 'pagecheck-no-letters';
    style.textContent = '.hero, .hero * { color: transparent !important; } .hero__kicker::before, .hero__facts li::before { visibility: hidden; }';
    document.head.appendChild(style);
    return { top, height: Math.ceil(hero.getBoundingClientRect().height), lines: found };
  })()`);
  await sleep(80);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: lines.top, width: viewport.width, height: lines.height, scale: 1 }, captureBeyondViewport: true });
  await evaluate(cdp, `document.getElementById('pagecheck-no-letters').remove()`);
  const image = decodePng(Buffer.from(data, 'base64'));
  const k = image.width / viewport.width;

  let worst = { ratio: Infinity, text: '', lines: lines.lines.length };
  for (const line of lines.lines) {
    const [r, g, b] = /** @type {string} */ (line.colour).match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
    const ink = luminance(r, g, b);
    let brightest = 0;
    for (let y = Math.max(0, Math.floor(line.y * k)); y < Math.min(image.height, Math.ceil((line.y + line.height) * k)); y++) {
      for (let x = Math.max(0, Math.floor(line.x * k)); x < Math.min(image.width, Math.ceil((line.x + line.width) * k)); x++) {
        const at = (y * image.width + x) * 4;
        const behind = luminance(image.rgba[at], image.rgba[at + 1], image.rgba[at + 2]);
        if (behind > brightest) brightest = behind;
      }
    }
    const ratio = (Math.max(ink, brightest) + 0.05) / (Math.min(ink, brightest) + 0.05);
    if (ratio < worst.ratio) worst = { ratio, text: line.text, lines: lines.lines.length };
  }
  return worst;
}

async function checkHeroContrast(/** @type {Cdp} */ cdp, /** @type {Viewport} */ viewport, /** @type {string} */ where) {
  const worst = await heroContrast(cdp, viewport);
  notes.push(`contrast of the first screen, ${where}: ${worst.ratio.toFixed(1)}:1 at the worst of ${worst.lines} lines ("${worst.text}")`);
  if (worst.ratio < MIN_CONTRAST) problems.push(`${where}: the text "${worst.text}" of the first screen has a contrast of ${worst.ratio.toFixed(2)}:1, under ${MIN_CONTRAST}:1`);
}

// ---- the stand-in server of the feedback form ------------------------------------------------------------------

const TYPES = /** @type {Record<string, string>} */ ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg' });

/**
 * The file of a built site that the path of a request names, a folder being its index page; `null` when the path
 * leads out of the site (the folder next to it whose name begins the same, `dist-deploy`, is outside too).
 * @param {string} dist
 * @param {string} path the path of the request, decoded, with its leading slash
 * @returns {string | null}
 */
export function servedFile(dist, path) {
  const root = resolve(dist);
  const file = resolve(root, `.${path.endsWith('/') ? `${path}index.html` : path}`);
  return file.startsWith(root + sep) ? file : null;
}

/**
 * Serves a built site from this computer and answers the feedback form with whatever `reply` holds at the moment.
 * @param {string} dist
 */
async function startStandIn(dist) {
  const state = {
    reply: { status: 200, body: '{"ok":true}' },
    /** @type {Array<{ fields: Array<{ name: string, filename: string | null }>, type: string }>} */
    received: [],
  };
  const server = createServer((request, response) => {
    const path = decodeURIComponent((request.url ?? '/').split('?')[0]);
    if (request.method === 'POST' && path === '/api/feedback') {
      /** @type {Buffer[]} */
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        const body = Buffer.concat(chunks).toString('latin1');
        const fields = [...body.matchAll(/Content-Disposition: form-data; name="([^"]+)"(?:; filename="([^"]*)")?/g)].map((match) => ({ name: match[1], filename: match[2] ?? null }));
        state.received.push({ fields, type: request.headers['content-type'] ?? '' });
        response.writeHead(state.reply.status, { 'content-type': 'application/json' });
        response.end(state.reply.body);
      });
      return;
    }
    const file = servedFile(dist, path);
    if (file === null || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404);
      return void response.end();
    }
    response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    response.end(readFileSync(file));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', () => done(undefined)));
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  return { origin: `http://127.0.0.1:${port}`, state, close: () => new Promise((done) => server.close(() => done(undefined))) };
}

// ---- what is looked at -------------------------------------------------------------------------------------------

/** @param {{ cdp: Cdp, onLoad: { wait: () => Promise<void> } }} browser @param {string} dist @param {string} out */
async function lookAtPages(browser, dist, out) {
  const { cdp } = browser;
  const address = (/** @type {string} */ file) => pathToFileURL(join(dist, file)).href;
  for (const { lang, home, data } of LANGS) {
    for (const viewport of [DESKTOP, PHONE]) {
      const name = (/** @type {string} */ what) => join(out, `${viewport.name}-${lang}-${what}.png`);
      await open(browser, address(home), viewport);
      // the switch of the folded menu is a thing of the narrow layout: on a wide screen a keyboard must not stop at it
      const toggle = await evaluate(cdp, `getComputedStyle(document.querySelector('#menu-toggle')).display`);
      if ((toggle === 'none') !== (viewport === DESKTOP)) problems.push(`${home} ${viewport.name}: the switch of the menu has display "${toggle}"`);
      await captureScreen(cdp, name('1-hero'), viewport);
      await checkHeroContrast(cdp, viewport, `${lang} ${viewport.name}, still background`);
      if (viewport === PHONE) await captureElement(cdp, '.hero', name('1-hero-whole'), viewport);
      for (const [index, id] of SECTIONS.entries()) await captureElement(cdp, `#${id}`, name(`${index + 2}-${id}`), viewport);
      await captureElement(cdp, '.site-footer', name('8-footer'), viewport);
      await open(browser, address(data), viewport);
      await captureElement(cdp, 'main', name('9-data'), viewport);
    }
    for (const width of WIDTHS) {
      for (const file of [home, data]) {
        await open(browser, address(file), { name: String(width), width, height: 900, scale: 1, mobile: width < 720 });
        await checkOverflow(cdp, `${file} at ${width} px`);
      }
    }
  }
  // a plate or a picture that has the focus shows it by a ring drawn inside it. One Tab first: the page then knows
  // that the visitor uses the keyboard, and shows the focus the way it does for the keys.
  await open(browser, address('index.html'), DESKTOP);
  await pressTab(cdp);
  for (const [what, selector] of [['support', '.support__link'], ['gallery', '[data-gallery] a']]) {
    const ring = await evaluate(cdp, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.scrollIntoView({ block: 'center', behavior: 'instant' }); return getComputedStyle(el).boxShadow; })()`);
    if (!/inset/.test(ring)) problems.push(`${selector} shows no ring when it has the focus (box-shadow: ${ring})`);
    await sleep(80);
    await captureVisible(cdp, join(out, `${DESKTOP.name}-ru-focus-${what}.png`));
  }

  await open(browser, address('404.html'), DESKTOP);
  await captureScreen(cdp, join(out, '1440-404.png'), DESKTOP);

  // the menu of a narrow screen, opened the way a finger opens it
  await open(browser, address('index.html'), PHONE);
  await evaluate(cdp, `document.querySelector('.menu-button').click()`);
  await sleep(100);
  await captureScreen(cdp, join(out, '390-ru-menu.png'), PHONE);
  if (!(await evaluate(cdp, `getComputedStyle(document.querySelector('.site-nav')).display !== 'none'`))) problems.push('the menu of a narrow screen did not open');

  // a visitor without Bahnschrift (a phone): the next font of the list is much wider
  await evaluate(cdp, `(document.querySelector('#menu-toggle').checked = false, document.documentElement.style.setProperty('--font', "'Segoe UI', Arial, sans-serif"))`);
  await sleep(150);
  await captureElement(cdp, '.hero', join(out, '390-ru-hero-other-font.png'), PHONE);
  await checkOverflow(cdp, 'index.html at 390 px with a wider font');
  await checkHeroContrast(cdp, PHONE, 'ru 390, a wider font');
}

/** @param {{ cdp: Cdp, onLoad: { wait: () => Promise<void> } }} browser @param {string} dist @param {string} out */
async function lookAtGallery(browser, dist, out) {
  const { cdp } = browser;
  const key = async (/** @type {string} */ name, /** @type {number} */ code) => {
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: name, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
    await sleep(120);
  };
  for (const viewport of [DESKTOP, PHONE]) {
    await open(browser, pathToFileURL(join(dist, 'index.html')).href, viewport);
    // with the keyboard: the focus on the first picture, Enter
    await evaluate(cdp, `(document.querySelector('[data-gallery] a').scrollIntoView({ block: 'center' }), document.querySelector('[data-gallery] a').focus())`);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: '\r' });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await until(cdp, `document.querySelector('[data-lightbox]').open`, 'the picture to open on Enter');
    await evaluate(cdp, `document.querySelector('[data-lightbox-image]').decode().catch(() => {})`);
    await sleep(150);
    await captureVisible(cdp, join(out, `${viewport.name}-ru-lightbox.png`));

    const first = await evaluate(cdp, `document.querySelector('[data-lightbox-caption]').textContent`);
    await key('ArrowRight', 39);
    const second = await evaluate(cdp, `document.querySelector('[data-lightbox-caption]').textContent`);
    if (first === second || second === '') problems.push(`${viewport.name}: the right arrow did not show the next picture`);
    const shown = await evaluate(cdp, `(() => { const r = document.querySelector('[data-lightbox-image]').getBoundingClientRect(); return { w: r.width, right: r.right, bottom: r.bottom, vw: innerWidth, vh: innerHeight }; })()`);
    if (shown.right > shown.vw + 0.5 || shown.bottom > shown.vh + 0.5) problems.push(`${viewport.name}: the opened picture does not fit the screen (${JSON.stringify(shown)})`);
    await key('Escape', 27);
    const after = await evaluate(cdp, `({ open: document.querySelector('[data-lightbox]').open, back: document.activeElement === document.querySelector('[data-gallery] a') })`);
    if (after.open) problems.push(`${viewport.name}: Esc did not close the opened picture`);
    if (!after.back) problems.push(`${viewport.name}: after Esc the focus did not return to the picture that was opened`);
  }
}

/** @param {{ cdp: Cdp, onLoad: { wait: () => Promise<void> } }} browser @param {string} dist @param {string} out */
async function lookAtConsent(browser, dist, out) {
  const { cdp } = browser;
  const googleOnPage = `[...document.scripts].some((script) => /google/i.test(script.src)) || 'dataLayer' in window`;
  for (const { lang, home } of LANGS) {
    for (const viewport of [DESKTOP, PHONE]) {
      await open(browser, pathToFileURL(join(dist, home)).href, viewport);
      await evaluate(cdp, `localStorage.clear()`);
      await open(browser, pathToFileURL(join(dist, home)).href, viewport);
      if (await evaluate(cdp, `document.querySelector('[data-consent]').hidden`)) problems.push(`${home} ${viewport.name}: the banner is not shown to a visitor who has not answered`);
      // a visitor with a keyboard meets the question first: Tab from the top of the page goes to the skip link, then into the banner
      await pressTab(cdp);
      await pressTab(cdp);
      if (!(await evaluate(cdp, `document.activeElement !== null && document.activeElement.closest('[data-consent]') !== null`))) {
        problems.push(`${home} ${viewport.name}: the second Tab from the top of the page does not land in the question about analytics`);
      }
      await evaluate(cdp, `(document.activeElement && document.activeElement.blur(), scrollTo(0, 0))`);
      await captureScreen(cdp, join(out, `${viewport.name}-${lang}-consent.png`), viewport);
      const sizes = await evaluate(cdp, `['allow', 'decline'].map((kind) => { const r = document.querySelector('[data-consent-' + kind + ']').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })`);
      if (sizes[0][0] !== sizes[1][0] || sizes[0][1] !== sizes[1][1]) problems.push(`${home} ${viewport.name}: "Allow" and "Decline" are not the same size (${JSON.stringify(sizes)})`);
      if (await evaluate(cdp, googleOnPage)) problems.push(`${home}: something of Google is on the page before any answer`);
    }
  }
  // "Decline": one click, remembered, nothing loaded. ("Allow" is never clicked here: it would ask for a script of
  // Google, a request to the outside. What it does is tested without a browser, tests/site/consent.test.ts.)
  await evaluate(cdp, `document.querySelector('[data-consent-decline]').click()`);
  const declined = await evaluate(cdp, `({ hidden: document.querySelector('[data-consent]').hidden, kept: localStorage.getItem('sc-trade.analytics'), google: ${googleOnPage} })`);
  if (!declined.hidden || declined.kept !== 'denied' || declined.google) problems.push(`"Decline" did not do its job: ${JSON.stringify(declined)}`);
  await open(browser, pathToFileURL(join(dist, 'index.html')).href, DESKTOP);
  const again = await evaluate(cdp, `({ hidden: document.querySelector('[data-consent]').hidden, link: !document.querySelector('[data-consent-open]').hidden, google: ${googleOnPage} })`);
  if (!again.hidden || !again.link || again.google) problems.push(`after "Decline" the next page is wrong: ${JSON.stringify(again)}`);
  await captureElement(cdp, '.site-footer', join(out, '1440-ru-footer-change-choice.png'), DESKTOP);
  await evaluate(cdp, `localStorage.clear()`);
}

/** @param {{ cdp: Cdp, onLoad: { wait: () => Promise<void> } }} browser @param {string} dist @param {string} out @param {string} work */
async function lookAtForm(browser, dist, out, work) {
  const { cdp } = browser;
  const dictionaries = loadDictionaries(siteDir);
  const standIn = await startStandIn(dist);
  const picture = join(siteDir, 'assets', 'shots', 'price-entry.png');
  const log = join(work, 'sctrade.log');
  writeFileSync(log, '[boot] a line of a log that stands in for the real one\n');
  const formState = `(() => {
    const form = document.querySelector('[data-feedback]');
    const error = form.querySelector('[data-feedback-error]');
    return {
      formHidden: form.hidden, doneHidden: document.querySelector('[data-feedback-done]').hidden,
      error: error.hidden ? null : error.textContent, message: form.elements.message.value, contact: form.elements.contact.value,
      shots: form.elements['shots[]'].files.length, log: form.elements.log.files.length,
    };
  })()`;
  try {
    for (const { lang, home } of LANGS) {
      const errors = /** @type {Record<string, string>} */ (/** @type {any} */ (dictionaries[lang].feedback).errors);
      for (const viewport of lang === 'ru' ? [DESKTOP, PHONE] : [DESKTOP]) {
        const where = `the form, ${lang} ${viewport.name}`;
        standIn.state.received.length = 0;
        await open(browser, `${standIn.origin}/${home}`, viewport);
        if (await evaluate(cdp, `document.querySelector('[data-feedback]').hidden`)) problems.push(`${where}: the script did not show the form`);
        if (!/^\d{13}$/.test(await evaluate(cdp, `document.querySelector('[name="started"]').value`))) problems.push(`${where}: "started" is not the time the form was shown`);

        // too short: refused by the page itself, nothing is sent, the text stays
        await evaluate(cdp, `(() => { const form = document.querySelector('[data-feedback]'); form.elements.message.value = 'short'; form.requestSubmit(); })()`);
        let state = await evaluate(cdp, formState);
        if (state.error !== errors.too_short || state.message !== 'short' || standIn.state.received.length !== 0) problems.push(`${where}: a short message was not refused by the page (${JSON.stringify(state)})`);

        // a refusal of the server: its text in the language of the page, and everything typed and chosen stays
        const text = lang === 'ru' ? 'После обновления окно раскрывается вниз, а не вверх. Лог приложил.' : 'After an update the window unfolds downwards, not upwards. The log is attached.';
        await evaluate(cdp, `(() => { const form = document.querySelector('[data-feedback]'); form.elements.message.value = ${JSON.stringify(text)}; form.elements.message.dispatchEvent(new Event('input')); form.elements.contact.value = 'player#1234'; })()`);
        const { root } = await cdp.send('DOM.getDocument', {});
        for (const [selector, files] of /** @type {const} */ ([['[name="shots[]"]', [picture, picture]], ['[name="log"]', [log]]])) {
          const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
          await cdp.send('DOM.setFileInputFiles', { nodeId, files });
        }
        standIn.state.reply = { status: 429, body: '{"ok":false,"error":"rate_limited"}' };
        await evaluate(cdp, `document.querySelector('[data-feedback]').requestSubmit()`);
        await until(cdp, `!document.querySelector('[data-feedback-error]').hidden`, 'the refusal of the server to be shown');
        state = await evaluate(cdp, formState);
        if (state.error !== errors.rate_limited || state.message !== text || state.contact !== 'player#1234' || state.shots !== 2 || state.log !== 1 || state.formHidden) {
          problems.push(`${where}: after a refusal of the server the form is wrong (${JSON.stringify(state)})`);
        }
        await evaluate(cdp, `document.querySelector('#feedback').scrollIntoView()`);
        await captureElement(cdp, '#feedback', join(out, `${viewport.name}-${lang}-form-error.png`), viewport);

        const sent = standIn.state.received.at(-1);
        const names = (sent?.fields ?? []).map((field) => field.name).sort().join(' ');
        if (names !== 'contact lang log message shots[] shots[] started website' || !sent?.type.startsWith('multipart/form-data')) {
          problems.push(`${where}: the request is not the contract (multipart/form-data with message, contact, shots[], log, lang, website, started): ${sent?.type} — ${names}`);
        }

        // and a success
        standIn.state.reply = { status: 200, body: '{"ok":true}' };
        await evaluate(cdp, `document.querySelector('[data-feedback]').requestSubmit()`);
        await until(cdp, `!document.querySelector('[data-feedback-done]').hidden`, 'the thanks to be shown');
        state = await evaluate(cdp, formState);
        if (!state.formHidden || state.message !== '' || state.error !== null) problems.push(`${where}: after a success the form is wrong (${JSON.stringify(state)})`);
        await captureElement(cdp, '#feedback', join(out, `${viewport.name}-${lang}-form-success.png`), viewport);
      }
    }
  } finally {
    await standIn.close();
  }
}

/** @param {{ cdp: Cdp, onLoad: { wait: () => Promise<void> } }} browser @param {string} dist @param {string} out */
async function lookAtVideo(browser, dist, out) {
  const { cdp } = browser;
  const address = pathToFileURL(join(dist, 'index.html')).href;
  const source = `document.querySelector('[data-hero-video]').currentSrc`;

  await open(browser, address, DESKTOP);
  await until(cdp, `${source} !== '' && document.querySelector('[data-hero-video]').readyState >= 2`, 'the video to start on a wide screen', 15000).catch((err) => problems.push(`the white video, 1440: ${err.message}`));
  await sleep(300);
  await captureScreen(cdp, join(out, '1440-ru-hero-white-video.png'), DESKTOP);
  await checkHeroContrast(cdp, DESKTOP, 'ru 1440, a white video');

  await open(browser, address, PHONE);
  if ((await evaluate(cdp, source)) !== '') problems.push('a narrow screen loaded the video: it must show the still frame only');
  if (await evaluate(cdp, `getComputedStyle(document.querySelector('[data-hero-video]')).display !== 'none'`)) problems.push('a narrow screen shows the video element');
  await captureScreen(cdp, join(out, '390-ru-hero-white-video.png'), PHONE);
  await checkHeroContrast(cdp, PHONE, 'ru 390, a white still frame');

  await open(browser, address, DESKTOP, { reducedMotion: true });
  if ((await evaluate(cdp, source)) !== '') problems.push('a visitor who asked for less motion got the video: it must be the still frame only');
  await checkHeroContrast(cdp, DESKTOP, 'ru 1440, less motion, a white still frame');
}

// ---- the whole run -------------------------------------------------------------------------------------------

async function main() {
  const { values } = parseArgs({ options: { out: { type: 'string' }, installer: { type: 'string' }, 'no-video': { type: 'boolean' }, help: { type: 'boolean' } } });
  if (values.help) return console.log('usage: npm run site:check [-- --out <folder>] [--no-video] [--installer <file>]');
  const out = resolve(values.out ?? join(projectRoot, '.superpowers', 'site-check'));
  try {
    preparePictureFolder(out);
  } catch (err) {
    // a folder that cannot be used is the caller's to fix: the sentence is enough, without the trace of the script
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  const { version } = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
  const work = mkdtempSync(join(tmpdir(), 'sc-trade-site-check-'));

  // a file that stands in for the installer, the size of a real one, unless a real one is named
  const installer = values.installer ?? join(work, `SC Trade_${version}_x64-setup.exe`);
  if (values.installer === undefined) writeFileSync(installer, Buffer.alloc(4_920_458, 'stand-in '));
  const site = (/** @type {string} */ name, /** @type {Partial<import('./build.mjs').BuildOptions>} */ options = {}) => {
    const dir = join(work, name);
    // the pages are looked at without analytics, whatever id the settings carry; the build for the banner sets a made-up id of its own
    const withoutAnalytics = (/** @type {import('./config.mjs').SiteConfig} */ config) => void (config.analytics.ga4Id = '');
    buildSite({ version, installer, outDir: join(dir, 'dist'), deployDir: join(dir, 'dist-deploy'), videoDir: join(work, 'no-video'), patchConfig: withoutAnalytics, ...options });
    return join(dir, 'dist');
  };

  const launched = await launchBrowser(browserPath(), { args: isolatedArguments });
  let exitCode = 0;
  try {
    const cdp = await connect(await pageSocketUrl(launched.port));
    /** @type {(() => void) | null} */
    let loaded = null;
    cdp.on('Page.loadEventFired', () => loaded?.());
    const browser = { cdp, onLoad: { wait: () => /** @type {Promise<void>} */ (new Promise((done) => (loaded = done))) } };
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    cdp.on('Network.requestWillBeSent', ({ request }) => {
      if (!/^(file:|data:|blob:|about:|http:\/\/127\.0\.0\.1:)/.test(request.url)) problems.push(`a page asked for an address outside this computer: ${request.url}`);
    });
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => problems.push(`a script of a page threw: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`));

    await lookAtPages(browser, site('main'), out);
    await lookAtGallery(browser, join(work, 'main', 'dist'), out);
    await lookAtForm(browser, join(work, 'main', 'dist'), out, work);

    const plain = site('no-installer', { installer: null });
    await open(browser, pathToFileURL(join(plain, 'index.html')).href, DESKTOP);
    await captureScreen(cdp, join(out, '1440-ru-hero-no-installer.png'), DESKTOP);
    await captureElement(cdp, '#download', join(out, '1440-ru-download-no-installer.png'), DESKTOP);

    await lookAtConsent(browser, site('analytics', { patchConfig: (config) => void (config.analytics.ga4Id = GA4_ID) }), out);

    if (values['no-video'] !== true) {
      // the brightest video there can be: white from the first frame to the last
      const white = join(work, 'white.mp4');
      const made = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=1280x720:r=30:d=3', '-pix_fmt', 'yuv420p', white], { encoding: 'utf8' });
      if (made.status !== 0) notes.push(`the white video was not checked: ffmpeg is not there or failed (${made.error?.message ?? made.stderr.trim()})`);
      else {
        makeHeroVideo({ input: white, outDir: join(work, 'white-video'), blur: 0, minSeconds: 1 });
        await lookAtVideo(browser, site('video', { videoDir: join(work, 'white-video') }), out);
      }
    }
    cdp.close();
  } finally {
    await launched.close();
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }

  const shown = (/** @type {string} */ path) => relative(process.cwd(), path).replaceAll('\\', '/');
  console.log(`${pictures.length} pictures in ${shown(out)}:`);
  for (const picture of pictures) console.log(`  ${shown(picture)}`);
  for (const note of notes) console.log(note);
  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s):`);
    for (const problem of [...new Set(problems)]) console.error(`  - ${problem}`);
    exitCode = 1;
  } else console.log('all passed');
  process.exit(exitCode);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
  });
}
