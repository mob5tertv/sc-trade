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
import { startDatabase } from './vm/startup-order';

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

/**
 * Merges the write-ahead journal (`sctrade.db-wal`) into the database file, so that the backup, a copy of that one
 * file, is the whole database. The line of the log is what SQLite answered: `busy` 1 when another connection kept it
 * from finishing (the backup may then miss the newest pages), `log` the pages still in the journal and `checkpointed`
 * how many of them are in the file. A complete merge empties the journal and answers 0 / 0; -1 / -1 is a database
 * that keeps no such journal.
 */
async function mergeJournal(opened: Db, log: Logger): Promise<void> {
  const rows = await opened.select<{ busy: number; log: number; checkpointed: number }>('PRAGMA wal_checkpoint(TRUNCATE)');
  const answer = rows[0] ?? null;
  if (answer === null || answer.busy !== 0) {
    log.warn('db', 'the journal was not merged into the database file completely, the backup may miss the newest pages', { answer });
  } else if (answer.log < 0) log.info('db', 'the database keeps no write-ahead journal, nothing to merge', { answer });
  else log.info('db', 'journal merged into the database file', { answer });
}

/** The backup of the start: a copy of the database file, taken after the journal was merged into it and before the migrations. */
async function backup(log: Logger): Promise<void> {
  const created = await invoke<string | null>('backup_db');
  log.info('app', 'database backup', { created });
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

/**
 * Database (opened, its journal merged, backed up, migrated: `vm/startup-order.ts`), settings, log level, the first
 * window and the trigger keys.
 */
async function prepare(log: Logger): Promise<void> {
  if (prepared) return;
  const started = await startDatabase(db, {
    open: () => openTauriDb(log),
    opened: (opened) => {
      db = opened;
    },
    mergeJournal: (opened) => mergeJournal(opened, log),
    backup: () => backup(log),
    migrate: (opened) => migrate(opened, log),
    // neither stops the start
    failed: (step, err) => log.error('app', step === 'backup' ? 'database backup failed' : 'cannot merge the journal into the database file', { err }),
  });
  db = started.db;
  const schema = started.schema;
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
  // The window is shown even when the start broke before the settings were read: the error must be seen. It unfolds with
  // the text of the error whatever the setting of the mini line says: with that line switched off the window is hidden, and
  // the player would not know why nothing is there. (The window that is already unfolded stays as it is.)
  app.ensureShown();
  void app.expand('start failed');
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
