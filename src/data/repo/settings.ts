import { DEFAULT_SETTINGS, type Settings } from '../../core/settings';
import type { Db } from '../db';
import type { Logger } from '../logger';

// Settings live in the `setting` table as key -> JSON text, one row per changed setting.
// A missing row means "use the default", so an empty table yields DEFAULT_SETTINGS.

interface SettingRow {
  key: string;
  value: string;
}

function isSettingKey(key: string): key is keyof Settings {
  return Object.hasOwn(DEFAULT_SETTINGS, key);
}

export async function loadSettings(db: Db, log: Logger): Promise<Settings> {
  const rows = await db.select<SettingRow>('SELECT key, value FROM setting');
  const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const { key, value } of rows) {
    if (!isSettingKey(key)) {
      log.debug('settings', 'ignoring unknown key', { key });
      continue;
    }
    try {
      settings[key] = JSON.parse(value);
    } catch {
      log.warn('settings', 'corrupt value, using default', { key, value });
    }
  }
  // A value that was given another name is read as its heir: until 1.2 the options were ordered by 'uecPerHour', now by the
  // profit of the trip (plan item 17). The row is rewritten when the player next picks an order.
  if (settings.sort === 'uecPerHour') settings.sort = 'profit';
  // Values are trusted to be of the declared type: only this module writes them.
  return settings as unknown as Settings;
}

export async function saveSetting<K extends keyof Settings>(
  db: Db,
  log: Logger,
  key: K,
  value: Settings[K],
): Promise<void> {
  await db.execute(
    'INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, JSON.stringify(value)],
  );
  log.info('settings', 'saved', { key, value });
}
