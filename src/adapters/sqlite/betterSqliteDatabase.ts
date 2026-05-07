import BetterSqlite3, { type Database as BSqlite } from 'better-sqlite3';
import type { Database, RunResult, SQLParam } from '../../db/types';

/**
 * Test-only adapter: wraps `better-sqlite3` (sync, native) to conform to our
 * async `Database` interface. Used by jest tests to run real SQL against an
 * in-memory database.
 *
 * NOTE: NOT used in production. expo-sqlite is the production driver.
 */

export class BetterSqliteDatabase implements Database {
  private readonly db: BSqlite;

  constructor(filename: string = ':memory:') {
    this.db = new BetterSqlite3(filename);
    this.db.pragma('foreign_keys = ON');
  }

  async execAsync(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async runAsync(sql: string, ...params: SQLParam[]): Promise<RunResult> {
    const r = this.db.prepare(sql).run(...params);
    return {
      changes: r.changes,
      lastInsertRowId: Number(r.lastInsertRowid),
    };
  }

  async getAllAsync<T>(sql: string, ...params: SQLParam[]): Promise<T[]> {
    return this.db.prepare(sql).all(...params) as T[];
  }

  async getFirstAsync<T>(sql: string, ...params: SQLParam[]): Promise<T | null> {
    const r = this.db.prepare(sql).get(...params) as T | undefined;
    return r ?? null;
  }

  async withTransactionAsync(fn: () => Promise<void>): Promise<void> {
    // better-sqlite3's `db.transaction()` is sync-only, so we drive
    // BEGIN/COMMIT/ROLLBACK manually to support an async callback.
    this.db.exec('BEGIN');
    try {
      await fn();
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  close(): void {
    this.db.close();
  }
}
