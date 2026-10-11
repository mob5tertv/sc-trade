import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, loadDictionaries, siteDir } from '../../scripts/site/config.mjs';

// README.md is the face of the repository: the first thing a visitor of GitHub sees. It opens with a short
// introduction in English; a rule cuts the introduction off from the guide, which is in Russian. The guide is the
// source: the introduction says of the program nothing that the guide does not say, and every link of it leads
// somewhere.

const ROOT = join(__dirname, '..', '..');
// by lines: nothing here depends on how the lines of the file end on this disk
const lines = readFileSync(join(ROOT, 'README.md'), 'utf8').split(/\r?\n/);
const rule = lines.indexOf('---');
const intro = lines.slice(1, Math.max(rule, 1)).join('\n');
const guide = lines.slice(rule + 1).join('\n');
const config = loadConfig(siteDir);

interface Link {
  image: boolean;
  text: string;
  target: string;
}
const links: Link[] = [...intro.matchAll(/(!?)\[([^\]]*)\]\(([^()\s]+)\)/g)].map((match) => ({ image: match[1] === '!', text: match[2], target: match[3] }));
const targets = links.map((link) => link.target);

/** The anchor GitHub gives a heading: lower case, punctuation dropped, every space a hyphen. */
const anchorOf = (heading: string) => heading.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');

describe('README.md, the face of the repository', () => {
  it('begins with the title', () => {
    expect(lines[0]).toBe('# SC Trade');
  });

  it('opens with an introduction in English, and a rule cuts it off from the guide in Russian, before the first section', () => {
    expect(rule).toBeGreaterThan(1);
    expect(lines.filter((line) => line === '---')).toHaveLength(1);
    // a rule, not a heading: "---" right under a line of text would make that line a heading
    expect([lines[rule - 1], lines[rule + 1]]).toEqual(['', '']);
    const firstSection = lines.findIndex((line) => line.startsWith('## '));
    expect(lines[firstSection]).toBe('## Что это');
    expect(rule).toBeLessThan(firstSection);
    // the guide begins as it always did
    expect(lines[rule + 2]).toBe('Личный дневник цен и помощник по торговым маршрутам для Star Citizen. Программа живёт небольшим окном поверх игры.');
    // in English: the only Russian words are the names it quotes (the two sections of the guide it sends to, a section
    // of the window in the picture) and the anchors of those two sections
    expect(intro.replace(/«[^»]*»/g, '').replace(/\]\(#[^()\s]*\)/g, '')).not.toMatch(/[А-Яа-яЁё]/);
    expect(intro).toContain('The guide below is in Russian.');
    // and with no heading of its own: the title of the file is its title
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

  it('leads somewhere with every link: to a file of the repository, to a heading of the guide, or to an https address', () => {
    expect(links.length).toBeGreaterThanOrEqual(9);
    const anchors = new Set(lines.filter((line) => /^#{2,6} /.test(line)).map((line) => anchorOf(line.replace(/^#+ /, ''))));
    for (const { text, target } of links) {
      if (target.startsWith('#')) {
        expect(anchors.has(target.slice(1)), target).toBe(true);
        // the words of such a link are the title of the section itself
        expect(anchorOf(text), target).toBe(target.slice(1));
      } else if (/^[a-z][a-z0-9+.-]*:/i.test(target)) expect(target).toMatch(/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/[\w\-./]*)?$/);
      else expect(existsSync(join(ROOT, target)), target).toBe(true);
    }
    expect(targets.filter((target) => target.startsWith('#'))).toEqual(['#чего-программа-не-делает', '#сборка-из-исходников']);
  });

  it('shows one picture of the window, a picture of the site, and the caption says what is on it and no more', () => {
    const pictures = links.filter((link) => link.image);
    expect(pictures).toHaveLength(1);
    const { text: caption, target } = pictures[0];
    const name = /^site\/assets\/shots\/([\w-]+)\.png$/.exec(target)?.[1] ?? '';
    expect(name).not.toBe('');
    expect(existsSync(join(ROOT, target)), target).toBe(true);
    // the picture is what the introduction begins with, right under the title
    expect(lines.slice(1).find((line) => line !== '')).toBe(`![${caption}](${target})`);
    // what is on it is said once, in the texts of the site (site/i18n/en.json); here the same words, and where the numbers come from
    const described = (loadDictionaries(siteDir).en.shots as Record<string, { alt: string }>)[name].alt;
    expect(caption.replace(' on demo data:', ':')).toBe(described);
    expect(caption).toContain('The unfolded SC Trade window on demo data:');
    // the pictures of the site are taken in the preview, with no game behind the window: the caption does not put one there
    expect(caption).not.toMatch(/over the game|on top of the game|in the game|in[- ]game|in flight/i);
  });

  it('says of the program only what the guide says, and keeps what the guide discloses about the keys', () => {
    // a statement of the introduction, and the sentence of the guide it rests on («Чего программа не делает», «Что нужно», «Источник данных и права»)
    const pairs = [
      ['nothing is injected', 'ничего не внедряет в чужие процессы'],
      ["the game's memory and files are not read", 'Не читает память игры'],
      ["the game's memory and files are not read", 'Не читает файлы игры'],
      ['no key presses or clicks are sent', 'Не нажимает клавиши и не кликает за игрока'],
      ['The only network address is `api.uexcorp.uk`', 'В сеть она ходит по одному адресу, `api.uexcorp.uk`'],
      ['none is assigned by default', 'по умолчанию не назначено ничего'],
      ['while one is assigned, Windows calls the program on every key press', 'Пока назначена хотя бы одна, Windows вызывает функцию перехвата программы для каждого нажатия любой клавиши'],
      ['every press is passed on to the game', 'Любое нажатие функция всегда передаёт дальше, так что игра получает его, как обычно'],
      ['The list of permissions is pinned by a test', 'Список разрешений закреплён тестом (`tests/release/permissions.test.ts`)'],
      ['Windows 10 / 11, 64-bit', 'Windows 10 или 11, 64 бита.'],
      ['SC Trade is an unofficial fan-made tool', 'SC Trade — неофициальный фанатский инструмент'],
      ['is not endorsed by them', 'не связан с разработчиком и издателем игры и не одобрен ими'],
    ] as const;
    for (const [said, source] of pairs) {
      expect(intro, said).toContain(said);
      expect(guide, source).toContain(source);
    }
    // and no word of a promise that the guide does not make
    expect(intro).not.toMatch(/\bsafe|undetect|anti-?cheat|guarantee|\bbann?ed\b|\bban\b|allowed by|approved|100\s?%/i);
  });
});
