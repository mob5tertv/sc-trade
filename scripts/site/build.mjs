// `npm run site:build`: makes the site (site/dist) from the templates, the two dictionaries and the settings of
// site/, with nothing but Node. What the server needs besides the site is written beside it (site/dist-deploy: the
// config of the web server, the script that sets the server up, the feedback service — see server-bundle.mjs),
// never inside: dist is what goes to the folder of the site on the server.
//
//   npm run site:build -- --installer <path to the installer>     the site as it is published
//   npm run site:build -- --no-installer                          a page to look at: the download button is off
//
// The version comes from package.json; the name, the size and the SHA-256 of the installer are read from the file.
// The build stops with a phrase that says what to fix when the installer is missing or is of another version, when
// the author or the Twitch link is empty, and when the dictionaries do not have the same keys.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { bundleScripts } from './bundle.mjs';
import { assertSameKeys, LANGUAGES, loadDictionaries, projectRoot, readJson, siteDir as defaultSiteDir, validateConfig } from './config.mjs';
import { formatSize, readInstaller } from './installer.mjs';
import { readServerBundle, writeServerBundle } from './server-bundle.mjs';
import { contentSecurityPolicy, styleHash } from './server-config.mjs';
import { fillPlaceholders, render } from './template.mjs';

/**
 * @typedef {import('./config.mjs').SiteConfig} SiteConfig
 * @typedef {import('./config.mjs').Dictionaries} Dictionaries
 * @typedef {import('./config.mjs').Dictionary} Dictionary
 * @typedef {import('./config.mjs').Lang} Lang
 * @typedef {import('./installer.mjs').InstallerInfo} InstallerInfo
 *
 * @typedef {{
 *   outDir: string,
 *   deployDir: string,
 *   version: string,
 *   installer: string | null,
 *   siteDir?: string,
 *   videoDir?: string,
 *   serverDir?: string,
 *   now?: Date,
 *   patchConfig?: (config: SiteConfig) => void,
 *   patchDictionaries?: (dictionaries: Dictionaries) => void,
 * }} BuildOptions
 *   `installer: null` is the build without the installer. `videoDir` is where hero.webm, hero.mp4 and hero.jpg are
 *   looked for (site/assets/video). `serverDir` is the feedback service with its installed packages (site/server).
 *   The two `patch…` are for the tests: they change what was read before it is checked.
 *
 * @typedef {{ files: string[], deploy: string[], installer: InstallerInfo | null, video: boolean, analytics: boolean, pictures: number }} BuildResult
 *   `files`: what is in dist; `deploy`: what is in dist-deploy
 */

/** The pages every language has: the template and the file it becomes (in the folder of the language). */
const PAGES = /** @type {const} */ ([
  { id: 'home', template: 'home.html', file: 'index.html' },
  { id: 'data', template: 'data.html', file: 'data.html' },
]);

/** The style sheets (site/css), joined in this order into assets/css/site.css. */
const STYLES = ['base.css', 'hero.css', 'sections.css', 'shots.css', 'feedback.css', 'consent.css', 'data.css'];

/** The scripts (site/js), joined in this order into assets/js/site.js; see bundle.mjs. */
const MAIN_SCRIPTS = ['menu.js', 'copy.js', 'hero-video.js', 'lightbox.js', 'feedback-rules.js', 'feedback.js', 'downloads.js'];

/** The scripts of the consent banner: assets/js/consent.js, written only when a GA4 id is set. */
const CONSENT_SCRIPTS = ['consent-core.js', 'consent.js'];

/** The pictures of the application each block of the home page shows (site/assets/shots/<name>.png). */
const FEATURE_SHOTS = ['terminal-options', 'mini-run', 'my-routes'];
const GALLERY_SHOTS = ['price-entry', 'storage-buy', 'storage', 'sell-or-fly', 'history', 'settings'];

/** The files of the background video, all three or none (`npm run site:video` makes them). */
const VIDEO_FILES = /** @type {const} */ ({ webm: 'hero.webm', mp4: 'hero.mp4', poster: 'hero.jpg' });

/** What is copied from site/assets as it is. */
const ASSET_TYPES = /\.(svg|png|jpg|webp|ico)$/;

const LOCALES = /** @type {const} */ ({ ru: 'ru_RU', en: 'en_US' });

/** @param {string} dir @returns {string[]} every file under it, as paths with forward slashes, sorted */
function listFiles(dir) {
  if (!existsSync(dir)) return [];
  /** @type {(folder: string) => string[]} */
  const walk = (folder) =>
    readdirSync(folder).flatMap((name) => {
      const path = join(folder, name);
      return statSync(path).isDirectory() ? walk(path) : [relative(dir, path).replaceAll('\\', '/')];
    });
  return walk(dir).sort();
}

