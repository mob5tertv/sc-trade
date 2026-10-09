// Consent for analytics: where the answer of the visitor is kept and the one address of Google the site knows.
// This file and consent.js are put on the pages only when a GA4 id is set in site/site.config.json.

/** @typedef {'granted' | 'denied'} Choice */
/** @typedef {{ getItem: (key: string) => string | null, setItem: (key: string, value: string) => void }} ChoiceStorage */

export const CONSENT_KEY = 'sc-trade.analytics';

/**
 * The answer the visitor gave before; `null`: none yet, or the browser keeps nothing (private mode).
 * @param {ChoiceStorage} storage
 * @returns {Choice | null}
 */
export function readChoice(storage) {
  try {
    const value = storage.getItem(CONSENT_KEY);
    return value === 'granted' || value === 'denied' ? value : null;
  } catch {
    return null;
  }
}

/**
 * @param {ChoiceStorage} storage
 * @param {Choice} choice
 * @returns {boolean} whether it was kept
 */
export function saveChoice(storage, choice) {
  try {
    storage.setItem(CONSENT_KEY, choice);
    return true;
  } catch {
    return false;
  }
}

/** The script of Google Analytics for an id. It is asked for only after the visitor allowed it. */
export function analyticsUrl(/** @type {string} */ id) {
  return `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
}
