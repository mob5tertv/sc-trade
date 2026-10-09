// The question about analytics on the page. Nothing of Google is on the page until the visitor presses "Allow":
// this script adds the analytics script itself, and only then. "Decline" is one press; the answer is remembered and
// can be changed by the link in the footer.
import { analyticsUrl, readChoice, saveChoice } from './consent-core.js';

function startConsent() {
  const banner = /** @type {HTMLElement | null} */ (document.querySelector('[data-consent]'));
  const id = banner?.getAttribute('data-ga4-id') ?? '';
  if (banner === null || id === '') return;
  /** @type {Record<string, any>} */
  const page = window;
  // the storage is touched only inside readChoice and saveChoice: a browser that forbids it throws on the property itself
  /** @type {import('./consent-core.js').ChoiceStorage} */
  const storage = { getItem: (key) => page.localStorage.getItem(key), setItem: (key, value) => page.localStorage.setItem(key, value) };
  let loaded = false;
  /** @type {HTMLElement | null} the link the banner was reopened from */
  let opener = null;

  const loadAnalytics = () => {
    page[`ga-disable-${id}`] = false;
    if (loaded) return;
    loaded = true;
    page.dataLayer = page.dataLayer || [];
    page.gtag = function gtag() {
      // the script of Google reads the very `arguments` objects
      page.dataLayer.push(arguments);
    };
    page.gtag('js', new Date());
    page.gtag('config', id);
    const script = document.createElement('script');
    script.async = true;
    script.src = analyticsUrl(id);
    document.head.appendChild(script);
  };

  /** For a visitor who allowed and then changed the answer: the documented off switch, and the cookies go. */
  const stopAnalytics = () => {
    page[`ga-disable-${id}`] = true;
    const names = document.cookie
      .split(';')
      .map((part) => part.split('=')[0].trim())
      .filter((name) => name === '_ga' || name.startsWith('_ga_'));
    const host = String(page.location?.hostname ?? '');
    for (const name of names) {
      document.cookie = `${name}=; path=/; max-age=0`;
      if (host !== '') document.cookie = `${name}=; path=/; domain=.${host}; max-age=0`;
    }
  };

  /** @param {import('./consent-core.js').Choice} choice */
  const answer = (choice) => {
    saveChoice(storage, choice);
    banner.hidden = true;
    if (choice === 'granted') loadAnalytics();
    else stopAnalytics();
    if (opener !== null) opener.focus();
    opener = null;
  };

  banner.querySelector('[data-consent-allow]')?.addEventListener('click', () => answer('granted'));
  banner.querySelector('[data-consent-decline]')?.addEventListener('click', () => answer('denied'));

  for (const link of /** @type {HTMLElement[]} */ (Array.from(document.querySelectorAll('[data-consent-open]')))) {
    link.hidden = false;
    link.addEventListener('click', () => {
      opener = link;
      banner.hidden = false;
      banner.setAttribute('tabindex', '-1');
      banner.focus();
    });
  }

  const choice = readChoice(storage);
  if (choice === 'granted') loadAnalytics();
  else if (choice === null) banner.hidden = false;
}

startConsent();
