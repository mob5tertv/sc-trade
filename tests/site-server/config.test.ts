import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG_PATH, loadSettings, readSettings } from '../../site/server/src/config.mjs';
import { DOMAIN, PASSWORD, PASSWORD_HASH, tempDir } from './helpers';

const serverDir = resolve(__dirname, '..', '..', 'site', 'server');
const example = () => JSON.parse(readFileSync(join(serverDir, 'config.example.json'), 'utf8')) as Record<string, unknown>;
const good = (dir = tempDir()) => ({ domain: DOMAIN, port: 8787, dataDir: dir, passwordHash: PASSWORD_HASH });

describe('the settings of the service', () => {
  it('are a domain, a port, a folder for the data and the hash of the password; the limits have defaults', () => {
    const dir = tempDir();
    const settings = readSettings(good(dir));
    expect(settings).toEqual({
      domain: DOMAIN,
      origin: `https://${DOMAIN}`,
      port: 8787,
      dataDir: dir,
      siteRoot: `/var/www/${DOMAIN}`,
      passwordHash: PASSWORD_HASH,
      limits: {
        bodyBytes: 18 * 1024 * 1024,
        requestMs: 120_000,
        idleMs: 15_000,
        lingerMs: 2000,
        perAddressHour: 5,
        perAddressDay: 20,
        globalHour: 120,
        perAddressDayBytes: 40 * 1024 * 1024,
        globalHourBytes: 200 * 1024 * 1024,
        attemptsPerAddressHour: 30,
        uploadsAtOnce: 4,
        limiterKeys: 20_000,
        storageBytes: 1024 * 1024 * 1024,
        retentionDays: 180,
        loginFailures: 5,
        loginWindowMs: 15 * 60_000,
        loginSlowAfter: 30,
        loginSlowMs: 1000,
        sessionMs: 12 * 3_600_000,
      },
    });
  });

  it('never keeps the messages where the web server would hand them out: the folder of the data is not inside the site', () => {
    const inside = /"dataDir" must not lie inside the folder of the site, nor hold it: what lies in the site is served to anybody/;
    // the site lives in /var/www/<domain> unless the settings name another folder
    expect(readSettings(good()).siteRoot).toBe(`/var/www/${DOMAIN}`);
    for (const dataDir of [`/var/www/${DOMAIN}`, `/var/www/${DOMAIN}/data`, `/var/www/${DOMAIN}/assets/../messages`, `/var/www/${DOMAIN}/`, '/var/www']) {
      expect(() => readSettings({ ...good(), dataDir }), dataDir).toThrow(inside);
    }
    expect(() => readSettings({ ...good(), siteRoot: '/srv/site', dataDir: '/srv/site/messages' })).toThrow(inside);
    expect(() => readSettings({ ...good(), siteRoot: '/srv/data/site', dataDir: '/srv/data' })).toThrow(inside);
    // next to the site is not inside it
    expect(readSettings({ ...good(), siteRoot: '/srv/site', dataDir: '/srv/site-data' })).toMatchObject({ siteRoot: '/srv/site', dataDir: '/srv/site-data' });
    expect(readSettings({ ...good(), dataDir: '/var/lib/sc-trade-site' }).dataDir).toBe('/var/lib/sc-trade-site');
    for (const siteRoot of ['www', 7, '', '/']) expect(() => readSettings({ ...good(), siteRoot }), String(siteRoot)).toThrow(/"siteRoot" must be the full path of the folder of the site/);
  });

  it('wants a folder of its own for the data, two levels deep at the least: not a folder that holds half the system', () => {
    for (const dataDir of ['/data', '/var', '/srv/', '/home']) {
      expect(() => readSettings({ ...good(), dataDir }), dataDir).toThrow(/"dataDir" must be the full path of a folder of its own, two levels deep at the least, like \/var\/lib\/sc-trade-site/);
    }
    expect(readSettings({ ...good(), dataDir: '/srv/messages' }).dataDir).toBe('/srv/messages');
  });

  it('lives in /etc on the server unless the service is told another file', () => {
    expect(DEFAULT_CONFIG_PATH).toBe('/etc/sc-trade-site/config.json');
  });

  it('takes the port 8787 when none is given', () => {
    const { port: _port, ...rest } = good();
    expect(readSettings(rest).port).toBe(8787);
  });

  it('lets the owner of the server change the limits that are his to change', () => {
    const mb = 1024 * 1024;
    const settings = readSettings({ ...good(), limits: { requestSeconds: 60, perAddressHour: 2, perAddressDay: 4, globalHour: 30, perAddressDayBytes: 20 * mb, globalHourBytes: 100 * mb, storageBytes: 64 * mb, retentionDays: 30 } });
    expect(settings.limits).toMatchObject({ requestMs: 60_000, perAddressHour: 2, perAddressDay: 4, globalHour: 30, perAddressDayBytes: 20 * mb, globalHourBytes: 100 * mb, storageBytes: 64 * mb, retentionDays: 30 });
  });

  it('never sets a budget of bytes below one full message: such a form would refuse what the page allows', () => {
    const full = 18 * 1024 * 1024;
    expect(() => readSettings({ ...good(), limits: { perAddressDayBytes: full - 1 } })).toThrow(/"limits\.perAddressDayBytes" must be a whole number from 18874368 to/);
    expect(() => readSettings({ ...good(), limits: { globalHourBytes: 1000 } })).toThrow(/"limits\.globalHourBytes"/);
    expect(readSettings({ ...good(), limits: { perAddressDayBytes: full, globalHourBytes: full } }).limits).toMatchObject({ perAddressDayBytes: full, globalHourBytes: full });
  });

  it('never keeps messages longer than the 180 days the page about data promises', () => {
    expect(() => readSettings({ ...good(), limits: { retentionDays: 181 } })).toThrow(/"limits\.retentionDays" must be a whole number from 2 to 180/);
    expect(() => readSettings({ ...good(), limits: { retentionDays: 365 } })).toThrow(/retentionDays/);
    expect(readSettings({ ...good(), limits: { retentionDays: 180 } }).limits.retentionDays).toBe(180);
  });

  it('says everything that is missing or wrong at once, by the name of the setting', () => {
    expect(() => readSettings({})).toThrow(/"domain" is missing[\s\S]*"dataDir" is missing[\s\S]*"passwordHash" is missing/);
    expect(() => readSettings(null)).toThrow(/must be an object/);
    expect(() => readSettings([])).toThrow(/must be an object/);
    const wrong: Array<[Record<string, unknown>, RegExp]> = [
      [{ domain: 'https://site.example.test' }, /"domain" must be a host name/],
      [{ domain: 'site.example.test/' }, /"domain"/],
      [{ domain: 'Site.Example.Test' }, /"domain"/],
      [{ domain: '' }, /"domain"/],
      [{ port: 80 }, /"port" must be a whole number from 1024 to 65535/],
      [{ port: '8787' }, /"port"/],
      [{ port: 8787.5 }, /"port"/],
      [{ dataDir: 'data' }, /"dataDir" must be the full path/],
      [{ dataDir: '/' }, /"dataDir"/],
      [{ dataDir: 7 }, /"dataDir"/],
      [{ passwordHash: '' }, /"passwordHash"/],
      [{ passwordHash: 'hunter2hunter2' }, /"passwordHash" is not a hash/],
      [{ limits: [] }, /"limits" must be an object/],
      [{ limits: { perAddressHour: 0 } }, /"limits\.perAddressHour"/],
      [{ limits: { perAddressHour: 10, perAddressDay: 5 } }, /"limits\.perAddressDay" must not be less than "limits\.perAddressHour"/],
      [{ limits: { requestSeconds: 1 } }, /"limits\.requestSeconds"/],
      [{ limits: { storageBytes: 10 } }, /"limits\.storageBytes"/],
      [{ limits: { speed: 3 } }, /"limits\.speed" is not a setting/],
      [{ colour: 'blue' }, /"colour" is not a setting/],
    ];
    for (const [change, why] of wrong) expect(() => readSettings({ ...good(), ...change }), JSON.stringify(change)).toThrow(why);
  });

  it('refuses a file that holds the password itself: only its hash belongs there', () => {
    expect(() => readSettings({ ...good(), password: PASSWORD })).toThrow(/"password" must not be in the settings: only the hash/);
    let said = '';
    try {
      readSettings({ ...good(), password: PASSWORD, passwordHash: PASSWORD });
    } catch (err) {
      said = String(err);
    }
    // what is wrong is said without repeating what was typed there
    expect(said).toMatch(/"password" must not be in the settings[\s\S]*"passwordHash" is not a hash/);
    expect(said).not.toContain(PASSWORD);
  });
});

