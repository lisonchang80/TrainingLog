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

// ---------------------------------------------------------------------------
// Slice 15 (Backup) — APPEND-ONLY ZONE. Parallel slice-15 work (restore's
// `closeAndResetForRestore`) also appends to this file; keep everything above
// this line byte-identical so the merge face stays minimal.
// ---------------------------------------------------------------------------

/**
 * Classified failure from {@link createBackupSnapshot}.
 *
 *   - 'snapshot-failed'        — open / sqlite3_backup error (transient: a
 *                                concurrent write transaction can surface as
 *                                SQLITE_BUSY; the next trigger retries)
 *   - 'integrity-check-failed' — the produced file failed `PRAGMA
 *                                quick_check` (never upload a bad snapshot)
 */
export class BackupSnapshotError extends Error {
  constructor(
    readonly kind: 'snapshot-failed' | 'integrity-check-failed',
    message: string
  ) {
    super(message);
    this.name = 'BackupSnapshotError';
  }
}

export interface BackupSnapshotResult {
  /** Absolute filesystem PATH of the verified snapshot file. */
  path: string;
  /** Snapshot file name inside expo-sqlite's default directory. */
  name: string;
}

/**
 * Produce a verified point-in-time snapshot of the live database as a
 * sandbox temp file (slice 15 C2; grill Q2-A): `backupDatabaseAsync`
 * (sqlite3_backup) → `backup-snapshot-<ts>.sqlite` next to the live DB →
 * `PRAGMA quick_check` gate. Returns the snapshot path for the upload
 * adapter (`icloudBackupAdapter`) to ship to the ubiquity container; the
 * adapter owns deleting the temp file (and sweeping stale ones).
 *
 * ## Why a DEDICATED source connection (not the cached singleton)
 * sqlite3_backup across two same-file connections is the canonical usage
 * (SQLite docs' loadOrSaveDb example) and is journal-mode agnostic — a
 * concurrent writer just restarts the (sub-millisecond, <5MB) copy. Reaching
 * into the singleton's private `inner` from appended code would need an
 * access hack, and this zone is append-only by contract. The transaction
 * serializer is irrelevant here: it guards BEGIN overlap on ONE connection;
 * the backup never issues transactions on the live connection at all.
 *
 * ## Preconditions / caveats
 *   - Call only after boot has opened + migrated the live DB (all C3
 *     triggers run post-boot). Calling on a missing file would snapshot a
 *     freshly-created empty DB.
 *   - DELETE journal mode (repo default, grill Q3-A): after `closeAsync`
 *     the snapshot has no `-wal`/`-shm`; the upload adapter still clears
 *     sidecars defensively at the copy site (R1).
 *   - expo-sqlite is lazy-required so importing this module under jest
 *     (node env) stays safe; tests `jest.mock('expo-sqlite', factory)`.
 */
export async function createBackupSnapshot(
  nowMs: number = Date.now()
): Promise<BackupSnapshotResult> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sqlite = require('expo-sqlite') as typeof import('expo-sqlite');
  const name = `backup-snapshot-${nowMs}.sqlite`;

  let src: SQLiteDatabase | null = null;
  let dest: SQLiteDatabase | null = null;

  const closeBestEffort = async () => {
    if (dest) {
      try {
        await dest.closeAsync();
      } catch {
        // best-effort — never mask the original failure
      }
      dest = null;
    }
    if (src) {
      try {
        await src.closeAsync();
      } catch {
        // best-effort
      }
      src = null;
    }
  };

  try {
    let destPath: string;
    try {
      src = await sqlite.openDatabaseAsync(DB_FILE);
      dest = await sqlite.openDatabaseAsync(name);
      destPath = dest.databasePath;
      await sqlite.backupDatabaseAsync({ sourceDatabase: src, destDatabase: dest });
    } catch (e) {
      throw new BackupSnapshotError('snapshot-failed', `sqlite3_backup failed: ${String(e)}`);
    }

    let verdict: string;
    try {
      const rows = await dest.getAllAsync<Record<string, unknown>>('PRAGMA quick_check');
      const values = rows.map((r) => String(Object.values(r ?? {})[0] ?? ''));
      verdict = values.length === 0 ? '(no rows)' : values.join('; ');
    } catch (e) {
      throw new BackupSnapshotError(
        'integrity-check-failed',
        `quick_check could not run: ${String(e)}`
      );
    }
    if (verdict !== 'ok') {
      throw new BackupSnapshotError('integrity-check-failed', `quick_check reported: ${verdict}`);
    }

    await closeBestEffort();
    return { path: destPath, name };
  } catch (e) {
    await closeBestEffort();
    try {
      // Don't leave a broken half-snapshot for the adapter's stale sweep to
      // mistake for anything; deletion failure is acceptable (sweep catches it).
      await sqlite.deleteDatabaseAsync(name);
    } catch {
      // best-effort
    }
    throw e;
  }
}

