import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { siteDir } from '../../scripts/site/config.mjs';
import { deploy, planDeploy, readTarget } from '../../scripts/site/deploy.mjs';
import { build, projectRoot, tempDir, version, type Built } from './helpers';

const target = { host: 'server.example.test', user: 'deploy', path: '/var/www/sc-trade.space', port: 2222 };

describe('where the site is uploaded (site/deploy.local.json)', () => {
  it('is a host, a user, a folder on the server and a port', () => {
    expect(readTarget(target)).toEqual(target);
  });

  it('goes to port 22 and to the folder of the site when they are not given', () => {
    expect(readTarget({ host: '203.0.113.7', user: 'deploy' })).toEqual({ host: '203.0.113.7', user: 'deploy', path: '/var/www/sc-trade.space', port: 22 });
  });

  it('must not hold a password or a key: the upload logs in with an SSH key only', () => {
    for (const extra of [{ password: 'x' }, { pass: 'x' }, { privateKey: 'x' }, { secret: 'x' }, { token: 'x' }]) {
      expect(() => readTarget({ ...target, ...extra })).toThrow(/no password and no key/);
    }
    expect(() => readTarget({ ...target, host: 'deploy:hunter2@server.example.test' })).toThrow(/"host"/);
  });

  it('refuses anything that is not a plain name: nothing typed there may reach a command as something else', () => {
    expect(() => readTarget({ ...target, host: 'server.example.test; rm -rf /' })).toThrow(/"host"/);
    expect(() => readTarget({ ...target, host: '-oProxyCommand=calc' })).toThrow(/"host"/);
    expect(() => readTarget({ ...target, host: '' })).toThrow(/"host"/);
    expect(() => readTarget({ ...target, user: 'root; id' })).toThrow(/"user"/);
    expect(() => readTarget({ ...target, user: '-l' })).toThrow(/"user"/);
    expect(() => readTarget({ ...target, port: 70000 })).toThrow(/"port"/);
    expect(() => readTarget({ ...target, port: '22' })).toThrow(/"port"/);
    expect(() => readTarget({ ...target, colour: 'blue' })).toThrow(/"colour"/);
  });

  it('refuses a folder that is not a full path of its own on the server', () => {
    for (const path of ['www', '/', '/var', '/var/www/../../etc', '/var/www/my site', '/var/www/x"y', '~/site']) {
      expect(() => readTarget({ ...target, path }), path).toThrow(/"path"/);
    }
  });

  it('has an example in the repository that is a made-up server, and the real file is never committed', () => {
    const example = JSON.parse(readFileSync(join(siteDir, 'deploy.example.json'), 'utf8'));
    expect(readTarget(example)).toEqual({ host: 'server.example', user: 'deploy', path: '/var/www/sc-trade.space', port: 22 });
    const ignored = readFileSync(resolve(projectRoot, '.gitignore'), 'utf8').split(/\r?\n/);
    for (const line of ['site/dist/', 'site/dist-deploy/', 'site/deploy.local.json']) expect(ignored).toContain(line);
  });
});

