import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hashPassword, parseHash, PASSWORD_MIN, verifyPassword } from '../../site/server/src/password.mjs';

const CHEAP = { N: 16384, r: 8, p: 1 };
const source = readFileSync(join(__dirname, '..', '..', 'site', 'server', 'src', 'password.mjs'), 'utf8');

describe('the hash of the password', () => {
  it('is scrypt with a salt of its own, and says with what work it was made', () => {
    const hash = hashPassword('correct horse battery staple', CHEAP);
    expect(hash).toMatch(/^scrypt\$N=16384,r=8,p=1\$[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=$/);
    const parsed = parseHash(hash);
    expect(parsed).toMatchObject({ N: 16384, r: 8, p: 1 });
    expect(parsed.salt).toHaveLength(16);
    expect(parsed.key).toHaveLength(32);
    // the password is not in it, and the same password gives another hash every time
    expect(hash).not.toContain('correct');
    expect(hashPassword('correct horse battery staple', CHEAP)).not.toBe(hash);
  });

  it('is made with more work than the least the service accepts, unless told otherwise', () => {
    const { N, r, p } = parseHash(hashPassword('correct horse battery staple'));
    expect(N * r * p).toBeGreaterThan(16384 * 8);
    expect(N).toBeGreaterThanOrEqual(32768);
  });

  it('is not made of a password that is too short to be one', () => {
    expect(PASSWORD_MIN).toBe(16);
    expect(() => hashPassword('short', CHEAP)).toThrow(/at least 16 characters/);
    expect(() => hashPassword('x'.repeat(PASSWORD_MIN - 1), CHEAP)).toThrow(/at least 16/);
    expect(() => hashPassword('x'.repeat(2000), CHEAP)).toThrow(/too long/);
    expect(hashPassword('x'.repeat(PASSWORD_MIN), CHEAP)).toMatch(/^scrypt\$/);
  });

  it('lets in the password it was made of, and no other', async () => {
    const hash = hashPassword('correct horse battery staple', CHEAP);
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    for (const wrong of ['', 'correct horse battery stapl', 'correct horse battery staple ', 'Correct horse battery staple', 'x'.repeat(5000)]) {
      expect(await verifyPassword(wrong, hash), wrong.slice(0, 40)).toBe(false);
    }
    // another salt: the same password under another hash still opens
    expect(await verifyPassword('correct horse battery staple', hashPassword('correct horse battery staple', CHEAP))).toBe(true);
  });

  it('compares in constant time, with the tool of Node made for it', () => {
    expect(source).toMatch(/timingSafeEqual\(/);
    expect(source).not.toMatch(/\.equals\(|key\.toString\([^)]*\)\s*===/);
  });

  it('refuses a hash that is not one, with what is wrong', () => {
    const [, params, salt, key] = hashPassword('correct horse battery staple', CHEAP).split('$');
    const bad: Array<[string, RegExp]> = [
      ['', /scrypt\$N=/],
      ['<made by setup.sh>', /scrypt\$N=/],
      [`bcrypt$${params}$${salt}$${key}`, /scrypt\$N=/],
      [`scrypt$N=1000,r=8,p=1$${salt}$${key}`, /power of two/],
      [`scrypt$N=1024,r=8,p=1$${salt}$${key}`, /N must be/],
      [`scrypt$N=${2 ** 22},r=8,p=1$${salt}$${key}`, /N must be/],
      // a hash that would take more memory to check than the service has: every login would end the service
      [`scrypt$N=${2 ** 20},r=8,p=1$${salt}$${key}`, /takes 1024 MB to check, and the service has 128 MB for it/],
      [`scrypt$N=${2 ** 18},r=8,p=1$${salt}$${key}`, /takes 256 MB to check/],
      [`scrypt$N=65536,r=32,p=1$${salt}$${key}`, /takes 256 MB to check/],
      [`scrypt$N=16384,r=8,p=9$${salt}$${key}`, /p must be from 1 to 8/],
      [`scrypt$N=16384,r=1,p=1$${salt}$${key}`, /r must be/],
      [`scrypt$N=16384,r=8,p=0$${salt}$${key}`, /p must be/],
      [`scrypt$N=16384,r=8,p=99$${salt}$${key}`, /p must be/],
      [`scrypt$N=16384,r=8,p=1$c2hvcnQ=$${key}`, /salt/],
      [`scrypt$N=16384,r=8,p=1$${salt}$c2hvcnQ=`, /hash/],
      [`scrypt$N=16384,r=8,p=1$${salt}$${key}$more`, /scrypt\$N=/],
    ];
    for (const [hash, why] of bad) expect(() => parseHash(hash), hash.slice(0, 40)).toThrow(why);
  });

  it('takes a hash made with more work than its own, up to the memory the service has', () => {
    const [, , salt, key] = hashPassword('correct horse battery staple', CHEAP).split('$');
    // 128·N·r: 64 MB and 128 MB are within the 512 MB the unit gives the service; more is not
    expect(parseHash(`scrypt$N=65536,r=8,p=3$${salt}$${key}`)).toMatchObject({ N: 65536, r: 8, p: 3 });
    expect(parseHash(`scrypt$N=131072,r=8,p=1$${salt}$${key}`)).toMatchObject({ N: 131072 });
    expect(parseHash(`scrypt$N=32768,r=32,p=8$${salt}$${key}`)).toMatchObject({ r: 32, p: 8 });
    const unit = readFileSync(join(__dirname, '..', '..', 'site', 'deploy', 'sc-trade-site.service'), 'utf8');
    const memory = Number(/^MemoryMax=(\d+)M$/m.exec(unit)?.[1]);
    expect(memory).toBeGreaterThanOrEqual(4 * 128);
  });

  it('opens nothing with a hash that is not one', async () => {
    expect(await verifyPassword('correct horse battery staple', 'not a hash')).toBe(false);
    expect(await verifyPassword('', '')).toBe(false);
  });
});
