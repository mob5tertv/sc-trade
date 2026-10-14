import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, siteDir } from '../../scripts/site/config.mjs';
import { installerInfo } from '../../scripts/site/installer.mjs';

// README.md is the face of the repository, the first thing a visitor of GitHub sees, and it is in English: an
// introduction, a rule, then the guide. README.ru.md is the guide in Russian — the longer one, and the source the
// introduction's statements were written from. Every link leads somewhere; both name the installer as it is downloaded.

const ROOT = join(__dirname, '..', '..');
// by lines: nothing here depends on how the lines of the file end on this disk
const read = (name: string) => readFileSync(join(ROOT, name), 'utf8').split(/\r?\n/);
const lines = read('README.md');
const ruLines = read('README.ru.md');
const ruGuide = ruLines.join('\n');
/** The first horizontal rule of README.md: where the introduction ends and the guide begins. */
const rule = lines.findIndex((line) => /^(-{3,}|\*{3,}|_{3,})$/.test(line));
const intro = lines.slice(1, Math.max(rule, 1)).join('\n');
const guide = lines.slice(rule + 1).join('\n');
const config = loadConfig(siteDir);
const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string };

/** The links of a text, as Markdown writes them. */
const linksOf = (text: string) => [...text.matchAll(/(?<!!)\[([^\]]*)\]\(([^()\s]+)\)/g)].map((match) => ({ text: match[1], target: match[2] }));
const targets = linksOf(intro).map((link) => link.target);
/** Its pictures: HTML, so that a picture can be given a width. */
const attribute = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? '';
const picturesOf = (text: string) => [...text.matchAll(/<img\s[^>]*>/g)].map((match) => ({ src: attribute(match[0], 'src'), alt: attribute(match[0], 'alt'), width: attribute(match[0], 'width') }));

/** The anchor GitHub gives a heading: lower case, punctuation dropped, every space a hyphen. */
const anchorOf = (heading: string) => heading.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
/** The line that switches the language: with the name of the first screen of the window, the only Russian words of README.md. */
const SWITCH = '**English** · [Русский](README.ru.md)';

