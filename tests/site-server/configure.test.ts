import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSettings } from '../../site/server/src/config.mjs';
import { parseHash, verifyPassword } from '../../site/server/src/password.mjs';
import { DOMAIN, PASSWORD, PASSWORD_HASH, tempDir } from './helpers';

// `node src/configure.mjs`: the tool setup.sh uses to write the settings of the service. The password reaches it on
// its standard input and in no other way.

const tool = resolve(__dirname, '..', '..', 'site', 'server', 'src', 'configure.mjs');
const source = readFileSync(tool, 'utf8');

function configure(args: string[], input: string | undefined) {
  const run = spawnSync(process.execPath, [tool, ...args], { input: input ?? '', encoding: 'utf8', timeout: 30_000 });
  return { status: run.status, out: run.stdout, err: run.stderr };
}

/** The folder of the data named in a settings file: any full path will do, nothing is made there. */
const dataDir = (dir: string) => join(dir, 'data');

describe('the settings are written by a tool that gets the password on its standard input', () => {
  it('writes a whole settings file with the hash of the password, and never the password', async () => {
    const dir = tempDir();
    const file = join(dir, 'config.json');
    const run = configure(['--config', file, '--domain', DOMAIN, '--port', '8799', '--data', dataDir(dir)], PASSWORD);
    expect(run.err).toBe('');
    expect(run.status).toBe(0);
    const text = readFileSync(file, 'utf8');
    const written = JSON.parse(text);
    expect(Object.keys(written)).toEqual(['domain', 'port', 'dataDir', 'passwordHash']);
    expect(written).toMatchObject({ domain: DOMAIN, port: 8799, dataDir: dataDir(dir) });
    // the service starts with it
    expect(readSettings(written).limits.retentionDays).toBe(180);
    expect(await verifyPassword(PASSWORD, written.passwordHash)).toBe(true);
    // made with the full work, not with the cheap one of the tests
    expect(parseHash(written.passwordHash)).toMatchObject({ N: 32768, r: 8, p: 3 });
    for (const place of [text, run.out, run.err]) expect(place).not.toContain(PASSWORD);
    expect(run.out).not.toContain('scrypt$');
    // nothing else was left in the folder, and the folder of the data was not made
    expect(readdirSync(dir)).toEqual(['config.json']);
  });

  it('takes the port 8787 when none is named, and one line break after the password as the end of it', async () => {
    const dir = tempDir();
    const file = join(dir, 'config.json');
    expect(configure(['--config', file, '--domain', DOMAIN, '--data', dataDir(dir)], `${PASSWORD}\n`).status).toBe(0);
    const written = JSON.parse(readFileSync(file, 'utf8'));
    expect(written.port).toBe(8787);
    expect(await verifyPassword(PASSWORD, written.passwordHash)).toBe(true);
    expect(await verifyPassword(`${PASSWORD}\n`, written.passwordHash)).toBe(false);
  });

  it('has no way to be given the password as an argument, and does not repeat an argument it does not know', () => {
    const dir = tempDir();
    const file = join(dir, 'config.json');
    for (const args of [['--password', 'TYPED-BY-MISTAKE-1234'], ['--password=TYPED-BY-MISTAKE-1234'], ['TYPED-BY-MISTAKE-1234'], ['-p', 'TYPED-BY-MISTAKE-1234']]) {
      const run = configure(['--config', file, '--domain', DOMAIN, '--data', dataDir(dir), ...args], PASSWORD);
      expect(run.status, args.join(' ')).toBe(1);
      expect(run.err).toMatch(/an argument the tool does not know/);
      expect(run.err + run.out).not.toContain('TYPED-BY-MISTAKE');
      expect(existsSync(file)).toBe(false);
    }
    // the code reads the password from the input only
    expect(source).not.toMatch(/--pass|argv\[[^\]]*\][^\n]*password|env\.[A-Z_]*PASS/i);
    expect(source).toMatch(/process\.stdin/);
  });

  it('refuses a password that is too short or missing, and writes nothing', () => {
    const dir = tempDir();
    const file = join(dir, 'config.json');
    for (const password of ['', '\n', 'short', 'x'.repeat(15)]) {
      const run = configure(['--config', file, '--domain', DOMAIN, '--data', dataDir(dir)], password);
      expect(run.status).toBe(1);
      expect(run.err).toMatch(/at least 16 characters/);
      expect(existsSync(file)).toBe(false);
    }
    expect(readdirSync(dir)).toEqual([]);
  });

  it('says what is missing or wrong, by name', () => {
    const dir = tempDir();
    const file = join(dir, 'config.json');
    expect(configure(['--domain', DOMAIN, '--data', dataDir(dir)], PASSWORD).err).toMatch(/--config/);
    expect(configure(['--config', file, '--data', dataDir(dir)], PASSWORD).err).toMatch(/"domain" is missing/);
    expect(configure(['--config', file, '--domain', DOMAIN], PASSWORD).err).toMatch(/"dataDir" is missing/);
    expect(configure(['--config', file, '--domain', 'https://x', '--data', dataDir(dir)], PASSWORD).err).toMatch(/"domain" must be a host name/);
    expect(configure(['--config', file, '--domain', DOMAIN, '--data', dataDir(dir), '--port', '80'], PASSWORD).err).toMatch(/"port"/);
    expect(configure(['--config', file, '--domain', DOMAIN, '--data', dataDir(dir), '--port', 'abc'], PASSWORD).err).toMatch(/"port"/);
    expect(configure(['--config', file, '--domain'], PASSWORD).err).toMatch(/--domain needs a value/);
    expect(existsSync(file)).toBe(false);
  });
});

