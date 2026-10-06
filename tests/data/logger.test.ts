import { describe, expect, it } from 'vitest';
import { createLogger, memorySink } from '../../src/data/logger';

describe('logger', () => {
  it('formats module, message and context', () => {
    const sink = memorySink();
    const log = createLogger(sink);
    log.info('uex', 'request', { url: 'u', ms: 12 });
    expect(sink.lines).toEqual([{ level: 'info', line: '[uex] request {"url":"u","ms":12}' }]);
  });

  it('omits context when absent', () => {
    const sink = memorySink();
    createLogger(sink).warn('db', 'slow');
    expect(sink.lines[0].line).toBe('[db] slow');
  });

  it('drops entries below the level and honours setLevel', () => {
    const sink = memorySink();
    const log = createLogger(sink, 'warn');
    log.debug('a', 'x');
    log.info('a', 'x');
    log.warn('a', 'y');
    expect(sink.lines.map((l) => l.level)).toEqual(['warn']);
    log.setLevel('debug');
    log.debug('a', 'z');
    expect(sink.lines).toHaveLength(2);
  });

  it('serialises Error with message and stack', () => {
    const sink = memorySink();
    createLogger(sink).error('crash', 'boom', new Error('bad'));
    expect(sink.lines[0].line).toContain('"message":"bad"');
    expect(sink.lines[0].line).toContain('"stack"');
  });

  it('replaces circular and unserialisable context with a marker', () => {
    const sink = memorySink();
    const log = createLogger(sink);
    const circ: Record<string, unknown> = {};
    circ.self = circ;
    log.info('a', 'circular', circ);
    log.info('a', 'bigint', { n: 1n });
    expect(sink.lines.map((l) => l.line)).toEqual([
      '[a] circular "[unserializable]"',
      '[a] bigint "[unserializable]"',
    ]);
  });

  it('never throws when the sink throws or context is circular', () => {
    const log = createLogger({
      write() {
        throw new Error('disk full');
      },
    });
    const circ: Record<string, unknown> = {};
    circ.self = circ;
    expect(() => log.info('a', 'b', circ)).not.toThrow();
  });
});