/** The name of the installer as a person has it (the site's name), and as the build writes it. */
function installerNames(): { downloaded: string; built: string } {
  const built = `SC Trade_${version}_x64-setup.exe`;
  const dir = mkdtempSync(join(tmpdir(), 'sc-trade-readme-'));
  try {
    writeFileSync(join(dir, built), 'this only stands in for an installer');
    return { downloaded: installerInfo(join(dir, built), version).fileName, built };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('README.md, the face of the repository, in English', () => {
  it('begins with the title and the switch to the Russian guide', () => {
    expect(lines[0]).toBe('# SC Trade');
    expect(lines[2]).toBe(SWITCH);
    expect(existsSync(join(ROOT, 'README.ru.md'))).toBe(true);
  });

  it("is English throughout: the switch of the language and the name of the window's first screen are its only Russian words", () => {
    const russian = lines.map((line) => line.replace(SWITCH, '').replace('"Язык · Language"', '')).filter((line) => /[А-Яа-яЁё]/.test(line));
    expect(russian).toEqual([]);
    expect(lines).toContain(SWITCH);
  });

  it('opens with an introduction, and a rule cuts it off from the guide, before the first section', () => {
    expect(rule).toBeGreaterThan(1);
    // a rule, not a heading: "---" right under a line of text would make that line a heading
    expect([lines[rule - 1], lines[rule + 1]]).toEqual(['', '']);
    expect(rule).toBeLessThan(lines.findIndex((line) => line.startsWith('## ')));
    expect(intro).not.toMatch(/^#/m);
  });

  it('links to the site, to the releases, to the licence and to the test that pins the permissions', () => {
    expect(targets).toContain(`https://${config.domain}`);
    expect(targets).toContain(`${config.links.github}/releases/latest`);
    expect(targets).toContain('LICENSE');
    expect(targets).toContain('tests/release/permissions.test.ts');
    // UEX and the author: the same addresses the site gives
    expect(targets).toContain(config.links.uex);
    expect(targets).toContain(config.links.twitch);
  });

  it.each([['README.md', lines], ['README.ru.md', ruLines]] as const)('%s leads somewhere with every link: a file of the repository, a heading of its own, or an https address', (_name, text) => {
    const links = linksOf(text.join('\n'));
    expect(links.length).toBeGreaterThanOrEqual(1);
    const anchors = new Set(text.filter((line) => /^#{2,6} /.test(line)).map((line) => anchorOf(line.replace(/^#+ /, ''))));
    for (const { target } of links) {
      if (target.startsWith('#')) expect(anchors.has(target.slice(1)), target).toBe(true);
      else if (/^[a-z][a-z0-9+.-]*:/i.test(target)) expect(target).toMatch(/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[\w\-./]*)?$/);
      else expect(existsSync(join(ROOT, target)), target).toBe(true);
    }
  });

  it.each([['README.md', lines], ['README.ru.md', ruLines]] as const)('%s shows a picture of the window that is a file of the repository, with words for those who do not see it, at the size of the window', (name, text) => {
    const pictures = picturesOf(text.join('\n'));
    expect(pictures.length).toBeGreaterThanOrEqual(1);
    for (const { src, alt, width } of pictures) {
      expect(src).toMatch(/^[\w-]+(\/[\w.-]+)+\.png$/);
      expect(existsSync(join(ROOT, src)), src).toBe(true);
      expect(alt.trim(), src).not.toBe('');
      // the pictures of the site have twice the pixels of the window: in Markdown form the page would show every
      // pixel, and the text would begin a screen lower
      const pixels = readFileSync(join(ROOT, src)).readUInt32BE(16);
      expect(Number(width) * 2, src).toBe(pixels);
    }
    // the English page shows the English window
    if (name === 'README.md') expect(pictures.every(({ src }) => src.includes('/en/'))).toBe(true);
    expect(text.join('\n')).not.toMatch(/!\[/);
  });

  // What this test does: it holds twelve statements of the introduction, each next to the sentence of the Russian guide
  // it was written from («Чего программа не делает», «Что нужно», «Источник данных и права»), so that neither can be
  // changed without the other being looked at; and it refuses a few words of a promise. Whether a pair really says
  // the same thing is for a reader to judge: no test can.
  it('has twelve statements about the program, each with the sentence of the Russian guide it was written from, and none of the words of a promise', () => {
    const pairs = [
      ['nothing is injected', 'ничего не внедряет в чужие процессы'],
      ["the game's memory and files are not read", 'Не читает память игры'],
      ["the game's memory and files are not read", 'Не читает файлы игры'],
      ['no key presses or clicks are sent', 'Не нажимает клавиши и не кликает за игрока'],
      ['The only network address is `api.uexcorp.uk`', 'В сеть она ходит по одному адресу, `api.uexcorp.uk`'],
      ['none is assigned by default', 'по умолчанию не назначено ничего'],
      ['while one is assigned, Windows calls the program on every key press', 'Пока назначена хотя бы одна, Windows вызывает функцию перехвата программы для каждого нажатия любой клавиши'],
      ['every press is passed on to the game', 'Любое нажатие функция всегда передаёт дальше, так что игра получает его, как обычно'],
      // whose permissions: the test pins what the WINDOW is allowed — the guide says it in the item about the window («у окна программы нет разрешения…»)
      ["The window's list of permissions is pinned by a test", 'Список разрешений закреплён тестом (`tests/release/permissions.test.ts`)'],
      ['Windows 10 / 11, 64-bit', 'Windows 10 или 11, 64 бита.'],
      ['SC Trade is an unofficial fan-made tool', 'SC Trade — неофициальный фанатский инструмент'],
      ['is not endorsed by them', 'не связан с разработчиком и издателем игры и не одобрен ими'],
    ] as const;
    for (const [said, source] of pairs) {
      expect(intro, said).toContain(said);
      expect(ruGuide, source).toContain(source);
    }
    // no word of a promise, and no hint at a plan nobody has stated
    expect(intro).not.toMatch(/\bsafe|undetect|anti-?cheat|guarantee|\bbann?ed\b|\bban\b|allowed by|approved|100\s?%|\bfor now\b/i);
  });

  it('names the installer in both guides as it is downloaded, and the output of the build as the build names it', () => {
    const { downloaded, built } = installerNames();
    // the build calls the file one way; the site gives it a name without spaces (scripts/site/installer.mjs), and that is the file a person has
    const ruStep = ruLines.find((line) => line.startsWith('1. Запусти установщик')) ?? '';
    expect(ruStep).toContain(`1. Запусти установщик \`${downloaded}\` (так файл называется на сайте и в релизе на GitHub). Он ставит программу`);
    expect(ruStep).not.toContain(built);
    const enStep = lines.find((line) => line.startsWith('1. Run the installer')) ?? '';
    expect(enStep).toContain(`1. Run the installer \`${downloaded}\` (that is the file's name on the site and in the GitHub release).`);
    expect(enStep).not.toContain(built);
    // the sections on building speak of what the build writes: there the name of the build is the right one
    expect(ruGuide).toContain(`\`src-tauri/target/release/bundle/nsis/${built}\``);
    expect(guide).toContain(`\`src-tauri/target/release/bundle/nsis/${built}\``);
  });
});

describe('README.ru.md, the guide in Russian', () => {
  it('begins with the title, the switch to the English page and the guide as it always began', () => {
    expect(ruLines[0]).toBe('# SC Trade');
    expect(ruLines[2]).toBe('[English](README.md) · **Русский**');
    expect(ruLines.find((line) => line.startsWith('Личный дневник'))).toBe('Личный дневник цен и помощник по торговым маршрутам для Star Citizen. Программа живёт небольшим окном поверх игры.');
  });
});
