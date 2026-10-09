import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { Script } from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildSite } from '../../scripts/site/build.mjs';
import { loadConfig, loadDictionaries, siteDir } from '../../scripts/site/config.mjs';
import { formatSize, installerInfo } from '../../scripts/site/installer.mjs';
import { addresses, build, fakeInstaller, isText, references, tempDir, version, type Built } from './helpers';

const config = loadConfig(siteDir);
const dictionaries = loadDictionaries(siteDir);
const text = (lang: 'ru' | 'en', group: string, key: string) => (dictionaries[lang][group] as Record<string, string>)[key];

const PAGES = { ru: 'index.html', en: 'en/index.html' } as const;
const section = (html: string, id: string) => new RegExp(`<section[^>]*\\sid="${id}"[\\s\\S]*?</section>`).exec(html)?.[0] ?? '';
const footer = (html: string) => /<footer[\s\S]*<\/footer>/.exec(html)?.[0] ?? '';

describe('the build with an installer', () => {
  let site: Built;
  let installer: { name: string; size: number; sha256: string };

  beforeAll(() => {
    site = build();
    const bytes = readFileSync(join(site.out, 'download', `SC-Trade-${version}-setup.exe`));
    installer = { name: `SC-Trade-${version}-setup.exe`, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  });

  it('writes the pages of both languages, the 404 page, robots.txt, sitemap.xml, the styles, the script and the icon', () => {
    expect(site.files).toEqual(
      expect.arrayContaining(['index.html', 'en/index.html', '404.html', 'robots.txt', 'sitemap.xml', 'assets/css/site.css', 'assets/js/site.js', 'assets/icon.svg']),
    );
  });

  it('copies the installer under a name without spaces, byte for byte, and writes its sum next to it', () => {
    expect(installer.size).toBe(statSync(site.result.installer!.source).size);
    expect(readFileSync(site.result.installer!.source).equals(readFileSync(join(site.out, 'download', installer.name)))).toBe(true);
    expect(site.read('download/SHA256SUMS.txt')).toBe(`${installer.sha256}  ${installer.name}\n`);
    expect(installer.name).not.toMatch(/\s/);
  });

  it.each(['ru', 'en'] as const)('puts the version, the file name, the size and the SHA-256 on the %s page', (lang) => {
    const html = site.read(PAGES[lang]);
    const units = (dictionaries[lang].download as { units: { mb: string; kb: string; b: string } }).units;
    expect(html).toContain(version);
    expect(html).toContain(`download/${installer.name}`);
    expect(html).toContain(installer.sha256);
    expect(html).toContain(formatSize(installer.size, lang, units));
    // the first screen says the version and the size on the button itself
    const hero = section(html, 'top');
    expect(hero).toContain(version);
    expect(hero).toContain(formatSize(installer.size, lang, units));
    expect(hero).toContain('Windows 10 / 11, 64-bit');
    // and the download section gives the sum whole, with a button that copies it
    const download = section(html, 'download');
    expect(download).toContain(installer.sha256);
    expect(download).toMatch(/<button[^>]*data-copy/);
    expect(download).toContain(`Get-FileHash .\\${installer.name}`);
  });

  it('says the day of the build on both pages', () => {
    expect(site.read('index.html')).toContain('<time datetime="2026-10-09">9 октября 2026 г.</time>');
    expect(site.read('en/index.html')).toContain('<time datetime="2026-10-09">October 9, 2026</time>');
  });

  it('declares the language of every page and links the two languages to each other with plain links', () => {
    expect(site.read('index.html')).toMatch(/<html lang="ru"/);
    expect(site.read('en/index.html')).toMatch(/<html lang="en"/);
    expect(site.read('index.html')).toMatch(/<a[^>]*href="en\/index\.html"[^>]*hreflang="en"/);
    expect(site.read('en/index.html')).toMatch(/<a[^>]*href="\.\.\/index\.html"[^>]*hreflang="ru"/);
    // no script decides the language for the visitor
    expect(site.read('assets/js/site.js')).not.toMatch(/navigator\.languages?|location\.(replace|assign|href\s*=)/);
  });

  it.each(['ru', 'en'] as const)('has the copyright line, the Twitch link and the whole disclaimer in the footer of the %s page', (lang) => {
    const foot = footer(site.read(PAGES[lang]));
    expect(foot).toContain('© 2026 mob5ter');
    expect(foot).toMatch(new RegExp(`<a[^>]*href="${config.links.twitch}"[^>]*rel="noopener noreferrer"`));
    expect(foot).toContain(text(lang, 'footer', 'disclaimer'));
    expect(foot).toContain('Cloud Imperium Rights LLC');
    expect(foot).toMatch(new RegExp(`<a[^>]*href="${config.links.uex}"[^>]*rel="noopener noreferrer"`));
  });

  it.each(['ru', 'en'] as const)('says on the first screen of the %s page that the project is not official, right under the button', (lang) => {
    const hero = section(site.read(PAGES[lang]), 'top');
    const disclaimer = text(lang, 'hero', 'disclaimer');
    expect(hero).toContain(disclaimer);
    expect(hero).toContain('Cloud Imperium Games');
    expect(hero.indexOf(disclaimer)).toBeGreaterThan(hero.indexOf(`download/${installer.name}`));
  });

  it('opens every link that leaves the site in a new tab, without telling the other site where the visitor came from', () => {
    for (const page of Object.values(PAGES)) {
      const external = [...site.read(page).matchAll(/<a\s[^>]*href="https?:[^"]*"[^>]*>/g)].map((match) => match[0]);
      expect(external.length).toBeGreaterThanOrEqual(5);
      for (const link of external) {
        expect(link).toContain('rel="noopener noreferrer"');
        expect(link).toContain('target="_blank"');
      }
    }
  });

  it('gives the support section three links: Boosty, DonationAlerts and Twitch', () => {
    for (const page of Object.values(PAGES)) {
      const support = section(site.read(page), 'support');
      for (const link of [config.links.boosty, config.links.donationalerts, config.links.twitch]) expect(support).toContain(`href="${link}"`);
      // under each name stands the address the link leads to, nothing about the service that is not ours to promise
      for (const shown of ['boosty.to/mob5ter', 'donationalerts.com/r/mob5tertv', 'twitch.tv/mob5tertv']) expect(support).toContain(`<span class="support__hint">${shown}</span>`);
    }
  });

  it('has a header with an anchor for every section, and every anchor leads to a section of the page', () => {
    for (const page of Object.values(PAGES)) {
      const html = site.read(page);
      const anchors = [...(/<header[\s\S]*?<\/header>/.exec(html)?.[0] ?? '').matchAll(/href="#([\w-]+)"/g)].map((match) => match[1]);
      expect(anchors).toEqual(expect.arrayContaining(['features', 'safety', 'download', 'support']));
      for (const anchor of new Set([...html.matchAll(/href="#([\w-]+)"/g)].map((match) => match[1]))) expect(html, `#${anchor} of ${page}`).toMatch(new RegExp(`\\sid="${anchor}"`));
    }
  });

  it('has one main heading on every page', () => {
    for (const file of site.files.filter((name) => name.endsWith('.html'))) expect(site.read(file).match(/<h1[\s>]/g), file).toHaveLength(1);
  });

  it('links to its own files with relative addresses, and every one of them exists', () => {
    const htmlFiles = site.files.filter((file) => file.endsWith('.html') && file !== '404.html');
    expect(htmlFiles.length).toBeGreaterThanOrEqual(2);
    for (const file of htmlFiles) {
      for (const { attribute, value } of references(site.read(file))) {
        if (/^(https?:|mailto:|data:|#)/.test(value)) continue;
        // the one address of the site that is not a file: where the feedback form is sent
        if (attribute === 'action' && value === config.feedback.endpoint) continue;
        expect(value, `${attribute} of ${file}`).not.toMatch(/^\//);
        const target = posix.join(dirname(file), value.split(/[?#]/)[0]);
        expect(existsSync(join(site.out, target)), `${file} -> ${value}`).toBe(true);
        expect(statSync(join(site.out, target)).isFile(), `${file} -> ${value} is a file`).toBe(true);
      }
    }
  });

  it('names every file its styles need, and they exist', () => {
    const css = site.read('assets/css/site.css');
    for (const match of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
      if (match[1].startsWith('data:')) continue;
      expect(existsSync(join(site.out, 'assets/css', match[1].split(/[?#]/)[0])), match[1]).toBe(true);
    }
  });

  it('names no address outside the site but the links of the author and of UEX', () => {
    const allowed = new Set(Object.values(config.links));
    const own = `https://${config.domain}/`;
    for (const file of site.files.filter(isText)) {
      for (const address of addresses(site.read(file))) {
        if (address.startsWith(own) || address === own.slice(0, -1)) continue;
        if (file.endsWith('.svg') && address === 'http://www.w3.org/2000/svg') continue; // the name of the format, never fetched
        if (file === 'sitemap.xml' && address === 'http://www.sitemaps.org/schemas/sitemap/0.9') continue; // the same
        expect(allowed.has(address), `${file}: ${address}`).toBe(true);
      }
    }
    for (const address of addresses(site.caddyfile)) expect(address.startsWith(own.slice(0, -1)), `Caddyfile: ${address}`).toBe(true);
  });

  it('has no banner of consent and no trace of Google while ga4Id is empty', () => {
    expect(config.analytics.ga4Id).toBe('');
    expect(site.result.analytics).toBe(false);
    for (const file of site.files.filter(isText)) {
      const content = site.read(file);
      expect(content, file).not.toMatch(/google|gtag|googletagmanager|doubleclick|gstatic/i);
      expect(content, file).not.toMatch(/data-consent|consent\.js/);
    }
    expect(site.caddyfile).not.toMatch(/google|gtag/i);
    expect(site.files).not.toContain('assets/js/consent.js');
  });

  it('keeps scripts and styles in files of their own, so that the server may forbid inline ones', () => {
    for (const file of site.files.filter((name) => name.endsWith('.html'))) {
      const html = site.read(file);
      for (const tag of html.matchAll(/<script\b[^>]*>/g)) expect(tag[0], file).toMatch(/\ssrc="|type="application\/(ld\+)?json"/);
      expect(html, file).not.toMatch(/\sstyle="/);
      expect(html, file).not.toMatch(/\son[a-z]+="/);
      if (file !== '404.html') expect(html, file).not.toMatch(/<style[\s>]/);
    }
  });

  it('writes a script the browser can run as a plain script (a page opened from the disk loads no modules)', () => {
    const script = site.read('assets/js/site.js');
    expect(script).not.toMatch(/^\s*(import|export)\s/m);
    expect(() => new Script(script)).not.toThrow();
    for (const page of Object.values(PAGES)) expect(site.read(page)).toMatch(/<script defer src="[^"]*assets\/js\/site\.js[^"]*"><\/script>/);
  });

  it('lists the pages of both languages in the sitemap and names the sitemap in robots.txt', () => {
    const sitemap = site.read('sitemap.xml');
    for (const path of ['', 'en/']) expect(sitemap).toContain(`<loc>https://${config.domain}/${path}</loc>`);
    expect(sitemap).toContain('<lastmod>2026-10-09</lastmod>');
    expect(sitemap).not.toContain('404');
    expect(site.read('robots.txt')).toContain(`Sitemap: https://${config.domain}/sitemap.xml`);
  });

  it('builds the 404 page so that it works at any address: its own styles inside, links from the root', () => {
    const html = site.read('404.html');
    expect(html).toContain('Страница не найдена');
    expect(html).toContain('Page not found');
    expect(html).toMatch(/<style>/);
    expect(html).toMatch(/href="\/"/);
    expect(html).toMatch(/href="\/en\/"/);
    expect(html).toMatch(/<meta name="robots" content="noindex"/);
    expect(references(html).filter(({ value }) => !value.startsWith('/'))).toEqual([]);
  });

  it('writes the config of the web server beside dist, never inside it', () => {
    expect(site.files.filter((file) => /caddy/i.test(file))).toEqual([]);
    expect(site.caddyfile).toContain(`${config.domain} {`);
  });

  it('writes the same bytes when it is run twice', () => {
    const again = build({ installer: site.result.installer!.source });
    expect(again.files).toEqual(site.files);
    for (const file of site.files.filter(isText)) expect(again.read(file), file).toBe(site.read(file));
    expect(again.caddyfile).toBe(site.caddyfile);
  });
});

describe('the build without the installer (a page to look at)', () => {
  let site: Built;
  beforeAll(() => {
    site = build({ installer: null });
  });

  it('has no download folder and no sums', () => {
    expect(site.files.filter((file) => file.startsWith('download/'))).toEqual([]);
    expect(site.result.installer).toBeNull();
  });

  it.each(['ru', 'en'] as const)('switches the download buttons of the %s page off and says why', (lang) => {
    const html = site.read(PAGES[lang]);
    expect(html).not.toMatch(/href="[^"]*download\//);
    expect(html).not.toMatch(/\.exe"/);
    const label = text(lang, 'hero', 'no_installer');
    for (const id of ['top', 'download']) {
      const part = section(html, id);
      expect(part, id).toMatch(/<button[^>]*class="[^"]*\bbutton--primary\b[^"]*"[^>]*\sdisabled/);
      expect(part, id).toContain(label);
    }
  });

  it('still links only to files that exist', () => {
    for (const file of ['index.html', 'en/index.html']) {
      for (const { value } of references(site.read(file))) {
        if (/^(https?:|#|\/)/.test(value)) continue;
        expect(existsSync(join(site.out, posix.join(dirname(file), value.split(/[?#]/)[0]))), `${file} -> ${value}`).toBe(true);
      }
    }
  });
});

describe('the build stops with a clear phrase', () => {
  it('when the installer is not there', () => {
    expect(() => build({ installer: join(tempDir(), `SC Trade_${version}_x64-setup.exe`) })).toThrow(/the installer .* does not exist/);
  });

  it('when the name of the installer carries another version than package.json', () => {
    const installer = fakeInstaller(tempDir(), 'SC Trade_0.1.0_x64-setup.exe');
    expect(() => build({ installer })).toThrow(`the installer "SC Trade_0.1.0_x64-setup.exe" is not version ${version} (package.json)`);
  });

  it('when a longer version only ends with the right one', () => {
    const installer = fakeInstaller(tempDir(), `SC Trade_1${version}_x64-setup.exe`);
    expect(() => build({ installer })).toThrow(/is not version/);
  });

  it('when the Twitch link is empty', () => {
    expect(() => build({ patchConfig: (settings) => void (settings.links.twitch = '') })).toThrow('site.config.json: the Twitch link is empty');
  });

  it('when the author is empty', () => {
    expect(() => build({ patchConfig: (settings) => void (settings.author = '') })).toThrow('site.config.json: the author is empty');
  });

  it('when the dictionaries do not have the same keys', () => {
    expect(() => build({ patchDictionaries: (all) => void delete (all.en.hero as Record<string, unknown>).lead })).toThrow(
      'the dictionaries differ (site/i18n): only in ru.json: hero.lead',
    );
  });

  it('and leaves no half-built site behind', () => {
    const dir = tempDir();
    expect(() => buildSite({ version, outDir: join(dir, 'dist'), deployDir: join(dir, 'dist-deploy'), installer: join(dir, 'nope.exe') })).toThrow();
    expect(existsSync(join(dir, 'dist'))).toBe(false);
    expect(existsSync(join(dir, 'dist-deploy'))).toBe(false);
  });
});

describe('the installer', () => {
  it('is described by its size and its SHA-256, under the name the site gives it', () => {
    const file = fakeInstaller(tempDir());
    const bytes = readFileSync(file);
    expect(installerInfo(file, version)).toEqual({
      source: file,
      fileName: `SC-Trade-${version}-setup.exe`,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  });

  it('has a size a person can read, in the way of the language', () => {
    const ru = { mb: 'МБ', kb: 'КБ', b: 'байт' };
    const en = { mb: 'MB', kb: 'KB', b: 'bytes' };
    // a space that does not break (U+00A0): the number and its unit stay on one line
    const gap = String.fromCharCode(0xa0);
    expect(formatSize(4_920_458, 'ru', ru)).toBe(`4,7${gap}МБ`);
    expect(formatSize(4_920_458, 'en', en)).toBe(`4.7${gap}MB`);
    expect(formatSize(204_000, 'ru', ru)).toBe(`199${gap}КБ`);
    expect(formatSize(512, 'en', en)).toBe(`512${gap}bytes`);
  });
});

describe('the first screen', () => {
  /** A folder with files that stand in for the background video (the build does not look inside them). */
  const videoFolder = (names: string[]) => {
    const dir = tempDir();
    for (const name of names) writeFileSync(join(dir, name), `stand-in for ${name}`);
    return dir;
  };

  it('is whole without a video: the still scene, and no video tag at all', () => {
    const site = build();
    expect(site.result.video).toBe(false);
    for (const page of Object.values(PAGES)) {
      const hero = section(site.read(page), 'top');
      expect(hero).not.toMatch(/<video|<source|hero__poster|hero--video/);
      for (const layer of ['hero__space', 'hero__planet']) expect(hero).toContain(`class="${layer}"`);
      expect(hero).toMatch(/<h1[^>]*>SC Trade<\/h1>/);
    }
    expect(site.files.filter((file) => file.startsWith('assets/video/'))).toEqual([]);
  });

  it('plays the video when its three files are there: silent, in a loop, inline, with a still frame first', () => {
    const site = build({ videoDir: videoFolder(['hero.webm', 'hero.mp4', 'hero.jpg']) });
    expect(site.result.video).toBe(true);
    expect(site.files).toEqual(expect.arrayContaining(['assets/video/hero.webm', 'assets/video/hero.mp4', 'assets/video/hero.jpg']));
    for (const [page, root] of [['index.html', ''], ['en/index.html', '../']] as const) {
      const hero = section(site.read(page), 'top');
      expect(hero).toMatch(/<section class="hero hero--video"/);
      const video = /<video[^>]*>/.exec(hero)?.[0] ?? '';
      for (const attribute of ['autoplay', 'muted', 'loop', 'playsinline']) expect(video).toMatch(new RegExp(`\\s${attribute}[\\s>]`));
      expect(video).toContain(` poster="${root}assets/video/hero.jpg?v=`);
      expect(video).not.toMatch(/\scontrols/);
      const sources = [...hero.matchAll(/<source src="([^"]+)" type="([^"]+)" media="([^"]+)">/g)].map((match) => match.slice(1));
      expect(sources.map(([src, type]) => [src.replace(/\?v=[0-9a-f]+$/, ''), type])).toEqual([
        [`${root}assets/video/hero.webm`, 'video/webm'],
        [`${root}assets/video/hero.mp4`, 'video/mp4'],
      ]);
      // a veil lies over the video, and the still frame is there for where the video is not shown
      expect(hero.indexOf('class="hero__veil"')).toBeGreaterThan(hero.indexOf('</video>'));
      expect(hero).toContain(`<img class="hero__poster" src="${root}assets/video/hero.jpg?v=`);
    }
  });

  it('keeps the video away from narrow screens and from visitors who asked for less motion, three times over', () => {
    const site = build({ videoDir: videoFolder(['hero.webm', 'hero.mp4', 'hero.jpg']) });
    // 1. the sources themselves: a browser loads none of them when the condition is not met
    const sources = [...section(site.read('index.html'), 'top').matchAll(/<source[^>]*>/g)];
    expect(sources).toHaveLength(2);
    for (const source of sources) expect(source[0]).toContain('media="(min-width: 720px) and (prefers-reduced-motion: no-preference)"');
    // 2. the styles never show the video there
    const css = site.read('assets/css/site.css').replace(/\s+/g, ' ');
    expect(css).toContain('@media (max-width: 719.98px), (prefers-reduced-motion: reduce) { .hero__video { display: none; } }');
    // 3. the script takes the sources away in a browser that ignored the condition
    const script = site.read('assets/js/site.js');
    expect(script).toContain("'(max-width: 719.98px), (prefers-reduced-motion: reduce)'");
    expect(script).toContain('source.remove()');
  });

  it('stops with a clear phrase when only a part of the video is there', () => {
    expect(() => build({ videoDir: videoFolder(['hero.mp4']) })).toThrow(/the background video is not whole: .* has only hero\.mp4 \(npm run site:video makes all three files\)/);
  });

  it('has nothing in its styles that moves or is fetched: the still scene is gradients only', () => {
    const css = build().read('assets/css/site.css');
    const hero = css.slice(css.indexOf('.hero {'), css.indexOf('.features {'));
    expect(hero.length).toBeGreaterThan(1000);
    expect(hero).not.toMatch(/animation|@keyframes|transition|url\(|filter:/);
  });
});
