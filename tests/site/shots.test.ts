import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDictionaries, siteDir } from '../../scripts/site/config.mjs';
import { decodePng } from '../../scripts/site/png.mjs';
import { BACKDROP, shotArguments, shotEnvironment, SHOTS } from '../../scripts/site/shots.mjs';
import { build, projectRoot, type Built } from './helpers';

const shotsDir = join(siteDir, 'assets', 'shots');
const dictionaries = loadDictionaries(siteDir);
const names = SHOTS.map((shot) => shot.name);

describe('the list of pictures of the application', () => {
  it('names scenes of the browser preview that exist', () => {
    const scenes = readdirSync(resolve(projectRoot, 'src', 'preview'))
      .filter((file) => /^scenes.*\.ts$/.test(file))
      .map((file) => readFileSync(resolve(projectRoot, 'src', 'preview', file), 'utf8'))
      .join('\n');
    for (const shot of SHOTS) expect(scenes, shot.scene).toContain(`name: '${shot.scene}'`);
  });

  it('gives every picture a name of its own', () => {
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z][a-z-]*$/);
  });

  it('is exactly the pictures that lie in site/assets/shots, and the English window of some of them in its folder en', () => {
    expect(readdirSync(shotsDir).filter((file) => file !== 'en').sort()).toEqual(names.map((name) => `${name}.png`).sort());
    // the English pages show the English picture where there is one, the Russian one where there is not
    for (const file of readdirSync(join(shotsDir, 'en'))) expect(names.map((name) => `${name}.png`), file).toContain(file);
  });

  it('takes the English window with the language of the preview, and the Russian one as before', () => {
    expect(shotArguments(SHOTS[0], 'out.png', 'en')).toEqual(expect.arrayContaining(['--lang', 'en']));
    expect(shotArguments(SHOTS[0], 'out.png')).not.toContain('--lang');
  });

  it.each(['ru', 'en'] as const)('has a caption and a description of every picture in the %s dictionary, and of nothing else', (lang) => {
    const texts = dictionaries[lang].shots as Record<string, { caption: string; alt: string }>;
    expect(Object.keys(texts).sort()).toEqual([...names].sort());
  });
});

describe('a picture is taken', () => {
  const shot = SHOTS[0];

  it('by the screenshot script of the preview, from a scene on demo data, at twice the density', () => {
    const args = shotArguments(shot, 'C:/tmp/out.png');
    expect(args[0].replaceAll('\\', '/')).toMatch(/scripts\/preview\/shot\.mjs$/);
    expect(args.slice(1, 7)).toEqual(['--scene', shot.scene, '--scale', '2', '--out', 'C:/tmp/out.png']);
  });

  it('over a flat backdrop of the colour of the glass, so that nothing but the window is in the picture', () => {
    const args = shotArguments(shot, 'out.png');
    const steps = args[args.indexOf('--do') + 1];
    expect(BACKDROP).toBe('#07121b');
    expect(steps).toContain(`eval:parent.document.getElementById('field').style.background='${BACKDROP}'`);
  });

  it("never over the player's own screenshots: the folder the preview takes its backdrop from is an empty one", () => {
    const env = shotEnvironment({ PATH: 'x', PREVIEW_BACKDROP_DIR: 'D:/somewhere/Screenshot' }, 'C:/tmp/empty');
    expect(env.PREVIEW_BACKDROP_DIR).toBe('C:/tmp/empty');
    expect(env.PATH).toBe('x');
  });

  it('with the address of the dev server resolved to IPv4 first, and with the browser the caller named', () => {
    expect(shotEnvironment({}, 'e').NODE_OPTIONS).toBe('--dns-result-order=ipv4first');
    expect(shotEnvironment({ NODE_OPTIONS: '--max-old-space-size=4096' }, 'e').NODE_OPTIONS).toBe('--max-old-space-size=4096 --dns-result-order=ipv4first');
    expect(shotEnvironment({ NODE_OPTIONS: '--dns-result-order=ipv4first' }, 'e').NODE_OPTIONS).toBe('--dns-result-order=ipv4first');
    expect(shotEnvironment({ PREVIEW_BROWSER: 'C:/my/browser.exe' }, 'e').PREVIEW_BROWSER).toBe('C:/my/browser.exe');
  });
});

