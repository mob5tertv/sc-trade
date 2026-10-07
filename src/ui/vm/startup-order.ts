import { NewerDatabaseError } from '../../data/migrations';

/**
 * The order in which the database is made ready at the start, and which of the steps may fail without stopping it.
 *
 * The database runs with a write-ahead journal (WAL). After an exit that did not merge the journal (a crash, the
 * task ended from the Task Manager, the power went) the newest pages lie in `sctrade.db-wal`, not in `sctrade.db`,
 * and the backup copies `sctrade.db` alone: taken before the database is opened, it was stale or empty, and five such
 * copies pushed the real ones out. So:
 *
 *   open  →  read the schema version  →  merge the journal into the file  →  back the file up  →  migrate
 *
 * The version is read before anything is touched:
 *  - a database from a NEWER build is refused there (the step throws), and nothing after it runs. In particular no
 *    backup is made: an older build that is started five times would rotate the backups made before the upgrade away;
 *  - a database that was only just created (version 0) has no journal worth merging and nothing to back up.
 * The backup comes after the merge (the one file is then the whole database) and before the migrations (it is the copy
 * to go back to when a migration goes wrong). A merge or a backup that fails is reported and the start goes on; a
 * database that cannot be opened, read or migrated stops it.
 */
export interface StartupSteps<D> {
  /** Opens the database, creating it when there is none. */
  open(): Promise<D>;
  /** Told the database as soon as it is open, before anything else can fail: the caller keeps it, it is opened once per run. */
  opened(db: D): void;
  /** The schema version the database is found with (0: it was only just created). Throws for a database this build must not touch. */
  schemaVersion(db: D): Promise<number>;
  /** Merges the write-ahead journal into the database file. */
  mergeJournal(db: D): Promise<void>;
  /** Copies the database file into the backups. */
  backup(): Promise<void>;
  /**
   * Told once the database is safe to migrate: the backup was taken (or tried), or there was nothing to back up. The
   * caller keeps that too: a start that is tried again makes no second backup.
   */
  secured(): void;
  /** Applies the migrations; resolves to the schema version. */
  migrate(db: D): Promise<number>;
  /** A step that must not stop the start has failed. */
  failed(step: 'mergeJournal' | 'backup', err: unknown): void;
}

/** How far an earlier try of this run got: what `opened` and `secured` were told. A first try: `{ db: null, secured: false }`. */
export interface StartupProgress<D> {
  db: D | null;
  secured: boolean;
}

/**
 * Makes the database ready. With the `progress` of an earlier try (the start is tried again after a failure) nothing
 * is done twice: an open database is not opened again, a database that was made safe is only migrated. A try that
 * stopped before the backup goes through the check, the merge and the backup again, so that nothing is ever migrated
 * that was not made safe first.
 */
export async function startDatabase<D>(progress: StartupProgress<D>, steps: StartupSteps<D>): Promise<{ db: D; schema: number }> {
  let db = progress.db;
  if (db === null) {
    db = await steps.open();
    steps.opened(db);
  }
  if (!progress.secured) {
    const version = await steps.schemaVersion(db);
    if (version > 0) {
      try {
        await steps.mergeJournal(db);
      } catch (err) {
        steps.failed('mergeJournal', err);
      }
      try {
        await steps.backup();
      } catch (err) {
        steps.failed('backup', err);
      }
    }
    steps.secured();
  }
  return { db, schema: await steps.migrate(db) };
}

/**
 * What the player reads when the database could not be made ready. A database from a newer version says so itself, in
 * a sentence written for the player (what happened and what to do): it is shown as it is. Anything else is the general
 * sentence `general`; raw error text never reaches the screen, it is in the log.
 */
export function startFailureText(err: unknown, general: string): string {
  return err instanceof NewerDatabaseError ? err.message : general;
}
