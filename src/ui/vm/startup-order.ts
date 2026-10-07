/**
 * The order in which the database is made ready at the start, and which of the steps may fail without stopping it.
 *
 * The database runs with a write-ahead journal (WAL). After an exit that did not merge the journal (a crash, the
 * task ended from the Task Manager, the power went) the newest pages lie in `sctrade.db-wal`, not in `sctrade.db`,
 * and the backup copies `sctrade.db` alone: taken before the database is opened, it was stale or empty, and five such
 * copies pushed the real ones out. So:
 *
 *   open  →  merge the journal into the file  →  back the file up  →  migrate
 *
 * The backup comes after the merge (the one file is then the whole database) and still before the migrations (it is
 * the copy to go back to when a migration goes wrong). A merge or a backup that fails is reported and the start goes
 * on; a database that cannot be opened or migrated stops it.
 */
export interface StartupSteps<D> {
  /** Opens the database, creating it when there is none. */
  open(): Promise<D>;
  /** Told the database as soon as it is open, before anything else can fail: the caller keeps it, it is opened once per run. */
  opened(db: D): void;
  /** Merges the write-ahead journal into the database file. */
  mergeJournal(db: D): Promise<void>;
  /** Copies the database file into the backups. */
  backup(): Promise<void>;
  /** Applies the migrations; resolves to the schema version. */
  migrate(db: D): Promise<number>;
  /** A step that must not stop the start has failed. */
  failed(step: 'mergeJournal' | 'backup', err: unknown): void;
}

/**
 * Makes the database ready. `current` is the database when it is open already (the start is tried again after a
 * failure): it is not opened, merged or backed up a second time, only migrated.
 */
export async function startDatabase<D>(current: D | null, steps: StartupSteps<D>): Promise<{ db: D; schema: number }> {
  let db = current;
  if (db === null) {
    db = await steps.open();
    steps.opened(db);
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
  return { db, schema: await steps.migrate(db) };
}
