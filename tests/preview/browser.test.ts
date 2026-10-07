import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { launchBrowser } from '../../scripts/preview/browser.mjs';

// The browser of `preview:shot` runs on a throw-away profile. Whatever goes wrong while it starts, the profile
// folder (`sc-trade-preview-*`) must not stay behind and the process must not stay running. Node itself plays the
// browser: it is a program that exists everywhere, refuses the browser's arguments (so it exits at once) or
// can be told to sit and do nothing.

let sandbox: string;
let tempRoot: string;

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'sc-browser-test-'));
  tempRoot = join(sandbox, 'profiles');
  // `launchBrowser` makes its profile directly in `tempRoot`
  mkdirSync(tempRoot);
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

const profiles = (): string[] => readdirSync(tempRoot).filter((name) => name.startsWith('sc-trade-preview-'));

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe('launchBrowser: nothing is left behind when the start fails', () => {
  it('the browser exits at once', async () => {
    // node does not know `--headless=new` and exits with an error
    await expect(launchBrowser(process.execPath, { tempRoot })).rejects.toThrow(/exited before it was ready/);
    expect(profiles()).toEqual([]);
  });

  it('the debugging port does not open in time, and the browser is stopped', async () => {
    const pidFile = join(sandbox, 'pid.txt');
    const sleepy = ['-e', 'require("node:fs").writeFileSync(process.argv[1], String(process.pid)); setTimeout(() => {}, 60000)', pidFile];
    await expect(
      launchBrowser(process.execPath, { tempRoot, startTimeoutMs: 1500, args: () => sleepy }),
    ).rejects.toThrow(/did not open its debugging port/);
    expect(profiles()).toEqual([]);

    expect(existsSync(pidFile)).toBe(true);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    for (let i = 0; i < 30 && alive(pid); i++) await new Promise((resolve) => setTimeout(resolve, 100));
    expect(alive(pid)).toBe(false);
  });

  it('the program does not exist (spawn reports an error)', async () => {
    const missing = join(sandbox, 'no-such-browser.exe');
    await expect(launchBrowser(missing, { tempRoot })).rejects.toThrow(/no-such-browser/);
    expect(profiles()).toEqual([]);
  });

  it('spawn throws at once (an argument it cannot take)', async () => {
    await expect(launchBrowser(process.execPath, { tempRoot, args: () => ['bad\0argument'] })).rejects.toThrow();
    expect(profiles()).toEqual([]);
  });

  it('the profile is made where it was asked to be', async () => {
    // a start that fails must still have used the folder it was given, or the checks above would prove nothing
    const seen: string[] = [];
    await expect(
      launchBrowser(process.execPath, {
        tempRoot,
        args: (profile) => {
          seen.push(profile);
          return ['-e', 'process.exit(3)'];
        },
      }),
    ).rejects.toThrow();
    expect(seen).toHaveLength(1);
    expect(seen[0].startsWith(tempRoot)).toBe(true);
    expect(existsSync(seen[0])).toBe(false);
  });
});
