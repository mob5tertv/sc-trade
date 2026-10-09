import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
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
    expect(readdirSync(join(dir, 'data')).sort()).toEqual(['files', 'messages', 'tmp']);

    child.kill();
    await ended;
    await expect(request(port, { path: '/api/' })).rejects.toThrow();
  }, 30_000);
});
