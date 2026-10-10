import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COOKIE_NAME, cookieFor, createSessions, sameToken, sessionIdFrom } from '../../site/server/src/sessions.mjs';
import { COOKIE, START } from './helpers';

const HOUR_MS = 3_600_000;
const source = readFileSync(join(__dirname, '..', '..', 'site', 'server', 'src', 'sessions.mjs'), 'utf8');

function sessions(max?: number) {
  const clock = { now: START };
  return { clock, sessions: createSessions({ now: () => clock.now, lifeMs: 12 * HOUR_MS, ...(max === undefined ? {} : { max }) }) };
}

describe('the sessions of the author’s page', () => {
  it('are a random id and a random token each, new every time', () => {
    const { sessions: all } = sessions();
    const one = all.open();
    const two = all.open();
    for (const value of [one.id, one.csrf, two.id, two.csrf]) expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Set([one.id, one.csrf, two.id, two.csrf]).size).toBe(4);
    expect(all.find(one.id)).toEqual({ csrf: one.csrf });
    expect(all.find(two.id)).toEqual({ csrf: two.csrf });
    expect(all.size()).toBe(2);
  });

  it('are found by their id only', () => {
    const { sessions: all } = sessions();
    const { id, csrf } = all.open();
    for (const wrong of [undefined, '', csrf, id.slice(1), `${id}x`, id.toUpperCase() === id ? `${id}_` : id.toUpperCase(), '../x', '__proto__', 'constructor']) {
      expect(all.find(wrong), String(wrong)).toBeNull();
    }
  });

  it('end after twelve hours, and when they are closed', () => {
    const { clock, sessions: all } = sessions();
    const one = all.open();
    clock.now += 6 * HOUR_MS;
    const two = all.open();
    clock.now = START + 12 * HOUR_MS - 1;
    expect(all.find(one.id)).not.toBeNull();
    clock.now = START + 12 * HOUR_MS;
    expect(all.find(one.id)).toBeNull();
    expect(all.find(two.id)).not.toBeNull();
    expect(all.size()).toBe(1);
    all.close(two.id);
    expect(all.find(two.id)).toBeNull();
    expect(all.size()).toBe(0);
    all.close('never opened');
    all.close(undefined);
  });

  it('are a few at the most: a new one pushes out the oldest', () => {
    const { clock, sessions: all } = sessions(3);
    const opened = [1, 2, 3, 4].map(() => {
      clock.now += 1000;
      return all.open();
    });
    expect(all.size()).toBe(3);
    expect(all.find(opened[0].id)).toBeNull();
    for (const session of opened.slice(1)) expect(all.find(session.id)).not.toBeNull();
  });

  it('are kept under the hash of their id: what lies in memory is not what a browser sends', () => {
    expect(source).toMatch(/createHash\('sha256'\)/);
    expect(source).toMatch(/timingSafeEqual\(/);
  });
});

describe('the token against requests forged by another site', () => {
  it('is the same only when it is the same', () => {
    const { sessions: all } = sessions();
    const { csrf } = all.open();
    expect(sameToken(csrf, csrf)).toBe(true);
    for (const wrong of [undefined, null, '', csrf.slice(1), `${csrf}x`, csrf.toLowerCase() === csrf ? `${csrf.slice(0, -1)}!` : csrf.toLowerCase(), 5, [csrf], { csrf }]) {
      expect(sameToken(wrong, csrf), String(wrong)).toBe(false);
    }
  });
});

describe('the cookie of a session', () => {
  it('is for /admin only, is not shown to scripts, travels over https only and never with a request of another site', () => {
    expect(COOKIE_NAME).toBe(COOKIE);
    expect(cookieFor('abc', 43_200)).toBe(`${COOKIE}=abc; Path=/admin; Max-Age=43200; HttpOnly; Secure; SameSite=Strict`);
    // taken back: the same cookie, empty and already over
    expect(cookieFor('', 0)).toBe(`${COOKIE}=; Path=/admin; Max-Age=0; HttpOnly; Secure; SameSite=Strict`);
  });

  it('is read out of what a browser sends, and only when it has the shape of an id', () => {
    const id = 'A'.repeat(43);
    expect(sessionIdFrom(`${COOKIE}=${id}`)).toBe(id);
    expect(sessionIdFrom(`theme=dark; ${COOKIE}=${id}; other=1`)).toBe(id);
    expect(sessionIdFrom(`theme=dark;${COOKIE}=${id}`)).toBe(id);
    for (const header of [undefined, '', 'theme=dark', `${COOKIE}=`, `${COOKIE}=short`, `${COOKIE}=${'A'.repeat(44)}`, `${COOKIE}=${'A'.repeat(42)}/`, `x${COOKIE}=${id}`, `${COOKIE}x=${id}`, `${COOKIE.toLowerCase()}=${id}`, `${COOKIE}="${id}"`]) {
      expect(sessionIdFrom(header), String(header)).toBeUndefined();
    }
    // sent twice: the first one counts, as a browser orders them
    expect(sessionIdFrom(`${COOKIE}=${id}; ${COOKIE}=${'B'.repeat(43)}`)).toBe(id);
  });
});
