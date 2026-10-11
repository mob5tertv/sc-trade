import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, loadDictionaries, siteDir, type Dictionaries } from '../../scripts/site/config.mjs';
import { escapeHtml } from '../../scripts/site/template.mjs';
import { build, type Built } from './helpers';

// The code is open (README, «Источник данных и права»). The site says so in two places — the footer of every page
// that has one, and the last fact of the section about the game — and both lead to the one address the settings name.

const REPOSITORY = 'https://github.com/mob5tertv/sc-trade';
const config = loadConfig(siteDir);
const dictionaries = loadDictionaries(siteDir);

type Lang = 'ru' | 'en';
interface Fact {
  title: string;
  text: string;
  github_link?: string;
}
const facts = (all: Dictionaries, lang: Lang) => (all[lang].safety as unknown as { items: Fact[] }).items;
const footerText = (lang: Lang, key: string) => (dictionaries[lang].footer as Record<string, string>)[key];

const HOME = { ru: 'index.html', en: 'en/index.html' } as const;
/** Every page that has the footer of the site. The 404 page is a page of its own, with no header and no footer. */
const WITH_FOOTER = [['ru', 'index.html'], ['ru', 'data.html'], ['en', 'en/index.html'], ['en', 'en/data.html']] as const;
const footer = (html: string) => /<footer[\s\S]*<\/footer>/.exec(html)?.[0] ?? '';
const safety = (html: string) => /<section[^>]*\sid="safety"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
const factBlocks = (html: string) => [...safety(html).matchAll(/<div class="fact">[\s\S]*?<\/div>/g)].map((match) => match[0]);

/** A link that leaves the site, as the pages write one: a new tab, no word to the other site, and the hidden words that say so. */
const outside = (href: string, text: string, lang: Lang) =>
  `<a href="${href}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}<span class="visually-hidden"> (${escapeHtml(footerText(lang, 'external'))})</span></a>`;

describe('the link to the source code', () => {
  let site: Built;
  beforeAll(() => {
    site = build();
  });

  it('leads to the repository, and the settings are where its address is kept', () => {
    expect(config.links.github).toBe(REPOSITORY);
  });

  it('has its words for the footer in both languages', () => {
    expect(footerText('ru', 'github')).toBe('Исходный код на GitHub');
    expect(footerText('en', 'github')).toBe('Source code on GitHub');
  });

  it.each(WITH_FOOTER)('stands in the footer of the %s page %s, right after the Twitch link, and opens as every link that leaves the site', (lang, page) => {
    const foot = footer(site.read(page));
    const link = outside(REPOSITORY, footerText(lang, 'github'), lang);
    expect(foot).toContain(`<p>${outside(config.links.twitch, footerText(lang, 'twitch'), lang)}</p>\n          <p>${link}</p>`);
    expect(foot.split(`href="${REPOSITORY}"`)).toHaveLength(2);
  });

  it.each(['ru', 'en'] as const)('stands under the seventh fact of the section about the game on the %s page, and the six before it are written as they were', (lang) => {
    const blocks = factBlocks(site.read(HOME[lang]));
    const items = facts(dictionaries, lang);
    expect(blocks).toHaveLength(7);
    expect(items).toHaveLength(7);
    const head = (index: number) =>
      `<div class="fact">\n              <dt><span class="fact__index" aria-hidden="true">0${index + 1}</span>${escapeHtml(items[index].title)}</dt>\n              <dd>${escapeHtml(items[index].text)}</dd>\n`;
    for (let index = 0; index < 6; index++) expect(blocks[index], `fact ${index + 1}`).toBe(`${head(index)}            </div>`);
    expect(blocks[6]).toBe(`${head(6)}              <dd>${outside(REPOSITORY, items[6].github_link ?? '', lang)}</dd>\n            </div>`);
    // the one link of the section
    expect(safety(site.read(HOME[lang])).match(/<a\s/g)).toHaveLength(1);
  });

  it('gives the seventh fact the whole row of the list of two columns: an odd fact at the end does not hang over one half of it', () => {
    const css = site.read('assets/css/site.css').replace(/\s+/g, ' ');
    expect(css).toContain('.fact:last-child:nth-child(odd) { grid-column: 1 / -1; }');
    // across the whole page a line of text would be too long to read: the text keeps the measure of the head of a section
    expect(css).toContain('.fact:last-child:nth-child(odd) dd { max-width: 760px; }');
    expect(css).toContain('.section__head { max-width: 760px;');
  });

  it('takes its address from the settings in both places: no template writes it a second time', () => {
    const other = 'https://code.example/somebody/else';
    const moved = build({ patchConfig: (settings) => void (settings.links.github = other) });
    for (const [lang, page] of WITH_FOOTER) {
      const html = moved.read(page);
      expect(html, page).not.toContain('github.com');
      expect(footer(html), page).toContain(outside(other, footerText(lang, 'github'), lang));
    }
    for (const lang of ['ru', 'en'] as const) expect(safety(moved.read(HOME[lang])), lang).toContain(outside(other, facts(dictionaries, lang)[6].github_link ?? '', lang));

    const templates = readdirSync(join(siteDir, 'templates'), { recursive: true, encoding: 'utf8' }).filter((name) => name.endsWith('.html'));
    expect(templates.length).toBeGreaterThanOrEqual(10);
    for (const name of templates) expect(readFileSync(join(siteDir, 'templates', name), 'utf8'), name).not.toMatch(/github\.com/i);
  });

  it('does not make the text of a fact, or the words of its link, HTML: both are written as text', () => {
    const patched = build({
      patchDictionaries: (all) => {
        for (const lang of ['ru', 'en'] as const) {
          const item = facts(all, lang)[6];
          item.text = 'a <b>bold</b> claim & a "quoted" one';
          item.github_link = '<i>the repository</i>';
        }
      },
    });
    for (const lang of ['ru', 'en'] as const) {
      const part = safety(patched.read(HOME[lang]));
      expect(part, lang).toContain('<dd>a &lt;b&gt;bold&lt;/b&gt; claim &amp; a &quot;quoted&quot; one</dd>');
      expect(part, lang).toContain('rel="noopener noreferrer">&lt;i&gt;the repository&lt;/i&gt;<span class="visually-hidden">');
      expect(part, lang).not.toMatch(/<b>|<i>/);
    }
  });

  it('stops the build when one of the dictionaries lacks its words, or has them empty', () => {
    const differ = 'the dictionaries differ (site/i18n): ';
    expect(() => build({ patchDictionaries: (all) => void delete facts(all, 'en')[6].github_link })).toThrow(`${differ}only in ru.json: safety.items.6.github_link`);
    expect(() => build({ patchDictionaries: (all) => void delete (all.ru.footer as Record<string, unknown>).github })).toThrow(`${differ}only in en.json: footer.github`);
    expect(() => build({ patchDictionaries: (all) => void (facts(all, 'ru')[6].github_link = ' ') })).toThrow(`${differ}empty in ru.json: safety.items.6.github_link`);
    expect(() => build({ patchDictionaries: (all) => void facts(all, 'en').pop() })).toThrow(
      `${differ}only in ru.json: safety.items.6.github_link; only in ru.json: safety.items.6.text; only in ru.json: safety.items.6.title`,
    );
  });
});