describe('settings that are already there', () => {
  const existing = (dir: string) => ({ domain: DOMAIN, port: 8790, dataDir: dataDir(dir), passwordHash: PASSWORD_HASH, limits: { retentionDays: 90, perAddressHour: 3 } });

  it('are not touched unless a new password is asked for by name', () => {
    const dir = tempDir();
    const file = join(dir, 'config.json');
    const before = JSON.stringify(existing(dir), null, 2);
    writeFileSync(file, before);
    const run = configure(['--config', file, '--domain', 'other.example.test', '--data', dataDir(dir)], 'another password, long enough');
    expect(run.status).toBe(1);
    expect(run.err).toMatch(/is already there[\s\S]*--reset-password/);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('get a new hash with --reset-password, and keep everything else as it was', async () => {
    const dir = tempDir();
    const file = join(dir, 'config.json');
    writeFileSync(file, JSON.stringify(existing(dir), null, 2));
    const run = configure(['--config', file, '--reset-password'], 'another password, long enough');
    expect(run.err).toBe('');
    expect(run.status).toBe(0);
    const written = JSON.parse(readFileSync(file, 'utf8'));
    expect({ ...written, passwordHash: '' }).toEqual({ ...existing(dir), passwordHash: '' });
    expect(written.passwordHash).not.toBe(PASSWORD_HASH);
    expect(await verifyPassword('another password, long enough', written.passwordHash)).toBe(true);
    expect(await verifyPassword(PASSWORD, written.passwordHash)).toBe(false);
    expect(readdirSync(dir)).toEqual(['config.json']);
  });

  it('are not replaced by --reset-password when there is nothing to reset, or when what is there is broken', () => {
    const dir = tempDir();
    const file = join(dir, 'config.json');
    expect(configure(['--config', file, '--reset-password'], PASSWORD).err).toMatch(/cannot be read/);
    writeFileSync(file, '{ broken');
    expect(configure(['--config', file, '--reset-password'], PASSWORD).err).toMatch(/is not JSON/);
    expect(readFileSync(file, 'utf8')).toBe('{ broken');
  });

  it('can be checked against the site they belong to: --verify changes nothing and asks for no password', () => {
    const dir = tempDir();
    const file = join(dir, 'config.json');
    const before = JSON.stringify(existing(dir));
    writeFileSync(file, before);
    const good = configure(['--config', file, '--verify', '--domain', DOMAIN, '--port', '8790'], undefined);
    expect(good.err).toBe('');
    expect(good.status).toBe(0);
    const otherPort = configure(['--config', file, '--verify', '--domain', DOMAIN, '--port', '8787'], undefined);
    expect(otherPort.status).toBe(1);
    expect(otherPort.err).toMatch(/"port" is 8790[\s\S]*8787/);
    const otherDomain = configure(['--config', file, '--verify', '--domain', 'other.example.test', '--port', '8790'], undefined);
    expect(otherDomain.status).toBe(1);
    expect(otherDomain.err).toMatch(/"domain" is site\.example\.test[\s\S]*other\.example\.test/);
    writeFileSync(file, JSON.stringify({ domain: DOMAIN }));
    const broken = configure(['--config', file, '--verify', '--domain', DOMAIN, '--port', '8787'], undefined);
    expect(broken.status).toBe(1);
    expect(broken.err).toMatch(/"passwordHash" is missing/);
    writeFileSync(file, before);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });
});
