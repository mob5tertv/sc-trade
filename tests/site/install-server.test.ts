import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { siteDir } from '../../scripts/site/config.mjs';
import { npmCli } from '../../scripts/site/install-server.mjs';
import { projectRoot, tempDir } from './helpers';

// The root `npm ci` installs the two packages of the feedback service as well (the "postinstall" of package.json).
// That step must never make the root install fail: without the registry it says one clear line and lets go.

const script = resolve(projectRoot, 'scripts', 'site', 'install-server.mjs');
const serverDir = join(siteDir, 'server');

/** A stand-in for npm: writes down how it was called and ends with the code it is told to end with. */
function fakeNpm(dir: string, exitCode: number): { file: string; record: string } {
  const file = join(dir, 'fake-npm.mjs');
  const record = join(dir, 'npm-called.txt');
  writeFileSync(file, `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(record)}, process.argv.slice(2).join(' ') + '\\n');\nprocess.exit(${exitCode});\n`);
  return { file, record };
}

/** The service without what npm installed, in a folder of its own. */
function bareServer(dir: string): string {
  const copy = join(dir, 'server');
  cpSync(serverDir, copy, { recursive: true });
  rmSync(join(copy, 'node_modules'), { recursive: true, force: true });
  return copy;
}

function run(server: string, npm: string) {
  // the stand-in takes the place of the npm these tests themselves were started by (on Windows the name of that
  // variable may come in capitals, and of two names that differ in case only the first would reach the script)
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'npm_execpath'));
  const result = spawnSync(process.execPath, [script, server], { encoding: 'utf8', timeout: 30_000, env: { ...env, npm_execpath: npm } });
  return { status: result.status, out: result.stdout, err: result.stderr };
}

describe('npm ci of the project also installs the feedback service (scripts/site/install-server.mjs)', () => {
  it('is what the root package runs after its own install, and the strict command stays for a person to run', () => {
    const scripts = (JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;
    expect(scripts.postinstall).toBe('node scripts/site/install-server.mjs');
    expect(scripts['site:server:install']).toBe('npm ci --prefix site/server --omit=dev --ignore-scripts --no-audit --no-fund');
  });

  it('does nothing when the packages are there at the versions of the lock file: npm is not even started', () => {
    const dir = tempDir();
    const npm = fakeNpm(dir, 1);
    const result = run(serverDir, npm.file);
    expect(result.status).toBe(0);
    expect(existsSync(npm.record)).toBe(false);
    expect(result.err).toBe('');
  });

  it('installs them when they are missing, with the lock file and without running any script of a package', () => {
    const dir = tempDir();
    const npm = fakeNpm(dir, 0);
    const server = bareServer(dir);
    const result = run(server, npm.file);
    expect(result.status).toBe(0);
    expect(readFileSync(npm.record, 'utf8')).toBe(`ci --prefix ${server} --omit=dev --ignore-scripts --no-audit --no-fund\n`);
  });

  it('does not fail the install of the project when npm cannot reach the registry: one clear line, and the code 0', () => {
    const dir = tempDir();
    const npm = fakeNpm(dir, 1);
    const result = run(bareServer(dir), npm.file);
    expect(result.status).toBe(0);
    expect(existsSync(npm.record)).toBe(true);
    const said = `${result.out}${result.err}`.trim().split('\n').filter((line) => line.includes('site:server:install'));
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/^the feedback service of the site was NOT installed \(npm ended with 1\)\. The project itself is installed\. The tests of the service and "npm run site:build" need it: run  npm run site:server:install  when the registry can be reached\.$/);
  });

  it('starts npm without a shell: a folder with a space and an "&" in its name is one argument, never a command', () => {
    // (a shell would take what follows the "&" for a second command and print the word)
    const dir = join(tempDir(), 'my project & echo PWNED');
    mkdirSync(dir);
    const npm = fakeNpm(dir, 0);
    const server = bareServer(dir);
    const result = run(server, npm.file);
    expect(result.status).toBe(0);
    expect(readFileSync(npm.record, 'utf8')).toBe(`ci --prefix ${server} --omit=dev --ignore-scripts --no-audit --no-fund\n`);
    expect(`${result.out}${result.err}`).not.toContain('PWNED');
    // nothing in the script hands a line of text to a shell: it starts Node itself with a list of arguments
    const source = readFileSync(script, 'utf8');
    expect(source).not.toMatch(/shell\s*:|\bexec(Sync)?\(/);
    expect(source).toMatch(/spawnSync\(process\.execPath, \[cli, \.\.\.args\], \{ stdio: 'inherit' \}\)/);
  });

  it('started by hand, takes the npm that came with this very Node — and knows when there is none', () => {
    const windows = join('C:', 'Program Files', 'nodejs');
    const unix = join('/', 'usr', 'local');
    const inWindows = join(windows, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const inUnix = join(unix, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
    // under npm (the "postinstall"): the npm that is running
    expect(npmCli({ npmExecPath: join(unix, 'somewhere', 'npm-cli.js'), node: join(unix, 'bin', 'node'), exists: () => false })).toBe(join(unix, 'somewhere', 'npm-cli.js'));
    // by hand: next to Node, where each system puts it
    expect(npmCli({ npmExecPath: undefined, node: join(windows, 'node.exe'), exists: (path) => path === inWindows })).toBe(inWindows);
    expect(npmCli({ npmExecPath: undefined, node: join(unix, 'bin', 'node'), exists: (path) => path === inUnix })).toBe(inUnix);
    // what is not a script of Node is not handed to Node (another package manager may name a program there)
    expect(npmCli({ npmExecPath: join(windows, 'npm.cmd'), node: join(windows, 'node.exe'), exists: (path) => path === inWindows })).toBe(inWindows);
    expect(npmCli({ npmExecPath: undefined, node: join(unix, 'bin', 'node'), exists: () => false })).toBeNull();
    // the npm of this very run is found by it
    expect(npmCli({ npmExecPath: undefined, node: process.execPath })).toMatch(/npm-cli\.js$/);
  });

  it('installs again when what is there is not what the lock file names', () => {
    const dir = tempDir();
    const npm = fakeNpm(dir, 0);
    const server = join(dir, 'server');
    cpSync(serverDir, server, { recursive: true });
    const manifest = join(server, 'node_modules', 'busboy', 'package.json');
    writeFileSync(manifest, JSON.stringify({ ...JSON.parse(readFileSync(manifest, 'utf8')), version: '0.0.1' }));
    expect(run(server, npm.file).status).toBe(0);
    expect(existsSync(npm.record)).toBe(true);
  });
});
