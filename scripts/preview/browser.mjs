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

/** @param {string} profile @returns {string[]} */
const browserArguments = (profile) => [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-gpu',
  '--hide-scrollbars', '--force-color-profile=srgb', '--disable-background-networking', 'about:blank',
];

/**
 * Starts the browser. `close()` ends it and everything it started, and removes the profile.
 * The options are for the tests: where the profile is made, how long to wait for the port, other arguments.
 * @param {string} executable
 * @param {{ tempRoot?: string, startTimeoutMs?: number, args?: (profile: string) => string[] }} [options]
 */
export async function launchBrowser(executable, options = {}) {
  const startTimeoutMs = options.startTimeoutMs ?? 20_000;
  const profile = mkdtempSync(join(options.tempRoot ?? tmpdir(), 'sc-trade-preview-'));
  /** @type {import('node:child_process').ChildProcess | undefined} */
  let child;
  let exited = false;
  /** @type {Error | undefined} */
  let spawnFailure;

  /** Ends the browser, if it was started, and removes the profile. */
  const discard = async () => {
    if (child !== undefined && !exited) kill(child.pid);
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
  };

  // Everything after the profile exists is guarded: a start that fails for any reason must leave nothing behind.
  try {
    try {
      child = spawn(executable, (options.args ?? browserArguments)(profile), { stdio: 'ignore', windowsHide: true });
    } catch (err) {
      // spawn throws at once for a file that is no program, and for arguments it cannot take
      throw new Error(`cannot start the browser ${executable}: ${err instanceof Error ? err.message : err}`, { cause: err });
    }
    child.on('exit', () => { exited = true; });
    // a program that cannot be started reports it here, and an unhandled `error` event would crash this process
    child.on('error', (err) => { spawnFailure = err; });

    // With port 0 the browser picks the port and writes it, with the address of the browser endpoint, into this file.
    const portFile = join(profile, 'DevToolsActivePort');
    const deadline = Date.now() + startTimeoutMs;
    while (!existsSync(portFile)) {
      if (spawnFailure !== undefined) throw new Error(`cannot start the browser ${executable}: ${spawnFailure.message}`);
      if (exited) throw new Error(`the browser ${executable} exited before it was ready`);
      if (Date.now() > deadline) throw new Error(`the browser ${executable} did not open its debugging port in ${startTimeoutMs / 1000} s`);
      await sleep(100);
    }
    const [port, browserPath] = readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
    const started = child;

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
        if (!exited) kill(started.pid);
      }
      await discard();
    }

    return { port: Number(port), close };
  } catch (err) {
    await discard();
    throw err;
  }
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
