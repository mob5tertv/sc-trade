import { describe, expect, it } from 'vitest';
import { NewerDatabaseError } from '../../src/data/migrations';
import { startDatabase, startFailureText, type StartupProgress, type StartupSteps } from '../../src/ui/vm/startup-order';

// The database runs with a write-ahead journal: after an exit that did not merge it (a crash, the task ended, the power
// went) the newest pages are in `sctrade.db-wal`, not in `sctrade.db`. The backup copies `sctrade.db` alone, so it is
// taken AFTER the journal was merged, which needs the database open, and still BEFORE the migrations. And before either
// the schema version is read: a database from a newer build is not touched at all (not even backed up: an older build
// started five times would rotate the backups made before the upgrade away), and a database that was only just created
// has nothing to back up.

interface Fake {
  /** What the database is, for the steps that are handed it. */
  name: string;
}

interface Options {
  /** The schema version the database is found with; 2 (an existing database) by default. */
  version?: number;
  failOpen?: boolean;
  /** The version cannot be read (the database itself fails). */
  failVersion?: boolean;
  /** The database was written by a newer build. */
  newer?: boolean;
  failMerge?: boolean;
  failBackup?: boolean;
  failMigrate?: boolean;
}

const NEW: StartupProgress<Fake> = { db: null, secured: false };
const NEWER = new NewerDatabaseError(7, 2);

function setup(options: Options = {}) {
  const calls: string[] = [];
  const failures: string[] = [];
  const steps: StartupSteps<Fake> = {
    async open() {
      calls.push('open');
      if (options.failOpen) throw new Error('cannot open');
      return { name: 'the database' };
    },
    opened(db) {
      calls.push(`opened ${db.name}`);
    },
    async schemaVersion(db) {
      calls.push(`version of ${db.name}`);
      if (options.failVersion) throw new Error('cannot read the version');
      if (options.newer) throw NEWER;
      return options.version ?? 2;
    },
    async mergeJournal(db) {
      calls.push(`merge journal of ${db.name}`);
      if (options.failMerge) throw new Error('cannot merge');
    },
    async backup() {
      calls.push('backup');
      if (options.failBackup) throw new Error('cannot copy');
    },
    secured() {
      calls.push('secured');
    },
    async migrate(db) {
      calls.push(`migrate ${db.name}`);
      if (options.failMigrate) throw new Error('cannot migrate');
      return 2;
    },
    failed(step, err) {
      failures.push(`${step}: ${err instanceof Error ? err.message : String(err)}`);
    },
  };
  return { steps, calls, failures };
}

const WHOLE = [
  'open', 'opened the database', 'version of the database', 'merge journal of the database', 'backup', 'secured', 'migrate the database',
];

