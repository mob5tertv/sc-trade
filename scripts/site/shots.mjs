// `npm run site:shots`: takes the pictures of the application the site shows (site/assets/shots/*.png) again, from
// the scenes of the browser preview on demo data — the same `npm run preview:shot` a developer uses, so the real
// interface, never a drawing of it. The pictures are in the repository: the site is built without a browser.
//
//   npm run site:shots [-- --only <name>[,<name>]]
//
// Each picture is taken at twice the pixel density over a flat backdrop of the colour of the glass, and then the
// window alone is cut out of it along its frame (png.mjs): the two cut corners become transparent, so the window can
// lie over anything on the page.
//
// The preview may put a screenshot of the game under the window (the folder Screenshot/ of the project: the player's
// own pictures). The site must never show them, so the preview is pointed at an empty folder here, always.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { encodePng } from '../installer/encode.mjs';
import { findChrome } from './chrome.mjs';
import { projectRoot, siteDir } from './config.mjs';
import { cutWindow, decodePng } from './png.mjs';

/**
 * The pictures: the name of the file, and the scene of the preview (src/preview/scenes*.ts) it is taken from.
 * Where each one stands on the page is in build.mjs and in the templates; its texts are `shots.<name>` of the dictionaries.
 * @type {ReadonlyArray<{ name: string, scene: string }>}
 */
export const SHOTS = [
  { name: 'hero-strip', scene: 'arrive-target-mini' },
  { name: 'hero-window', scene: 'roi-sell' },
  { name: 'mini-run', scene: 'mini-run' },
  { name: 'terminal-options', scene: 'expanded-options' },
  { name: 'my-routes', scene: 'stats-routes' },
  { name: 'price-entry', scene: 'expanded-row' },
  // version 1.4: the storage of a station — a purchase over the hold, and the tab «Склад»
  { name: 'storage-buy', scene: 'storage-buy-split' },
  { name: 'storage', scene: 'storage-tab' },
  { name: 'sell-or-fly', scene: 'run-sell-decision' },
  { name: 'history', scene: 'stats-history' },
  { name: 'settings', scene: 'settings' },
];

/** What is painted under the window for the picture: the glass of the theme, so the glass of the window is its own colour. */
export const BACKDROP = '#07121b';

/**
 * The arguments of `node` that take one picture into `out`, with the window in `lang`.
 * @param {{ scene: string }} shot
 * @param {string} out
 * @param {'ru' | 'en'} [lang]
 * @returns {string[]}
 */
export function shotArguments(shot, out, lang = 'ru') {
  return [
    join(projectRoot, 'scripts', 'preview', 'shot.mjs'),
    '--scene', shot.scene,
    '--scale', '2',
    '--out', out,
    ...(lang === 'en' ? ['--lang', 'en'] : []),
    // the step runs in the page of the application; the field around the window belongs to the page above it
    '--do', `eval:parent.document.getElementById('field').style.background='${BACKDROP}'`,
  ];
}

/**
 * The environment the screenshot script runs in.
 * @param {Record<string, string | undefined>} env the environment of this process
 * @param {string} emptyDir a folder with nothing in it: where the preview looks for a backdrop
 *   (Chrome is named unless the caller named a browser: the screenshot script would take Edge first, and headless Edge does not start everywhere)
 * @returns {Record<string, string | undefined>}
 */
export function shotEnvironment(env, emptyDir) {
  const ipv4 = '--dns-result-order=ipv4first';
  const nodeOptions = env.NODE_OPTIONS ?? '';
  return {
    ...env,
    PREVIEW_BACKDROP_DIR: emptyDir,
    PREVIEW_BROWSER: env.PREVIEW_BROWSER ?? findChrome(env),
    NODE_OPTIONS: nodeOptions.includes(ipv4) ? nodeOptions : `${nodeOptions} ${ipv4}`.trim(),
  };
}

function main() {
  const { values } = parseArgs({ options: { only: { type: 'string' }, lang: { type: 'string' }, help: { type: 'boolean' } } });
  const lang = values.lang ?? 'ru';
  if (lang !== 'ru' && lang !== 'en') throw new Error(`--lang must be ru or en, not "${lang}"`);
  if (values.help) return console.log(`usage: npm run site:shots [-- --only <name>[,<name>]]\npictures: ${SHOTS.map((shot) => shot.name).join(', ')}`);
  const only = values.only?.split(',').map((name) => name.trim());
  const unknown = (only ?? []).filter((name) => !SHOTS.some((shot) => shot.name === name));
  if (unknown.length > 0) throw new Error(`no such picture: ${unknown.join(', ')} (there are: ${SHOTS.map((shot) => shot.name).join(', ')})`);

  // the English window goes into a folder of its own: the English pages show it, the Russian ones the Russian window
  const outDir = lang === 'en' ? join(siteDir, 'assets', 'shots', 'en') : join(siteDir, 'assets', 'shots');
  mkdirSync(outDir, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), 'sc-trade-shots-'));
  const emptyDir = join(work, 'no-backdrop');
  mkdirSync(emptyDir);
  try {
    for (const shot of SHOTS.filter((one) => only === undefined || only.includes(one.name))) {
      const raw = join(work, `${shot.name}.png`);
      const run = spawnSync(process.execPath, shotArguments(shot, raw, lang), { cwd: projectRoot, env: shotEnvironment(process.env, emptyDir), encoding: 'utf8' });
      if (run.status !== 0 || !existsSync(raw)) throw new Error(`the scene "${shot.scene}" was not taken (exit code ${run.status}):\n${run.stdout}${run.stderr}`);
      const window = cutWindow(decodePng(readFileSync(raw)));
      const file = join(outDir, `${shot.name}.png`);
      writeFileSync(file, encodePng(window.rgba, window.width, window.height));
      console.log(`${relative(process.cwd(), file).replaceAll('\\', '/')}: scene ${shot.scene}, ${window.width} x ${window.height}`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
