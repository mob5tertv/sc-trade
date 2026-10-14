import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Logger } from '../data/logger';

export type TriggerName = 'panel' | 'depart' | 'arrive' | 'guide';

// The order of the arguments and of the results of the Rust command `set_trigger_keys`.
const NAMES: readonly TriggerName[] = ['panel', 'depart', 'arrive', 'guide'];

const TRIGGER_EVENT = 'input://trigger';

let stopListening: (() => void) | undefined;

function isTriggerName(value: unknown): value is TriggerName {
  return NAMES.includes(value as TriggerName);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Assigns the optional trigger keys. The Rust side catches them with a low-level keyboard hook that
 * exists only while at least one key is assigned and that never swallows a key.
 * '' means "not assigned". Returns the outcome per trigger: `null` when the key is assigned (or
 * empty), the error text when it could not be used (it does not stop the others).
 * Safe to call again: the previous listener is dropped and the Rust side takes the new keys.
 */
export async function bindTriggers(
  keys: Record<TriggerName, string>,
  handlers: Record<TriggerName, () => void>,
  log: Logger,
): Promise<Record<TriggerName, string | null>> {
  const outcome: Record<TriggerName, string | null> = { panel: null, depart: null, arrive: null, guide: null };
  const assigned = NAMES.filter((name) => keys[name].trim() !== '');

  stopListening?.();
  stopListening = undefined;

  // Listening starts before the hook can be installed, so that no trigger is lost.
  try {
    stopListening = await listen<{ name: unknown }>(TRIGGER_EVENT, ({ payload }) => {
      if (!isTriggerName(payload.name)) {
        log.warn('trigger', 'unknown trigger name', { name: payload.name });
        return;
      }
      log.debug('trigger', 'received', { name: payload.name });
      handlers[payload.name]();
    });
  } catch (err) {
    const reason = errorText(err);
    log.error('trigger', 'cannot listen for trigger events', { err: reason });
    for (const name of assigned) outcome[name] = reason;
    return outcome;
  }

  try {
    const results = await invoke<(string | null)[]>('set_trigger_keys', {
      panel: keys.panel,
      depart: keys.depart,
      arrive: keys.arrive,
      guide: keys.guide,
    });
    NAMES.forEach((name, i) => {
      outcome[name] = results[i] ?? null;
    });
    // Names only: which keys they are is logged by the Rust side, once, when they are assigned.
    log.info('trigger', 'bound', {
      assigned: assigned.filter((name) => outcome[name] === null),
      rejected: assigned.filter((name) => outcome[name] !== null),
    });
  } catch (err) {
    // The keyboard hook could not be installed: none of the assigned keys works.
    const reason = errorText(err);
    log.error('trigger', 'cannot set the trigger keys', { err: reason });
    for (const name of assigned) outcome[name] = reason;
  }
  return outcome;
}
