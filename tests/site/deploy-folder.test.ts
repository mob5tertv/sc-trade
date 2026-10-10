import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { cpSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildSite } from '../../scripts/site/build.mjs';
import { loadConfig, siteDir } from '../../scripts/site/config.mjs';
import { build, fakeInstaller, isText, listFiles, tempDir, version, type Built } from './helpers';

// site/dist-deploy: everything the server needs besides the site itself, as one folder the owner copies to the
// server and runs setup.sh in. It is never part of site/dist and is not touched by the upload of the site.

const config = loadConfig(siteDir);
const serverDir = join(siteDir, 'server');
const lock = JSON.parse(readFileSync(join(serverDir, 'package-lock.json'), 'utf8')) as { packages: Record<string, { version: string }> };

const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill();
});

describe('the folder for the server (site/dist-deploy)', () => {
  let site: Built;
  let files: string[];
  beforeAll(() => {
    site = build();
    files = listFiles(site.deploy);
  });

  it('holds the Caddyfile, setup.sh, the unit of the service, the rule for the log, the name of the site and the service itself', () => {
    expect(files.filter((file) => !file.startsWith('server/'))).toEqual(['Caddyfile', 'logrotate.conf', 'sc-trade-site.service', 'setup.sh', 'site.conf']);
    expect(files.filter((file) => file.startsWith('server/') && !file.startsWith('server/node_modules/'))).toEqual(
      ['server/config.example.json', 'server/package-lock.json', 'server/package.json', ...listFiles(join(serverDir, 'src')).map((file) => `server/src/${file}`)].sort(),
    );
    for (const needed of ['server/src/main.mjs', 'server/src/configure.mjs', 'server/src/assets/admin.css']) expect(files).toContain(needed);
    expect(site.result.deploy).toEqual(files);
  });

  it('carries what the service needs to run, exactly as the lock file names it: nothing is installed on the server', () => {
    const modules = [...new Set(files.filter((file) => file.startsWith('server/node_modules/')).map((file) => file.split('/')[2]))];
    expect(modules).toEqual(['busboy', 'streamsearch']);
    for (const name of modules) {
      const installed = JSON.parse(readFileSync(join(site.deploy, 'server', 'node_modules', name, 'package.json'), 'utf8'));
      expect(installed.version).toBe(lock.packages[`node_modules/${name}`].version);
      expect(installed.scripts?.install ?? installed.scripts?.postinstall ?? installed.scripts?.preinstall).toBeUndefined();
    }
    expect(files).toContain('server/node_modules/busboy/lib/index.js');
    expect(files).toContain('server/node_modules/busboy/LICENSE');
    // the files are the ones npm installed, byte for byte
    for (const file of files.filter((name) => name.startsWith('server/node_modules/'))) {
      expect(readFileSync(join(site.deploy, file)).equals(readFileSync(join(siteDir, file))), file).toBe(true);
    }
    // nothing of npm's own bookkeeping, nothing that only a developer of a package needs: its tests, its benchmarks
    expect(files.filter((file) => /\.package-lock\.json$|\/\.bin\/|\/\.github\/|\.eslintrc/.test(file))).toEqual([]);
    expect(files.filter((file) => /^server\/node_modules\/[^/]+\/(test|tests|bench|benchmark|example|examples)\//.test(file))).toEqual([]);
    // what is left is what the packages run on, and what says whose they are
    expect(files.filter((file) => file.startsWith('server/node_modules/'))).toEqual([
      'server/node_modules/busboy/LICENSE',
      'server/node_modules/busboy/README.md',
      'server/node_modules/busboy/lib/index.js',
      'server/node_modules/busboy/lib/types/multipart.js',
      'server/node_modules/busboy/lib/types/urlencoded.js',
      'server/node_modules/busboy/lib/utils.js',
      'server/node_modules/busboy/package.json',
      'server/node_modules/streamsearch/LICENSE',
      'server/node_modules/streamsearch/README.md',
      'server/node_modules/streamsearch/lib/sbmh.js',
      'server/node_modules/streamsearch/package.json',
    ]);
  });

  it('copies every file as the bytes it is: a text gets Unix line ends, anything else is not touched', () => {
    const dir = tempDir();
    const copy = join(dir, 'server');
    cpSync(serverDir, copy, { recursive: true });
    // a file that is not text, with bytes that are no UTF-8 and with the two bytes of a Windows line end in it
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0xc3, 0x28, 0x0d, 0x0a, 0x80]);
    writeFileSync(join(copy, 'src', 'assets', 'pixel.png'), binary);
    // and a text of the code that was checked out on Windows
    writeFileSync(join(copy, 'src', 'windows.mjs'), '// one\r\n// two\r\n');
    const out = join(dir, 'dist-deploy');
    buildSite({ version, outDir: join(dir, 'dist'), deployDir: out, installer: null, serverDir: copy });
    expect(readFileSync(join(out, 'server', 'src', 'assets', 'pixel.png')).equals(binary)).toBe(true);
    expect(readFileSync(join(out, 'server', 'src', 'windows.mjs'), 'utf8')).toBe('// one\n// two\n');
    expect(readFileSync(join(out, 'server', 'src', 'assets', 'admin.css')).includes(13)).toBe(false);
  });

  it('holds no settings of a real server and no secret: the example only, and the hash is made on the server', () => {
    expect(files.filter((file) => /(^|\/)config\.json$|\.env|deploy\.local|\.pem$|\.key$|id_(rsa|ed25519)/.test(file))).toEqual([]);
    const example = JSON.parse(readFileSync(join(site.deploy, 'server', 'config.example.json'), 'utf8'));
    expect(example.passwordHash).toBe('');
    for (const file of files.filter((name) => !name.startsWith('server/node_modules/'))) {
      expect(readFileSync(join(site.deploy, file), 'utf8'), file).not.toMatch(/scrypt\$N=\d+,r=\d+,p=\d+\$[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=/);
    }
  });

  it('names the site for setup.sh, from the settings of the build', () => {
    expect(readFileSync(join(site.deploy, 'site.conf'), 'utf8')).toBe(
      `# The site this folder was built for (site/site.config.json). setup.sh reads it.\ndomain=${config.domain}\nroot=${config.server.root}\nport=${config.server.service.split(':')[1]}\n`,
    );
    // the same address the Caddyfile passes requests to
    expect(site.caddyfile).toContain(`reverse_proxy ${config.server.service}`);
  });

  it('has Unix line ends in every text that goes to the server, whatever the computer it was built on', () => {
    for (const file of files.filter((name) => !name.startsWith('server/node_modules/'))) {
      expect(readFileSync(join(site.deploy, file)).includes(13), file).toBe(false);
    }
    expect(readFileSync(join(site.deploy, 'setup.sh'), 'utf8').startsWith('#!/usr/bin/env bash\n')).toBe(true);
  });

  it('is not part of the site: nothing of it is in dist, so nothing of it is ever uploaded or served', () => {
    expect(site.files.filter((file) => /setup\.sh|\.service$|logrotate|site\.conf|^server\/|config\.example|Caddyfile|node_modules/.test(file))).toEqual([]);
    for (const file of site.files.filter(isText)) expect(site.read(file), file).not.toMatch(/sc-trade-site\.service|setup\.sh|passwordHash/);
  });

  it('is made anew by every build: what a build before it left there is gone', () => {
    const dir = tempDir();
    const options = { version, outDir: join(dir, 'dist'), deployDir: join(dir, 'dist-deploy'), installer: fakeInstaller(dir) };
    buildSite(options);
    writeFileSync(join(dir, 'dist-deploy', 'server', 'src', 'left-behind.mjs'), '// of a build before');
    writeFileSync(join(dir, 'dist-deploy', 'config.json'), '{}');
    buildSite(options);
    expect(listFiles(join(dir, 'dist-deploy'))).toEqual(files);
  });

  it('runs as it lies there: the service of the folder starts with settings, answers, and stops', async () => {
    // without settings it says so and ends with 78: its code and what it needs are all found
    const missing = spawnSync(process.execPath, [join(site.deploy, 'server', 'src', 'main.mjs'), join(tempDir(), 'none.json')], { encoding: 'utf8', timeout: 20_000 });
    expect(missing.status).toBe(78);
    expect(missing.stderr).toMatch(/sc-trade-site does not start: the settings /);

    const dir = tempDir();
    const port = await new Promise<number>((done, fail) => {
      const probe = net.createServer();
      probe.once('error', fail);
      probe.listen(0, '127.0.0.1', () => {
        const found = (probe.address() as net.AddressInfo).port;
        probe.close(() => done(found));
      });
    });
    // the settings are made by the tool of the folder, the password on its input
    const file = join(dir, 'config.json');
    const made = spawnSync(process.execPath, [join(site.deploy, 'server', 'src', 'configure.mjs'), '--config', file, '--domain', 'site.example.test', '--port', String(port), '--data', join(dir, 'data')], {
      input: 'a password of the tests only',
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(made.stderr).toBe('');
    expect(made.status).toBe(0);

    const child = spawn(process.execPath, [join(site.deploy, 'server', 'src', 'main.mjs'), file], { stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
    const deadline = Date.now() + 15_000;
    while (!out.includes(' started ') && child.exitCode === null && Date.now() < deadline) await new Promise((wait) => setTimeout(wait, 20));
    expect(err).toBe('');
    expect(out).toContain(`started address=127.0.0.1 port=${port}`);

    // a message with a picture goes through the parser the folder carries
    const boundary = 'folder';
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="message"\r\n\r\nA message for the service of the folder.\r\n--${boundary}\r\nContent-Disposition: form-data; name="shots[]"; filename="x.png"\r\nContent-Type: image/png\r\n\r\n`),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const reply = await fetch(`http://127.0.0.1:${port}/api/feedback`, { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, Origin: 'https://site.example.test' }, body });
    expect(reply.status).toBe(200);
    expect(await reply.json()).toEqual({ ok: true });
    expect(readdirSync(join(dir, 'data', 'messages'))).toHaveLength(1);
    const login = await fetch(`http://127.0.0.1:${port}/admin/login`);
    expect(login.status).toBe(200);
    expect(await login.text()).toContain('<form method="post" action="/admin/login"');
  }, 60_000);
});

describe('the build stops', () => {
  it('when the service is not installed: it says how to install it, and writes nothing', () => {
    const dir = tempDir();
    const copy = join(dir, 'server');
    cpSync(serverDir, copy, { recursive: true });
    rmSync(join(copy, 'node_modules'), { recursive: true, force: true });
    const options = { version, outDir: join(dir, 'dist'), deployDir: join(dir, 'dist-deploy'), installer: null, serverDir: copy };
    expect(() => buildSite(options)).toThrow(/the service of the site is not installed[\s\S]*npm run site:server:install/);
    expect(readdirSync(dir)).toEqual(['server']);
  });

  it('when what is installed is not what the lock file names', () => {
    const dir = tempDir();
    const copy = join(dir, 'server');
    cpSync(serverDir, copy, { recursive: true });
    const manifest = join(copy, 'node_modules', 'busboy', 'package.json');
    writeFileSync(manifest, JSON.stringify({ ...JSON.parse(readFileSync(manifest, 'utf8')), version: '0.0.1' }));
    const options = { version, outDir: join(dir, 'dist'), deployDir: join(dir, 'dist-deploy'), installer: null, serverDir: copy };
    expect(() => buildSite(options)).toThrow(/busboy 0\.0\.1 is installed, and package-lock\.json names 1\.6\.0[\s\S]*npm run site:server:install/);
    expect(statSync(dir).isDirectory() && readdirSync(dir)).toEqual(['server']);
  });
});
