import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { createLogger, memorySink } from '../../src/data/logger';
import { loadSettings, saveSetting } from '../../src/data/repo/settings';
import { migratedDb } from '../helpers/test-db';

describe('settings repository', () => {
  let sink: ReturnType<typeof memorySink>;
  let log: ReturnType<typeof createLogger>;

  beforeEach(() => {
    sink = memorySink();
    log = createLogger(sink);
  });

  it('returns defaults on an empty database', async () => {
    expect(await loadSettings(await migratedDb(), log)).toEqual(DEFAULT_SETTINGS);
  });

  it('defaults: no key is assigned, the strip is in the top-right corner, the panel side is not a setting', async () => {
    const settings = await loadSettings(await migratedDb(), log);
    expect([settings.hotkeyPanel, settings.hotkeyDepart, settings.hotkeyArrive]).toEqual(['', '', '']);
    expect(settings.stripCorner).toBe('top-right');
    expect(Object.hasOwn(settings, 'panelSide')).toBe(false);
  });

  it('defaults: the window collapses after 40 s, three sections are open, the panel is 440 px wide', async () => {
    const settings = await loadSettings(await migratedDb(), log);
    expect(settings.idleCollapseSec).toBe(40);
    expect(settings.openSections).toBe('terminal,options,settings:ship');
    expect(settings.panelWidth).toBe(440);
  });

  it('defaults: the window is 16 px from the edges of its corner and not locked', async () => {
    const settings = await loadSettings(await migratedDb(), log);
    expect([settings.windowDx, settings.windowDy]).toEqual([16, 16]);
    expect(settings.windowLocked).toBe(false);
  });

  it('round-trips where the player put the window and the lock', async () => {
    const db = await migratedDb();
    await saveSetting(db, log, 'stripCorner', 'bottom-left');
    await saveSetting(db, log, 'windowDx', 120);
    await saveSetting(db, log, 'windowDy', 45);
    await saveSetting(db, log, 'windowLocked', true);
    const settings = await loadSettings(db, log);
    expect([settings.stripCorner, settings.windowDx, settings.windowDy, settings.windowLocked]).toEqual(['bottom-left', 120, 45, true]);
  });

  it('keeps a panel width an older version stored: only a changed value is stored, a default never is', async () => {
    const db = await migratedDb();
    expect(await db.select('SELECT key FROM setting')).toEqual([]);
    await saveSetting(db, log, 'panelWidth', 470);
    expect((await loadSettings(db, log)).panelWidth).toBe(470);
  });

  it('round-trips the idle collapse time and the open sections', async () => {
    const db = await migratedDb();
    await saveSetting(db, log, 'idleCollapseSec', 0);
    await saveSetting(db, log, 'openSections', 'options,terminal');
    const settings = await loadSettings(db, log);
    expect(settings.idleCollapseSec).toBe(0);
    expect(settings.openSections).toBe('options,terminal');
  });

  it('skips a panelSide row stored by an older version', async () => {
    const db = await migratedDb();
    await db.execute("INSERT INTO setting VALUES ('panelSide', '\"left\"')");
    const settings = await loadSettings(db, log);
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(Object.hasOwn(settings, 'panelSide')).toBe(false);
  });

  it('defaults the full-refill time of a stock to 75 minutes and round-trips a changed one', async () => {
    const db = await migratedDb();
    expect((await loadSettings(db, log)).refillFullMin).toBe(75);
    await saveSetting(db, log, 'refillFullMin', 90);
    expect((await loadSettings(db, log)).refillFullMin).toBe(90);
  });

  it('round-trips number, null, string and boolean', async () => {
    const db = await migratedDb();
    await saveSetting(db, log, 'scuCapacity', 696);
    await saveSetting(db, log, 'starSystemId', 68);
    await saveSetting(db, log, 'hotkeyPanel', 'F8');
    await saveSetting(db, log, 'showStrip', false);
    await saveSetting(db, log, 'starSystemId', null);
    expect(await loadSettings(db, log)).toEqual({
      ...DEFAULT_SETTINGS,
      scuCapacity: 696,
      starSystemId: null,
      hotkeyPanel: 'F8',
      showStrip: false,
    });
  });

  it('ignores unknown keys and falls back to default on corrupt JSON, with a warning', async () => {
    const db = await migratedDb();
    await db.execute("INSERT INTO setting VALUES ('nope', '1'), ('topN', '{oops')");
    expect(await loadSettings(db, log)).toEqual(DEFAULT_SETTINGS);
    expect(sink.lines.some((l) => l.level === 'warn' && l.line.includes('topN'))).toBe(true);
  });

  it('logs every saved value', async () => {
    await saveSetting(await migratedDb(), log, 'topN', 3);
    expect(sink.lines.at(-1)).toEqual({ level: 'info', line: '[settings] saved {"key":"topN","value":3}' });
  });
});
