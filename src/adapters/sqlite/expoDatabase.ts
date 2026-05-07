import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import type { Database, RunResult, SQLParam } from '../../db/types';
import { migrate } from '../../db/migrate';

/**
 * Production adapter: wraps expo-sqlite's `SQLiteDatabase` to conform to our
 * own `Database` interface. The shape is nearly identical, so this is a thin
 * pass-through. Existence of this file matters for the architectural rule:
 * repositories never import `expo-sqlite` directly.
 */

class ExpoDatabase implements Database {
  constructor(private readonly inner: SQLiteDatabase) {}

  execAsync(sql: string): Promise<void> {
    return this.inner.execAsync(sql);
  }

  async runAsync(sql: string, ...params: SQLParam[]): Promise<RunResult> {
    const r = await this.inner.runAsync(sql, ...params);
    return { changes: r.changes, lastInsertRowId: r.lastInsertRowId };
  }

  getAllAsync<T>(sql: string, ...params: SQLParam[]): Promise<T[]> {
    return this.inner.getAllAsync<T>(sql, ...params);
  }

  async getFirstAsync<T>(sql: string, ...params: SQLParam[]): Promise<T | null> {
    const r = await this.inner.getFirstAsync<T>(sql, ...params);
    return r ?? null;
  }

  withTransactionAsync(fn: () => Promise<void>): Promise<void> {
    return this.inner.withTransactionAsync(fn);
  }
}

const DB_FILE = 'traininglog.db';

let cached: Database | null = null;

/**
 * Open (or return cached) production database, ensuring migrations are
 * up to date. Safe to call repeatedly; migrations are no-op once at target.
 */
export async function openDatabase(): Promise<Database> {
  if (cached) return cached;
  const inner = await openDatabaseAsync(DB_FILE);
  await inner.execAsync('PRAGMA foreign_keys = ON');
  const wrapped = new ExpoDatabase(inner);
  await migrate(wrapped);
  cached = wrapped;
  return wrapped;
}
