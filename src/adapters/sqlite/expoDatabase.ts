import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import type { Database, RunResult, SQLParam } from '../../db/types';
import { migrate } from '../../db/migrate';
import { createTransactionSerializer } from './transactionSerializer';

/**
 * Production adapter: wraps expo-sqlite's `SQLiteDatabase` to conform to our
 * own `Database` interface. The shape is nearly identical, so this is a thin
 * pass-through. Existence of this file matters for the architectural rule:
 * repositories never import `expo-sqlite` directly.
 */

class ExpoDatabase implements Database {
  /**
   * Serializes `withTransactionAsync` onto expo-sqlite's single connection so
   * two overlapping transactions can't race on `BEGIN` (the
   * "cannot start a transaction within a transaction" crash hit by a
   * live-mirror tick overlapping start-from-watch). See `transactionSerializer`.
   */
  private readonly serializeTx = createTransactionSerializer();

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
    // Serialized — never let two transactions' BEGIN/COMMIT overlap on the
    // shared connection (expo-sqlite single connection; see serializeTx).
    return this.serializeTx(() => this.inner.withTransactionAsync(fn));
  }
}

const DB_FILE = 'traininglog.db';

// Cache the PROMISE (not the resolved value) so concurrent callers share a
// single open. Fix C (eager WC bridge mount) and the DatabaseProvider can both
// call openDatabase() during boot; caching the value let both run the open +
// migrate, yielding two ExpoDatabase instances → two independent transaction
// serializers on the same DB file (defeats the serialization + risks SQLITE
// locking). Caching the in-flight promise collapses them to one instance.
let cached: Promise<Database> | null = null;

/**
 * Open (or return cached) production database, ensuring migrations are
 * up to date. Safe to call repeatedly / concurrently; migrations are a no-op
 * once at target. A failed open clears the cache so a later call can retry.
 */
export function openDatabase(): Promise<Database> {
  if (!cached) {
    cached = (async () => {
      const inner = await openDatabaseAsync(DB_FILE);
      await inner.execAsync('PRAGMA foreign_keys = ON');
      const wrapped = new ExpoDatabase(inner);
      await migrate(wrapped);
      return wrapped;
    })().catch((e) => {
      cached = null; // allow retry on next call
      throw e;
    });
  }
  return cached;
}
