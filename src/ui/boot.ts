import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { primaryMonitor } from '@tauri-apps/api/window';
import { version as windowsVersion } from '@tauri-apps/plugin-os';
import type { Reference } from '../core/types';
import type { Db } from '../data/db';
import type { Logger } from '../data/logger';
import { migrate } from '../data/migrations';
import { loadSettings } from '../data/repo/settings';
import { repairRuns } from '../data/trade';
import { createUexClient } from '../data/uex-client';
import { appPacing } from '../data/uex-pacing';
import { openTauriDb } from '../platform/tauri-db';
import { tauriFetchJson } from '../platform/tauri-http';
import { applyLogLevel } from '../platform/tauri-logger';
import { app } from './state.svelte';

export type BootResult = { ok: true } | { ok: false; reason: string };

// What the player reads when the start fails. Never raw error text: that is in the log.
const DATABASE_FAILED = 'Не удалось открыть локальную базу данных. Подробности в логе.';
const DATA_FAILED = 'Не удалось прочитать данные из локальной базы. Подробности в логе.';

// The database is opened exactly once per run: the trade service serialises its calls per `Db` object,
// so a second object would break that. A retry after a failed start reuses it.
let db: Db | null = null;
let prepared = false;

const nowSec = (): number => Math.floor(Date.now() / 1000);

const referenceIsEmpty = (ref: Reference): boolean => ref.terminals.size === 0 || ref.starSystems.length === 0;

/** The database is backed up BEFORE it is opened. A failed backup is logged and never stops the start. */
async function backup(log: Logger): Promise<void> {
  try {
    const created = await invoke<string | null>('backup_db');
    log.info('app', 'database backup', { created });
  } catch (err) {
    log.error('app', 'database backup failed', { err });
  }
}

async function appVersion(): Promise<string> {
  try {
    return await getVersion();
  } catch {
    return 'unknown'; // not running inside Tauri (plain browser)
  }
}

function osVersion(): string {
  try {
    return windowsVersion();
  } catch {
    return 'unknown';
  }
}

/** The primary monitor in logical pixels, the one the window is placed on. */
async function screenInfo(): Promise<{ width: number; height: number; scaleFactor: number; source: string }> {
  try {
    const monitor = await primaryMonitor();
    if (monitor !== null) {
      const size = monitor.size.toLogical(monitor.scaleFactor);
      return { width: size.width, height: size.height, scaleFactor: monitor.scaleFactor, source: 'primary monitor' };
    }
  } catch {
    // falls back to the webview's screen below
  }
  return { width: screen.width, height: screen.height, scaleFactor: window.devicePixelRatio, source: 'screen' };
}

/** The first line of every run: what the app, the system and the database are (spec 11). */
async function logStart(log: Logger, schema: number): Promise<void> {
  log.info('app', 'start', {
    version: await appVersion(),
    windows: osVersion(),
    screen: await screenInfo(),
    schema,
  });
}

/** Backup, database, migrations, settings, log level, the first window and the trigger keys. */
async function prepare(log: Logger): Promise<void> {
  if (prepared) return;
  if (db === null) {
    await backup(log);
    db = await openTauriDb(log);
  }
  const schema = await migrate(db, log);
  const settings = await loadSettings(db, log);
  await applyLogLevel(log, settings.logLevel);
  await repairRuns({ db, log }); // before the active run is read: a run that a write cut off is never shown

  app.attach({ db, uex: createUexClient(tauriFetchJson, log, Date.now, appPacing()), now: nowSec });
  app.setSettings(settings);
  // The start line comes first: the window logs its own lines as soon as it is shown.
  await logStart(log, schema);
  app.ensureShown();
  await app.applyTriggers();
  prepared = true;
}

function fail(reason: string): BootResult {
  // The window is shown even when the start broke before the settings were read: the error must be seen.
  app.ensureShown();
  app.bootError = reason;
  app.phase = 'failed';
  app.log.warn('app', 'start failed', { reason });
  return { ok: false, reason };
}

/**
 * Starts the application. Calling it again after `{ ok: false }` is the "Повторить" button.
 * The prices and a stale reference are downloaded in the background after it returns.
 */
export async function boot(): Promise<BootResult> {
  const log = app.log;
  app.phase = 'booting';
  app.bootError = null;
  app.bootStatus = 'Запуск…';

  try {
    await prepare(log);
  } catch (err) {
    log.error('app', 'start failed before the data was ready', { err });
    return fail(DATABASE_FAILED);
  }

  try {
    await app.loadFromDb();
    if (referenceIsEmpty(app.reference)) {
      // First launch: without the reference nothing can be shown.
      app.bootStatus = 'Загрузка справочника UEX…';
      const failure = await app.syncReferenceNow();
      if (failure !== null) return fail(failure);
      await app.loadFromDb();
    }
  } catch (err) {
    log.error('app', 'cannot load the data', { err });
    return fail(DATA_FAILED);
  }

  app.phase = 'ready';
  void app.startBackgroundSync();
  return { ok: true };
}
