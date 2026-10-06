// Pure TypeScript logger: no Tauri imports, so it also runs in Node tests.
// Platform sinks live in src/platform/.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogSink {
  write(level: LogLevel, line: string): void;
}

export interface Logger {
  debug(module: string, msg: string, ctx?: unknown): void;
  info(module: string, msg: string, ctx?: unknown): void;
  warn(module: string, msg: string, ctx?: unknown): void;
  error(module: string, msg: string, ctx?: unknown): void;
  setLevel(level: LogLevel): void;
}

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const UNSERIALIZABLE = '"[unserializable]"';

// Errors have no enumerable own properties, so JSON.stringify would turn them into `{}`.
function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

// Returns the context as a single-line JSON string. Circular references, BigInt,
// functions and anything else JSON cannot represent become "[unserializable]".
function serialiseContext(ctx: unknown): string {
  try {
    return JSON.stringify(ctx, jsonReplacer) ?? UNSERIALIZABLE;
  } catch {
    return UNSERIALIZABLE;
  }
}

function formatLine(module: string, msg: string, ctx: unknown): string {
  const head = `[${module}] ${msg}`;
  return ctx === undefined ? head : `${head} ${serialiseContext(ctx)}`;
}

export function createLogger(sink: LogSink, level: LogLevel = 'debug'): Logger {
  let threshold = RANK[level];

  const emit = (lvl: LogLevel, module: string, msg: string, ctx?: unknown): void => {
    // A logging failure must never break the application.
    try {
      if (RANK[lvl] < threshold) return;
      sink.write(lvl, formatLine(module, msg, ctx));
    } catch {
      // swallowed on purpose
    }
  };

  return {
    debug: (module, msg, ctx) => emit('debug', module, msg, ctx),
    info: (module, msg, ctx) => emit('info', module, msg, ctx),
    warn: (module, msg, ctx) => emit('warn', module, msg, ctx),
    error: (module, msg, ctx) => emit('error', module, msg, ctx),
    setLevel(next) {
      threshold = RANK[next];
    },
  };
}

export function memorySink(): LogSink & { lines: Array<{ level: LogLevel; line: string }> } {
  const lines: Array<{ level: LogLevel; line: string }> = [];
  return {
    lines,
    write(level, line) {
      lines.push({ level, line });
    },
  };
}
