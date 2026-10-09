import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadDictionaries, siteDir } from '../../scripts/site/config.mjs';
import { readSettings } from '../../site/server/src/config.mjs';
import { createLimiter, DAY } from '../../site/server/src/limiter.mjs';
import { createStore, SWEEP_EVERY_MS } from '../../site/server/src/store.mjs';
import { DAY_MS, DOMAIN, PASSWORD_HASH, START, tempDir } from './helpers';

// The page «О данных» of the site makes promises about what the server keeps and for how long. Each number it
// names is a number of the service or of the server's set-up: this file holds the two together, so that neither
// changes without the other. (How each promise is kept is tested where the thing itself is tested: feedback.test.ts,
// admin.test.ts, store.test.ts, tests/site/server-config.test.ts.)

const dictionaries = loadDictionaries(siteDir);
const data = (lang: 'ru' | 'en') => dictionaries[lang].data as unknown as { form: string[]; server: string[]; analytics_off: string[] };
const good = () => ({ domain: DOMAIN, dataDir: tempDir(), passwordHash: PASSWORD_HASH });
const deployFile = (name: string) => readFileSync(join(siteDir, 'deploy', name), 'utf8').replaceAll('\r\n', '\n');

describe('«О данных» and the service say the same', () => {
  it('"kept for up to 180 days": the service keeps a message 180 days at the most, and cannot be set to keep it longer', async () => {
    expect(data('ru').form.join(' ')).toContain('хранятся до 180 дней');
    expect(data('en').form.join(' ')).toContain('kept for up to 180 days');
    expect(readSettings(good()).limits.retentionDays).toBe(180);
    expect(() => readSettings({ ...good(), limits: { retentionDays: 181 } })).toThrow(/retentionDays/);
    // the daily check removes a message a day early, so that the next check does not come too late for it
    expect(SWEEP_EVERY_MS).toBe(DAY_MS);
    const clock = { now: START };
    const store = createStore({ dir: tempDir(), now: () => clock.now, storageBytes: 1e6, retentionMs: 180 * DAY_MS });
    await store.open();
    const id = store.newId();
    await store.save({ id, receivedAt: new Date(START).toISOString(), lang: '', message: 'A message that is long enough.', contact: '', files: [] });
    // whenever the check runs within the last day before the term, the message goes; one check a day is enough
    clock.now = START + 180 * DAY_MS - SWEEP_EVERY_MS;
    expect(await store.sweep()).toMatchObject({ expired: 1 });
  });

  it('"or deleted earlier at your request": the author can find a message and delete it with its files', () => {
    expect(data('ru').form.join(' ')).toContain('удаляются раньше — по твоей просьбе');
    const admin = readFileSync(resolve(siteDir, 'server', 'src', 'admin.mjs'), 'utf8');
    expect(admin).toContain('await store.remove(removal[1])');
    expect(admin).toMatch(/record\.message, record\.contact, \.\.\.record\.files\.map\(\(file\) => file\.name\), day/);
  });

  it('"in the limiter, for up to a day": no mark of the limiter outlives a day, whatever it is asked for', () => {
    expect(data('ru').server.join(' ')).toContain('в ограничителе частоты — до суток');
    expect(data('en').server.join(' ')).toContain('in the rate limiter, for up to a day');
    expect(DAY).toBe(DAY_MS);
    const clock = { now: START };
    const limiter = createLimiter({ now: () => clock.now });
    limiter.mark(`sent:${limiter.addressKey('203.0.113.7')}`, 365 * DAY);
    clock.now += DAY + 1;
    limiter.prune();
    expect(limiter.size()).toBe(0);
    // and the longest the service itself asks for is a day
    const sources = ['feedback.mjs', 'admin.mjs'].map((name) => readFileSync(resolve(siteDir, 'server', 'src', name), 'utf8')).join('\n');
    const asked = [...sources.matchAll(/limiter\.mark\([^,]+, ([\w.]+)\)/g)].map((match) => match[1]);
    expect([...new Set(asked)].sort()).toEqual(['DAY', 'HOUR', 'limits.loginWindowMs']);
    expect(readSettings(good()).limits.loginWindowMs).toBeLessThan(DAY);
  });

  it('"in the server\'s error log, for up to 30 days": the log of the web server is turned over daily and a part of it lives 29 days at the most', () => {
    expect(data('ru').server.join(' ')).toContain('в журнале ошибок сервера — до 30 дней');
    expect(data('en').server.join(' ')).toContain("in the server's error log, for up to 30 days");
    const rules = deployFile('logrotate.conf');
    expect(rules).toMatch(/^\tdaily$/m);
    const kept = Number(/^\trotate (\d+)$/m.exec(rules)?.[1]);
    // a day in the log itself, then one day for each part that is kept
    expect(kept + 1).toBeLessThan(30);
    expect(rules).toMatch(/^\tmaxage 30$/m);
    // the log is the one Caddy writes, and Caddy writes no other
    expect(rules).toMatch(/^\/var\/log\/caddy\/sc-trade-error\.log \{$/m);
    const template = deployFile('Caddyfile.template');
    expect(template.match(/output file [^\n]*/g)).toEqual(['output file /var/log/caddy/sc-trade-error.log {']);
    // the service itself writes no address into its own log: feedback.test.ts and admin.test.ts look at every line
  });

  it('"They are not stored with a message": a message is what was typed and attached, with no field for anything else', () => {
    expect(data('ru').server.join(' ')).toContain('Вместе с сообщением они не сохраняются');
    const feedback = readFileSync(resolve(siteDir, 'server', 'src', 'feedback.mjs'), 'utf8');
    expect(feedback).toContain("const record = { id, receivedAt: new Date(store.timeOf(id)).toISOString(), lang: cleanLang(texts.get('lang')), message, contact, files };");
    // of all the headers of a request the service reads four, and keeps none
    const read = [...new Set([...feedback.matchAll(/req\.headers(?:\.(\w+)|\['([\w-]+)'\])/g)].map((match) => match[1] ?? match[2]))].sort();
    expect(read).toEqual(['content-length', 'content-type', 'x-forwarded-for']);
    expect(feedback).toContain('const { origin } = req.headers;');
  });

  it('"set no cookies": the one cookie the service has belongs to the author\'s page and to nothing else', () => {
    expect(data('ru').analytics_off.join(' ')).toContain('не ставят cookie');
    const sources = ['feedback.mjs', 'service.mjs', 'http.mjs', 'admin.mjs', 'sessions.mjs'].map((name) => ({ name, text: readFileSync(resolve(siteDir, 'server', 'src', name), 'utf8') }));
    for (const { name, text } of sources) {
      if (name === 'admin.mjs' || name === 'sessions.mjs') continue;
      expect(text, name).not.toMatch(/set-cookie|cookieFor/i);
    }
    expect(sources.find(({ name }) => name === 'sessions.mjs')!.text).toContain('Path=/admin; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Strict');
  });

  it('"Only the author sees the messages": nothing leaves the service, and the folder of the messages is the service\'s alone', () => {
    expect(data('en').form.join(' ')).toContain('Only the author sees the messages');
    const unit = deployFile('sc-trade-site.service');
    expect(unit).toMatch(/^IPAddressDeny=any$/m);
    expect(unit).toMatch(/^IPAddressAllow=localhost$/m);
    expect(unit).toMatch(/^StateDirectoryMode=0700$/m);
    expect(deployFile('setup.sh')).toContain('run install -d -m 0700 -o "$SERVICE_USER" -g "$SERVICE_USER" "$DATA_DIR"');
    // (that the service makes no connection of its own and has no mail: package.test.ts)
  });
});