describe('the pictures in the repository', () => {
  it.each(names)('%s.png is the window alone: cut corners transparent, the rest opaque, twice the size it is shown at', (name) => {
    const file = join(shotsDir, `${name}.png`);
    expect(existsSync(file)).toBe(true);
    const image = decodePng(readFileSync(file));
    const alpha = (x: number, y: number) => image.rgba[(y * image.width + x) * 4 + 3];
    const colour = (x: number, y: number) => [...image.rgba.subarray((y * image.width + x) * 4, (y * image.width + x) * 4 + 3)];
    // the two cut corners
    expect(alpha(0, 0)).toBe(0);
    expect(alpha(image.width - 1, image.height - 1)).toBe(0);
    // the two whole corners carry the frame of the window, and so does the middle of every side
    const frame = [0x2b, 0x8f, 0xa8];
    expect(colour(image.width - 1, 0)).toEqual(frame);
    expect(colour(0, image.height - 1)).toEqual(frame);
    expect(colour(Math.floor(image.width / 2), 0)).toEqual(frame);
    expect(colour(0, Math.floor(image.height / 2))).toEqual(frame);
    expect(alpha(Math.floor(image.width / 2), Math.floor(image.height / 2))).toBe(255);
    // nothing transparent but the two corners
    let transparent = 0;
    for (let i = 3; i < image.rgba.length; i += 4) if (image.rgba[i] !== 255) transparent++;
    expect(transparent).toBeLessThanOrEqual(18 * 19);
    // a window of the application is 440 px wide at most by default, a mini line is one row
    expect(image.width).toBeGreaterThanOrEqual(600);
    expect(image.width).toBeLessThanOrEqual(1400);
    expect(statSync(file).size).toBeLessThan(400 * 1024);
  });
});

describe('the pictures on the page', () => {
  let site: Built;
  beforeAll(() => {
    site = build();
  });

  it.each(['index.html', 'en/index.html'])('%s shows every picture of the list, each with its size and a description', (page) => {
    const html = site.read(page);
    for (const name of names) {
      // the English page shows the English window where there is one (site/assets/shots/en)
      const english = page.startsWith('en/') && existsSync(join(shotsDir, 'en', `${name}.png`));
      const path = english ? `en/${name}` : name;
      const tag = new RegExp(`<img src="[^"]*assets/shots/${path}\\.png\\?v=[0-9a-f]+" width="(\\d+)" height="(\\d+)" alt="([^"]+)"`).exec(html);
      expect(tag, name).not.toBeNull();
      const image = decodePng(readFileSync(join(shotsDir, `${path}.png`)));
      // shown at half its pixels: sharp on a dense screen
      expect([Number(tag![1]), Number(tag![2])]).toEqual([Math.round(image.width / 2), Math.round(image.height / 2)]);
    }
    // the pictures of the site: the Russian set and the English ones beside it
    expect(site.result.pictures).toBe(names.length + readdirSync(join(shotsDir, 'en')).length);
  });

  it('puts the mini line and a window on the first screen, three pictures next to the features and the rest in the gallery', () => {
    const html = site.read('index.html');
    const part = (id: string) => new RegExp(`<section[^>]*\\sid="${id}"[\\s\\S]*?</section>`).exec(html)?.[0] ?? '';
    const shown = (text: string) => [...text.matchAll(/assets\/shots\/([a-z-]+)\.png/g)].map((match) => match[1]);
    expect(shown(part('top'))).toEqual(['hero-strip', 'hero-window']);
    expect(shown(part('features'))).toEqual(['terminal-options', 'mini-run', 'my-routes']);
    expect([...new Set(shown(part('gallery')))]).toEqual(['price-entry', 'sell-or-fly', 'history', 'settings']);
  });

  it('links to the gallery from the header of every page', () => {
    for (const [page, anchor] of [['index.html', '#gallery'], ['en/index.html', '#gallery'], ['data.html', 'index.html#gallery'], ['en/data.html', 'index.html#gallery']]) {
      expect(/<header class="site-header">[\s\S]*?<\/header>/.exec(site.read(page))?.[0], page).toContain(`href="${anchor}"`);
    }
  });

  it('opens a picture of the gallery larger: a link to the picture itself (it works without a script), and a dialog for the script', () => {
    const html = site.read('index.html');
    const gallery = /<section[^>]*\sid="gallery"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
    const links = [...gallery.matchAll(/<a class="stage__screen" href="([^"]+)" data-full data-width="(\d+)" data-height="(\d+)"/g)];
    expect(links).toHaveLength(4);
    for (const link of links) expect(link[1]).toMatch(/^assets\/shots\/[a-z-]+\.png\?v=[0-9a-f]+$/);
    expect(gallery).toMatch(/<dialog class="lightbox" data-lightbox/);
    for (const control of ['data-lightbox-close', 'data-lightbox-prev', 'data-lightbox-next']) expect(gallery).toMatch(new RegExp(`<button[^>]*${control}[^>]*aria-label="[^"]+"`));
    const script = site.read('assets/js/site.js');
    expect(script).toContain('showModal');
    expect(script).toContain('ArrowLeft');
  });
});