describe('the file of the settings', () => {
  it('is read from the path the service is given', () => {
    const dir = tempDir();
    const file = join(dir, 'config.json');
    writeFileSync(file, JSON.stringify(good(dir)));
    expect(loadSettings(file).domain).toBe(DOMAIN);
  });

  it('stops the service with a phrase that names the file when it is missing, is not JSON or is not whole', () => {
    const dir = tempDir();
    const file = join(dir, 'config.json');
    expect(() => loadSettings(file)).toThrow(/config\.json[\s\S]*cannot be read/);
    writeFileSync(file, '{ "domain": ');
    expect(() => loadSettings(file)).toThrow(/config\.json[\s\S]*is not JSON/);
    writeFileSync(file, JSON.stringify({ domain: DOMAIN }));
    expect(() => loadSettings(file)).toThrow(/config\.json[\s\S]*"dataDir" is missing[\s\S]*"passwordHash" is missing/);
  });
});

describe('the example of the settings (site/server/config.example.json)', () => {
  it('names every setting, with the defaults for the limits', () => {
    expect(example()).toEqual({
      domain: 'site.example',
      port: 8787,
      dataDir: '/var/lib/sc-trade-site',
      siteRoot: '/var/www/site.example',
      passwordHash: '',
      limits: { requestSeconds: 120, perAddressHour: 5, perAddressDay: 20, globalHour: 120, perAddressDayBytes: 40 * 1024 * 1024, globalHourBytes: 200 * 1024 * 1024, storageBytes: 1024 * 1024 * 1024, retentionDays: 180 },
    });
  });

  it('holds no real value: no domain of the site, no hash — and the service does not start with it as it is', () => {
    const text = readFileSync(join(serverDir, 'config.example.json'), 'utf8');
    expect(text).not.toMatch(/sc-trade\.space|scrypt\$|@/);
    expect(() => readSettings(example())).toThrow(/"passwordHash"/);
  });

  it('is whole once the hash is in: the limits it shows are the defaults', () => {
    const filled: Record<string, unknown> = { ...example(), dataDir: tempDir(), passwordHash: PASSWORD_HASH };
    const { limits: _limits, ...plain } = filled;
    expect(readSettings(filled)).toEqual(readSettings(plain));
  });
});
