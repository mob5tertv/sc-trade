import { runInNewContext } from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadDictionaries, siteDir } from '../../scripts/site/config.mjs';
import { analyticsUrl, CONSENT_KEY, readChoice, saveChoice } from '../../site/js/consent-core.js';
import { build, isText, type Built } from './helpers';

const GA4_ID = 'G-TEST123456';
/** An address or a script of Google; the pages may say the name of the service in plain words. */
const GOOGLE = /googletagmanager|google-analytics|analytics\.google|google\.com|doubleclick|gstatic|gtag/i;
const dictionaries = loadDictionaries(siteDir);

const withAnalytics = () => build({ patchConfig: (settings) => void (settings.analytics.ga4Id = GA4_ID) });

describe('the choice about analytics', () => {
  const storage = (initial: Record<string, string> = {}) => {
    const values = new Map(Object.entries(initial));
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value), values };
  };
  const broken = {
    getItem: () => {
      throw new Error('storage is off');
    },
    setItem: () => {
      throw new Error('storage is off');
    },
  };

  it('is nothing until the visitor answers', () => {
    expect(readChoice(storage())).toBeNull();
  });

  it('is kept as "granted" or "denied", and anything else in its place is no answer', () => {
    const kept = storage();
    expect(saveChoice(kept, 'granted')).toBe(true);
    expect(kept.values.get(CONSENT_KEY)).toBe('granted');
    expect(readChoice(kept)).toBe('granted');
    saveChoice(kept, 'denied');
    expect(readChoice(kept)).toBe('denied');
    expect(readChoice(storage({ [CONSENT_KEY]: 'yes' }))).toBeNull();
  });

  it('is no answer when the browser has no storage, and nothing breaks', () => {
    expect(readChoice(broken)).toBeNull();
    expect(saveChoice(broken, 'granted')).toBe(false);
  });

  it('names the address of the analytics script for an id', () => {
    expect(analyticsUrl(GA4_ID)).toBe(`https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`);
  });
});

describe('the site with a GA4 id', () => {
  let site: Built;
  beforeAll(() => {
    site = withAnalytics();
  });

  it('has a banner on every page, hidden until the script decides, with the two answers side by side and alike', () => {
    for (const [lang, page] of [['ru', 'index.html'], ['en', 'en/index.html'], ['ru', 'data.html'], ['en', 'en/data.html']] as const) {
      const html = site.read(page);
      const banner = /<section class="consent"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
      const texts = dictionaries[lang].consent as Record<string, string>;
      expect(banner, page).toMatch(/<section class="consent"[^>]*\sdata-consent[^>]*\shidden/);
      expect(banner).toContain(`data-ga4-id="${GA4_ID}"`);
      expect(banner).toContain(texts.text);
      const buttons = [...banner.matchAll(/<button class="([^"]+)" type="button" (data-consent-(?:allow|decline))>([^<]+)<\/button>/g)];
      expect(buttons.map((match) => [match[2], match[3]])).toEqual([
        ['data-consent-allow', texts.allow],
        ['data-consent-decline', texts.decline],
      ]);
      // the same classes: the refusal is drawn exactly like the consent
      expect(buttons[0][1]).toBe(buttons[1][1]);
      // and they stand next to each other, nothing between them
      expect(banner).toMatch(/<\/button>\s*<button[^>]*data-consent-decline/);
      expect(html).toMatch(/<script defer src="[^"]*assets\/js\/consent\.js[^"]*"><\/script>/);
      expect(/<footer[\s\S]*<\/footer>/.exec(html)?.[0]).toMatch(/<button[^>]*data-consent-open[^>]*hidden[^>]*>/);
    }
  });

  it('names Google only in the consent script and in the config of the web server', () => {
    expect(site.read('assets/js/consent.js')).toContain('https://www.googletagmanager.com/gtag/js?id=');
    expect(site.caddyfile).toContain('https://*.googletagmanager.com');
    for (const file of site.files.filter(isText)) {
      if (file === 'assets/js/consent.js') continue;
      expect(site.read(file), file).not.toMatch(GOOGLE);
    }
  });

  it('has no Google script in the HTML: the consent script adds it, and only after "Allow"', () => {
    for (const file of site.files.filter((name) => name.endsWith('.html'))) {
      for (const tag of site.read(file).matchAll(/<script\b[^>]*>/g)) expect(tag[0], file).toMatch(/src="[^"]*assets\/js\/(site|consent)\.js/);
    }
  });
});

