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
  },
  analytics: { ga4Id: '' },
  feedback: { endpoint: '/api/feedback' },
  server: { root: '/var/www/sc-trade.space', service: '127.0.0.1:8787' },
});

describe('the settings of the site (site/site.config.json)', () => {
  it('are what the user gave', () => {
    expect(loadConfig(siteDir)).toEqual(good());
  });

  it('pass the check as they are', () => {
    expect(() => validateConfig(good())).not.toThrow();
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
