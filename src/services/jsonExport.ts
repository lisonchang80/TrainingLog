/**
 * jsonExport — slice 15b C6 (ADR-0011 §5 "JSON Export", frozen v1 EXPORT ONLY).
 *
 * Produces a self-describing, version-decoupled JSON dump of the WHOLE
 * SQLite database — every user table, every row — so the user has an
 * independent, human-readable, cross-platform copy of their data (ADR-0011
 * §5: 「完整 dump 全表」/ portable / SQLite-version decoupled / 不加密 /
 * export only — import is deferred to v1.5+ to avoid clashing with the
 * A-plan whole-DB SQLite restore).
 *
 * ## Two layers (mirrors icloudBackupAdapter's pure/IO split)
 *   - `buildJsonExport(db, opts)` — PURE async serializer. Takes the
 *     `Database` interface (NOT the concrete ExpoDatabase) so it round-trips
 *     against better-sqlite3 in jest's node env. It calls NO clock / RNG:
 *     `exportedAt` + `appVersion` are caller-supplied → deterministic tests.
 *   - `writeJsonExport(json, deps)` — thin file writer behind an injectable
 *     `ExportFs` boundary, so the serializer stays pure/unit-tested while the
 *     expo-file-system touch point is a one-liner that needs no unit test.
 *
 * ## Why enumerate `sqlite_master` (not a hardcoded table list)
 * ADR-0011 §5 lists Exercise / Template / Session / Set / body_metric /
 * app_settings 「全表」. Hardcoding that list would silently drop any table
 * added by a future migration (e.g. v026+). Reading `sqlite_master` instead
 * dumps EVERY user table automatically — future-proof, and the most literal
 * reading of 「完整 dump」. SQLite-internal bookkeeping tables
 * (`sqlite_sequence`, `sqlite_stat*`, and the `sqlite_` prefix generally)
 * are excluded — they are engine state, not user data, and would not
 * round-trip meaningfully.
 */

import type { Database } from '../db/types';

/** Current export envelope schema version (decoupled from SQLite user_version). */
export const JSON_EXPORT_FORMAT_VERSION = 1 as const;

/** One SQLite row — column name → scalar value (TEXT/INTEGER/REAL/NULL/BLOB). */
export type ExportRow = Record<string, unknown>;

/** The self-describing export envelope (ADR-0011 §5). */
export interface JsonExportEnvelope {
  /** Envelope schema version — bump when this shape changes. */
  formatVersion: typeof JSON_EXPORT_FORMAT_VERSION;
  /** App marketing version at export time (caller-supplied, e.g. "1.0.0"). */
  appVersion: string;
  /** SQLite `PRAGMA user_version` (migration schema version) at export time. */
  userVersion: number;
  /** ISO-8601 timestamp the caller stamped (caller-supplied → deterministic). */
  exportedAt: string;
  /** table name → all rows, in `sqlite_master` order. */
  tables: Record<string, ExportRow[]>;
}

export interface BuildJsonExportOptions {
  /** App marketing version (e.g. from `Constants.expoConfig?.version`). */
  appVersion: string;
  /** ISO-8601 export timestamp (e.g. `new Date().toISOString()`) — passed in. */
  exportedAt: string;
}

/** sqlite_master row shape for the table enumeration query. */
interface TableNameRow {
  name: string;
}

/**
 * A table belongs in the export when it is a real user table — i.e. NOT a
 * SQLite-internal bookkeeping table. SQLite reserves the `sqlite_` name
 * prefix for itself (`sqlite_sequence`, `sqlite_stat1`/`_stat4`, etc.); those
 * are engine state, not user data.
 */
function isUserTable(name: string): boolean {
  return !name.startsWith('sqlite_');
}

/**
 * Build the complete JSON export string (PURE — no clock / RNG / file I/O).
 *
 * @param db   any {@link Database} (prod = expo-sqlite, tests = better-sqlite3)
 * @param opts caller-supplied `appVersion` + `exportedAt` (deterministic)
 * @returns pretty-printed JSON string of a {@link JsonExportEnvelope}
 */
export async function buildJsonExport(
  db: Database,
  opts: BuildJsonExportOptions
): Promise<string> {
  // PRAGMA user_version — the migration schema version (separate axis from
  // the envelope's formatVersion; captured so an importer/forensics can tell
  // which schema the rows came from).
  const versionRow = await db.getFirstAsync<{ user_version: number }>(
    'PRAGMA user_version'
  );
  const userVersion = versionRow?.user_version ?? 0;

  // Enumerate every user table. ORDER BY name keeps the output stable
  // (deterministic) regardless of creation order.
  const tableRows = await db.getAllAsync<TableNameRow>(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
  );
  const tableNames = tableRows.map((r) => r.name).filter(isUserTable);

  const tables: Record<string, ExportRow[]> = {};
  for (const name of tableNames) {
    // Identifiers can't be bound params; the names come straight from
    // sqlite_master (not user input), and we double-quote to handle any
    // legal identifier safely.
    const rows = await db.getAllAsync<ExportRow>(
      `SELECT * FROM "${name.replace(/"/g, '""')}"`
    );
    tables[name] = rows;
  }

  const envelope: JsonExportEnvelope = {
    formatVersion: JSON_EXPORT_FORMAT_VERSION,
    appVersion: opts.appVersion,
    userVersion,
    exportedAt: opts.exportedAt,
    tables,
  };

  return JSON.stringify(envelope, null, 2);
}

// ---------------------------------------------------------------------------
// Thin file writer (Priority 2) — kept behind an injectable boundary so the
// serializer above stays pure. The writer itself is a one-liner over
// expo-file-system's new File/Directory API and needs no unit test.
// ---------------------------------------------------------------------------

/** Minimal fs facade for the writer (mirrors icloudBackupAdapter's BackupFs). */
export interface ExportFs {
  /** Directory URI to write the export into (e.g. documentDirectory). */
  readonly baseDirUri: string;
  /** Write `content` to `<baseDirUri>/<name>`; returns the written file URI. */
  writeFile(name: string, content: string): string;
}

/** Production fs — lazy expo-file-system require (jest node-env safe import). */
export function createExpoExportFs(): ExportFs {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
  const baseDir = Paths.document;
  return {
    baseDirUri: baseDir.uri,
    writeFile: (name, content) => {
      const file = new File(baseDir, name);
      file.write(content);
      return file.uri;
    },
  };
}

export interface WriteJsonExportDeps {
  /** Defaults to {@link createExpoExportFs}. */
  fs?: ExportFs;
}

/**
 * Compose a stable, collision-resistant export file name (sortable, no
 * filesystem-illegal characters): `traininglog-export-<ts>.json`. The `ts`
 * is the export timestamp ms (deterministic given the caller's clock).
 */
export function makeExportFileName(exportedAtMs: number): string {
  return `traininglog-export-${exportedAtMs}.json`;
}

/**
 * Write a built JSON export string to a file and return its URI. Thin shim
 * over {@link ExportFs}; the serialization itself is `buildJsonExport`.
 */
export function writeJsonExport(
  json: string,
  exportedAtMs: number,
  deps: WriteJsonExportDeps = {}
): string {
  const fs = deps.fs ?? createExpoExportFs();
  return fs.writeFile(makeExportFileName(exportedAtMs), json);
}
