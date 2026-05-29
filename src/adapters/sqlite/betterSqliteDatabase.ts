import BetterSqlite3, { type Database as BSqlite } from 'better-sqlite3';
import type { Database, RunResult, SQLParam } from '../../db/types';

/**
 * Test-only adapter: wraps `better-sqlite3` (sync, native) to conform to our
 * async `Database` interface. Used by jest tests to run real SQL against an
 * in-memory database.
 *
 * NOTE: NOT used in production. expo-sqlite is the production driver.
 *
 * ── Cross-suite `.rejects.toThrow()` flake (root cause + fix) ───────────────
 * Under `jest --runInBand` (one process for all 91 `tests/db/*` files) the
 * constraint-violation assertions (`.rejects.toThrow()` for FK / CHECK /
 * NOT NULL / UNIQUE) intermittently STOPPED throwing — green in isolation,
 * ~4 suites red as a group, and the red set rotated run-to-run. Under default
 * multi-worker jest it stayed green (fewer files per worker process).
 *
 * Root cause: better-sqlite3 is a native addon and its query methods are
 * synchronous. The old wrappers were `async` and let the *native* `SqliteError`
 * propagate straight out of the `async` body, so the rejected promise held a
 * live reference to that native error object. Across many full `migrate()`
 * suites churning the addon inside one process, V8 finalization of native
 * objects belonging to torn-down test-module registries races with that pending
 * rejection, and the throw intermittently fails to surface at the
 * `.rejects.toThrow()` boundary for whichever assertion lands in the window.
 * (Verified by bisection: a purely *synchronous* try/catch around the same
 * `prepare().run()` never flaked across hundreds of runs — only the path that
 * let the native error escape an async body as a rejection did.)
 *
 * Fix (test harness only — production migration logic untouched): wrap each
 * native call in a synchronous try/catch and, on failure, re-throw a DETACHED
 * plain `Error` (copied message + `code`) via `detachSqliteError`. The native
 * error is consumed synchronously the instant it is thrown; the value that
 * becomes the promise rejection references no native state, so it is immune to
 * addon-finalization timing. Behaviour is identical for assertions —
 * `.toThrow()` and `.toThrow(/regex/)` both match on `error.message`.
 */

/** Re-throw a native sqlite error as a detached plain Error (see class doc). */
function detachSqliteError(e: unknown): never {
  if (e instanceof Error) {
    const detached = new Error(e.message);
    const code = (e as { code?: unknown }).code;
    if (code !== undefined) {
      (detached as { code?: unknown }).code = code;
    }
    throw detached;
  }
  throw new Error(String(e));
}

export class BetterSqliteDatabase implements Database {
  private readonly db: BSqlite;

  constructor(filename: string = ':memory:') {
    this.db = new BetterSqlite3(filename);
    this.db.pragma('foreign_keys = ON');
  }

  async execAsync(sql: string): Promise<void> {
    try {
      this.db.exec(sql);
    } catch (e) {
      detachSqliteError(e);
    }
  }

  async runAsync(sql: string, ...params: SQLParam[]): Promise<RunResult> {
    try {
      const r = this.db.prepare(sql).run(...params);
      return {
        changes: r.changes,
        lastInsertRowId: Number(r.lastInsertRowid),
      };
    } catch (e) {
      return detachSqliteError(e);
    }
  }

  async getAllAsync<T>(sql: string, ...params: SQLParam[]): Promise<T[]> {
    try {
      return this.db.prepare(sql).all(...params) as T[];
    } catch (e) {
      return detachSqliteError(e);
    }
  }

  async getFirstAsync<T>(sql: string, ...params: SQLParam[]): Promise<T | null> {
    try {
      const r = this.db.prepare(sql).get(...params) as T | undefined;
      return r ?? null;
    } catch (e) {
      return detachSqliteError(e);
    }
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
