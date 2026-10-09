// The browser the scripts of the site use to look at pages: an installed Chrome (or the one PREVIEW_BROWSER names),
// headless, on a throw-away profile, and cut off from the network — a page of the site must load everything from
// the site itself, and a script that looks at it must never reach the outside by accident.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { findBrowser } from '../preview/browser.mjs';

/** Chrome in its standard places. The scripts of the preview take Edge first, and headless Edge does not start on every machine. */
export function findChrome(/** @type {Record<string, string | undefined>} */ env = process.env) {
  for (const base of [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA]) {
    if (base === undefined) continue;
    const candidate = join(base, 'Google', 'Chrome', 'Application', 'chrome.exe');
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** The browser to start: the one PREVIEW_BROWSER names, else Chrome, else whatever the preview scripts find. */
export function browserPath(/** @type {Record<string, string | undefined>} */ env = process.env) {
  return env.PREVIEW_BROWSER ? findBrowser(env) : (findChrome(env) ?? findBrowser(env));
}

/**
 * The arguments of the browser: as the preview starts it, plus a rule that makes every name but this computer
 * unknown to it, so no request can leave the machine whatever a page asks for.
 * @param {string} profile
 */
export function isolatedArguments(profile) {
  return [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-gpu',
    '--hide-scrollbars', '--force-color-profile=srgb', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--disable-default-apps', '--no-pings',
    '--autoplay-policy=no-user-gesture-required',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    'about:blank',
  ];
}
