import { describe, expect, it } from 'vitest';
import { createRingLog } from '../../src/preview/ring-log';

describe('ring log', () => {
  it('keeps the last lines only', () => {
    const log = createRingLog(3);
    for (const line of ['a', 'b', 'c', 'd', 'e']) log.push(line);
    expect(log.lines()).toEqual(['c', 'd', 'e']);
  });

  it('hands out a copy', () => {
    const log = createRingLog(5);
    log.push('a');
    log.lines().push('x');
    expect(log.lines()).toEqual(['a']);
  });

  it('holds 500 lines by default', () => {
    const log = createRingLog();
    for (let i = 0; i < 600; i++) log.push(String(i));
    expect(log.lines()).toHaveLength(500);
    expect(log.lines()[0]).toBe('100');
  });
});
