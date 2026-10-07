/** The last `limit` lines of the log, so that a scene's log can be read after the fact (`window.__preview.log`). */
export interface RingLog {
  push(line: string): void;
  /** A copy, oldest line first. */
  lines(): string[];
}

export const RING_LOG_LIMIT = 500;

export function createRingLog(limit: number = RING_LOG_LIMIT): RingLog {
  let buffer: string[] = [];
  return {
    push(line) {
      buffer.push(line);
      if (buffer.length > limit * 2) buffer = buffer.slice(-limit); // trimmed in bulk, not on every line
    },
    lines: () => buffer.slice(-limit),
  };
}
