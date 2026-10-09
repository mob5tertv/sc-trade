import { beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, loadDictionaries, siteDir } from '../../scripts/site/config.mjs';
import { escapeHtml } from '../../scripts/site/template.mjs';
import { build, type Built } from './helpers';

const config = loadConfig(siteDir);
const dictionaries = loadDictionaries(siteDir);
const PAGES = [['ru', 'data.html', 'index.html'], ['en', 'en/data.html', 'en/index.html']] as const;
const texts = (lang: 'ru' | 'en') => dictionaries[lang].data as Record<string, string> & { app: string[]; form: string[]; analytics_on: string[]; analytics_off: string[] };
const main = (html: string) => /<main[\s\S]*<\/main>/.exec(html)?.[0] ?? '';

describe('the page about data', () => {
  let site: Built;
  beforeAll(() => {
    site = build();
  });

  it.each(PAGES)('exists in %s, with a title of its own, and the footer of every page links to it', (lang, page, home) => {
    const html = site.read(page);
    const meta = dictionaries[lang].meta as Record<string, string>;
    expect(html).toContain(`<html lang="${lang}"`);
    expect(html).toContain(`<title>${meta.data_title}</title>`);
    expect(html).toContain(`<h1 class="doc__title">${texts(lang).title}</h1>`);
    for (const from of [page, home]) expect(/<footer[\s\S]*<\/footer>/.exec(site.read(from))?.[0]).toMatch(/<a href="data\.html">/);
    expect(site.read('sitemap.xml')).toContain(`<loc>https://${config.domain}/${page}</loc>`);
  });

  it.each(PAGES)('says in %s that the application sends nothing to the site and goes online for UEX data only', (lang, page) => {
    const text = main(site.read(page));
    for (const line of texts(lang).app) expect(text).toContain(escapeHtml(line));
    expect(text).toContain('api.uexcorp.uk');
  });

  it.each(PAGES)('says in %s what the form sends, who sees it and that a message is deleted on request', (lang, page) => {
    const text = main(site.read(page));
    for (const line of texts(lang).form) expect(text).toContain(escapeHtml(line));
    // the four things of the contract a visitor gives, and the two the page adds
    const all = texts(lang).form.join(' ');
    for (const word of lang === 'ru' ? ['текст', 'контакт', 'картинки', 'файл лога', 'язык страницы', 'время'] : ['text', 'contact', 'pictures', 'log file', 'language of the page', 'time']) {
      expect(all, word).toContain(word);
    }
    expect(all).toMatch(lang === 'ru' ? /видит только автор/ : /Only the author sees/);
    expect(all).toMatch(lang === 'ru' ? /удалили/ : /deleted/);
    expect(text).toMatch(new RegExp(`<a href="${config.links.twitch}" target="_blank" rel="noopener noreferrer">`));
  });

  it.each(PAGES)('says in %s that there is no analytics while ga4Id is empty, and does not say the name of any service', (lang, page) => {
    const text = main(site.read(page));
    for (const line of texts(lang).analytics_off) expect(text).toContain(escapeHtml(line));
    for (const line of texts(lang).analytics_on) expect(text).not.toContain(escapeHtml(line));
    expect(text).not.toMatch(/google/i);
  });

  it('says what the analytics collects, and when, once a GA4 id is set', () => {
    const withAnalytics = build({ patchConfig: (settings) => void (settings.analytics.ga4Id = 'G-TEST123456') });
    for (const [lang, page] of PAGES) {
      const text = main(withAnalytics.read(page));
      for (const line of texts(lang).analytics_on) expect(text).toContain(escapeHtml(line));
      for (const line of texts(lang).analytics_off) expect(text).not.toContain(escapeHtml(line));
      const all = texts(lang).analytics_on.join(' ');
      expect(all).toContain('Google Analytics 4');
      // only after consent; what goes to Google; how to change the answer
      expect(all).toMatch(lang === 'ru' ? /только после того, как ты нажал «Разрешить»/ : /only after you click “Allow”/);
      expect(all).toMatch(/cookie/);
      expect(all).toContain((dictionaries[lang].footer as Record<string, string>).consent_change);
    }
  });

  it.each(PAGES)('has the header of the site in %s, with links back to the sections of the home page', (_lang, page, home) => {
    const header = /<header class="site-header">[\s\S]*?<\/header>/.exec(site.read(page))?.[0] ?? '';
    const homeHtml = site.read(home);
    const anchors = [...header.matchAll(/href="index\.html#([\w-]+)"/g)].map((match) => match[1]);
    expect(anchors).toEqual(expect.arrayContaining(['features', 'safety', 'download', 'feedback', 'support']));
    for (const anchor of anchors) expect(homeHtml).toMatch(new RegExp(`\\sid="${anchor}"`));
  });
});
