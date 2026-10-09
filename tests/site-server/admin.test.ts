import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from '../../scripts/site/server-config.mjs';
import { admin as rawAdmin, AUTHOR, COOKIE, cookieOf, csrfOf, DAY_MS, fields, listFiles, LOG_TEXT, logFile, login, ORIGIN, PASSWORD, PNG, send, shot, start, START, stored, type Part, type Reply, type Running } from './helpers';

const HOUR_MS = 3_600_000;

/** Every answer the author's page gave in this file: each is checked once more at the end. */
const replies: Array<{ path: string; reply: Reply }> = [];
const admin: typeof rawAdmin = async (run, path, options) => {
  const reply = await rawAdmin(run, path, options);
  replies.push({ path, reply });
  return reply;
};

afterAll(() => {
  expect(replies.length).toBeGreaterThan(80);
  for (const { path, reply } of replies) {
    // nothing of the author's page is kept by a browser or shown by a search engine
    expect(reply.headers['cache-control'], path).toBe('no-store');
    expect(reply.headers['x-robots-tag'], path).toBe('noindex, nofollow');
    expect(reply.headers['x-content-type-options'], path).toBe('nosniff');
    expect(reply.headers['x-frame-options'], path).toBe('DENY');
    // a cookie is set by the login and the logout only, and only for /admin
    for (const cookie of reply.headers['set-cookie'] ?? []) {
      expect(path).toMatch(/^\/admin\/(login|logout)$/);
      expect(cookie).toMatch(new RegExp(`^${COOKIE}=[A-Za-z0-9_-]*; Path=/admin; Max-Age=\\d+; HttpOnly; Secure; SameSite=Strict$`));
    }
    // (an answer to HEAD has the head of a page and no page)
    if (String(reply.headers['content-type']).startsWith('text/html') && reply.text !== '') expectCleanPage(reply.text, path);
  }
});

/**
 * A page of the author lives under the policy the web server puts on every answer (no inline script or style,
 * everything from the site itself): it has no script at all, no style of its own, and names nothing outside /admin.
 */
function expectCleanPage(html: string, path: string) {
  expect(html, path).toMatch(/^<!doctype html>\n<html lang="ru">/);
  expect(html, path).not.toMatch(/<script|<style|<iframe|<object|<embed|<base|<meta http-equiv/i);
  // every "<" a visitor typed is written as "&lt;", so whatever opens with "<" here is a tag of the page itself
  for (const [tag] of html.matchAll(/<[a-zA-Z][^>]*>/g)) {
    expect(tag, path).not.toMatch(/\sstyle\s*=|\son[a-z]+\s*=|javascript:|data:/i);
    for (const match of tag.matchAll(/\s(href|src|action)="([^"]*)"/g)) expect(match[2], `${path}: ${tag}`).toMatch(/^\/admin\//);
    if (tag.startsWith('<form')) expect(tag, path).toMatch(/method="(post|get)"/);
  }
}

let sender = 0;
/** A visitor sends a message; each one from an address of its own, a second after the one before. */
async function visitor(run: Running, changed: Record<string, string | undefined> = {}, files: Part[] = []) {
  run.clock.now += 1000;
  sender = (sender % 250) + 1;
  const reply = await send(run, [...fields(run.clock, changed), ...files], { 'X-Forwarded-For': `192.0.2.${sender}` });
  expect(reply.json).toEqual({ ok: true });
  return stored(run.dir).at(-1)!;
}

