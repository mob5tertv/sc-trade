// `npm run installer:images`: makes the two bitmaps of the installer (src-tauri/installer/*.bmp) from their SVG sources
// (src-tauri/installer/*.svg). The SVG is drawn by the browser that the preview scripts already use (Edge or Chrome,
// `PREVIEW_BROWSER` to name one), on a throw-away profile, and the pixels are written as a 24-bit bitmap by encode.mjs.
// Nothing is downloaded and no package is needed.
//
//   npm run installer:images [-- --png <folder> [--zoom <n>]]
//                           also write a PNG of every bitmap (and one enlarged <n> times) to look at; the folder
//                           .superpowers/preview/ is not in the repository
//
// The text of the pictures is drawn with Bahnschrift, the font of the theme (it comes with Windows 10/11). The pictures
// are made once and committed: the installer needs the bitmaps, not the font or this script.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { findBrowser, launchBrowser, pageSocketUrl } from '../preview/browser.mjs';
import { connect } from '../preview/cdp.mjs';
import { encodeBmp24, encodePng } from './encode.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const folder = resolve(root, 'src-tauri', 'installer');

/** The pictures and the size NSIS draws each at (Modern UI 2; `headerImage` and `sidebarImage` of tauri.conf.json). */
const pictures = [
  { name: 'header', width: 150, height: 57 },
  { name: 'sidebar', width: 164, height: 314 },
];

/** The glass of the theme: what a picture is painted with before the SVG is drawn on it. */
const GLASS = '#07121b';
/** The font of the theme, as the SVG names it first. */
const THEME_FONT = "'Bahnschrift SemiCondensed'";

/**
 * Draws an SVG on a canvas of its own size in the page of the browser and gives the pixels back as RGBA.
 * @param {import('../preview/cdp.mjs').Cdp} cdp
 * @param {string} svg
 * @param {number} width
 * @param {number} height
 * @returns {Promise<Uint8ClampedArray>}
 */
async function rasterise(cdp, svg, width, height) {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression: `(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = ${width};
      canvas.height = ${height};
      const context = canvas.getContext('2d', { willReadFrequently: true });
      // a font that is not installed is replaced by another one without a word: the width of a text tells
      context.font = "20px ${THEME_FONT}, monospace";
      const themed = context.measureText('SC TRADE дневник').width;
      context.font = '20px monospace';
      if (themed === context.measureText('SC TRADE дневник').width) {
        throw new Error('the font of the theme (Bahnschrift) is not installed on this machine, the text would be drawn in another one');
      }
      const image = new Image();
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(${JSON.stringify(svg)});
      await image.decode();
      context.fillStyle = '${GLASS}';
      context.fillRect(0, 0, ${width}, ${height});
      context.drawImage(image, 0, 0, ${width}, ${height});
      const data = context.getImageData(0, 0, ${width}, ${height}).data;
      let binary = '';
      for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]);
      return btoa(binary);
    })()`,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return Uint8ClampedArray.from(Buffer.from(result.value, 'base64'));
}

/** The same pixels, every one `zoom` times as wide and as high, for looking at small text. */
function enlarge(/** @type {Uint8ClampedArray} */ rgba, /** @type {number} */ width, /** @type {number} */ height, /** @type {number} */ zoom) {
  const out = new Uint8ClampedArray(width * zoom * height * zoom * 4);
  for (let y = 0; y < height * zoom; y++) {
    for (let x = 0; x < width * zoom; x++) {
      const from = (Math.floor(y / zoom) * width + Math.floor(x / zoom)) * 4;
      out.set(rgba.subarray(from, from + 4), (y * width * zoom + x) * 4);
    }
  }
  return out;
}

async function main() {
  const { values } = parseArgs({ options: { png: { type: 'string' }, zoom: { type: 'string' } } });
  const zoom = Number(values.zoom ?? 4);
  if (!Number.isInteger(zoom) || zoom < 1 || zoom > 16) throw new Error(`--zoom must be a whole number from 1 to 16, not "${values.zoom}"`);
  const pngFolder = values.png === undefined ? undefined : resolve(values.png);
  if (pngFolder !== undefined) mkdirSync(pngFolder, { recursive: true });

  const browser = await launchBrowser(findBrowser());
  try {
    const cdp = await connect(await pageSocketUrl(browser.port));
    try {
      await cdp.send('Runtime.enable');
      for (const { name, width, height } of pictures) {
        const rgba = await rasterise(cdp, readFileSync(resolve(folder, `${name}.svg`), 'utf8'), width, height);
        const bitmap = resolve(folder, `${name}.bmp`);
        writeFileSync(bitmap, encodeBmp24(rgba, width, height));
        console.log(`${relative(root, bitmap)}: ${width} x ${height}`);
        if (pngFolder !== undefined) {
          writeFileSync(resolve(pngFolder, `${name}.png`), encodePng(rgba, width, height));
          writeFileSync(resolve(pngFolder, `${name}-x${zoom}.png`), encodePng(enlarge(rgba, width, height, zoom), width * zoom, height * zoom));
        }
      }
    } finally {
      cdp.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
