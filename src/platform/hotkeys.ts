import { isRegistered, register, unregister } from '@tauri-apps/plugin-global-shortcut';
import type { Logger } from '../data/logger';

export type HotkeyName = 'panel' | 'depart' | 'arrive';

const NAMES: readonly HotkeyName[] = ['panel', 'depart', 'arrive'];

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Registers the global hotkeys, one by one. A hotkey that cannot be registered (usually because
 * another program owns it) does not stop the others.
 * Returns the outcome per hotkey: `null` on success, the error text on failure.
 * Handlers fire on key press only, not on release.
 */
export async function bindHotkeys(
  keys: Record<HotkeyName, string>,
  handlers: Record<HotkeyName, () => void>,
  log: Logger,
): Promise<Record<HotkeyName, string | null>> {
  const outcome: Record<HotkeyName, string | null> = { panel: null, depart: null, arrive: null };

  for (const name of NAMES) {
    const key = keys[name];
    try {
      // The Rust side keeps its registrations when the webview reloads. Drop a stale one of ours,
      // otherwise the new registration would fail and the old handler is gone.
      if (await isRegistered(key)) {
        log.info('hotkey', 'dropping a stale registration', { name, key });
        await unregister(key);
      }
      await register(key, (event) => {
        if (event.state !== 'Pressed') return;
        log.info('hotkey', 'pressed', { name, key });
        handlers[name]();
      });
      log.info('hotkey', 'registered', { name, key });
    } catch (err) {
      const reason = errorText(err);
      outcome[name] = reason;
      log.warn('hotkey', 'registration failed', { name, key, reason });
    }
  }
  return outcome;
}
