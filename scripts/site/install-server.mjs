// The "postinstall" of the project: after `npm ci` in the root, installs the two packages the feedback service of
// the site runs on (site/server/node_modules), from the lock file of the service and without running any script of
// a package.
//
// It never makes the install of the project fail. When the packages are there already, at the versions the lock
// file names, it does nothing — npm is not started. When npm cannot install them (the registry cannot be reached),
// it says so in one line and ends well: the project itself is installed, and the tests of the service and
// `npm run site:build` will name the command to run later —
//
//   npm run site:server:install       the same install, strict: it fails when npm fails
//
//   node scripts/site/install-server.mjs [the folder of the service]
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteDir } from './config.mjs';

/**
 * Are the packages of the service installed, each at the version its lock file names?
 * @param {string} serverDir
 * @returns {boolean}
 */
export function isInstalled(serverDir) {
  try {
    const lock = /** @type {{ packages: Record<string, { version?: string, dev?: boolean }> }} */ (JSON.parse(readFileSync(join(serverDir, 'package-lock.json'), 'utf8')));
    return Object.entries(lock.packages)
      .filter(([key, entry]) => key.startsWith('node_modules/') && entry.dev !== true)
      .every(([key, entry]) => {
        const manifest = join(serverDir, key, 'package.json');
        return existsSync(manifest) && /** @type {{ version?: string }} */ (JSON.parse(readFileSync(manifest, 'utf8'))).version === entry.version;
      });
  } catch {
    return false;
  }
}

/**
 * The file of npm that Node is to run. npm is never started through a command line of the system — a folder of the
 * project with a space or an "&" in its name would then be read as part of a command: it is Node itself that is
 * started, with this file and a list of arguments.
 * @param {{ npmExecPath: string | undefined, node: string, exists?: (path: string) => boolean }} where `npmExecPath`:
 *   what npm says of itself while it runs a script (npm_execpath); `node`: the Node that runs this
 * @returns {string | null} `null`: no npm was found
 */
export function npmCli({ npmExecPath, node, exists = existsSync }) {
  // under npm: the very npm this install is running under (when it is a script of Node — another package manager
  // may name a program of its own there)
  if (npmExecPath !== undefined && /\.[cm]?js$/.test(npmExecPath)) return npmExecPath;
  // started by hand: the npm that came with this Node — next to it on Windows, under ../lib elsewhere
  const home = dirname(node);
  const places = [join(home, 'node_modules', 'npm', 'bin', 'npm-cli.js'), join(home, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  return places.find((place) => exists(place)) ?? null;
}

function main() {
  const serverDir = resolve(process.argv[2] ?? join(siteDir, 'server'));
  if (isInstalled(serverDir)) return;
  const args = ['ci', '--prefix', serverDir, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'];
  const cli = npmCli({ npmExecPath: process.env.npm_execpath, node: process.execPath });
  const run = cli === null ? null : spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit' });
  if (run?.status === 0) return;
  const why = run === null ? 'npm was not found next to Node' : `npm ended with ${run.status ?? run.error?.message ?? 'no code'}`;
  console.error(
    `the feedback service of the site was NOT installed (${why}). The project itself is installed. The tests of the service and "npm run site:build" need it: run  npm run site:server:install  when the registry can be reached.`,
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