describe('without a login the author’s page gives nothing', () => {
  it('sends every address under /admin to the login page, and says nothing of what it keeps', async () => {
    const run = await start();
    const record = await visitor(run, { message: 'SECRET-TEXT of a visitor.', contact: 'SECRET-CONTACT' }, [shot(PNG, 'SECRET-NAME.png')]);
    const paths = ['/admin/', '/admin/?q=SECRET', `/admin/m/${record.id}`, `/admin/m/${record.id}/file/1`, '/admin/nothing', '/admin/m/../..', '/admin/assets/../m/x', '/admin/login/../'];
    for (const cookie of [undefined, `${COOKIE}=${'A'.repeat(43)}`, `${COOKIE}=`, `other=1; ${COOKIE}=../../x`, 'sc_admin=1']) {
      for (const path of paths) {
        const reply = await admin(run, path, { cookie });
        expect(reply.status, path).toBe(303);
        expect(reply.headers.location).toBe('/admin/login');
        expect(reply.text).not.toMatch(/SECRET/);
        expect(reply.headers['set-cookie']).toBeUndefined();
      }
    }
  });

  it('does nothing it is asked to do: a message stays where it is', async () => {
    const run = await start();
    const record = await visitor(run, {}, [shot()]);
    for (const path of [`/admin/m/${record.id}/delete`, '/admin/logout', '/admin/']) {
      const reply = await admin(run, path, { form: { csrf: 'x', confirm: 'yes' } });
      expect(reply.status, path).toBe(303);
      expect(reply.headers.location).toBe('/admin/login');
    }
    expect(stored(run.dir)).toHaveLength(1);
    expect(listFiles(run.dir)).toHaveLength(2);
  });

  it('shows the login page: a form with one field, the password, and no cookie', async () => {
    const run = await start();
    const reply = await admin(run, '/admin/login');
    expect(reply.status).toBe(200);
    expect(reply.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(reply.headers['set-cookie']).toBeUndefined();
    expect(reply.text).toContain('<form method="post" action="/admin/login"');
    expect(reply.text).toMatch(/<input[^>]*type="password"[^>]*name="password"[^>]*autocomplete="current-password"[^>]*required/);
    expect(reply.text.match(/<input/g)).toHaveLength(1);
    expect(reply.text).toContain('<link rel="stylesheet" href="/admin/assets/admin.css">');
  });

  it('answers /admin without the slash with a redirect to /admin/, not with 404', async () => {
    const run = await start();
    for (const path of ['/admin', '/admin?q=1']) {
      const reply = await admin(run, path);
      expect(reply.status).toBe(308);
      expect(reply.headers.location).toBe('/admin/');
    }
    // and an address that only begins like it is not the author's page at all
    const other = await rawAdmin(run, '/administrator');
    expect(other.status).toBe(404);
    expect(other.headers['content-type']).toBe('application/json; charset=utf-8');
  });

  it('hands its style sheet to anyone: there is nothing in it but the look of the pages', async () => {
    const run = await start();
    const reply = await admin(run, '/admin/assets/admin.css');
    expect(reply.status).toBe(200);
    expect(reply.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(reply.text).toContain('color-scheme: dark');
    expect(reply.text).not.toMatch(/url\(|@import|expression\(|https?:/);
    for (const path of ['/admin/assets/', '/admin/assets/admin.js', '/admin/assets/../../config.json', '/admin/assets/admin.css/', '/admin/assets/%2e%2e/main.mjs']) {
      expect((await admin(run, path)).status, path).toBe(303);
    }
  });
});

describe('the login', () => {
  it('lets the author in with the password and gives the session a cookie for /admin only', async () => {
    const run = await start();
    const reply = await admin(run, '/admin/login', { form: { password: PASSWORD } });
    expect(reply.status).toBe(303);
    expect(reply.headers.location).toBe('/admin/');
    expect(reply.headers['set-cookie']).toHaveLength(1);
    expect(reply.headers['set-cookie']![0]).toMatch(new RegExp(`^${COOKIE}=[A-Za-z0-9_-]{43}; Path=/admin; Max-Age=43200; HttpOnly; Secure; SameSite=Strict$`));
    const list = await admin(run, '/admin/', { cookie: cookieOf(reply) });
    expect(list.status).toBe(200);
    expect(list.text).toContain('<h1>Обращения</h1>');
    // the page of the login now leads straight in
    const again = await admin(run, '/admin/login', { cookie: cookieOf(reply) });
    expect(again.status).toBe(303);
    expect(again.headers.location).toBe('/admin/');
  });

  it('refuses a wrong password, says so in Russian, sets no cookie — and writes no password to the log', async () => {
    const run = await start();
    for (const password of ['', 'wrong', `${PASSWORD} `, PASSWORD.toUpperCase(), 'WRONG-MARKER']) {
      const reply = await admin(run, '/admin/login', { form: { password } });
      expect(reply.status, password).toBe(401);
      expect(reply.text).toContain('Неверный пароль');
      expect(reply.text).not.toContain('WRONG-MARKER');
      expect(reply.headers['set-cookie']).toBeUndefined();
    }
    await login(run, { 'X-Forwarded-For': '198.51.100.201' });
    expect(run.lines.filter((line) => / admin login /.test(line)).map((line) => line.replace(/^\S+ /, ''))).toEqual([...Array.from({ length: 5 }, () => 'admin login wrong status=401'), 'admin login ok status=303']);
    const log = run.lines.join('\n');
    expect(log).not.toContain(PASSWORD);
    expect(log).not.toMatch(/WRONG-MARKER|198\.51\.100/);
  });

  it('after five wrong passwords from an address takes none from it for fifteen minutes — not even the right one', async () => {
    const run = await start();
    for (let n = 1; n <= 5; n++) expect((await admin(run, '/admin/login', { form: { password: `wrong ${n}` } })).status).toBe(401);
    const locked = await admin(run, '/admin/login', { form: { password: PASSWORD } });
    expect(locked.status).toBe(429);
    expect(locked.text).toContain('Слишком много неверных паролей');
    expect(locked.headers['set-cookie']).toBeUndefined();
    // the address is the one the web server in front wrote, whatever the sender put before it
    expect((await admin(run, '/admin/login', { form: { password: PASSWORD }, headers: { 'X-Forwarded-For': `10.0.0.1, ${AUTHOR}` } })).status).toBe(429);
    // another address is not held back
    await login(run, { 'X-Forwarded-For': '198.51.100.201' });

    run.clock.now += 15 * 60_000 - 1000;
    expect((await admin(run, '/admin/login', { form: { password: PASSWORD } })).status).toBe(429);
    run.clock.now += 2000;
    await login(run);
    expect(run.lines.some((line) => / admin login locked status=429$/.test(line))).toBe(true);
  });

  it('counts wrong passwords sent at the same moment one by one: the sixth is not even looked at', async () => {
    const run = await start();
    const all = await Promise.all(Array.from({ length: 12 }, (_, n) => admin(run, '/admin/login', { form: { password: `wrong ${n}` } })));
    const statuses = all.map((reply) => reply.status);
    // five are looked at and found wrong; the rest are turned away: the address is shut out, or too many wait already
    expect(statuses.filter((status) => status === 401)).toHaveLength(5);
    expect(statuses.every((status) => status === 401 || status === 429 || status === 503)).toBe(true);
    expect(run.lines.filter((line) => / admin login wrong /.test(line))).toHaveLength(5);
    expect((await admin(run, '/admin/login', { form: { password: PASSWORD } })).status).toBe(429);
  });

  it('remembers who tried for fifteen minutes and no longer, as an HMAC and never as the address', async () => {
    const run = await start();
    expect((await admin(run, '/admin/login', { form: { password: 'wrong' } })).status).toBe(401);
    const limiter = run.service.loginLimiter;
    // the address that tried, and the count of wrong passwords of everybody together
    expect(limiter.keys()).toEqual([`login:${limiter.addressKey(AUTHOR)}`, 'wrong:all']);
    expect(JSON.stringify(limiter.keys())).not.toContain(AUTHOR);
    // the limiter of the form knows nothing of it
    expect(run.service.limiter.size()).toBe(0);
    run.clock.now += 15 * 60_000 + 1;
    limiter.prune();
    expect(limiter.size()).toBe(0);
  });

  it('slows everybody down when wrong passwords come from many addresses — and never shuts the author out for what strangers do', async () => {
    const run = await start();
    expect(run.settings.limits.loginSlowAfter).toBe(30);
    expect(run.settings.limits.loginSlowMs).toBe(1000);
    // thirty wrong passwords in a quarter of an hour, each from an address of its own: none of the addresses is shut out
    for (let n = 1; n <= 30; n++) {
      const reply = await admin(run, '/admin/login', { form: { password: `a wrong password, number ${n}` }, headers: { 'X-Forwarded-For': `198.18.1.${n}` } });
      expect(reply.status).toBe(401);
    }
    // so far nobody was made to wait
    expect(run.sleeps).toEqual([]);

    // from now on one password a second is looked at, whoever sends it
    const began = run.clock.now;
    expect((await admin(run, '/admin/login', { form: { password: 'one more wrong password' }, headers: { 'X-Forwarded-For': '198.18.2.1' } })).status).toBe(401);
    expect((await admin(run, '/admin/login', { form: { password: 'and another wrong one' }, headers: { 'X-Forwarded-For': '198.18.2.2' } })).status).toBe(401);
    expect(run.sleeps).toEqual([1000, 1000]);
    expect(run.clock.now - began).toBe(2000);

    // the author, from his own address, with the right password: a second later he is in — not refused
    const cookie = await login(run);
    expect(run.sleeps).toEqual([1000, 1000, 1000]);
    expect((await admin(run, '/admin/', { cookie })).status).toBe(200);
    // an address that has not tried five times is not told "too many wrong passwords" for what the others did
    expect(run.lines.filter((line) => / admin login locked /.test(line))).toEqual([]);

    // a check that comes later than a second after the one before is not made to wait at all
    run.clock.now += 5000;
    expect((await admin(run, '/admin/login', { form: { password: 'wrong again' }, headers: { 'X-Forwarded-For': '198.18.2.3' } })).status).toBe(401);
    expect(run.sleeps).toHaveLength(3);

    // a quarter of an hour without wrong passwords, and everything is as fast as before
    run.clock.now += 15 * 60_000 + 1000;
    await login(run);
    expect((await admin(run, '/admin/login', { form: { password: 'wrong, long after' }, headers: { 'X-Forwarded-For': '198.18.2.4' } })).status).toBe(401);
    expect(run.sleeps).toHaveLength(3);
  });

  it('gives every login a session of its own, and closes the one the browser came with', async () => {
    const run = await start();
    const first = await login(run);
    const second = await login(run);
    expect(second).not.toBe(first);
    expect((await admin(run, '/admin/', { cookie: first })).status).toBe(200);
    // a login from a browser that already has a session: the old one is over
    const reply = await admin(run, '/admin/login', { form: { password: PASSWORD }, cookie: first });
    const third = cookieOf(reply)!;
    expect(new Set([first, second, third]).size).toBe(3);
    expect((await admin(run, '/admin/', { cookie: first })).status).toBe(303);
    expect((await admin(run, '/admin/', { cookie: second })).status).toBe(200);
    expect((await admin(run, '/admin/', { cookie: third })).status).toBe(200);
  });

  it('ends a session after twelve hours', async () => {
    const run = await start();
    const cookie = await login(run);
    run.clock.now += 12 * HOUR_MS - 1000;
    expect((await admin(run, '/admin/', { cookie })).status).toBe(200);
    run.clock.now += 1000;
    const late = await admin(run, '/admin/', { cookie });
    expect(late.status).toBe(303);
    expect(late.headers.location).toBe('/admin/login');
  });

  it('keeps sessions in memory only: a service started again knows none of them', async () => {
    const run = await start();
    const cookie = await login(run);
    await visitor(run);
    await run.stop();
    expect(readFileSync(join(run.dir, 'messages', `${stored(run.dir)[0].id}.json`), 'utf8')).not.toContain(cookie.split('=')[1]);
    expect(listFiles(run.dir)).toHaveLength(1);
    const again = await start({ dir: run.dir });
    expect((await admin(again, '/admin/', { cookie })).status).toBe(303);
  });

  it('does not look at a password that another site sends, and does not count it', async () => {
    const run = await start();
    for (const origin of ['https://evil.example.test', 'null', `http://site.example.test`]) {
      const reply = await admin(run, '/admin/login', { form: { password: PASSWORD }, headers: { Origin: origin } });
      expect(reply.status, origin).toBe(403);
      expect(reply.headers['set-cookie']).toBeUndefined();
    }
    expect(run.service.loginLimiter.size()).toBe(0);
    expect(run.lines.filter((line) => / admin login /.test(line))).toEqual([]);
  });

  it('takes the password from a small form only', async () => {
    const run = await start();
    const big = await admin(run, '/admin/login', { form: { password: 'x'.repeat(20_000) } });
    expect(big.status).toBe(413);
    const json = await admin(run, '/admin/login', { body: JSON.stringify({ password: PASSWORD }), headers: { 'Content-Type': 'application/json' } });
    expect(json.status).toBe(415);
    const query = await admin(run, `/admin/login?password=${encodeURIComponent(PASSWORD)}`, { form: {} });
    expect(query.status).toBe(401);
    for (const method of ['PUT', 'DELETE', 'PATCH']) expect((await admin(run, '/admin/login', { method })).status).toBe(405);
  });
});

describe('the list of messages', () => {
  it('shows the newest first, twenty to a page', async () => {
    const run = await start();
    for (let n = 1; n <= 25; n++) await visitor(run, { message: `Message number ${String(n).padStart(2, '0')} of the list.`, contact: `sender-${n}` });
    const cookie = await login(run);
    const numbers = (html: string) => [...html.matchAll(/Message number (\d\d) of the list\./g)].map((match) => Number(match[1]));

    const first = await admin(run, '/admin/', { cookie });
    expect(first.status).toBe(200);
    expect(numbers(first.text)).toEqual(Array.from({ length: 20 }, (_, index) => 25 - index));
    expect(first.text).toContain('Всего: 25');
    expect(first.text).toContain('<a href="/admin/?page=2" rel="next">');
    expect(first.text).not.toContain('rel="prev"');

    const second = await admin(run, '/admin/?page=2', { cookie });
    expect(numbers(second.text)).toEqual([5, 4, 3, 2, 1]);
    expect(second.text).toContain('<a href="/admin/" rel="prev">');
    expect(second.text).not.toContain('rel="next"');

    // a page that is not there is the nearest one that is
    for (const page of ['3', '999999999999', '0', '-1', 'abc', '1.5', '']) {
      const reply = await admin(run, `/admin/?page=${page}`, { cookie });
      expect(reply.status, page).toBe(200);
      expect(numbers(reply.text)).toHaveLength(page === '3' || page === '999999999999' ? 5 : 20);
    }
  });

  it('says of every message when it came, who it is from, how it begins and how many files it has', async () => {
    const run = await start();
    const record = await visitor(run, { message: `First line of the message.\r\nSecond line. ${'A long tail. '.repeat(40)}`, contact: 'pilot#42', lang: 'en' }, [shot(), logFile()]);
    await visitor(run, { message: 'A message with no contact.', contact: '' });
    const reply = await admin(run, '/admin/', { cookie: await login(run) });
    expect(reply.text).toContain(`<a href="/admin/m/${record.id}">`);
    expect(reply.text).toContain('<time datetime="2026-10-10T12:00:01.000Z">10.10.2026 12:00 UTC</time>');
    expect(reply.text).toContain('pilot#42');
    expect(reply.text).toContain('First line of the message. Second line. A long tail.');
    expect(reply.text).not.toContain('A long tail. '.repeat(30));
    expect(reply.text).toContain('файлов: 2');
    expect(reply.text).toContain('без контакта');
  });

  it('finds a message by its text, its contact, the name of a file and its day', async () => {
    const run = await start();
    await visitor(run, { message: 'Цена КВАНТАНИУМА на Area 18 неверная.', contact: 'Пилот_Иван' });
    await visitor(run, { message: 'The route to Lorville is missing.', contact: 'someone@discord' }, [shot(PNG, 'lorville-terminal.png')]);
    run.clock.now = START + 3 * DAY_MS;
    await visitor(run, { message: 'Sent three days later, nothing else in common.', contact: '' });
    const cookie = await login(run);
    const found = async (q: string) => {
      const reply = await admin(run, `/admin/?q=${encodeURIComponent(q)}`, { cookie });
      expect(reply.status).toBe(200);
      return ['КВАНТАНИУМА', 'Lorville is missing', 'three days later'].filter((mark) => reply.text.includes(mark));
    };
    expect(await found('квантаниума')).toEqual(['КВАНТАНИУМА']);
    expect(await found('  LORVILLE  ')).toEqual(['Lorville is missing']);
    expect(await found('пилот_иван')).toEqual(['КВАНТАНИУМА']);
    expect(await found('someone@discord')).toEqual(['Lorville is missing']);
    expect(await found('lorville-terminal')).toEqual(['Lorville is missing']);
    expect(await found('2026-10-13')).toEqual(['three days later']);
    expect(await found('13.10.2026')).toEqual(['three days later']);
    expect(await found('2026-10-10')).toEqual(['КВАНТАНИУМА', 'Lorville is missing']);
    expect(await found('')).toHaveLength(3);
    expect(await found('no such thing anywhere')).toEqual([]);

    const none = await admin(run, '/admin/?q=no+such+thing', { cookie });
    expect(none.text).toContain('Ничего не найдено');
    // the words of the search are put back into the field as text
    const odd = await admin(run, `/admin/?q=${encodeURIComponent('"><script>alert(1)</script>')}`, { cookie });
    expect(odd.text).toContain('value="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
  });

  it('keeps the words of the search in the links to the other pages', async () => {
    const run = await start();
    for (let n = 1; n <= 22; n++) await visitor(run, { message: `Same words & more, number ${n}.` });
    await visitor(run, { message: 'Something else entirely.' });
    const cookie = await login(run);
    const first = await admin(run, `/admin/?q=${encodeURIComponent('words & more')}`, { cookie });
    expect(first.text).toContain('Найдено: 22');
    expect(first.text).toContain('<a href="/admin/?q=words%20%26%20more&amp;page=2" rel="next">');
    const second = await admin(run, '/admin/?q=words%20%26%20more&page=2', { cookie });
    expect(second.text.match(/Same words &amp; more, number/g)).toHaveLength(2);
    expect(second.text).toContain('<a href="/admin/?q=words%20%26%20more" rel="prev">');
  });

  it('does not show a message that has reached its term, even before the daily check removed it', async () => {
    const run = await start();
    const record = await visitor(run);
    run.clock.now = START + 180 * DAY_MS + 2000;
    const cookie = await login(run);
    expect((await admin(run, '/admin/', { cookie })).text).toContain('Всего: 0');
    expect((await admin(run, `/admin/m/${record.id}`, { cookie })).status).toBe(404);
  });
});

describe('one message', () => {
  it('is shown whole: the text with its line breaks, the contact, the language, the time, the files', async () => {
    const run = await start();
    const record = await visitor(run, { message: 'Line one.\r\nLine two.\r\n\r\nLine four.', contact: 'pilot#42', lang: 'en' }, [shot(PNG, 'terminal.png'), logFile(LOG_TEXT, 'sctrade.log')]);
    const reply = await admin(run, `/admin/m/${record.id}`, { cookie: await login(run) });
    expect(reply.status).toBe(200);
    expect(reply.text).toContain('<pre class="message">Line one.\nLine two.\n\nLine four.</pre>');
    expect(reply.text).toContain('pilot#42');
    expect(reply.text).toContain('<time datetime="2026-10-10T12:00:01.000Z">10.10.2026 12:00 UTC</time>');
    expect(reply.text).toContain('английский');
    expect(reply.text).toContain(`<a href="/admin/m/${record.id}/file/1"`);
    expect(reply.text).toContain(`<img class="thumb" src="/admin/m/${record.id}/file/1" alt="" loading="lazy">`);
    expect(reply.text).toContain(`<a href="/admin/m/${record.id}/file/2"`);
    expect(reply.text.match(/<img /g)).toHaveLength(1); // the log is a link, not a picture
    expect(reply.text).toContain('terminal.png');
    expect(reply.text).toContain('sctrade.log');
    expect(reply.text).toContain(`${PNG.length} Б`);
    expect(reply.text).toContain('<a href="/admin/">');
    // the form that deletes it, with the token of the session and a tick to confirm
    expect(reply.text).toContain(`<form method="post" action="/admin/m/${record.id}/delete"`);
    expect(reply.text).toMatch(/<input type="checkbox" name="confirm" value="yes" required>/);
    expect(csrfOf(reply.text)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('shows what a visitor typed as text, whatever it is: a script in the message, the contact or a file name runs nowhere', async () => {
    const run = await start();
    const attack = '<script>alert(document.cookie)</script><img src=x onerror=alert(1)>"\'&';
    const record = await visitor(run, { message: `${attack} and some more text.`, contact: `"><script>alert(2)</script>` }, [
      shot(PNG, '<script>alert(3)<b>.png'),
      logFile(LOG_TEXT, `<svg onload=alert(4)>.log`),
    ]);
    const cookie = await login(run);
    for (const path of [`/admin/m/${record.id}`, '/admin/', `/admin/?q=${encodeURIComponent('<script>')}`]) {
      const reply = await admin(run, path, { cookie });
      expect(reply.status).toBe(200);
      expect(reply.text, path).not.toMatch(/<script|<img src=x|<svg|<b>/);
      expect(reply.text, path).toContain('&lt;script&gt;alert(document.cookie)&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;');
      expect(reply.text, path).toContain('&quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt;');
    }
    const one = (await admin(run, `/admin/m/${record.id}`, { cookie })).text;
    expect(one).toContain('&lt;script&gt;alert(3)&lt;b&gt;.png');
    expect(one).toContain('&lt;svg onload=alert(4)&gt;.log');
  });

  it('is not found under an id that is not an id: nothing a visitor or a browser types becomes a path', async () => {
    const run = await start();
    const record = await visitor(run, {}, [shot()]);
    const cookie = await login(run);
    const paths = [
      '/admin/m/../..',
      '/admin/m/..%2f..',
      '/admin/m/%2e%2e',
      '/admin/m/..',
      '/admin/m/',
      '/admin/m',
      `/admin/m/${record.id.toUpperCase()}`,
      `/admin/m/${record.id}0`,
      `/admin/m/${record.id.slice(1)}`,
      `/admin/m/${record.id}/`,
      `/admin/m/${record.id}/../${record.id}`,
      `/admin/m/${record.id}%00`,
      `/admin/m/${record.id}.json`,
      `/admin/m/${'f'.repeat(32)}`,
      `/admin/messages/${record.id}.json`,
      '/admin/../api/',
      '/admin//',
    ];
    for (const path of paths) {
      const reply = await admin(run, path, { cookie });
      expect(reply.status, path).toBe(404);
      expect(reply.text).toContain('Такой страницы нет');
    }
    expect((await admin(run, `/admin/m/${record.id}`, { cookie })).status).toBe(200);
  });
});

describe('an address made to break the author’s page', () => {
  it('is answered with a page that is not found or a redirect to the login — never with an error, never with a file', async () => {
    const run = await start();
    const record = await visitor(run, { message: 'SECRET-TEXT that only the author may read.' }, [shot()]);
    const cookie = await login(run);
    // a stream of numbers that is the same every time
    let state = 20261010;
    const pick = (below: number) => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state % below;
    };
    const pieces = ['/', '//', '.', '..', '%2e%2e', '%2f', '%5c', '%00', '%0d%0a', '?', '&', '=', ';', '~', '*', 'm', 'file', 'delete', 'login', 'logout', 'assets', 'admin.css', 'messages', 'files', 'tmp', record.id, record.id.slice(0, 16), record.files[0].stored, '1', '0', '-1', '99', 'config.json', 'etc', 'passwd', 'C:', '@', '+', ',', "'", '(', ')', '!', '$'];
    const methods = ['GET', 'GET', 'GET', 'HEAD', 'POST', 'PUT', 'DELETE'];
    for (let n = 0; n < 300; n++) {
      const path = `/admin/${Array.from({ length: 1 + pick(7) }, () => pieces[pick(pieces.length)]).join(pick(3) === 0 ? '' : '/')}`;
      const method = methods[pick(methods.length)];
      for (const session of [cookie, undefined]) {
        const reply = await admin(run, path, { method, cookie: session, ...(method === 'POST' ? { form: { csrf: 'x', confirm: 'yes' } } : {}) });
        const where = `${method} ${path} ${session === undefined ? 'without' : 'with'} a session`;
        expect(reply.status, where).toBeLessThan(500);
        if (session === undefined) {
          // without a session: the login page, its style sheet, or the way to the login — and not a word of a message
          expect([200, 303, 401, 403, 405, 413, 415, 429]).toContain(reply.status);
          expect(reply.text, where).not.toContain('SECRET-TEXT');
          if (reply.status === 200) expect(path.split('?')[0], where).toMatch(/^\/admin\/(login|assets\/admin\.css)$/);
        } else {
          expect([200, 303, 400, 401, 403, 404, 405, 413, 415, 429], where).toContain(reply.status);
          // a page or a file comes only from an address of the exact shape of one
          if (reply.status === 200) expect(path.split('?')[0], where).toMatch(new RegExp(`^/admin/(|assets/admin\\.css|m/${record.id}|m/${record.id}/file/1)$`));
        }
      }
    }
    // nothing was deleted or changed by all of it, and no line of the log is an error
    expect(stored(run.dir)).toHaveLength(1);
    expect(listFiles(run.dir)).toHaveLength(2);
    expect(run.lines.filter((line) => / error /.test(line))).toEqual([]);
  }, 60_000);
});

describe('a file of a message', () => {
  it('is handed to the author as a download, with the type its content has and "nosniff"', async () => {
    const run = await start();
    const polyglot = Buffer.concat([PNG, Buffer.from('<script>alert(document.cookie)</script>')]);
    const record = await visitor(run, {}, [shot(polyglot, 'x.html', 'text/html'), logFile('<html><script>alert(1)</script>\n', 'page.html', 'text/html')]);
    const cookie = await login(run);

    const picture = await admin(run, `/admin/m/${record.id}/file/1`, { cookie });
    expect(picture.status).toBe(200);
    expect(picture.headers['content-type']).toBe('image/png');
    expect(picture.headers['content-disposition']).toBe('attachment; filename="sc-trade-20261010-120001-1.png"');
    expect(picture.headers['x-content-type-options']).toBe('nosniff');
    expect(picture.headers['content-length']).toBe(String(polyglot.length));
    expect(picture.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(picture.headers['cross-origin-resource-policy']).toBe('same-origin');
    expect(picture.bytes.equals(polyglot)).toBe(true);

    const text = await admin(run, `/admin/m/${record.id}/file/2`, { cookie });
    expect(text.status).toBe(200);
    expect(text.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(text.headers['content-disposition']).toBe('attachment; filename="sc-trade-20261010-120001-2.txt"');
    expect(text.headers['x-content-type-options']).toBe('nosniff');
    expect(text.text).toBe('<html><script>alert(1)</script>\n');
    // the name the visitor gave is in no header
    expect(JSON.stringify([picture.headers, text.headers])).not.toMatch(/x\.html|page\.html/);
  });

  it('arrives byte for byte', async () => {
    const run = await start();
    const bytes = Buffer.concat([PNG, Buffer.from(Array.from({ length: 70_000 }, (_, index) => index % 251))]);
    const record = await visitor(run, {}, [shot(bytes)]);
    const cookie = await login(run);
    const reply = await admin(run, `/admin/m/${record.id}/file/1`, { cookie });
    expect(reply.headers['content-length']).toBe(String(bytes.length));
    expect(reply.bytes.equals(bytes)).toBe(true);
  });

  it('is asked for by the number it has in its message, and by nothing else', async () => {
    const run = await start();
    const record = await visitor(run, {}, [shot(), logFile()]);
    const other = await visitor(run, {}, [shot()]);
    const cookie = await login(run);
    const name = record.files[0].stored;
    for (const tail of ['0', '3', '-1', '1.5', '01', '1e0', 'abc', '', '1/', '1/../2', `../${other.id}/file/1`, name, `..%2f${name}`, '%31', '1%00', '99999999999999999999']) {
      const reply = await admin(run, `/admin/m/${record.id}/file/${tail}`, { cookie });
      expect(reply.status, tail).toBe(404);
    }
    expect((await admin(run, `/admin/m/${other.id}/file/2`, { cookie })).status).toBe(404);
    expect((await admin(run, `/admin/m/${record.id}/file/2`, { cookie })).status).toBe(200);
    for (const method of ['POST', 'PUT', 'DELETE']) expect((await admin(run, `/admin/m/${record.id}/file/1`, { cookie, method })).status, method).toBe(405);
  });

  it('is not there when its file is gone from the disk or is not a plain file', async () => {
    const run = await start();
    const record = await visitor(run, {}, [shot(), shot()]);
    const cookie = await login(run);
    rmSync(join(run.dir, 'files', record.id, record.files[0].stored));
    rmSync(join(run.dir, 'files', record.id, record.files[1].stored));
    mkdirSync(join(run.dir, 'files', record.id, record.files[1].stored));
    expect((await admin(run, `/admin/m/${record.id}/file/1`, { cookie })).status).toBe(404);
    expect((await admin(run, `/admin/m/${record.id}/file/2`, { cookie })).status).toBe(404);
  });
});

describe('deleting a message', () => {
  it('needs the token of the session: a request without it, with a wrong one or with the token of another session does nothing', async () => {
    const run = await start();
    const record = await visitor(run, {}, [shot()]);
    const cookie = await login(run);
    const otherCookie = await login(run, { 'X-Forwarded-For': '198.51.100.201' });
    const otherToken = csrfOf((await admin(run, `/admin/m/${record.id}`, { cookie: otherCookie })).text);
    const token = csrfOf((await admin(run, `/admin/m/${record.id}`, { cookie })).text);
    expect(otherToken).not.toBe(token);
    const path = `/admin/m/${record.id}/delete`;

    for (const form of [{ confirm: 'yes' }, { csrf: '', confirm: 'yes' }, { csrf: 'x'.repeat(43), confirm: 'yes' }, { csrf: otherToken, confirm: 'yes' }, { csrf: token.slice(0, -1), confirm: 'yes' }] as Array<Record<string, string>>) {
      const reply = await admin(run, path, { cookie, form });
      expect(reply.status, JSON.stringify(form)).toBe(403);
      expect(reply.text).toContain('Действие отклонено');
    }
    // the token in the address instead of the form, a request of another site, another method
    expect((await admin(run, `${path}?csrf=${token}&confirm=yes`, { cookie, form: {} })).status).toBe(403);
    expect((await admin(run, path, { cookie, form: { csrf: token, confirm: 'yes' }, headers: { Origin: 'https://evil.example.test' } })).status).toBe(403);
    expect((await admin(run, path, { cookie })).status).toBe(405);
    expect((await admin(run, `${path}?csrf=${token}&confirm=yes`, { cookie })).status).toBe(405);
    // the right token, but the tick that confirms is missing
    const unsure = await admin(run, path, { cookie, form: { csrf: token } });
    expect(unsure.status).toBe(400);
    expect(unsure.text).toContain('Поставь галочку');

    expect(stored(run.dir)).toHaveLength(1);
    expect(listFiles(run.dir)).toHaveLength(2);
    expect(run.lines.filter((line) => / admin delete /.test(line))).toEqual([]);
  });

  it('removes the message and its files, and the list no longer has it', async () => {
    const run = await start();
    const gone = await visitor(run, { message: 'This one is deleted on request.' }, [shot(), shot(), logFile()]);
    const stays = await visitor(run, { message: 'This one stays where it is.' }, [shot()]);
    const cookie = await login(run);
    const token = csrfOf((await admin(run, `/admin/m/${gone.id}`, { cookie })).text);

    const reply = await admin(run, `/admin/m/${gone.id}/delete`, { cookie, form: { csrf: token, confirm: 'yes' } });
    expect(reply.status).toBe(303);
    expect(reply.headers.location).toBe('/admin/');
    expect(listFiles(run.dir)).toEqual([`files/${stays.id}/${stays.files[0].stored}`, `messages/${stays.id}.json`]);
    expect(existsSync(join(run.dir, 'files', gone.id))).toBe(false);

    const list = await admin(run, '/admin/', { cookie });
    expect(list.text).toContain('This one stays where it is.');
    expect(list.text).not.toContain('deleted on request');
    expect((await admin(run, `/admin/m/${gone.id}`, { cookie })).status).toBe(404);
    expect((await admin(run, `/admin/m/${gone.id}/file/1`, { cookie })).status).toBe(404);
    // asked again: there is nothing to delete
    expect((await admin(run, `/admin/m/${gone.id}/delete`, { cookie, form: { csrf: token, confirm: 'yes' } })).status).toBe(404);
    expect(run.lines.filter((line) => / admin delete /.test(line)).map((line) => line.replace(/^\S+ /, ''))).toEqual(['admin delete ok status=303 count=1']);
  });

  it('is not done for an id that is not one', async () => {
    const run = await start();
    await visitor(run, {}, [shot()]);
    const cookie = await login(run);
    const token = csrfOf((await admin(run, '/admin/', { cookie })).text);
    for (const id of ['..', '../..', '%2e%2e', `${'f'.repeat(32)}/..`, '*', '']) {
      const reply = await admin(run, `/admin/m/${id}/delete`, { cookie, form: { csrf: token, confirm: 'yes' } });
      expect(reply.status, id).toBe(404);
    }
    expect(listFiles(run.dir)).toHaveLength(2);
  });
});

describe('deleting several messages at once', () => {
  /** Five messages, oldest first. */
  async function five(run: Running) {
    const records = [];
    for (let n = 1; n <= 5; n++) records.push(await visitor(run, { message: `Message ${n} of five, ${n % 2 === 0 ? 'even' : 'odd'}.` }, n === 1 ? [shot()] : []));
    return records;
  }
  const texts = (html: string) => [...html.matchAll(/Message (\d) of five/g)].map((match) => Number(match[1]));

  it('the list has a box to tick for every message and one button for the ticked ones', async () => {
    const run = await start();
    const records = await five(run);
    const page = (await admin(run, '/admin/', { cookie: await login(run) })).text;
    expect(page).toContain('<form method="post" action="/admin/delete"');
    for (const record of records) expect(page).toMatch(new RegExp(`<input type="checkbox" name="id" value="${record.id}" aria-label="[^"<>]*">`));
    expect(page).toMatch(/<input type="checkbox" name="confirm" value="yes" required>[^<]*Удалить отмеченные навсегда/);
    expect(page).toMatch(/<button type="submit" class="danger">Удалить отмеченные<\/button>/);
    // one token for every form of the page
    expect(new Set([...page.matchAll(/name="csrf" value="([^"]+)"/g)].map((match) => match[1])).size).toBe(1);
  });

  it('removes the ticked ones with their files, and no other', async () => {
    const run = await start();
    const records = await five(run);
    const cookie = await login(run);
    const csrf = csrfOf((await admin(run, '/admin/', { cookie })).text);
    const body = new URLSearchParams([['csrf', csrf], ['confirm', 'yes'], ['id', records[0].id], ['id', records[2].id], ['id', records[4].id]]).toString();
    const reply = await admin(run, '/admin/delete', { cookie, body });
    expect(reply.status).toBe(303);
    expect(reply.headers.location).toBe('/admin/');
    expect(texts((await admin(run, '/admin/', { cookie })).text)).toEqual([4, 2]);
    expect(listFiles(run.dir)).toEqual([`messages/${records[1].id}.json`, `messages/${records[3].id}.json`]);
    expect(run.lines.filter((line) => / admin delete /.test(line)).map((line) => line.replace(/^\S+ /, ''))).toEqual(['admin delete ok status=303 count=3']);
  });

  it('goes back to the search it was started from', async () => {
    const run = await start();
    const records = await five(run);
    const cookie = await login(run);
    const csrf = csrfOf((await admin(run, '/admin/?q=even', { cookie })).text);
    const reply = await admin(run, '/admin/delete', { cookie, form: { csrf, confirm: 'yes', id: records[1].id, q: 'even' } });
    expect(reply.status).toBe(303);
    expect(reply.headers.location).toBe('/admin/?q=even');
    // where it goes back to is made by the service from the words of the search, never taken as an address
    const odd = await admin(run, '/admin/delete', { cookie, form: { csrf, confirm: 'yes', id: records[3].id, q: 'https://evil.example.test/' } });
    expect(odd.headers.location).toBe('/admin/?q=https%3A%2F%2Fevil.example.test%2F');
  });

  it('does nothing without the token, without the tick that confirms, with nothing ticked or with an id that is not one', async () => {
    const run = await start();
    const records = await five(run);
    const cookie = await login(run);
    const csrf = csrfOf((await admin(run, '/admin/', { cookie })).text);
    const post = (pairs: Array<[string, string]>, headers: Record<string, string> = {}) => admin(run, '/admin/delete', { cookie, body: new URLSearchParams(pairs).toString(), headers });
    const all: Array<[string, string]> = records.map((record) => ['id', record.id]);

    expect((await post([['confirm', 'yes'], ...all])).status).toBe(403);
    expect((await post([['csrf', 'x'.repeat(43)], ['confirm', 'yes'], ...all])).status).toBe(403);
    expect((await post([['csrf', csrf], ['confirm', 'yes'], ...all], { Origin: 'https://evil.example.test' })).status).toBe(403);
    const unsure = await post([['csrf', csrf], ...all]);
    expect(unsure.status).toBe(400);
    expect(unsure.text).toContain('Поставь галочку');
    const none = await post([['csrf', csrf], ['confirm', 'yes']]);
    expect(none.status).toBe(400);
    expect(none.text).toContain('Ничего не отмечено');
    // one id that is not an id among good ones: the whole request is refused, the good ones stay too
    for (const bad of ['..', '../..', `${records[0].id}/..`, records[0].id.toUpperCase(), '*', '']) {
      const reply = await post([['csrf', csrf], ['confirm', 'yes'], ['id', records[1].id], ['id', bad]]);
      expect(reply.status, bad).toBe(400);
    }
    // more boxes than a page has
    expect((await post([['csrf', csrf], ['confirm', 'yes'], ...Array.from({ length: 30 }, (): [string, string] => ['id', records[0].id])])).status).toBe(400);
    expect((await admin(run, '/admin/delete', { cookie })).status).toBe(405);
    expect((await admin(run, '/admin/delete', { form: { csrf, confirm: 'yes', id: records[0].id } })).status).toBe(303); // no session: the login

    expect(stored(run.dir)).toHaveLength(5);
    expect(listFiles(run.dir)).toHaveLength(6);
    expect(run.lines.filter((line) => / admin delete /.test(line))).toEqual([]);
  });

  it('offers to delete everything a search found — behind a page that says how many and asks once more', async () => {
    const run = await start();
    const records = await five(run);
    const cookie = await login(run);
    // without a search there is nothing to offer: "everything" is never one click away
    expect((await admin(run, '/admin/', { cookie })).text).not.toContain('/admin/delete-found');
    const list = (await admin(run, '/admin/?q=odd', { cookie })).text;
    expect(list).toContain('Найдено: 3');
    expect(list).toContain('<a href="/admin/delete-found?q=odd">Удалить всё найденное: 3</a>');

    const ask = await admin(run, '/admin/delete-found?q=odd', { cookie });
    expect(ask.status).toBe(200);
    expect(ask.text).toContain('Найдено обращений: 3');
    expect(ask.text).toContain('<form method="post" action="/admin/delete-found"');
    expect(ask.text).toContain('<input type="hidden" name="q" value="odd">');
    expect(ask.text).toContain('<input type="hidden" name="count" value="3">');
    expect(ask.text).toMatch(/<input type="checkbox" name="confirm" value="yes" required>/);
    // looking at that page deletes nothing
    expect(stored(run.dir)).toHaveLength(5);
    const csrf = csrfOf(ask.text);

    const done = await admin(run, '/admin/delete-found', { cookie, form: { csrf, q: 'odd', count: '3', confirm: 'yes' } });
    expect(done.status).toBe(303);
    expect(done.headers.location).toBe('/admin/');
    expect(texts((await admin(run, '/admin/', { cookie })).text)).toEqual([4, 2]);
    expect(listFiles(run.dir)).toEqual([`messages/${records[1].id}.json`, `messages/${records[3].id}.json`]);
    expect(run.lines.filter((line) => / admin delete /.test(line)).map((line) => line.replace(/^\S+ /, ''))).toEqual(['admin delete ok status=303 count=3']);
  });

  it('deletes what a search found only when it is asked with the token, the tick and the very number the page showed', async () => {
    const run = await start();
    await five(run);
    const cookie = await login(run);
    const csrf = csrfOf((await admin(run, '/admin/delete-found?q=odd', { cookie })).text);
    const post = (form: Record<string, string>, headers: Record<string, string> = {}) => admin(run, '/admin/delete-found', { cookie, form, headers });

    expect((await post({ q: 'odd', count: '3', confirm: 'yes' })).status).toBe(403);
    expect((await post({ csrf: 'nope', q: 'odd', count: '3', confirm: 'yes' })).status).toBe(403);
    expect((await post({ csrf, q: 'odd', count: '3', confirm: 'yes' }, { Origin: 'https://evil.example.test' })).status).toBe(403);
    expect((await post({ csrf, q: 'odd', count: '3' })).status).toBe(400);
    // no words of a search: "everything found" would be everything there is
    for (const q of ['', '   ']) expect((await post({ csrf, q, count: '5', confirm: 'yes' })).status).toBe(400);
    expect((await admin(run, '/admin/delete-found', { cookie })).status).toBe(400);
    expect((await admin(run, '/admin/delete-found?q=', { cookie })).status).toBe(400);
    // a message came in between: the number is not the one the author saw — the page asks again, with the new number
    await visitor(run, { message: 'One more odd message arrived.' });
    const changed = await post({ csrf, q: 'odd', count: '3', confirm: 'yes' });
    expect(changed.status).toBe(409);
    expect(changed.text).toContain('Найдено обращений: 4');
    expect(changed.text).toContain('<input type="hidden" name="count" value="4">');
    for (const count of ['', '0', '-4', '4 ', 'four', '04']) expect((await post({ csrf, q: 'odd', count, confirm: 'yes' })).status, count).toBe(409);
    // a search that finds nothing has nothing to delete
    const nothing = await admin(run, '/admin/delete-found?q=zzzz', { cookie });
    expect(nothing.status).toBe(200);
    expect(nothing.text).toContain('Ничего не найдено');
    expect(nothing.text).not.toContain('<form method="post" action="/admin/delete-found"');
    expect((await post({ csrf, q: 'zzzz', count: '0', confirm: 'yes' })).status).toBe(409);
    // without a session: the login, for both
    expect((await admin(run, '/admin/delete-found?q=odd')).status).toBe(303);
    expect((await admin(run, '/admin/delete-found', { form: { csrf, q: 'odd', count: '4', confirm: 'yes' } })).status).toBe(303);

    expect(stored(run.dir)).toHaveLength(6);
    expect(run.lines.filter((line) => / admin delete /.test(line))).toEqual([]);
  });

  it('shows the words of the search and the number as text on the page that asks', async () => {
    const run = await start();
    await visitor(run, { message: 'A message with <b>tags</b> in it.' });
    const cookie = await login(run);
    const ask = await admin(run, `/admin/delete-found?q=${encodeURIComponent('<b>tags</b>')}`, { cookie });
    expect(ask.text).toContain('&lt;b&gt;tags&lt;/b&gt;');
    expect(ask.text).not.toContain('<b>tags');
    expect(ask.text).toContain('<input type="hidden" name="q" value="&lt;b&gt;tags&lt;/b&gt;">');
  });
});

describe('the storage, as the author sees it', () => {
  it('is spoken of at the top of the list once it is more than four fifths full', async () => {
    const run = await start({ limits: { storageBytes: 4000 } });
    const cookie = await login(run);
    const picture = Buffer.concat([PNG, Buffer.alloc(900, 0x20)]);
    await visitor(run, {}, [shot(picture)]);
    await visitor(run, {}, [shot(picture)]);
    // some 2600 of 4000 bytes: nothing is said
    expect((await admin(run, '/admin/', { cookie })).text).not.toContain('Хранилище заполнено');
    await visitor(run, {}, [shot(Buffer.concat([PNG, Buffer.alloc(500, 0x20)]))]);
    // some 3500 of 4000
    const full = (await admin(run, '/admin/', { cookie })).text;
    expect(full).toMatch(/<p class="warning" role="status">Хранилище заполнено на 8\d %: [\d,]+ КБ из [\d,]+ КБ\. Когда место кончится, форма сайта перестанет принимать сообщения: удали ненужные\.<\/p>/);
    // it stands above the search, on every page of the list, also when a search finds nothing
    expect(full.indexOf('class="warning"')).toBeLessThan(full.indexOf('class="search"'));
    expect((await admin(run, '/admin/?q=zzzz', { cookie })).text).toContain('Хранилище заполнено');
    // deleting makes room, and the line goes
    const csrf = csrfOf(full);
    const ids = stored(run.dir).map((record): [string, string] => ['id', record.id]);
    await admin(run, '/admin/delete', { cookie, body: new URLSearchParams([['csrf', csrf], ['confirm', 'yes'], ...ids.slice(0, 2)]).toString() });
    expect((await admin(run, '/admin/', { cookie })).text).not.toContain('Хранилище заполнено');
  });
});

describe('the logout', () => {
  it('needs the token as well, ends the session and takes the cookie back', async () => {
    const run = await start();
    const cookie = await login(run);
    const page = await admin(run, '/admin/', { cookie });
    expect(page.text).toContain('<form method="post" action="/admin/logout"');
    const token = csrfOf(page.text);

    expect((await admin(run, '/admin/logout', { cookie, form: {} })).status).toBe(403);
    expect((await admin(run, '/admin/logout', { cookie, form: { csrf: 'nope' } })).status).toBe(403);
    expect((await admin(run, '/admin/logout', { cookie })).status).toBe(405);
    expect((await admin(run, '/admin/', { cookie })).status).toBe(200);

    const reply = await admin(run, '/admin/logout', { cookie, form: { csrf: token } });
    expect(reply.status).toBe(303);
    expect(reply.headers.location).toBe('/admin/login');
    expect(reply.headers['set-cookie']).toEqual([`${COOKIE}=; Path=/admin; Max-Age=0; HttpOnly; Secure; SameSite=Strict`]);
    expect((await admin(run, '/admin/', { cookie })).status).toBe(303);
  });
});

describe('the pages of the author', () => {
  it('fit under the policy the web server puts on every answer of the site', async () => {
    const policy = contentSecurityPolicy({ ga4Id: '', styleHashes: [] });
    // what the pages need of it: their own style sheet, their own pictures, forms that go back to the site
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("style-src 'self'");
    expect(policy).toContain("img-src 'self'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("script-src 'self'");
    // and they ask for no more: `expectCleanPage` looks at every page this file got (no script, no inline style,
    // nothing from another address)
    const run = await start();
    const record = await visitor(run, {}, [shot()]);
    const cookie = await login(run);
    for (const path of ['/admin/login', '/admin/', `/admin/m/${record.id}`, '/admin/nothing']) {
      const reply = await admin(run, path, { cookie: path === '/admin/login' ? undefined : cookie });
      expect(reply.headers['content-type']).toBe('text/html; charset=utf-8');
      // the service says the same itself, for a day it is reached without the web server in front
      expect(reply.headers['content-security-policy']).toBe("default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
      expect(reply.headers['referrer-policy']).toBe('no-referrer');
    }
  });

  it('are in Russian', async () => {
    const run = await start();
    const cookie = await login(run);
    expect((await admin(run, '/admin/login')).text).toMatch(/<title>Вход — SC Trade<\/title>[\s\S]*Пароль[\s\S]*Войти/);
    expect((await admin(run, '/admin/', { cookie })).text).toMatch(/<title>Обращения — SC Trade<\/title>[\s\S]*Выйти[\s\S]*Найти[\s\S]*Обращений пока нет/);
    expect((await admin(run, '/admin/nothing', { cookie })).text).toMatch(/Такой страницы нет/);
  });
});
