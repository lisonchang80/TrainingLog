/**
 * Database interface — matches expo-sqlite shape so production adapter is thin,
 * but is also implementable by test adapters (better-sqlite3 / fake).
 *
 * All repository functions in `src/adapters/sqlite/*` depend on this interface,
 * NOT on `expo-sqlite` directly. This keeps repositories testable in node.
 */

export type SQLParam = string | number | null;

export interface RunResult {
  changes: number;
  lastInsertRowId: number;
}

export interface Database {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: SQLParam[]): Promise<RunResult>;
  getAllAsync<T>(sql: string, ...params: SQLParam[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, ...params: SQLParam[]): Promise<T | null>;
  withTransactionAsync(fn: () => Promise<void>): Promise<void>;
}
