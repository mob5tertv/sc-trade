import { DEFAULT_SETTINGS, type Settings } from '../core/settings';
import type { Db } from '../data/db';
import type { Logger } from '../data/logger';
import { saveSetting } from '../data/repo/settings';
import type { UexClient } from '../data/uex-client';
import { DEMO_SHIP, DEMO_SYSTEM, writeDemoWorld } from './world';

// The data side of the demo trip (version 1.3): what its database holds and what goes back to the player's settings after it. The
// window side (the steps, the hints) is `src/ui/vm/demo.ts`; the switch of the data is `AppState.startDemo` / `endDemo`.

/** The capacity of the hold of the ship of the demo (the C2 Hercules of the demo world). */
export const DEMO_CAPACITY = 696;

/**
 * The settings the demo plays with: the player's own for the window (its language, place, size, keys), the demo's for the data
 * (a ship, a star system, no location yet, no target). The window does not fold by itself (a step must not vanish while it is read)
 * and has its mini line (a step is on it). The one-time words are said already: a hint of the window must not cover the demo.
 */
export function demoSettings(player: Settings): Settings {
  return {
    ...DEFAULT_SETTINGS,
    language: player.language,
    hotkeyPanel: player.hotkeyPanel, hotkeyDepart: player.hotkeyDepart, hotkeyArrive: player.hotkeyArrive, hotkeyGuide: player.hotkeyGuide,
    panelWidth: player.panelWidth, stripCorner: player.stripCorner, windowDx: player.windowDx, windowDy: player.windowDy,
    windowLocked: player.windowLocked, uiScale: player.uiScale, opacity: player.opacity, stripRangeTurns: player.stripRangeTurns,
    logLevel: player.logLevel,
    vehicleId: DEMO_SHIP, scuCapacity: DEMO_CAPACITY, starSystemId: DEMO_SYSTEM,
    idleCollapseSec: 0, showStrip: true, openSections: 'terminal,options',
    tutorialShown: true, keysHintShown: true, scaleNoticeShown: true,
  };
}

/** What the player may change in the window during the demo and keeps after it: the window, its language and its keys. */
export const KEPT_AFTER_DEMO = [
  'language', 'hotkeyPanel', 'hotkeyDepart', 'hotkeyArrive', 'hotkeyGuide', 'panelWidth', 'stripCorner', 'windowDx', 'windowDy',
  'windowLocked', 'uiScale', 'opacity', 'stripRangeTurns', 'logLevel',
] as const satisfies ReadonlyArray<keyof Settings>;

/** The settings of the demo that differ from the player's and that he keeps: they are written into his database after the demo. */
export function keptChanges(player: Settings, demo: Settings): Partial<Settings> {
  const changes: Partial<Settings> = {};
  for (const key of KEPT_AFTER_DEMO) {
    if (!Object.is(player[key], demo[key])) (changes as Record<string, unknown>)[key] = demo[key];
  }
  return changes;
}

/** Drops every table of the database and its version of the schema: what is left is an empty file. */
export async function emptyDb(db: Db): Promise<void> {
  const tables = await db.select<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
  for (const { name } of tables) await db.execute(`DROP TABLE IF EXISTS "${name.replace(/"/g, '""')}"`);
  await db.execute('PRAGMA user_version = 0');
}

/** Fills the database of the demo anew: the world, and the settings of the demo made from the player's. */
export async function prepareDemoDb(db: Db, log: Logger, now: number, player: Settings): Promise<void> {
  await emptyDb(db);
  await writeDemoWorld(db, now);
  const settings = demoSettings(player);
  for (const key of Object.keys(settings) as Array<keyof Settings>) {
    if (!Object.is(settings[key], DEFAULT_SETTINGS[key])) await saveSetting(db, log, key, settings[key]);
  }
}

/** The demo has no network: whatever would ask UEX is refused at once (its prices are fresh, so nothing should). */
const offline = (): Promise<never> => Promise.reject(new Error('the demo trip has no network'));
export const OFFLINE_UEX: UexClient = {
  starSystems: offline, terminals: offline, commodities: offline, vehicleManufacturers: offline, vehicles: offline,
  prices: offline, distancesFrom: offline, distance: offline,
};
