// What the server needs besides the site itself, gathered for site/dist-deploy: the script that sets the server up,
// the unit of the service, the rule that keeps the log of the web server short, the name of the site, and the
// feedback service with the packages it runs on. The owner of the server copies the folder there whole and runs
// setup.sh in it (site/DEPLOY.md). Nothing here is installed on the server from the internet: the packages of the
// service travel in the folder, exactly the ones its lock file names.
//
// The folder holds no secret: the settings of the service and the hash of the password are made on the server.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';

/**
 * @typedef {{ path: string, content: Buffer }} BundleFile `path`: inside dist-deploy, with forward slashes
 */

/** The files of site/deploy that go to the server as they are. */
const DEPLOY_FILES = ['setup.sh', 'sc-trade-site.service', 'logrotate.conf'];

/** The files of the service besides its code. */
const SERVICE_FILES = ['package.json', 'package-lock.json', 'config.example.json'];

/** The kinds of file that are text: these get the line ends of Unix. Anything else is copied as the bytes it is. */
const TEXT = ['.sh', '.service', '.conf', '.mjs', '.js', '.json', '.css', '.txt', '.md'];

/** What a package carries for its own developers and never runs on: left out of the folder for the server. */
const NOT_FOR_THE_SERVER = ['test', 'tests', 'bench', 'benchmark', 'example', 'examples'];

const INSTALL = 'npm run site:server:install';

/** @param {string} dir @returns {string[]} every file under it, as paths with forward slashes, sorted */
function listFiles(dir) {
  /** @type {(folder: string, prefix: string) => string[]} */
  const walk = (folder, prefix) =>
    readdirSync(folder).flatMap((name) => (statSync(join(folder, name)).isDirectory() ? walk(join(folder, name), `${prefix}${name}/`) : [`${prefix}${name}`]));
  return walk(dir, '').sort();
}

/**
 * A file of the project as it must lie on the server. It is read as bytes, never as text: a text file loses the
 * carriage return of every Windows line end (the two bytes 0D 0A become 0A), whatever the computer it is built on;
 * a file of any other kind is not touched.
 * @param {string} file
 * @returns {Buffer}
 */
function forServer(file) {
  const bytes = readFileSync(file);
  if (!TEXT.includes(extname(file).toLowerCase())) return bytes;
  const out = Buffer.alloc(bytes.length);
  let length = 0;
  for (let at = 0; at < bytes.length; at++) {
    if (bytes[at] === 0x0d && bytes[at + 1] === 0x0a) continue;
    out[length++] = bytes[at];
  }
  return out.subarray(0, length);
}

/**
 * Reads everything the folder is made of, and checks it: the build stops here, before a single file is written,
 * when the service is not installed or when what is installed is not what its lock file names.
 * @param {{ siteDir: string, serverDir: string, domain: string, root: string, service: string }} options
 *   `service`: the address the web server passes requests to, like 127.0.0.1:8787
 * @returns {BundleFile[]}
 */
export function readServerBundle({ siteDir, serverDir, domain, root, service }) {
  /** @type {BundleFile[]} */
  const files = DEPLOY_FILES.map((name) => ({ path: name, content: forServer(join(siteDir, 'deploy', name)) }));
  files.push({
    path: 'site.conf',
    content: Buffer.from(`# The site this folder was built for (site/site.config.json). setup.sh reads it.\ndomain=${domain}\nroot=${root}\nport=${service.split(':')[1]}\n`),
  });

  for (const name of SERVICE_FILES) files.push({ path: `server/${name}`, content: forServer(join(serverDir, name)) });
  for (const name of listFiles(join(serverDir, 'src'))) files.push({ path: `server/src/${name}`, content: forServer(join(serverDir, 'src', name)) });

  // the packages the service runs on: the ones the lock file names, at the versions it names
  const lock = /** @type {{ packages: Record<string, { version?: string, dev?: boolean }> }} */ (JSON.parse(readFileSync(join(serverDir, 'package-lock.json'), 'utf8')));
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!key.startsWith('node_modules/') || entry.dev === true) continue;
    const name = key.slice('node_modules/'.length);
    const folder = join(serverDir, key);
    if (!existsSync(join(folder, 'package.json'))) {
      throw new Error(`the service of the site is not installed (${key} is missing in ${serverDir}): run ${INSTALL}`);
    }
    const installed = /** @type {{ version?: string }} */ (JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'))).version;
    if (installed !== entry.version) {
      throw new Error(`the service of the site: ${name} ${installed} is installed, and package-lock.json names ${entry.version}: run ${INSTALL}`);
    }
    // as npm put them there, byte for byte — without what only a developer of the package needs: the files whose
    // names begin with a dot, the tests, the benchmarks
    for (const file of listFiles(folder)) {
      const parts = file.split('/');
      if (parts.some((part) => part.startsWith('.')) || NOT_FOR_THE_SERVER.includes(parts[0])) continue;
      files.push({ path: `server/${key}/${file}`, content: readFileSync(join(folder, file)) });
    }
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/**
 * @param {string} deployDir the folder to write into (it is there, and holds only what this build put there)
 * @param {BundleFile[]} files
 */
export function writeServerBundle(deployDir, files) {
  for (const file of files) {
    mkdirSync(dirname(join(deployDir, file.path)), { recursive: true });
    writeFileSync(join(deployDir, file.path), file.content);
  }
}
