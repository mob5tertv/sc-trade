import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isOwnPicture, preparePictureFolder, servedFile } from '../../scripts/site/pagecheck.mjs';
import { projectRoot, tempDir } from './helpers';

describe('the pictures of the page check', () => {
  it('have names of their own: width, language, what is shown, and a number when a section is cut into tiles', () => {
    for (const name of ['1440-ru-1-hero.png', '390-en-1-hero-whole.png', '1440-en-4-safety.png', '390-ru-4-safety-2.png', '390-ru-9-data-12.png', '1440-404.png', '390-ru-menu.png', '1440-en-form-error.png', '390-en-consent.png', '1440-ru-hero-white-video.png', '1440-ru-focus-support.png', '1440-ru-focus-gallery.png']) {
      expect(isOwnPicture(name), name).toBe(true);
    }
  });

  it('are told from every other file', () => {
    for (const name of ['holiday.png', '1440-ru-family.png', '1440-ru-1-hero.jpg', '1440-ru-1-hero.png.bak', '1440-ru-1-hero', 'IMG_1440-ru-1-hero.png', '1440-de-1-hero.png', '1024-ru-1-hero.png', '1440-ru-1-hero-x.png', '1440-404-2.png', 'notes.txt', '']) {
      expect(isOwnPicture(name), name).toBe(false);
    }
  });
});

describe('the folder the pictures go to (--out)', () => {
  it('keeps every file that is not a picture of the check, and loses only the old pictures of the check', () => {
    const out = join(tempDir(), 'Pictures');
    mkdirSync(join(out, 'trip'), { recursive: true });
    const foreign = ['holiday.png', 'passport scan.png', '1440-ru-family.png', 'notes.txt', 'report.pdf', 'trip/1440-ru-1-hero.png', 'trip/beach.png'];
    const own = ['1440-ru-1-hero.png', '390-en-4-safety-2.png', '1440-404.png', '390-ru-menu.png'];
    for (const name of [...foreign, ...own]) writeFileSync(join(out, name), `what was in ${name}`);

    expect(preparePictureFolder(out)).toEqual([...own].sort());

    for (const name of foreign) expect(readFileSync(join(out, name), 'utf8'), name).toBe(`what was in ${name}`);
    for (const name of own) expect(existsSync(join(out, name)), name).toBe(false);
    expect(readdirSync(out).sort()).toEqual(['1440-ru-family.png', 'holiday.png', 'notes.txt', 'passport scan.png', 'report.pdf', 'trip']);
  });

  it('is made when it is not there', () => {
    const out = join(tempDir(), 'a', 'b', 'pictures');
    expect(preparePictureFolder(out)).toEqual([]);
    expect(readdirSync(out)).toEqual([]);
  });

  it('is refused when it is a file, and the file is left as it was', () => {
    const file = join(tempDir(), 'pictures.png');
    writeFileSync(file, 'a file, not a folder');
    expect(() => preparePictureFolder(file)).toThrow(/is a file, not a folder/);
    expect(readFileSync(file, 'utf8')).toBe('a file, not a folder');
  });

  it('is never removed as a whole: the script has no recursive removal of it', () => {
    const source = readFileSync(resolve(projectRoot, 'scripts', 'site', 'pagecheck.mjs'), 'utf8');
    expect(source).not.toMatch(/rmSync\(\s*out\b/);
    // the only recursive removal left is of the temporary folder the script made itself
    expect([...source.matchAll(/rmSync\(([^,)]+),\s*\{[^}]*recursive: true/g)].map((match) => match[1].trim())).toEqual(['work']);
  });
});

describe('the stand-in server of the page check', () => {
  const dist = resolve(tempDir(), 'dist');

  it('serves the files of the built site, a folder as its index page', () => {
    expect(servedFile(dist, '/index.html')).toBe(join(dist, 'index.html'));
    expect(servedFile(dist, '/')).toBe(join(dist, 'index.html'));
    expect(servedFile(dist, '/en/')).toBe(join(dist, 'en', 'index.html'));
    expect(servedFile(dist, '/assets/css/site.css')).toBe(join(dist, 'assets', 'css', 'site.css'));
  });

  it('serves nothing outside the site, the folder next to it whose name begins the same included', () => {
    expect(servedFile(dist, '/../dist-deploy/Caddyfile')).toBeNull();
    expect(servedFile(dist, '/../../secret.txt')).toBeNull();
    expect(servedFile(dist, '/en/../../dist-deploy/Caddyfile')).toBeNull();
    expect(servedFile(dist, '/..')).toBeNull();
  });
});
