import { invoke } from '@tauri-apps/api/core';
import { debug, error, info, warn } from '@tauri-apps/plugin-log';
import type { LogLevel, Logger, LogSink } from '../data/logger';

const writers: Record<LogLevel, (message: string) => Promise<void>> = { debug, info, warn, error };

/** Sends log lines to the Rust log plugin, which writes them into the shared log file. */
export function tauriSink(): LogSink {
  return {
    write(level, line) {
      // Fire and forget: a failed IPC call must never break the app.
      writers[level](line).catch(() => {});
    },
  };
}

/** Applies the level on both sides: the TypeScript logger and the Rust `log` crate. */
export async function applyLogLevel(log: Logger, level: LogLevel): Promise<void> {
  log.setLevel(level);
  try {
    await invoke('set_log_level', { level });
  } catch (err) {
    log.warn('log', 'failed to set the Rust log level', { level, err: String(err) });
  }
}
