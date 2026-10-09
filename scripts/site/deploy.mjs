// `npm run site:deploy`: uploads the built site (site/dist) to the server over SSH, into the folder of the site.
//
//   npm run site:deploy                 a dry run: says what would be sent and where, sends nothing
//   npm run site:deploy -- --yes        uploads
//   npm run site:deploy -- --dry-run    a dry run whatever else is given
//
// Where to: site/deploy.local.json (host, user, path, port) — a file of this computer only, never committed; its
// example is site/deploy.example.json. The login is with an SSH key and nothing else: no password is asked for,
// read or kept anywhere (BatchMode). The upload only makes folders and puts files: it deletes nothing on the server
// and sets nothing up there (the web server and its config are the business of site/DEPLOY.md).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { siteDir } from './config.mjs';

/**
 * @typedef {{ host: string, user: string, path: string, port: number }} Target
 * @typedef {{ local: string, remote: string, bytes: number }} PlannedFile `local` is the path inside dist, with forward slashes
 * @typedef {{ program: 'sftp', args: string[], batch: string, files: PlannedFile[], folders: string[], bytes: number }} Plan
 * @typedef {(program: string, args: string[], options: { cwd: string, input: string }) => { status: number | null, output: string }} Run
 */

const DEFAULT_PATH = '/var/www/sc-trade.space';

/**
 * The settings of the upload, checked. Every value ends up in a command line or in a command of sftp, so each must
 * be a plain name and nothing more.
 * @param {unknown} value what deploy.local.json holds
 * @returns {Target}
 */
export function readTarget(value) {
  const fail = (/** @type {string} */ message) => new Error(`deploy.local.json: ${message}`);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw fail('it must be an object with "host", "user", "path" and "port"');
  const settings = /** @type {Record<string, unknown>} */ (value);
  for (const key of Object.keys(settings)) {
    if (/pass|secret|key|token/i.test(key)) throw fail(`"${key}" does not belong here: the file holds no password and no key, the upload logs in with your SSH key`);
    if (!['host', 'user', 'path', 'port'].includes(key)) throw fail(`"${key}" is not a setting of the upload (there are "host", "user", "path", "port")`);
  }
  const { host, user, path = DEFAULT_PATH, port = 22 } = settings;
  // `user@host` of sftp cannot carry an IPv6 address (its colons are read as something else): better a clear refusal
  // here than a failure of sftp that does not say why
  if (typeof host === 'string' && /^\[?[0-9A-Fa-f]*:[0-9A-Fa-f:.]*(%[\w.-]+)?\]?$/.test(host)) {
    throw fail(`"host" is an IPv6 address (${host}), and the upload cannot use one: put the host name of the server or its IPv4 address there`);
  }
  if (typeof host !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(host)) {
    throw fail('"host" must be the name of the server or its IPv4 address, like server.example or 203.0.113.7');
  }
  if (typeof user !== 'string' || !/^[a-z_][a-z0-9_-]{0,31}$/.test(user)) throw fail('"user" must be a user name of the server, like deploy');
  if (typeof path !== 'string' || !/^(\/[A-Za-z0-9._-]+){2,}$/.test(path) || path.split('/').includes('..')) {
    throw fail(`"path" must be the full path of the folder of the site on the server, like ${DEFAULT_PATH}`);
  }
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) throw fail('"port" must be a number from 1 to 65535 (22 unless the server says otherwise)');
  return { host, user, path, port };
}

/** @param {string} dir @returns {string[]} every file under it, as paths with forward slashes, sorted */
function listFiles(dir) {
  /** @type {(folder: string) => string[]} */
  const walk = (folder) =>
    readdirSync(folder).flatMap((name) => {
      const path = join(folder, name);
      return statSync(path).isDirectory() ? walk(path) : [relative(dir, path).replaceAll('\\', '/')];
    });
  return walk(dir).sort();
}

/**
 * What an upload of `distDir` to `target` is: the sftp command and the commands it is given. Nothing is started here.
 * A site that is not fit to be published is refused: one built without the installer, or one whose installer is not
 * the file its own sum describes.
 * @param {{ distDir: string, target: Target }} options
 * @returns {Plan}
 */
