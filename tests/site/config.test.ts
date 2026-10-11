import { describe, expect, it } from 'vitest';
import { compareDictionaries, loadConfig, loadDictionaries, siteDir, validateConfig } from '../../scripts/site/config.mjs';

const good = () => ({
  author: 'mob5ter',
  year: 2026,
  domain: 'sc-trade.space',
  links: {
    twitch: 'https://www.twitch.tv/mob5tertv',
    boosty: 'https://boosty.to/mob5ter',
    donationalerts: 'https://www.donationalerts.com/r/mob5tertv',
    uex: 'https://uexcorp.space/',
    github: 'https://github.com/mob5tertv/sc-trade',
  },
  analytics: { ga4Id: '' },
  feedback: { endpoint: '/api/feedback' },
  server: { root: '/var/www/sc-trade.space', service: '127.0.0.1:8787' },
});

describe('the settings of the site (site/site.config.json)', () => {
  it('are what the user gave: the author, the year, the domain, the links, the address of the form, the server', () => {
    // the id of the analytics is the user's to fill in, and later tasks add keys of their own: neither is pinned here
    const { analytics: _analytics, ...given } = good();
    expect(loadConfig(siteDir)).toMatchObject(given);
    expect(loadConfig(siteDir).analytics.ga4Id).toMatch(/^(G-[A-Z0-9]{4,20})?$/);
  });

  it('pass the check as they are', () => {
    expect(() => validateConfig(good())).not.toThrow();
  });

  it('pass the check with keys this build does not know (a later task adds its own)', () => {
    const more = { ...good(), feedback: { endpoint: '/api/feedback', maxMessages: 5 }, admin: { path: '/admin/' } };
    expect(() => validateConfig(more)).not.toThrow();
  });

  it('fail with a clear phrase when the author is empty', () => {
    expect(() => validateConfig({ ...good(), author: ' ' })).toThrow('site.config.json: the author is empty');
  });

  it('fail with a clear phrase when the Twitch link is empty', () => {
    const config = good();
    config.links.twitch = '';
    expect(() => validateConfig(config)).toThrow('site.config.json: the Twitch link is empty');
  });

  it('take only https links', () => {
    const config = good();
    config.links.boosty = 'http://boosty.to/mob5ter';
    expect(() => validateConfig(config)).toThrow(/links\.boosty.*https/);
  });

  it('ask for the link to the source code as for every other link: it is there, and it is an https address', () => {
    const without = good() as { links: Record<string, string> };
    delete without.links.github;
    expect(() => validateConfig(without)).toThrow('site.config.json: "links.github" must be an https:// address');
    for (const link of ['', ' ', 'http://github.com/mob5tertv/sc-trade', 'github.com/mob5tertv/sc-trade', 'https://github.com/mob5tertv/sc-trade"><script>']) {
      const config = good();
      config.links.github = link;
      expect(() => validateConfig(config), `"${link}"`).toThrow('site.config.json: "links.github" must be an https:// address');
    }
  });

  it('take an empty GA4 id or one that looks like G-XXXXXXX, nothing else', () => {
    expect(() => validateConfig({ ...good(), analytics: { ga4Id: 'G-AB12CD34EF' } })).not.toThrow();
    expect(() => validateConfig({ ...good(), analytics: { ga4Id: 'UA-1-1' } })).toThrow(/ga4Id/);
    expect(() => validateConfig({ ...good(), analytics: { ga4Id: 'G-1"><script>' } })).toThrow(/ga4Id/);
  });

  it('take a domain that is a host name, a year that is a year, an endpoint that is a path of the site', () => {
    expect(() => validateConfig({ ...good(), domain: 'https://sc-trade.space' })).toThrow(/domain/);
    expect(() => validateConfig({ ...good(), year: 26 })).toThrow(/year/);
    expect(() => validateConfig({ ...good(), feedback: { endpoint: 'https://elsewhere.test/api' } })).toThrow(/feedback\.endpoint/);
    expect(() => validateConfig({ ...good(), server: { root: 'www', service: '127.0.0.1:8787' } })).toThrow(/server\.root/);
    // a folder of its own, two levels deep at the least: the site is never put into a folder that holds half the system
    // …and with no step that is "." or "..": what such a path names is not what it says
    for (const root of ['/', '/var', '/srv', '/var/', '/var/www/../etc', '/var/www/my site', '/var/./www', '/./var/www', '/var/www/.', '/var/www/..', '/../var/www']) {
      expect(() => validateConfig({ ...good(), server: { root, service: '127.0.0.1:8787' } }), root).toThrow(/"server\.root" must be a full path of two levels or more/);
    }
    expect(() => validateConfig({ ...good(), server: { root: '/srv/site', service: '127.0.0.1:8787' } })).not.toThrow();
    // a name that merely begins with a dot is a name
    expect(() => validateConfig({ ...good(), server: { root: '/srv/.site', service: '127.0.0.1:8787' } })).not.toThrow();
    expect(() => validateConfig({ ...good(), server: { root: '/var/www/sc-trade.space', service: 'example.test:80' } })).toThrow(/server\.service/);
  });
});

describe('the two dictionaries', () => {
  it('have the same set of keys', () => {
    const { ru, en } = loadDictionaries(siteDir);
    expect(compareDictionaries({ ru, en })).toEqual([]);
  });

  it('name every key that only one of them has', () => {
    const ru = { a: 'а', list: ['1', '2'], deep: { x: 'х', y: 'у' } };
    const en = { a: 'a', list: ['1'], deep: { x: 'x', z: 'z' } };
    expect(compareDictionaries({ ru, en })).toEqual(['only in ru.json: deep.y', 'only in ru.json: list.1', 'only in en.json: deep.z']);
  });

  it('name a key that is a text in one and a group in the other, and an empty text', () => {
    expect(compareDictionaries({ ru: { a: 'а', b: '' }, en: { a: { x: 'x' }, b: 'b' } })).toEqual([
      'only in ru.json: a',
      'empty in ru.json: b',
      'only in en.json: a.x',
    ]);
  });

  it('have no empty text and nothing but texts', () => {
    const { ru, en } = loadDictionaries(siteDir);
    const leaves = (value: unknown): unknown[] => (value !== null && typeof value === 'object' ? Object.values(value).flatMap(leaves) : [value]);
    for (const leaf of [...leaves(ru), ...leaves(en)]) {
      expect(typeof leaf).toBe('string');
      expect(String(leaf).trim()).not.toBe('');
    }
  });
});
