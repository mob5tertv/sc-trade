import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../src/core/settings';
import { createLogger } from '../../src/data/logger';
import { loadSettings, saveSetting } from '../../src/data/repo/settings';
import { loadReference } from '../../src/data/repo/uex-cache';
import { DEMO_CAPACITY, demoSettings, emptyDb, keptChanges, OFFLINE_UEX, prepareDemoDb } from '../../src/demo/session';
import { DEMO_COMMODITY, DEMO_START_TERMINAL } from '../../src/demo/world';
import { testDb } from '../helpers/test-db';

// The data side of the demo trip of 1.3: what its own database holds, what the player keeps after it, and that it has no network.

const log = createLogger({ write() {} });
const player: Settings = {
  ...DEFAULT_SETTINGS, language: 'en', vehicleId: 77, scuCapacity: 128, starSystemId: 99, currentTerminalId: 12, targetTerminalId: 5,
  stripCorner: 'bottom-left', windowDx: 40, panelWidth: 520, hotkeyGuide: 'F7', idleCollapseSec: 90, showStrip: false, keysHintShown: false,
};

describe('the settings of the demo', () => {
  it('keep the player\'s window, language and keys, and take the demo\'s ship, system and nothing else of his data', () => {
    const s = demoSettings(player);
    expect([s.language, s.stripCorner, s.windowDx, s.panelWidth, s.hotkeyGuide]).toEqual(['en', 'bottom-left', 40, 520, 'F7']);
    expect([s.scuCapacity, s.currentTerminalId, s.targetTerminalId]).toEqual([DEMO_CAPACITY, null, null]);
    // a step must not vanish while it is read, the mini line has a step of its own, and no one-time word covers a hint
    expect([s.idleCollapseSec, s.showStrip, s.keysHintShown, s.tutorialShown]).toEqual([0, true, true, true]);
  });

  it('give back what the player changed of his window during the demo, and nothing of the demo\'s data', () => {
    const during = { ...demoSettings(player), stripCorner: 'top-left' as const, language: 'ru' as const, targetTerminalId: 4, scuCapacity: 696 };
    expect(keptChanges(player, during)).toEqual({ stripCorner: 'top-left', language: 'ru' });
  });
});

describe('the database of the demo', () => {
  it('holds the demo world and the demo\'s settings, made anew over whatever it held', async () => {
    const db = testDb();
    await prepareDemoDb(db, log, 1_800_000_000, player);
    await saveSetting(db, log, 'targetTerminalId', 4); // a demo that went as far as a target
    await prepareDemoDb(db, log, 1_800_000_000, player);
    const reference = await loadReference(db);
    expect(reference.terminals.get(DEMO_START_TERMINAL)?.nickname ?? reference.terminals.get(DEMO_START_TERMINAL)?.name).toMatch(/HUR/);
    expect([...reference.commodities.values()].some((c) => c.code === DEMO_COMMODITY)).toBe(true);
    const settings = await loadSettings(db, log);
    expect([settings.scuCapacity, settings.targetTerminalId, settings.language]).toEqual([DEMO_CAPACITY, null, 'en']);
  });

  it('is left empty after the demo: no table and no version of a schema', async () => {
    const db = testDb();
    await prepareDemoDb(db, log, 1_800_000_000, player);
    await emptyDb(db);
    expect(await db.select("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")).toEqual([]);
    expect(await db.select<{ user_version: number }>('PRAGMA user_version')).toEqual([{ user_version: 0 }]);
  });

  it('has no network: every question to UEX is refused at once', async () => {
    await expect(OFFLINE_UEX.prices([1])).rejects.toThrow(/no network/);
    await expect(OFFLINE_UEX.distance(1, 2)).rejects.toThrow(/no network/);
  });
});
