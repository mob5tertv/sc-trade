// The storage seam: everything above this layer talks to `Db`, never to a driver.
// The production implementation lives in src/platform/tauri-db.ts, the test one in tests/helpers/test-db.ts.
//
// Rules for callers: `?` placeholders only, no explicit transactions (tauri-plugin-sql
// runs on a connection pool), and one SQL statement per call.

export interface ExecResult {
  rowsAffected: number;
  lastInsertId: number;
}

export interface Db {
  select<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<ExecResult>;
}