export function planDeploy({ distDir, target }) {
  const dist = resolve(distDir);
  if (!existsSync(join(dist, 'index.html'))) throw new Error(`${dist} is not a built site: run npm run site:build -- --installer <file> first`);
  const names = listFiles(dist);
  const odd = names.find((name) => !/^[A-Za-z0-9._/-]+$/.test(name));
  if (odd !== undefined) throw new Error(`the file "${odd}" of the site has a name the upload does not take (letters, digits, ".", "-", "_" only)`);

  const sums = names.includes('download/SHA256SUMS.txt') ? readFileSync(join(dist, 'download/SHA256SUMS.txt'), 'utf8').trim() : '';
  const [sum, installer] = sums.split(/\s+/);
  if (sum === undefined || installer === undefined || !names.includes(`download/${installer}`)) {
    throw new Error(`${dist} was built without the installer (a page to look at): build it with npm run site:build -- --installer <file> before uploading`);
  }
  if (createHash('sha256').update(readFileSync(join(dist, 'download', installer))).digest('hex') !== sum) {
    throw new Error(`download/${installer} does not match download/SHA256SUMS.txt: build the site again`);
  }

  const files = names.map((local) => ({ local, remote: `${target.path}/${local}`, bytes: statSync(join(dist, local)).size }));
  const folders = [...new Set(names.flatMap((name) => name.split('/').slice(0, -1).map((_, depth, parts) => parts.slice(0, depth + 1).join('/'))))].sort(
    (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b),
  );
  // the pages go last: while the upload runs, no page on the server names a file that has not arrived yet
  const isPage = (/** @type {PlannedFile} */ file) => file.local.endsWith('.html');
  const ordered = [...files.filter((file) => !isPage(file)), ...files.filter(isPage)];
  const batch = [
    // "-" in front: a folder that is already there is not an error
    ...folders.map((folder) => `-mkdir "${target.path}/${folder}"`),
    ...ordered.map((file) => `put "${file.local}" "${file.remote}"`),
  ].join('\n');

  return {
    program: 'sftp',
    args: [
      '-b', '-', // the commands come on the input
      '-P', String(target.port),
      '-o', 'BatchMode=yes', // never ask for anything: a key that is not accepted is a failure, not a question
      '-o', 'PasswordAuthentication=no',
      '-o', 'KbdInteractiveAuthentication=no',
      '-o', 'PreferredAuthentications=publickey',
      '-o', 'ConnectTimeout=20',
      `${target.user}@${target.host}`,
    ],
    batch: `${batch}\n`,
    files: ordered,
    folders,
    bytes: files.reduce((total, file) => total + file.bytes, 0),
  };
}

/** @type {Run} */
const runProgram = (program, args, options) => {
  const result = spawnSync(program, args, { cwd: options.cwd, input: options.input, encoding: 'utf8', windowsHide: true });
  if (result.error) return { status: null, output: `${program} could not be started: ${result.error.message}` };
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

/**
 * Says what the upload is and, with `yes` and without `dryRun`, does it.
 * @param {{ distDir: string, target: Target, yes: boolean, dryRun?: boolean, run?: Run, say?: (line: string) => void }} options
 * @returns {{ sent: boolean, plan: Plan }}
 */
export function deploy({ distDir, target, yes, dryRun = false, run = runProgram, say = console.log }) {
  const plan = planDeploy({ distDir, target });
  const megabytes = (plan.bytes / 1024 / 1024).toFixed(1);
  say(`to: ${target.user}@${target.host}, port ${target.port}, folder ${target.path}`);
  say(`with: ${plan.program} ${plan.args.join(' ')}`);
  for (const line of plan.batch.trim().split('\n')) say(`  ${line}`);
  say(`${plan.files.length} files, ${megabytes} MB; nothing is deleted on the server`);

  if (!yes || dryRun) {
    say('dry run: nothing was sent. To upload, run it again with --yes (npm run site:deploy -- --yes)');
    return { sent: false, plan };
  }
  const result = run(plan.program, plan.args, { cwd: resolve(distDir), input: plan.batch });
  if (result.status !== 0) throw new Error(`the upload failed (sftp ended with ${result.status}); what it said:\n${result.output.trim()}`);
  say(`uploaded: ${plan.files.length} files`);
  return { sent: true, plan };
}

function main() {
  const { values } = parseArgs({
    options: { yes: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, config: { type: 'string' }, dist: { type: 'string' }, help: { type: 'boolean' } },
  });
  if (values.help) return console.log('usage: npm run site:deploy [-- --yes] [--dry-run] [--config <file>] [--dist <folder>]\nwithout --yes it only says what would be sent');
  const config = resolve(values.config ?? join(siteDir, 'deploy.local.json'));
  if (!existsSync(config)) {
    throw new Error(`${config} does not exist: copy site/deploy.example.json to site/deploy.local.json and put your server in it (site/DEPLOY.md says how)`);
  }
  /** @type {unknown} */
  let settings;
  try {
    settings = JSON.parse(readFileSync(config, 'utf8'));
  } catch (err) {
    throw new Error(`${config} is not JSON: ${err instanceof Error ? err.message : err}`, { cause: err });
  }
  deploy({ distDir: values.dist ?? join(siteDir, 'dist'), target: readTarget(settings), yes: values.yes === true, dryRun: values['dry-run'] === true });
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
