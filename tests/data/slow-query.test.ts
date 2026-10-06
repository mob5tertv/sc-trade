import { describe, expect, it } from 'vitest';
import { createLogger, memorySink } from '../../src/data/logger';
import { withSlowQueryLog } from '../../src/data/slow-query';
import { testDb } from '../helpers/test-db';

describe('withSlowQueryLog', () => {
  it('warns when a query takes 200 ms or more', async () => {
    const sink = memorySink();
    const ticks = [0, 250];
    const db = withSlowQueryLog(testDb(), createLogger(sink), () => ticks.shift()!);
    await db.select('SELECT 1');
    expect(sink.lines).toEqual([{ level: 'warn', line: expect.stringContaining('[db] slow query') }]);
  });

  it('stays silent for fast queries', async () => {
    const sink = memorySink();
    const ticks = [0, 100];
    await withSlowQueryLog(testDb(), createLogger(sink), () => ticks.shift()!).select('SELECT 1');
    expect(sink.lines).toHaveLength(0);
  });

  it('treats exactly the threshold as slow', async () => {
    const sink = memorySink();
    const ticks = [1000, 1200];
    await withSlowQueryLog(testDb(), createLogger(sink), () => ticks.shift()!).select('SELECT 1');
    expect(sink.lines).toHaveLength(1);
  });

  it('honours a custom threshold and covers execute too', async () => {
    const sink = memorySink();
    const ticks = [0, 60];
    const db = withSlowQueryLog(testDb(), createLogger(sink), () => ticks.shift()!, 50);
    await db.execute('CREATE TABLE t (id INTEGER)');
    expect(sink.lines).toEqual([{ level: 'warn', line: expect.stringContaining('[db] slow query') }]);
  });

  it('puts the duration, the statement and its parameters into the slow query line', async () => {
    const sink = memorySink();
    const ticks = [0, 250.4];
    await withSlowQueryLog(testDb(), createLogger(sink), () => ticks.shift()!).select('SELECT  ?  AS one', [1]);
    expect(sink.lines[0].line).toBe('[db] slow query {"ms":250,"sql":"SELECT ? AS one","params":[1]}');
  });

  it('returns the results unchanged', async () => {
    const db = withSlowQueryLog(testDb(), createLogger(memorySink()));
    expect(await db.select('SELECT ? AS n', [7])).toEqual([{ n: 7 }]);
    await db.execute('CREATE TABLE t (id INTEGER PRIMARY KEY)');
    expect(await db.execute('INSERT INTO t VALUES (?)', [3])).toEqual({ rowsAffected: 1, lastInsertId: 3 });
  });

  it('logs and rethrows query errors', async () => {
    const sink = memorySink();
    const db = withSlowQueryLog(testDb(), createLogger(sink));
    await expect(db.select('SELECT * FROM nope')).rejects.toThrow();
    expect(sink.lines[0].level).toBe('error');
    expect(sink.lines[0].line).toContain('[db] query failed');
    expect(sink.lines[0].line).toContain('no such table: nope');
  });
});