describe('the upload', () => {
  let site: Built;
  beforeAll(() => {
    site = build();
  });

  it('is one sftp session that logs in with a key and never asks for a password', () => {
    const plan = planDeploy({ distDir: site.out, target });
    expect(plan.program).toBe('sftp');
    expect(plan.args).toEqual([
      '-b', '-',
      '-P', '2222',
      '-o', 'BatchMode=yes',
      '-o', 'PasswordAuthentication=no',
      '-o', 'KbdInteractiveAuthentication=no',
      '-o', 'PreferredAuthentications=publickey',
      '-o', 'ConnectTimeout=20',
      'deploy@server.example.test',
    ]);
  });

  it('sends every file of dist to the same place under the folder of the site, and nothing else', () => {
    const plan = planDeploy({ distDir: site.out, target });
    expect(plan.files.map((file) => file.local).sort()).toEqual(site.files);
    for (const file of plan.files) expect(file.remote).toBe(`/var/www/sc-trade.space/${file.local}`);
    expect(plan.files.find((file) => file.local === `download/SC-Trade-${version}-setup.exe`)?.bytes).toBe(site.result.installer!.size);
    const puts = plan.batch.split('\n').filter((line) => line.startsWith('put '));
    expect(puts).toHaveLength(site.files.length);
    expect(puts).toContain('put "assets/css/site.css" "/var/www/sc-trade.space/assets/css/site.css"');
    // nothing of the server's own config goes up: it is not in dist at all
    expect(plan.batch).not.toMatch(/caddy/i);
  });

  it('makes the folders first, sends the pages last, and deletes nothing on the server', () => {
    const lines = planDeploy({ distDir: site.out, target }).batch.trim().split('\n');
    const folders = lines.filter((line) => line.startsWith('-mkdir '));
    expect(folders).toEqual([
      '-mkdir "/var/www/sc-trade.space/assets"',
      '-mkdir "/var/www/sc-trade.space/download"',
      '-mkdir "/var/www/sc-trade.space/en"',
      '-mkdir "/var/www/sc-trade.space/assets/css"',
      '-mkdir "/var/www/sc-trade.space/assets/js"',
      '-mkdir "/var/www/sc-trade.space/assets/shots"',
    ]);
    expect(lines.slice(0, folders.length)).toEqual(folders);
    const puts = lines.slice(folders.length);
    const firstPage = puts.findIndex((line) => /\.html"$/.test(line));
    expect(firstPage).toBeGreaterThan(0);
    for (const line of puts.slice(firstPage)) expect(line).toMatch(/\.html"$/);
    for (const line of puts.slice(0, firstPage)) expect(line).not.toMatch(/\.html"$/);
    for (const line of lines) expect(line).toMatch(/^(-mkdir|put) "/);
    expect(lines.join('\n')).not.toMatch(/\b(rm|rmdir|rename|ln|chmod|chown|!)\b/);
  });

  it('without --yes only says what it would send: nothing is started', () => {
    const started: unknown[] = [];
    const said: string[] = [];
    const result = deploy({ distDir: site.out, target, yes: false, run: (...call) => (started.push(call), { status: 0, output: '' }), say: (line) => said.push(line) });
    expect(result.sent).toBe(false);
    expect(started).toEqual([]);
    const text = said.join('\n');
    expect(text).toContain('deploy@server.example.test, port 2222');
    expect(text).toContain('/var/www/sc-trade.space');
    expect(text).toContain('sftp -b - -P 2222 -o BatchMode=yes');
    expect(text).toContain('put "index.html" "/var/www/sc-trade.space/index.html"');
    expect(text).toMatch(new RegExp(`${site.files.length} files`));
    expect(text).toContain('dry run: nothing was sent');
    expect(text).toContain('--yes');
  });

  it('with --yes starts sftp once, in the folder of dist, with the commands on its input', () => {
    const started: Array<[string, string[], { cwd: string; input: string }]> = [];
    const plan = planDeploy({ distDir: site.out, target });
    const result = deploy({ distDir: site.out, target, yes: true, run: (...call) => (started.push(call), { status: 0, output: '' }), say: () => {} });
    expect(result.sent).toBe(true);
    expect(started).toEqual([['sftp', plan.args, { cwd: site.out, input: plan.batch }]]);
  });

  it('a dry run asked for by name stays a dry run even with --yes', () => {
    const started: unknown[] = [];
    const result = deploy({ distDir: site.out, target, yes: true, dryRun: true, run: (...call) => (started.push(call), { status: 0, output: '' }), say: () => {} });
    expect(result.sent).toBe(false);
    expect(started).toEqual([]);
  });

  it('says so when sftp fails, with what sftp said', () => {
    const run = () => ({ status: 255, output: 'deploy@server.example.test: Permission denied (publickey).' });
    expect(() => deploy({ distDir: site.out, target, yes: true, run, say: () => {} })).toThrow(/the upload failed \(sftp ended with 255\)[\s\S]*Permission denied \(publickey\)/);
  });

  it('refuses a site that was built to be looked at, without the installer', () => {
    const plain = build({ installer: null });
    expect(() => planDeploy({ distDir: plain.out, target })).toThrow(/built without the installer/);
  });

  it('refuses a site whose installer is not the file its own sum describes', () => {
    const damaged = build();
    appendFileSync(join(damaged.out, 'download', `SC-Trade-${version}-setup.exe`), 'one more byte');
    expect(() => planDeploy({ distDir: damaged.out, target })).toThrow(/does not match download\/SHA256SUMS\.txt/);
  });

  it('refuses a folder that is not a built site', () => {
    expect(() => planDeploy({ distDir: join(tempDir(), 'nothing'), target })).toThrow(/npm run site:build/);
  });
});

describe('npm run site:deploy', () => {
  const script = resolve(projectRoot, 'scripts', 'site', 'deploy.mjs');
  const runCli = (args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

  it('is a dry run when --yes is not given: it prints the plan for a made-up server and sends nothing', () => {
    const site = build();
    const config = join(tempDir(), 'deploy.local.json');
    writeFileSync(config, JSON.stringify(target));
    const run = runCli(['--config', config, '--dist', site.out]);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('deploy@server.example.test, port 2222');
    expect(run.stdout).toContain('dry run: nothing was sent');
  });

  it('says how to make the settings file when there is none', () => {
    const run = runCli(['--config', join(tempDir(), 'deploy.local.json'), '--dist', 'whatever']);
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/deploy\.local\.json does not exist[\s\S]*deploy\.example\.json/);
  });
});