/** @param {string} dir @returns {Record<string, string>} the templates of a folder by name without `.html` */
function readTemplates(dir) {
  return Object.fromEntries(
    listFiles(dir)
      .filter((file) => file.endsWith('.html'))
      .map((file) => [file.slice(0, -'.html'.length), readFileSync(join(dir, file), 'utf8').replaceAll('\r\n', '\n')]),
  );
}

/** The size of a PNG, from its header. */
function pngSize(/** @type {string} */ file) {
  const bytes = readFileSync(file);
  if (bytes.length < 24 || bytes.toString('latin1', 1, 4) !== 'PNG') throw new Error(`${file} is not a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** The file of a page of a language, from the root of the site: the first language lives in the root. */
const pageFile = (/** @type {Lang} */ lang, /** @type {string} */ file) => (lang === LANGUAGES[0] ? file : `${lang}/${file}`);

/** The address of a page on the server: an index page is the folder itself. */
const pageUrl = (/** @type {string} */ domain, /** @type {string} */ file) => `https://${domain}/${file.replace(/(^|\/)index\.html$/, '$1')}`;

/** The relative address of one file of the site as seen from another. */
const linkFrom = (/** @type {string} */ from, /** @type {string} */ to) => posix.relative(posix.dirname(from), to) || posix.basename(to);

/**
 * @param {BuildOptions} options
 * @returns {BuildResult}
 */
export function buildSite(options) {
  const siteDir = options.siteDir ?? defaultSiteDir;
  const now = options.now ?? new Date();
  const outDir = resolve(options.outDir);
  const deployDir = resolve(options.deployDir);

  // ---- what the site is made of, checked before a single file is written
  const config = /** @type {SiteConfig} */ (readJson(join(siteDir, 'site.config.json')));
  options.patchConfig?.(config);
  validateConfig(config);
  const dictionaries = loadDictionaries(siteDir);
  options.patchDictionaries?.(dictionaries);
  assertSameKeys(dictionaries);
  // the installer is read once: the bytes measured here are the bytes written into the site below
  const read = options.installer === null ? null : readInstaller(resolve(options.installer), options.version);
  const installer = read === null ? null : read.info;
  const analytics = config.analytics.ga4Id !== '';

  const videoDir = options.videoDir ?? join(siteDir, 'assets', 'video');
  const videoFound = Object.values(VIDEO_FILES).filter((name) => existsSync(join(videoDir, name)));
  if (videoFound.length > 0 && videoFound.length < Object.keys(VIDEO_FILES).length) {
    throw new Error(`the background video is not whole: ${videoDir} has only ${videoFound.join(', ')} (npm run site:video makes all three files)`);
  }
  const hasVideo = videoFound.length > 0;

  // what goes to the server besides the site: read and checked here, so that a service that is not installed stops
  // the build before anything is written
  const serverBundle = readServerBundle({ siteDir, serverDir: options.serverDir ?? join(siteDir, 'server'), domain: config.domain, root: config.server.root, service: config.server.service });

  const templates = readTemplates(join(siteDir, 'templates'));
  const partials = Object.fromEntries(Object.entries(templates).filter(([name]) => name.startsWith('partials/')).map(([name, source]) => [name.slice('partials/'.length), source]));

  // ---- the files, into a folder next to the final one: a build that fails leaves the previous site as it was
  const work = `${outDir}.building`;
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  /** @type {Map<string, string>} the short hash of every file of the site that a page may name */
  const hashes = new Map();
  const write = (/** @type {string} */ file, /** @type {string | Buffer} */ content) => {
    mkdirSync(dirname(join(work, file)), { recursive: true });
    writeFileSync(join(work, file), content);
    hashes.set(file, createHash('sha256').update(content).digest('hex').slice(0, 10));
  };

  try {
    const assetsDir = join(siteDir, 'assets');
    for (const file of listFiles(assetsDir).filter((name) => ASSET_TYPES.test(name) && !name.startsWith('video/'))) write(`assets/${file}`, readFileSync(join(assetsDir, file)));
    if (hasVideo) for (const name of Object.values(VIDEO_FILES)) write(`assets/video/${name}`, readFileSync(join(videoDir, name)));

    write('assets/css/site.css', STYLES.map((name) => readFileSync(join(siteDir, 'css', name), 'utf8').replaceAll('\r\n', '\n').trim()).join('\n\n') + '\n');
    const sources = (/** @type {string[]} */ names) => names.map((name) => ({ name, source: readFileSync(join(siteDir, 'js', name), 'utf8') }));
    write('assets/js/site.js', bundleScripts(sources(MAIN_SCRIPTS)));
    if (analytics) write('assets/js/consent.js', bundleScripts(sources(CONSENT_SCRIPTS)));

    if (read !== null) {
      write(`download/${read.info.fileName}`, read.bytes);
      write('download/SHA256SUMS.txt', `${read.info.sha256}  ${read.info.fileName}\n`);
    }

    /** The pictures of the application: twice as many pixels as the size they are shown at. */
    const shotFiles = [...hashes.keys()].filter((file) => /^assets\/shots\/[\w-]+\.png$/.test(file));
    const shotSizes = Object.fromEntries(shotFiles.map((file) => [posix.basename(file, '.png'), pngSize(join(work, file))]));
    /** The same pictures with the English window (site/assets/shots/en): the English pages show them where they exist. */
    const shotFilesEn = [...hashes.keys()].filter((file) => /^assets\/shots\/en\/[\w-]+\.png$/.test(file));
    const shotSizesEn = Object.fromEntries(shotFilesEn.map((file) => [posix.basename(file, '.png'), pngSize(join(work, file))]));

    const isoDay = now.toISOString().slice(0, 10);

    for (const lang of LANGUAGES) {
      const t = dictionaries[lang];
      const units = /** @type {{ mb: string, kb: string, b: string }} */ (/** @type {Dictionary} */ (t.download).units);
      const captions = /** @type {Record<string, { caption: string, alt: string }>} */ (t.shots);

      for (const page of PAGES) {
        const file = pageFile(lang, page.file);
        const to = (/** @type {string} */ target) => linkFrom(file, target);
        /** A file of the site as this page names it: relative, with the hash of the file, so that a changed file has a new address. */
        const asset = (/** @type {string} */ target) => {
          const hash = hashes.get(target);
          if (hash === undefined) throw new Error(`the page ${file} needs ${target}, and the site has no such file (site/${target})`);
          return `${to(target)}?v=${hash}`;
        };
        const shots = Object.fromEntries(
          Object.entries(shotSizes).map(([name, ruSize]) => {
            if (captions[name] === undefined) throw new Error(`the picture site/assets/shots/${name}.png has no texts: add "shots.${name}" to the dictionaries`);
            const english = lang === 'en' && shotSizesEn[name] !== undefined;
            const size = english ? shotSizesEn[name] : ruSize;
            const src = asset(english ? `assets/shots/en/${name}.png` : `assets/shots/${name}.png`);
            return [name, { name, src, width: Math.round(size.width / 2), height: Math.round(size.height / 2), fullWidth: size.width, fullHeight: size.height, ...captions[name] }];
          }),
        );
        const pick = (/** @type {string[]} */ names) => names.filter((name) => shots[name] !== undefined).map((name) => shots[name]);
        const meta = /** @type {Record<string, string>} */ (t.meta);
        const home = pageFile(lang, 'index.html');

        const scope = {
          lang,
          t,
          site: config,
          // every link the way a person reads it: boosty.to/mob5ter
          shown: Object.fromEntries(Object.entries(config.links).map(([name, link]) => [name, link.replace(/^https:\/\/(www\.)?/, '').replace(/\/$/, '')])),
          page: {
            id: page.id,
            title: page.id === 'home' ? meta.title : meta[`${page.id}_title`],
            description: page.id === 'home' ? meta.description : meta[`${page.id}_description`],
            canonical: pageUrl(config.domain, file),
            locale: LOCALES[lang],
          },
          alternates: [
            ...LANGUAGES.map((other) => ({ code: other, url: pageUrl(config.domain, pageFile(other, page.file)) })),
            { code: 'x-default', url: pageUrl(config.domain, pageFile(LANGUAGES[0], page.file)) },
          ],
          langs: LANGUAGES.map((other) => ({ code: other, label: other.toUpperCase(), current: other === lang, href: to(pageFile(other, page.file)) })),
          links: { home: to(home), data: to(pageFile(lang, 'data.html')), anchor: page.id === 'home' ? '#' : `${to(home)}#` },
          build: {
            version: options.version,
            date: { iso: isoDay, text: new Intl.DateTimeFormat(lang, { dateStyle: 'long', timeZone: 'UTC' }).format(now) },
          },
          installer:
            installer === null
              ? false
              : {
                  fileName: installer.fileName,
                  href: to(`download/${installer.fileName}`),
                  sums: to('download/SHA256SUMS.txt'),
                  size: formatSize(installer.size, lang, units),
                  sha256: installer.sha256,
                  // the sum in groups of eight: easier to compare by eye; a copy takes it whole
                  shaGroups: installer.sha256.match(/.{8}/g) ?? [],
                  verify: `Get-FileHash .\\${installer.fileName}`,
                },
          flags: { analytics, pictures: shotFiles.length > 0 },
          video: hasVideo ? { webm: asset(`assets/video/${VIDEO_FILES.webm}`), mp4: asset(`assets/video/${VIDEO_FILES.mp4}`), poster: asset(`assets/video/${VIDEO_FILES.poster}`) } : false,
          shots,
          gallery: pick(GALLERY_SHOTS),
          features: /** @type {Dictionary[]} */ (/** @type {Dictionary} */ (t.features).groups).map((group, index) => ({ ...group, shot: shots[FEATURE_SHOTS[index]] ?? false })),
        };
        write(file, render(templates[page.template.slice(0, -'.html'.length)], scope, { name: page.template, partials, helpers: { asset } }));
      }
    }

    // ---- the 404 page: one file for both languages, served at any address, so it carries its styles inside
    const notFoundCss = readFileSync(join(siteDir, 'css', '404.css'), 'utf8').replaceAll('\r\n', '\n').trim();
    write(
      '404.html',
      render(
        templates['404'],
        {
          css: `\n${notFoundCss}\n`,
          pages: LANGUAGES.map((lang) => ({ lang, t: dictionaries[lang].notfound, home: lang === LANGUAGES[0] ? '/' : `/${lang}/` })),
        },
        { name: '404.html' },
      ),
    );

    const indexed = LANGUAGES.flatMap((lang) => PAGES.map((page) => pageUrl(config.domain, pageFile(lang, page.file))));
    write(
      'sitemap.xml',
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexed
        .map((url) => `  <url><loc>${url}</loc><lastmod>${isoDay}</lastmod></url>`)
        .join('\n')}\n</urlset>\n`,
    );
    write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: https://${config.domain}/sitemap.xml\n`);

    // ---- the config of the web server, beside the site
    const caddyfile = fillPlaceholders(readFileSync(join(siteDir, 'deploy', 'Caddyfile.template'), 'utf8').replaceAll('\r\n', '\n'), {
      domain: config.domain,
      root: config.server.root,
      service: config.server.service,
      csp: contentSecurityPolicy({ ga4Id: config.analytics.ga4Id, styleHashes: [styleHash(`\n${notFoundCss}\n`)] }),
    });

    rmSync(outDir, { recursive: true, force: true });
    renameSync(work, outDir);
    rmSync(deployDir, { recursive: true, force: true });
    mkdirSync(deployDir, { recursive: true });
    writeFileSync(join(deployDir, 'Caddyfile'), caddyfile);
    writeServerBundle(deployDir, serverBundle);
  } catch (err) {
    rmSync(work, { recursive: true, force: true });
    throw err;
  }

  return { files: listFiles(outDir), deploy: listFiles(deployDir), installer, video: hasVideo, analytics, pictures: [...hashes.keys()].filter((file) => file.startsWith('assets/shots/')).length };
}

const USAGE = `usage: npm run site:build -- --installer <path to the installer>
       npm run site:build -- --no-installer        a page to look at, the download button is off`;

function main() {
  const { values } = parseArgs({ options: { installer: { type: 'string' }, 'no-installer': { type: 'boolean' }, help: { type: 'boolean' } } });
  if (values.help) return console.log(USAGE);
  if ((values.installer === undefined) === (values['no-installer'] !== true)) {
    throw new Error(`say which build it is: with the installer or without\n${USAGE}`);
  }
  const { version } = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'));
  const outDir = join(defaultSiteDir, 'dist');
  const deployDir = join(defaultSiteDir, 'dist-deploy');
  const result = buildSite({ outDir, deployDir, version, installer: values.installer ?? null });

  const shown = (/** @type {string} */ path) => relative(process.cwd(), path).replaceAll('\\', '/') || '.';
  console.log(`site: ${shown(outDir)} (${result.files.length} files), version ${version}`);
  if (result.installer === null) console.log('installer: none — the download button is off ("built without the installer")');
  else console.log(`installer: download/${result.installer.fileName}, ${result.installer.size} bytes, SHA-256 ${result.installer.sha256}`);
  console.log(`background video: ${result.video ? 'assets/video/hero.webm, hero.mp4, hero.jpg' : 'none — the first screen uses its still background (npm run site:video makes the video)'}`);
  console.log(`pictures of the application: ${result.pictures}`);
  console.log(`analytics: ${result.analytics ? 'Google Analytics 4, after consent only' : 'off (ga4Id is empty): no banner, nothing of Google'}`);
  console.log(`for the server: ${shown(deployDir)} (${result.deploy.length} files) — the Caddyfile, setup.sh and the feedback service; site/DEPLOY.md, section 4, says what to do with the folder`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
