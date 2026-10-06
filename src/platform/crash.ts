import type { Logger } from '../data/logger';

/** Logs uncaught errors and unhandled promise rejections, with stacks. */
export function installCrashHandlers(log: Logger): void {
  window.addEventListener('error', (event) => {
    log.error('crash', 'uncaught error', {
      message: event.message,
      source: event.filename,
      line: event.lineno,
      column: event.colno,
      error: event.error,
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    log.error('crash', 'unhandled rejection', { reason: event.reason });
  });
}