describe('startDatabase', () => {
  it('opens the database, reads its version, merges the journal, takes the backup and only then migrates', async () => {
    const { steps, calls, failures } = setup();
    const started = await startDatabase(NEW, steps);
    expect(calls).toEqual(WHOLE);
    expect(started).toEqual({ db: { name: 'the database' }, schema: 2 });
    expect(failures).toEqual([]);
  });

  it('takes the backup after the journal is merged: the copy of the one file is then the whole database', async () => {
    const { steps, calls } = setup();
    await startDatabase(NEW, steps);
    expect(calls.indexOf('merge journal of the database')).toBeLessThan(calls.indexOf('backup'));
    expect(calls.indexOf('open')).toBeLessThan(calls.indexOf('merge journal of the database'));
  });

  it('takes the backup before the migrations: it is the copy to go back to when a migration goes wrong', async () => {
    const { steps, calls } = setup({ failMigrate: true });
    await expect(startDatabase(NEW, steps)).rejects.toThrow('cannot migrate');
    expect(calls).toEqual(WHOLE);
  });

  describe('a database that was only just created (schema version 0)', () => {
    it('is not merged and not backed up: there is nothing in it; it is migrated', async () => {
      const { steps, calls, failures } = setup({ version: 0 });
      const started = await startDatabase(NEW, steps);
      expect(calls).toEqual(['open', 'opened the database', 'version of the database', 'secured', 'migrate the database']);
      expect(started.schema).toBe(2);
      expect(failures).toEqual([]);
    });

    it('any version above 0 is a database with something in it: it is backed up', async () => {
      const { steps, calls } = setup({ version: 1 });
      await startDatabase(NEW, steps);
      expect(calls).toEqual(WHOLE);
    });
  });

  describe('a database from a newer version of the application', () => {
    it('stops the start at the check: nothing is merged, NOTHING IS BACKED UP, nothing is migrated', async () => {
      const { steps, calls, failures } = setup({ newer: true });
      await expect(startDatabase(NEW, steps)).rejects.toBe(NEWER);
      expect(calls).toEqual(['open', 'opened the database', 'version of the database']);
      expect(failures).toEqual([]);
    });

    it('started again and again, it is checked each time and still never backed up: the backups made before the upgrade stay', async () => {
      const { steps, calls } = setup({ newer: true });
      await expect(startDatabase(NEW, steps)).rejects.toBe(NEWER);
      for (let i = 0; i < 5; i++) {
        // "Повторить": the database is open already, and it was never made safe to migrate
        await expect(startDatabase({ db: { name: 'the database' }, secured: false }, steps)).rejects.toBe(NEWER);
      }
      expect(calls.filter((c) => c === 'backup')).toEqual([]);
      expect(calls.filter((c) => c === 'open')).toHaveLength(1);
      expect(calls.filter((c) => c.startsWith('version of'))).toHaveLength(6);
      expect(calls.some((c) => c.startsWith('migrate'))).toBe(false);
    });
  });

  it('a version that cannot be read stops the start too: nothing is migrated without the backup before it', async () => {
    const { steps, calls } = setup({ failVersion: true });
    await expect(startDatabase(NEW, steps)).rejects.toThrow('cannot read the version');
    expect(calls).toEqual(['open', 'opened the database', 'version of the database']);
  });

  it('a journal that cannot be merged does not stop the backup nor the start; it is reported', async () => {
    const { steps, calls, failures } = setup({ failMerge: true });
    const started = await startDatabase(NEW, steps);
    expect(calls).toEqual(WHOLE);
    expect(started.schema).toBe(2);
    expect(failures).toEqual(['mergeJournal: cannot merge']);
  });

  it('a backup that fails does not stop the start; it is reported', async () => {
    const { steps, calls, failures } = setup({ failBackup: true });
    const started = await startDatabase(NEW, steps);
    expect(calls.at(-1)).toBe('migrate the database');
    expect(started.schema).toBe(2);
    expect(failures).toEqual(['backup: cannot copy']);
  });

  it('both may fail, and the application still starts', async () => {
    const { steps, failures } = setup({ failMerge: true, failBackup: true });
    expect((await startDatabase(NEW, steps)).schema).toBe(2);
    expect(failures).toEqual(['mergeJournal: cannot merge', 'backup: cannot copy']);
  });

  it('a database that cannot be opened stops the start: nothing is read, merged, copied or migrated', async () => {
    const { steps, calls, failures } = setup({ failOpen: true });
    await expect(startDatabase(NEW, steps)).rejects.toThrow('cannot open');
    expect(calls).toEqual(['open']);
    expect(failures).toEqual([]);
  });

  it('hands the database out as soon as it is open, before anything else can fail: it is opened once per run', async () => {
    const { steps, calls } = setup({ failVersion: true });
    await expect(startDatabase(NEW, steps)).rejects.toThrow('cannot read the version');
    expect(calls.indexOf('opened the database')).toBe(calls.indexOf('open') + 1);
  });

  it('says that the database is safe to migrate before it migrates: a migration that failed is not preceded by a second backup', async () => {
    const { steps, calls } = setup({ failMigrate: true });
    await expect(startDatabase(NEW, steps)).rejects.toThrow('cannot migrate');
    expect(calls.indexOf('secured')).toBe(calls.indexOf('migrate the database') - 1);
  });

  describe('a start that is tried again', () => {
    it('with the database open and made safe: only the migrations, no second opening, merge or backup', async () => {
      const { steps, calls } = setup();
      const again = await startDatabase({ db: { name: 'the open database' }, secured: true }, steps);
      expect(calls).toEqual(['migrate the open database']);
      expect(again).toEqual({ db: { name: 'the open database' }, schema: 2 });
    });

    it('with the database open but stopped before the backup: everything but the opening, so that it is never migrated unsecured', async () => {
      const { steps, calls } = setup();
      await startDatabase({ db: { name: 'the open database' }, secured: false }, steps);
      expect(calls).toEqual([
        'version of the open database', 'merge journal of the open database', 'backup', 'secured', 'migrate the open database',
      ]);
    });
  });
});

describe('startFailureText', () => {
  const GENERAL = 'Не удалось открыть локальную базу данных. Подробности в логе.';

  it('lets the message of a database from a newer version through as it is: it says what happened and what to do', () => {
    expect(startFailureText(new NewerDatabaseError(7, 2), GENERAL))
      .toBe('База создана более новой версией программы (схема 7, эта версия знает 2). Обнови программу.');
  });

  it('never shows the raw text of any other failure: the general sentence, the details are in the log', () => {
    expect(startFailureText(new Error('SQLITE_CANTOPEN: unable to open database file'), GENERAL)).toBe(GENERAL);
    expect(startFailureText('a string', GENERAL)).toBe(GENERAL);
    expect(startFailureText(undefined, GENERAL)).toBe(GENERAL);
  });
});