/** The few things of a browser the consent script touches, enough to run the built script and watch what it does. */
function fakeBrowser(options: { stored?: string; storage?: 'broken'; cookies?: string } = {}) {
  type Handler = (event: { preventDefault: () => void }) => void;
  let focused: unknown = null;
  const element = (attributes: Record<string, string> = {}, children: Record<string, unknown> = {}) => {
    const handlers: Handler[] = [];
    const node = {
      hidden: true,
      src: '',
      async: false,
      getAttribute: (name: string) => attributes[name] ?? null,
      setAttribute: (name: string, value: string) => void (attributes[name] = value),
      addEventListener: (type: string, handler: Handler) => void (type === 'click' && handlers.push(handler)),
      querySelector: (selector: string) => children[selector] ?? null,
      focus: () => void (focused = node),
      click: () => handlers.forEach((handler) => handler({ preventDefault: () => {} })),
    };
    return node;
  };
  const allow = element();
  const decline = element();
  const banner = element({ 'data-ga4-id': GA4_ID }, { '[data-consent-allow]': allow, '[data-consent-decline]': decline });
  const change = element();
  const values = new Map<string, string>(options.stored === undefined ? [] : [[CONSENT_KEY, options.stored]]);
  const added: Array<{ src: string; async: boolean }> = [];
  const cookieWrites: string[] = [];
  const localStorage =
    options.storage === 'broken'
      ? {
          getItem: () => {
            throw new Error('off');
          },
          setItem: () => {
            throw new Error('off');
          },
        }
      : { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) };
  const document = {
    querySelector: (selector: string) => (selector === '[data-consent]' ? banner : null),
    querySelectorAll: (selector: string) => (selector === '[data-consent-open]' ? [change] : []),
    createElement: () => element(),
    head: { appendChild: (node: { src: string; async: boolean }) => void added.push(node) },
    get cookie() {
      return options.cookies ?? '';
    },
    set cookie(value: string) {
      cookieWrites.push(value);
    },
  };
  const window: Record<string, unknown> = { localStorage, location: { hostname: 'sc-trade.space' } };
  return { window, document, banner, allow, decline, change, added, values, cookieWrites, focused: () => focused };
}

describe('the consent script, run as the browser runs it', () => {
  let script: string;
  beforeAll(() => {
    script = withAnalytics().read('assets/js/consent.js');
  });
  const run = (browser: ReturnType<typeof fakeBrowser>) => {
    runInNewContext(script, { window: browser.window, document: browser.document, Date, Array, String, Object });
    return browser;
  };
  const calls = (browser: ReturnType<typeof fakeBrowser>) => ((browser.window.dataLayer as ArrayLike<unknown>[] | undefined) ?? []).map((entry) => Array.from(entry));

  it('asks a visitor who has not answered, and loads nothing meanwhile', () => {
    const browser = run(fakeBrowser());
    expect(browser.banner.hidden).toBe(false);
    expect(browser.added).toEqual([]);
    expect(browser.window.dataLayer).toBeUndefined();
    expect(browser.change.hidden).toBe(false);
  });

  it('loads the script of Google only after "Allow", once, and remembers the answer', () => {
    const browser = run(fakeBrowser());
    browser.allow.click();
    expect(browser.banner.hidden).toBe(true);
    expect(browser.values.get(CONSENT_KEY)).toBe('granted');
    expect(browser.added.map((node) => node.src)).toEqual([`https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`]);
    expect(browser.added[0].async).toBe(true);
    expect(calls(browser).map((entry) => entry[0])).toEqual(['js', 'config']);
    expect(calls(browser)[1][1]).toBe(GA4_ID);
    browser.allow.click();
    expect(browser.added).toHaveLength(1);
  });

  it('loads nothing after "Decline", in one click, and remembers the answer', () => {
    const browser = run(fakeBrowser());
    browser.decline.click();
    expect(browser.banner.hidden).toBe(true);
    expect(browser.values.get(CONSENT_KEY)).toBe('denied');
    expect(browser.added).toEqual([]);
    expect(browser.window.dataLayer).toBeUndefined();
  });

  it('does not ask again: a visitor who declined sees no banner and gets no script', () => {
    const browser = run(fakeBrowser({ stored: 'denied' }));
    expect(browser.banner.hidden).toBe(true);
    expect(browser.added).toEqual([]);
  });

  it('loads the script at once for a visitor who allowed it before', () => {
    const browser = run(fakeBrowser({ stored: 'granted' }));
    expect(browser.banner.hidden).toBe(true);
    expect(browser.added).toHaveLength(1);
  });

  it('shows the question again by the link of the footer, and gives the focus back to the link after the answer', () => {
    const browser = run(fakeBrowser({ stored: 'denied' }));
    browser.change.click();
    expect(browser.banner.hidden).toBe(false);
    expect(browser.focused()).toBe(browser.banner);
    browser.allow.click();
    expect(browser.values.get(CONSENT_KEY)).toBe('granted');
    expect(browser.added).toHaveLength(1);
    expect(browser.focused()).toBe(browser.change);
  });

  it('stops the analytics when a visitor who allowed it changes the answer: the switch of Google is set and its cookies are removed', () => {
    const browser = run(fakeBrowser({ stored: 'granted', cookies: '_ga=GA1.1.1; theme=dark; _ga_TEST123456=GS1.1.2' }));
    browser.change.click();
    browser.decline.click();
    expect(browser.values.get(CONSENT_KEY)).toBe('denied');
    expect(browser.window[`ga-disable-${GA4_ID}`]).toBe(true);
    const removed = browser.cookieWrites.map((write) => write.split('=')[0]);
    expect(new Set(removed)).toEqual(new Set(['_ga', '_ga_TEST123456']));
    for (const write of browser.cookieWrites) expect(write).toMatch(/max-age=0/i);
  });

  it('works in a browser without storage: it asks on every page and obeys the answer for that page', () => {
    const browser = run(fakeBrowser({ storage: 'broken' }));
    expect(browser.banner.hidden).toBe(false);
    browser.decline.click();
    expect(browser.added).toEqual([]);
    const second = run(fakeBrowser({ storage: 'broken' }));
    second.allow.click();
    expect(second.added).toHaveLength(1);
  });
});
