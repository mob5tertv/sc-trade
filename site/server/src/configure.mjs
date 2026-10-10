// The tool setup.sh writes the settings of the service with. It is given the password of the author's page on its
// standard input and in no other way: there is no argument for it and no variable of the environment, so the
// password is never in a command line, in the history of a shell or in a list of processes. What is written is its
// hash; the password itself is printed nowhere.
//
//   printf '%s' "$password" | node src/configure.mjs --config FILE --domain HOST [--port N] --data DIR [--root DIR]
//       a new settings file; refuses to replace one that is there
//   printf '%s' "$password" | node src/configure.mjs --config FILE --reset-password
//       a new password for settings that are there; nothing else in them changes
//   node src/configure.mjs --config FILE --verify --domain HOST --port N
//       are the settings whole, and are they for this site? changes nothing, reads no password
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { loadSettings, readSettings } from './config.mjs';
import { hashPassword } from './password.mjs';

const VALUES = ['--config', '--domain', '--port', '--data', '--root'];
const FLAGS = ['--reset-password', '--verify'];

class Problem extends Error {}

/** @param {string[]} args @returns {Record<string, string | true>} */
function readArgs(args) {
  /** @type {Record<string, string | true>} */
  const options = {};
  for (let at = 0; at < args.length; at++) {
    const name = args[at];
    if (FLAGS.includes(name)) options[name] = true;
    else if (VALUES.includes(name)) {
      const value = args[++at];
      if (value === undefined || value.startsWith('--')) throw new Problem(`${name} needs a value`);
      options[name] = value;
    }
    // what it is is not said back: it may be a password typed in the wrong place
    else throw new Problem(`an argument the tool does not know (there are ${[...VALUES, ...FLAGS].join(', ')}). The password is never an argument: it is read from the standard input.`);
  }
  return options;
}

/** Everything on the standard input, without the one line break a shell may put after it. */
async function readPassword() {
  if (process.stdin.isTTY) throw new Problem('the password is read from the standard input, not typed here: setup.sh asks for it and hands it over');
  /** @type {Buffer[]} */
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 4096) throw new Problem('what came on the standard input is too long to be a password');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

/** Writes a file whole or not at all, readable by its owner only (setup.sh then lets the service read it). */
function writeWhole(/** @type {string} */ file, /** @type {string} */ text) {
  const draft = `${file}.new`;
  rmSync(draft, { force: true });
  const fd = openSync(draft, 'wx', 0o600);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(draft, file);
}

/** @param {string} file @returns {Record<string, unknown> | null} what a settings file holds; `null`: there is none */
function readExisting(file) {
  /** @type {string} */
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return null;
    throw new Problem(`${file} cannot be read (${/** @type {NodeJS.ErrnoException} */ (err).code ?? 'error'})`);
  }
  try {
    const value = JSON.parse(text);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value;
  } catch {
    throw new Problem(`${file} is not JSON: put it right by hand, or remove it and let setup.sh make it anew`);
  }
}

async function main() {
  const options = readArgs(process.argv.slice(2));
  const file = options['--config'];
  if (typeof file !== 'string') throw new Problem('--config is missing: the file of the settings');

  if (options['--verify'] === true) {
    const settings = loadSettings(file);
    const port = Number(options['--port']);
    /** @type {string[]} */
    const differs = [];
    if (options['--domain'] !== undefined && settings.domain !== options['--domain']) differs.push(`"domain" is ${settings.domain}, and the site this folder was built for is ${options['--domain']}`);
    if (options['--port'] !== undefined && settings.port !== port) differs.push(`"port" is ${settings.port}, and the web server passes requests to ${options['--port']}`);
    if (differs.length > 0) throw new Problem(`the settings ${file} are for another site:\n${differs.join('\n')}`);
    return;
  }

  const existing = readExisting(file);
  /** @type {Record<string, unknown>} */
  let next;
  if (options['--reset-password'] === true) {
    if (existing === null) throw new Problem(`${file} cannot be read (ENOENT): there are no settings to give a new password to`);
    next = { ...existing };
  } else {
    if (existing !== null) throw new Problem(`${file} is already there and is left as it is. A new password for it: --reset-password`);
    const port = options['--port'] === undefined ? 8787 : /^\d{1,5}$/.test(String(options['--port'])) ? Number(options['--port']) : options['--port'];
    // --root: the folder of the site, which the service only needs to refuse a folder of data inside it
    next = { domain: options['--domain'], port, dataDir: options['--data'], ...(options['--root'] === undefined ? {} : { siteRoot: options['--root'] }) };
  }

  // everything else is checked before the password is even read: with a hash that only stands in for the real one
  readSettings({ ...next, passwordHash: hashPassword('a stand-in, never used', { N: 16384, r: 8, p: 1 }) });
  next.passwordHash = hashPassword(await readPassword());
  readSettings(next);
  writeWhole(file, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`the settings are written: ${file}`);
}

try {
  await main();
} catch (err) {
  console.error(`configure: ${err instanceof Error ? err.message : 'failed'}`);
  process.exit(1);
}
