import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DOMAIN, PASSWORD, PASSWORD_HASH, request, tempDir } from './helpers';

const main = resolve(__dirname, '..', '..', 'site', 'server', 'src', 'main.mjs');

const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill();
});

/** A port nobody listens on right now. */
function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = net.createServer();
    probe.once('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => done(port));
    });
  });
}

describe('node src/main.mjs <the file of the settings>', () => {
  it('does not start without its settings: says which file is missing and ends with the code systemd does not restart at', () => {
    const file = join(tempDir(), 'config.json');
    const run = spawnSync(process.execPath, [main, file], { encoding: 'utf8', timeout: 20_000 });
    expect(run.status).toBe(78);
    expect(run.stderr).toMatch(/sc-trade-site does not start: the settings .*config\.json cannot be read/);
    expect(run.stdout).toBe('');
  });

  it('does not start with settings that are not whole: names every one to fix, and never repeats what is in the file', () => {
    const dir = tempDir();
    const file = join(dir, 'config.json');
    writeFileSync(file, JSON.stringify({ domain: DOMAIN, password: PASSWORD, passwordHash: PASSWORD }));
    const run = spawnSync(process.execPath, [main, file], { encoding: 'utf8', timeout: 20_000 });
    expect(run.status).toBe(78);
    expect(run.stderr).toMatch(/"password" must not be in the settings/);
    expect(run.stderr).toMatch(/"dataDir" is missing/);
    expect(run.stderr).toMatch(/"passwordHash" is not a hash/);
    expect(run.stderr).not.toContain(PASSWORD);
    // nothing was made, nothing was opened
    expect(readdirSync(dir)).toEqual(['config.json']);
  });

  it('does not start in a folder of data that holds something and is not its own: says so, removes nothing, and is not started again', () => {
    const dir = tempDir();
    const data = join(dir, 'data');
    mkdirSync(join(data, 'tmp'), { recursive: true });
    writeFileSync(join(data, 'tmp', 'somebody-elses-work.txt'), 'not to be lost');
    const file = join(dir, 'config.json');
    writeFileSync(file, JSON.stringify({ domain: DOMAIN, port: 8787, dataDir: data, passwordHash: PASSWORD_HASH }));
    const run = spawnSync(process.execPath, [main, file], { encoding: 'utf8', timeout: 20_000 });
    expect(run.status).toBe(78);
    expect(run.stderr).toMatch(/sc-trade-site does not start: the folder of the data .* is not empty and was not made by this service \(the file sc-trade-site\.marker is missing\): nothing in it was touched/);
    expect(readdirSync(data)).toEqual(['tmp']);
    expect(readFileSync(join(data, 'tmp', 'somebody-elses-work.txt'), 'utf8')).toBe('not to be lost');
  });

  it('says what to do when the one package it needs is not next to it, instead of an error of the code', () => {
    // the code of the service alone, as a folder that was copied without its packages
    const dir = tempDir();
    cpSync(resolve(main, '..'), join(dir, 'server', 'src'), { recursive: true });
    writeFileSync(join(dir, 'server', 'package.json'), '{"type":"module"}');
    const file = join(dir, 'config.json');
    writeFileSync(file, JSON.stringify({ domain: DOMAIN, port: 8787, dataDir: join(dir, 'data'), passwordHash: PASSWORD_HASH }));
    const run = spawnSync(process.execPath, [join(dir, 'server', 'src', 'main.mjs'), file], { encoding: 'utf8', timeout: 20_000 });
    expect(run.status).toBe(78);
    expect(run.stderr).toMatch(/sc-trade-site does not start: the package "busboy" is not next to the service/);
    expect(run.stderr).toMatch(/npm run site:server:install/);
    expect(run.stderr).not.toMatch(/ at .*\.mjs|node:internal/);
    // nothing was made
    expect(existsSync(join(dir, 'data'))).toBe(false);
  });

  it('starts with settings that are whole: listens on 127.0.0.1, answers, and stops when told', async () => {
    const dir = tempDir();
    const port = await freePort();
    const file = join(dir, 'config.json');
    writeFileSync(file, JSON.stringify({ domain: DOMAIN, port, dataDir: join(dir, 'data'), passwordHash: PASSWORD_HASH }));
    const child = spawn(process.execPath, [main, file], { stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (err += chunk.toString()));
    const ended = new Promise<number | null>((done) => child.once('exit', (code) => done(code)));

    const deadline = Date.now() + 15_000;
    while (!out.includes(' started ') && child.exitCode === null && Date.now() < deadline) await new Promise((wait) => setTimeout(wait, 20));
    expect(err).toBe('');
    expect(out).toMatch(new RegExp(`^\\S+ sweep ok expired=0 strays=0 used=0\\n\\S+ started address=127\\.0\\.0\\.1 port=${port}\\n$`));

    const reply = await request(port, { path: '/api/' });
    expect(reply.status).toBe(200);
    expect(reply.json).toEqual({ ok: true });
    expect(readdirSync(join(dir, 'data')).sort()).toEqual(['files', 'messages', 'sc-trade-site.marker', 'tmp']);

    child.kill();
    await ended;
    await expect(request(port, { path: '/api/' })).rejects.toThrow();
  }, 30_000);
});
