import { describe, expect, it } from 'vitest';
import { startDatabase, type StartupSteps } from '../../src/ui/vm/startup-order';

// The database runs with a write-ahead journal: after an exit that did not merge it (a crash, the task ended, the power
// went) the newest pages are in `sctrade.db-wal`, not in `sctrade.db`. The backup copies `sctrade.db` alone, so it is
// taken AFTER the journal was merged, which needs the database open, and still BEFORE the migrations.

interface Fake {
  /** What the database is, for the steps that are handed it. */
  name: string;
}

interface Options {
  failOpen?: boolean;
  failMerge?: boolean;
  failBackup?: boolean;
  failMigrate?: boolean;
}

function setup(options: Options = {}) {
  const calls: string[] = [];
  const failures: string[] = [];
  const steps: StartupSteps<Fake> = {
    async open() {
      calls.push('open');
      if (options.failOpen) throw new Error('cannot open');
      return { name: 'the database' };
    },
    async mergeJournal(db) {
      calls.push(`merge journal of ${db.name}`);
      if (options.failMerge) throw new Error('cannot merge');
    },
    async backup() {
      calls.push('backup');
      if (options.failBackup) throw new Error('cannot copy');
    },
    async migrate(db) {
      calls.push(`migrate ${db.name}`);
      if (options.failMigrate) throw new Error('cannot migrate');
      return 2;
    },
    opened(db) {
      calls.push(`opened ${db.name}`);
    },
    failed(step, err) {
      failures.push(`${step}: ${err instanceof Error ? err.message : String(err)}`);
    },
  };
  return { steps, calls, failures };
}

describe('startDatabase', () => {
  it('opens the database, merges the journal, takes the backup and only then migrates', async () => {
    const { steps, calls, failures } = setup();
    const started = await startDatabase(null, steps);
    expect(calls).toEqual(['open', 'opened the database', 'merge journal of the database', 'backup', 'migrate the database']);
    expect(started).toEqual({ db: { name: 'the database' }, schema: 2 });
    expect(failures).toEqual([]);
  });

  it('takes the backup after the journal is merged: the copy of the one file is then the whole database', async () => {
    const { steps, calls } = setup();
    await startDatabase(null, steps);
    expect(calls.indexOf('merge journal of the database')).toBeLessThan(calls.indexOf('backup'));
    expect(calls.indexOf('open')).toBeLessThan(calls.indexOf('merge journal of the database'));
  });

  it('takes the backup before the migrations: it is the copy to go back to when a migration goes wrong', async () => {
    const { steps, calls } = setup({ failMigrate: true });
    await expect(startDatabase(null, steps)).rejects.toThrow('cannot migrate');
    expect(calls).toEqual(['open', 'opened the database', 'merge journal of the database', 'backup', 'migrate the database']);
  });

  it('a journal that cannot be merged does not stop the backup nor the start; it is reported', async () => {
    const { steps, calls, failures } = setup({ failMerge: true });
    const started = await startDatabase(null, steps);
    expect(calls).toEqual(['open', 'opened the database', 'merge journal of the database', 'backup', 'migrate the database']);
    expect(started.schema).toBe(2);
    expect(failures).toEqual(['mergeJournal: cannot merge']);
  });

  it('a backup that fails does not stop the start; it is reported', async () => {
    const { steps, calls, failures } = setup({ failBackup: true });
    const started = await startDatabase(null, steps);
    expect(calls.at(-1)).toBe('migrate the database');
    expect(started.schema).toBe(2);
    expect(failures).toEqual(['backup: cannot copy']);
  });

  it('both may fail, and the application still starts', async () => {
    const { steps, failures } = setup({ failMerge: true, failBackup: true });
    expect((await startDatabase(null, steps)).schema).toBe(2);
    expect(failures).toEqual(['mergeJournal: cannot merge', 'backup: cannot copy']);
  });

  it('a database that cannot be opened stops the start: nothing is merged, copied or migrated', async () => {
    const { steps, calls, failures } = setup({ failOpen: true });
    await expect(startDatabase(null, steps)).rejects.toThrow('cannot open');
    expect(calls).toEqual(['open']);
    expect(failures).toEqual([]);
  });

  it('hands the database out as soon as it is open, before anything else can fail: it is opened once per run', async () => {
    const { steps, calls } = setup({ failMigrate: true });
    await expect(startDatabase(null, steps)).rejects.toThrow('cannot migrate');
    expect(calls.indexOf('opened the database')).toBe(calls.indexOf('open') + 1);
  });

  it('a start that is tried again with the database already open only migrates: no second opening, merge or backup', async () => {
    const { steps, calls } = setup();
    const again = await startDatabase({ name: 'the open database' }, steps);
    expect(calls).toEqual(['migrate the open database']);
    expect(again).toEqual({ db: { name: 'the open database' }, schema: 2 });
  });
});