// ===========================================================================
// Slice 15 C4 — restore engine hooks (ADR-0011 + 2026-06-12 amendment).
//
// APPEND-ONLY ZONE: agent A (C2 snapshot side) appends its own block to this
// file in a parallel worktree. Nothing above this banner may be reordered or
// edited; new C4/C2 additions go below it. That is also why the class body
// above gains no new method — `inner` is reached via a structural cast here
// instead.
// ===========================================================================

// Appended import (hoisted by the module system) — adding it to the existing
// import line at the top would violate the append-only conflict-surface rule.
import { defaultDatabaseDirectory } from 'expo-sqlite';

/**
 * Absolute path of the live production DB file
 * (`<sandbox>/Documents/SQLite/traininglog.db` on iOS). Single source for
 * the restore engine's swap/sidecar paths — derives from the same `DB_FILE`
 * constant `openDatabase()` uses, so the two can never point at different
 * files. (`defaultDatabaseDirectory` is typed `any` upstream; it is a string
 * at runtime.)
 */
export function liveDatabasePath(): string {
  return `${String(defaultDatabaseDirectory)}/${DB_FILE}`;
}

/**
 * Close the live DB connection and drop the module-level singleton so the
 * NEXT `openDatabase()` call re-opens (and re-migrates) whatever file is on
 * disk — the in-place-swap primitive for restore (grill Q12-A; risk R10).
 *
 * Behaviour:
 * - Never opened (or a previous open failed) → no-op. Safe on the
 *   fresh-install RestoreGate path where no DB exists yet.
 * - `closeAsync()` THROWS → the singleton is KEPT (still-working connection)
 *   and the error propagates, so the restore engine aborts at its
 *   'close-live' step BEFORE any file deletion. Swapping the file under a
 *   connection we failed to close would risk corruption; keeping the cache
 *   avoids a second connection (= second transaction serializer) on retry.
 */
export async function closeAndResetForRestore(): Promise<void> {
  const pending = cached;
  if (!pending) return;
  let db: Database;
  try {
    db = await pending;
  } catch {
    // openDatabase()'s own .catch already cleared the cache for retry.
    return;
  }
  // `inner` is TS-private on ExpoDatabase — compile-time only; reach it via
  // a structural cast because the class body above is frozen (append-only).
  const inner = (db as unknown as { inner?: SQLiteDatabase }).inner;
  if (inner) {
    await inner.closeAsync();
  }
  cached = null;
}

/**
 * Minimal handle for INSPECTING a restore candidate file (quick_check /
 * user_version / preview counts). Deliberately read-shaped — the restore
 * engine must never write to a candidate.
 */
export interface CandidateDb {
  getFirstAsync<T>(sql: string): Promise<T | null>;
  closeAsync(): Promise<void>;
}

/**
 * Open an arbitrary on-disk SQLite file (downloaded backup candidate /
 * sandbox temp copy) WITHOUT touching the live singleton and WITHOUT
 * running migrations. Throws when the path cannot be opened as SQLite —
 * the restore rules layer maps that to the 'not-sqlite' verdict.
 *
 * expo-sqlite addresses files as (name, directory), so the absolute path is
 * split on its last '/'.
 */
export async function openCandidateDatabase(absolutePath: string): Promise<CandidateDb> {
  const slash = absolutePath.lastIndexOf('/');
  if (slash <= 0 || slash === absolutePath.length - 1) {
    throw new Error(`openCandidateDatabase: expected an absolute file path, got: ${absolutePath}`);
  }
  const directory = absolutePath.slice(0, slash);
  const name = absolutePath.slice(slash + 1);
  return openDatabaseAsync(name, undefined, directory);
}
