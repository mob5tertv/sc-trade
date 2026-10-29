import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOWNLOADS_FILE } from '../../site/server/src/downloads.mjs';
import { admin, DAY_MS, login, request, SENDER, start, type Running } from './helpers';

// The count of the downloads (the author: «как мне узнать, сколько людей скачали программу»): a press of «Скачать» on the site sends a
// beacon, the service keeps per day, version and language how many there were — and nothing of who pressed.

const beacon = (run: Running, body: string, from = SENDER, method = 'POST') =>
  request(run.port, { method, path: '/api/download', headers: { 'Content-Type': 'text/plain', 'X-Forwarded-For': from }, body });
const counts = (run: Running) => JSON.parse(readFileSync(join(run.dir, DOWNLOADS_FILE), 'utf8')) as { days: Record<string, Record<string, Record<string, number>>> };

describe('the count of the downloads', () => {
  it('counts a press per day, version and language of the page, and keeps no address', async () => {
    const run = await start();
    expect((await beacon(run, '{"version":"1.4.0","lang":"ru"}')).status).toBe(204);
    expect((await beacon(run, '{"version":"1.4.0","lang":"en"}', '198.51.100.9')).status).toBe(204);
    expect(counts(run)).toEqual({ days: { '2026-10-10': { '1.4.0': { ru: 1, en: 1 } } } });
    const file = readFileSync(join(run.dir, DOWNLOADS_FILE), 'utf8');
    expect(file).not.toContain(SENDER);
    expect(file).not.toContain('198.51.100');
    expect(run.lines.join('\n')).not.toContain(SENDER);
  });

  it('counts one address three times an hour at the most, and does not say so', async () => {
    const run = await start();
    for (let i = 0; i < 5; i++) expect((await beacon(run, '{"version":"1.4.0","lang":"ru"}')).status).toBe(204);
    expect(counts(run).days['2026-10-10']['1.4.0'].ru).toBe(3);
    run.clock.now += 61 * 60_000;
    await beacon(run, '{"version":"1.4.0","lang":"ru"}');
    expect(counts(run).days['2026-10-10']['1.4.0'].ru).toBe(4);
  });

  it('refuses what is no beacon: another method, a wrong version or language, a body too long', async () => {
    const run = await start();
    expect((await beacon(run, '', SENDER, 'GET')).status).toBe(405);
    expect((await beacon(run, '{"version":"1.4","lang":"ru"}')).status).toBe(400);
    expect((await beacon(run, '{"version":"1.4.0","lang":"de"}')).status).toBe(400);
    expect((await beacon(run, 'not json')).status).toBe(400);
    expect((await beacon(run, `{"version":"1.4.0","lang":"ru","x":"${'a'.repeat(400)}"}`)).status).toBe(400);
  });

  it('keeps the counts over a restart of the service', async () => {
    const first = await start();
    await beacon(first, '{"version":"1.4.0","lang":"ru"}');
    await first.stop();
    const again = await start({ dir: first.dir, now: first.clock.now + DAY_MS });
    await beacon(again, '{"version":"1.4.1","lang":"ru"}');
    expect(counts(again).days).toEqual({ '2026-10-10': { '1.4.0': { ru: 1 } }, '2026-10-11': { '1.4.1': { ru: 1 } } });
  });

  it('shows the author how many in all, per version and per day, behind the password', async () => {
    const run = await start();
    await beacon(run, '{"version":"1.4.0","lang":"ru"}');
    await beacon(run, '{"version":"1.4.1","lang":"en"}', '198.51.100.9');
    expect((await admin(run, '/admin/downloads')).headers.location).toBe('/admin/login');
    const session = await login(run);
    const page = await admin(run, '/admin/downloads', { cookie: session });
    expect(page.status).toBe(200);
    expect(page.text).toContain('Всего: 2');
    expect(page.text).toMatch(/1\.4\.1<\/span> <span class="amount">1<\/span>[\s\S]*1\.4\.0<\/span> <span class="amount">1<\/span>/);
    expect(page.text).toContain('10.10.2026');
    expect(page.text).not.toContain(SENDER);
  });
});
