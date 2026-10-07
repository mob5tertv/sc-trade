import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from './cdp.mjs';

// Finds an installed Edge or Chrome and starts it without a window, on a throw-away profile, with a debugging
// port the screenshot script can talk to. Nothing is downloaded and the profile of the user is never touched.

/** The browser to use: `PREVIEW_BROWSER`, else Edge, else Chrome, from their standard places. */
export function findBrowser(env = process.env) {
  if (env.PREVIEW_BROWSER) {
    if (!existsSync(env.PREVIEW_BROWSER)) throw new Error(`PREVIEW_BROWSER points to ${env.PREVIEW_BROWSER}, which does not exist`);
    return env.PREVIEW_BROWSER;
  }
  const programs = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean);
  const relative = [
    ['Microsoft', 'Edge', 'Application', 'msedge.exe'],
    ['Google', 'Chrome', 'Application', 'chrome.exe'],
  ];
  for (const parts of relative) {
    for (const base of programs) {
      const candidate = join(/** @type {string} */ (base), ...parts);
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error('No Edge or Chrome found in the standard places. Set PREVIEW_BROWSER to the path of msedge.exe or chrome.exe.');
}

const sleep = (/** @type {number} */ ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Starts the browser. `close()` ends it and everything it started, and removes the profile.
 * @param {string} executable
 */
export async function launchBrowser(executable) {
  const profile = mkdtempSync(join(tmpdir(), 'sc-trade-preview-'));
  const child = spawn(
    executable,
    [
      '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-gpu',
      '--hide-scrollbars', '--force-color-profile=srgb', '--disable-background-networking', 'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true },
  );
  let exited = false;
  child.once('exit', () => { exited = true; });

  // With port 0 the browser picks the port and writes it, with the address of the browser endpoint, into this file.
  const portFile = join(profile, 'DevToolsActivePort');
  const deadline = Date.now() + 20_000;
  while (!existsSync(portFile)) {
    if (exited) throw new Error(`the browser ${executable} exited before it was ready`);
    if (Date.now() > deadline) {
      kill(child.pid);
      throw new Error(`the browser ${executable} did not open its debugging port in 20 s`);
    }
    await sleep(100);
  }
  const [port, browserPath] = readFileSync(portFile, 'utf8').trim().split(/\r?\n/);

  async function close() {
    if (!exited) {
      try {
        const browser = await connect(`ws://127.0.0.1:${port}${browserPath}`);
        await Promise.race([browser.send('Browser.close').catch(() => {}), sleep(2000)]);
        browser.close();
      } catch {
        // killed below
      }
      for (let i = 0; i < 30 && !exited; i++) await sleep(100);
      if (!exited) kill(child.pid);
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
  }

  return { port: Number(port), close };
}

/** The address of the first page of the browser, to attach to. */
export async function pageSocketUrl(/** @type {number} */ port) {
  for (let i = 0; i < 50; i++) {
    const targets = /** @type {Array<{ type: string, webSocketDebuggerUrl?: string }>} */ (
      await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    );
    const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
    if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    await sleep(100);
  }
  throw new Error('the browser has no page to attach to');
}

/** Ends a process and its children (the helpers of a browser). */
function kill(/** @type {number | undefined} */ pid) {
  if (pid === undefined) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
}
