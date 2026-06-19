import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  buildJsonExport,
  type JsonExportEnvelope,
} from '../../src/services/jsonExport';

/**
 * Slice 15b C6 — JSON export EDGE-CASE hardening (recent-main bug-hunt 02,
 * 2026-06-17, finding #2 「JSON export edge cases」 + #1 「BLOB handling」).
 *
 * The shipped `jsonExport.test.ts` covers the happy-path envelope, the
 * drift-proof `SELECT *` round-trip, reserved-word table names, determinism
 * and the empty-table case. This file PINS the gnarlier inputs report 02
 * flagged as thinly covered:
 *
 *   - completely empty DB (migrated schema, but zero user rows anywhere)
 *   - unicode / emoji / CJK in TEXT columns
 *   - embedded double-quotes, backslashes, newlines, control chars
 *   - explicit NULL column values (must survive as JSON null, not "")
 *   - a large-ish row count (round-trips identically, no truncation)
 *   - multi-row / multi-table mixed round-trip equals `SELECT *` exactly
 *   - REAL precision + integer round-trip through JSON.stringify
 *
 * Plus a guard around the LATENT BLOB-handling bug (finding #1): no BLOB
 * column exists in the schema today, but if one is ever added the serializer
 * silently produces a non-round-trippable dump. We exercise the serializer
 * with a synthetic BLOB and ASSERT the current (lossy) behavior, and `.skip`
 * the assertion of the DESIRED behavior with a RECENT-MAIN-BUG marker.
 *
 * All tests run the PURE serializer against a real migrated schema via
 * better-sqlite3 (testEnvironment: node) — mirrors the sibling test style.
 */

const FIXED_OPTS = { appVersion: '1.0.0', exportedAt: '2026-06-17T00:00:00.000Z' };

async function exportEnvelope(db: BetterSqliteDatabase): Promise<JsonExportEnvelope> {
  const json = await buildJsonExport(db, FIXED_OPTS);
  // Must always be valid JSON regardless of the row content.
  expect(() => JSON.parse(json)).not.toThrow();
  return JSON.parse(json) as JsonExportEnvelope;
}

describe('buildJsonExport — empty database (no user rows)', () => {
  let db: BetterSqliteDatabase;
  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    // Wipe EVERY user table so no row exists anywhere. Disable FK to allow
    // deleting parent tables in any order; we only care about row counts.
    await db.execAsync('PRAGMA foreign_keys = OFF');
    const tables = (
      await db.getAllAsync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table'"
      )
    )
      .map((r) => r.name)
      .filter((n) => !n.startsWith('sqlite_'));
    for (const t of tables) {
      await db.execAsync(`DELETE FROM "${t.replace(/"/g, '""')}"`);
    }
  });
  afterEach(() => db.close());

  it('still emits the self-describing envelope', async () => {
    const env = await exportEnvelope(db);
    expect(env.formatVersion).toBe(1);
    expect(env.appVersion).toBe('1.0.0');
    expect(env.exportedAt).toBe('2026-06-17T00:00:00.000Z');
    expect(env.userVersion).toBeGreaterThan(0);
  });

  it('lists every user table as an empty array (no table dropped)', async () => {
    const env = await exportEnvelope(db);
    const tableNames = Object.keys(env.tables);
    expect(tableNames.length).toBeGreaterThan(0);
    for (const name of tableNames) {
      expect(env.tables[name]).toEqual([]);
    }
  });

  it('table set equals sqlite_master (minus internal tables) even when all empty', async () => {
    const env = await exportEnvelope(db);
    const master = (
      await db.getAllAsync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table'"
      )
    )
      .map((r) => r.name)
      .filter((n) => !n.startsWith('sqlite_'))
      .sort();
    expect(Object.keys(env.tables).sort()).toEqual(master);
  });
});

describe('buildJsonExport — text payload edge cases', () => {
  let db: BetterSqliteDatabase;
  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });
  afterEach(() => db.close());

  /** Insert a custom exercise with an arbitrary name + return its row. */
  async function insertExercise(id: string, name: string): Promise<void> {
    await db.runAsync(
      `INSERT INTO exercise (id, name, load_type, is_builtin, is_archived)
       VALUES (?, ?, ?, ?, ?)`,
      id,
      name,
      'loaded',
      0,
      0
    );
  }

  it('round-trips unicode / emoji / CJK names byte-for-byte', async () => {
    const tricky = '槓鈴臥推 💪🏋️ Übung «Test» 日本語テスト';
    await insertExercise('ex-unicode', tricky);
    const env = await exportEnvelope(db);
    const row = env.tables.exercise.find((r) => r.id === 'ex-unicode');
    expect(row?.name).toBe(tricky);
  });

  it('round-trips embedded double-quotes and backslashes (JSON escaping)', async () => {
    const tricky = 'He said "go heavy" \\ then \\\\ doubled';
    await insertExercise('ex-quotes', tricky);
    const env = await exportEnvelope(db);
    const row = env.tables.exercise.find((r) => r.id === 'ex-quotes');
    expect(row?.name).toBe(tricky);
  });

  it('round-trips newlines, tabs and control characters', async () => {
    const tricky = 'line1\nline2\ttabbed\r\nwin-newlinebell';
    await insertExercise('ex-control', tricky);
    const env = await exportEnvelope(db);
    const row = env.tables.exercise.find((r) => r.id === 'ex-control');
    expect(row?.name).toBe(tricky);
  });

  it('round-trips a JSON-looking string without it being re-parsed', async () => {
    // A name that itself looks like JSON must come back as a STRING, not an
    // object — i.e. the serializer never double-decodes column text.
    const tricky = '{"injected":true,"arr":[1,2,3]}';
    await insertExercise('ex-jsonish', tricky);
    const env = await exportEnvelope(db);
    const row = env.tables.exercise.find((r) => r.id === 'ex-jsonish');
    expect(typeof row?.name).toBe('string');
    expect(row?.name).toBe(tricky);
  });
});

describe('buildJsonExport — NULL value preservation', () => {
  let db: BetterSqliteDatabase;
  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });
  afterEach(() => db.close());

  it('preserves explicit NULL columns as JSON null (not "" / not omitted)', async () => {
    // Build a synthetic table with a nullable column to avoid coupling to the
    // app schema's nullability; this isolates the NULL-handling contract.
    await db.execAsync(
      'CREATE TABLE nulltest (id INTEGER PRIMARY KEY, label TEXT, maybe TEXT, num REAL)'
    );
    await db.runAsync(
      'INSERT INTO nulltest (id, label, maybe, num) VALUES (?, ?, ?, ?)',
      1,
      'has-nulls',
      null,
      null
    );
    const env = await exportEnvelope(db);
    expect(env.tables.nulltest).toEqual([
      { id: 1, label: 'has-nulls', maybe: null, num: null },
    ]);
    // The serialized JSON literally contains `"maybe": null` (key present).
    const json = await buildJsonExport(db, FIXED_OPTS);
    expect(json).toContain('"maybe": null');
  });
});

describe('buildJsonExport — numeric + scale edge cases', () => {
  let db: BetterSqliteDatabase;
  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });
  afterEach(() => db.close());

  it('round-trips INTEGER, REAL and negative / fractional values exactly', async () => {
    await db.execAsync(
      'CREATE TABLE nums (id INTEGER PRIMARY KEY, i INTEGER, r REAL, neg INTEGER)'
    );
    await db.runAsync(
      'INSERT INTO nums (id, i, r, neg) VALUES (?, ?, ?, ?)',
      1,
      9_007_199_254_740_991, // Number.MAX_SAFE_INTEGER
      123.456789,
      -42
    );
    const env = await exportEnvelope(db);
    expect(env.tables.nums).toEqual([
      { id: 1, i: 9_007_199_254_740_991, r: 123.456789, neg: -42 },
    ]);
  });

  it('round-trips a large-ish row count without truncation (drift-proof)', async () => {
    await db.execAsync('CREATE TABLE bulk (id INTEGER PRIMARY KEY, v TEXT)');
    const COUNT = 500;
    await db.withTransactionAsync(async () => {
      for (let i = 0; i < COUNT; i++) {
        await db.runAsync('INSERT INTO bulk (id, v) VALUES (?, ?)', i, `row-${i}-✓`);
      }
    });
    const env = await exportEnvelope(db);
    expect(env.tables.bulk).toHaveLength(COUNT);
    // Exact equality with a direct SELECT * is the strongest no-truncation
    // / no-reordering assertion.
    const direct = await db.getAllAsync('SELECT * FROM bulk');
    expect(env.tables.bulk).toEqual(direct);
  });
});

describe('buildJsonExport — multi-table mixed round-trip', () => {
  let db: BetterSqliteDatabase;
  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });
  afterEach(() => db.close());

  it('every table equals SELECT * for that table (whole-DB drift-proof)', async () => {
    // Seed a couple of custom rows so several tables are non-trivially
    // populated alongside whatever migrate() seeds.
    await db.runAsync(
      `INSERT INTO exercise (id, name, load_type, is_builtin, is_archived)
       VALUES (?, ?, ?, ?, ?)`,
      'ex-a',
      'Custom A',
      'loaded',
      0,
      0
    );
    const env = await exportEnvelope(db);
    for (const name of Object.keys(env.tables)) {
      const direct = await db.getAllAsync(`SELECT * FROM "${name.replace(/"/g, '""')}"`);
      expect(env.tables[name]).toEqual(direct);
    }
  });
});

describe('buildJsonExport — BLOB handling (LATENT: no BLOB column today)', () => {
  let db: BetterSqliteDatabase;
  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    // No app table declares a BLOB column today (verified in report 02), so
    // this is a synthetic table to exercise the serializer's BLOB path.
    await db.execAsync('CREATE TABLE blobtest (id INTEGER PRIMARY KEY, data BLOB)');
    // Insert raw bytes via a hex literal (SQLParam has no BLOB type).
    await db.execAsync("INSERT INTO blobtest (id, data) VALUES (1, X'48656C6C6F')"); // "Hello"
  });
  afterEach(() => db.close());

  it('CONFIRMS the schema has zero declared BLOB columns today', async () => {
    // Guards the assumption behind report 02 finding #1: the lossy path is
    // unreachable in production until a migration adds a BLOB column.
    const cols = await db.getAllAsync<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'blobtest'"
    );
    const declaresBlob = cols.some((c) => /\bBLOB\b/i.test(c.sql ?? ''));
    expect(declaresBlob).toBe(false);
  });

  it('encodes a BLOB value as a self-describing { $blob } wrapper (NOT lossy)', async () => {
    // RECENT-MAIN-BUG (report 02, finding #1) — NOW FIXED. Previously the
    // serializer dumped column values straight through JSON.stringify, so a
    // SQLite BLOB (Node Buffer via better-sqlite3 / Uint8Array via expo-sqlite)
    // rendered as {"type":"Buffer","data":[...]} — non-round-trippable and
    // indistinguishable from a legit object column. It now becomes a namespaced
    // base64 wrapper. (This test replaces the old "ASSERTS lossy" pin.)
    const env = await exportEnvelope(db);
    const row = env.tables.blobtest[0];
    // "Hello" (0x48656C6C6F) === base64 "SGVsbG8=".
    expect(row).toEqual({ id: 1, data: { $blob: 'SGVsbG8=' } });
  });

  // RECENT-MAIN-BUG (report 02, finding #1): the DESIRED behavior is a
  // self-describing, round-trippable BLOB encoding — base64 with a typed
  // wrapper `{ "$blob": "<base64>" }` (report's suggested fix; ADR-0011 §5 is
  // silent on encoding so the wrapper shape is the chosen contract). Now
  // implemented in jsonExport.ts (encodeRowBlobs).
  it('SHOULD encode a BLOB as a round-trippable base64 wrapper (RECENT-MAIN-BUG #1)', async () => {
    const env = await exportEnvelope(db);
    const row = env.tables.blobtest[0] as { id: number; data: { $blob: string } };
    // "Hello" === base64 "SGVsbG8="
    expect(row.data).toEqual({ $blob: 'SGVsbG8=' });
    expect(Buffer.from(row.data.$blob, 'base64').toString('utf8')).toBe('Hello');
  });
});

// =====================================================================
// Coverage fill (2026-06-20) — BLOB encoding hardening beyond "Hello".
//
// The shipped BLOB test pins a single 5-byte ASCII blob. These pin the
// gnarlier byte payloads + multi-column / null-blob shapes that the
// `encodeRowBlobs` shallow-copy + `encodeBlob` base64 path must survive,
// all through the real (production) better-sqlite3 Buffer representation.
// =====================================================================
describe('buildJsonExport — BLOB encoding hardening (full-byte / multi-column / null)', () => {
  let db: BetterSqliteDatabase;
  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });
  afterEach(() => db.close());

  it('round-trips a BLOB containing ALL 256 byte values (incl. NUL) via base64', async () => {
    await db.execAsync('CREATE TABLE blob256 (id INTEGER PRIMARY KEY, data BLOB)');
    // All bytes 0x00..0xFF — base64 must survive embedded NULs / high bytes
    // that would corrupt a naive string/UTF-8 path.
    const allBytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
    const hex = allBytes.toString('hex').toUpperCase();
    await db.execAsync(`INSERT INTO blob256 (id, data) VALUES (1, X'${hex}')`);

    const env = await exportEnvelope(db);
    const row = env.tables.blob256[0] as { id: number; data: { $blob: string } };
    expect(typeof row.data.$blob).toBe('string');
    // Decoded base64 must equal the original 256-byte sequence byte-for-byte.
    const decoded = Buffer.from(row.data.$blob, 'base64');
    expect(decoded.length).toBe(256);
    expect(decoded.equals(allBytes)).toBe(true);
    expect(row.data.$blob).toBe(allBytes.toString('base64'));
  });

  it('encodes ONLY the BLOB cell, leaving sibling scalar columns untouched', async () => {
    await db.execAsync(
      'CREATE TABLE mixed (id INTEGER PRIMARY KEY, label TEXT, n REAL, payload BLOB)',
    );
    await db.execAsync(
      "INSERT INTO mixed (id, label, n, payload) VALUES (1, 'meta', 3.5, X'DEADBEEF')",
    );
    const env = await exportEnvelope(db);
    expect(env.tables.mixed).toEqual([
      { id: 1, label: 'meta', n: 3.5, payload: { $blob: Buffer.from('DEADBEEF', 'hex').toString('base64') } },
    ]);
  });

  it('handles multiple BLOB columns in one row independently', async () => {
    await db.execAsync('CREATE TABLE twoblobs (id INTEGER PRIMARY KEY, a BLOB, b BLOB)');
    await db.execAsync("INSERT INTO twoblobs (id, a, b) VALUES (1, X'00', X'FFFE')");
    const env = await exportEnvelope(db);
    expect(env.tables.twoblobs).toEqual([
      {
        id: 1,
        a: { $blob: Buffer.from([0x00]).toString('base64') },
        b: { $blob: Buffer.from([0xff, 0xfe]).toString('base64') },
      },
    ]);
  });

  it('preserves a NULL blob cell as JSON null (not an empty $blob wrapper)', async () => {
    await db.execAsync('CREATE TABLE nullblob (id INTEGER PRIMARY KEY, data BLOB)');
    await db.runAsync('INSERT INTO nullblob (id, data) VALUES (?, ?)', 1, null);
    const env = await exportEnvelope(db);
    // A NULL is a scalar, not binary — it must stay `null`, never `{ $blob: '' }`.
    expect(env.tables.nullblob).toEqual([{ id: 1, data: null }]);
  });

  it('round-trips a zero-length BLOB as an empty base64 string', async () => {
    await db.execAsync('CREATE TABLE emptyblob (id INTEGER PRIMARY KEY, data BLOB)');
    // X'' is a valid zero-length blob (distinct from NULL).
    await db.execAsync("INSERT INTO emptyblob (id, data) VALUES (1, X'')");
    const env = await exportEnvelope(db);
    const row = env.tables.emptyblob[0] as { id: number; data: { $blob: string } | null };
    // better-sqlite3 may surface a zero-length blob as an empty Buffer (binary)
    // → encoded to an empty-string $blob wrapper. Either way it round-trips to
    // zero bytes; assert the decoded length is 0.
    if (row.data && typeof row.data === 'object' && '$blob' in row.data) {
      expect(Buffer.from(row.data.$blob, 'base64').length).toBe(0);
    } else {
      // Some drivers surface an empty blob as NULL — tolerated (still 0 bytes).
      expect(row.data).toBeNull();
    }
  });

  it('leaves a legit object-shaped TEXT column that merely looks like JSON as a string', async () => {
    // A TEXT cell whose content is the literal string `{"$blob":"x"}` must NOT
    // be confused with an encoded BLOB — it is plain text and round-trips as a
    // string (the serializer only wraps actual binary cells).
    await db.execAsync('CREATE TABLE looksblob (id INTEGER PRIMARY KEY, t TEXT)');
    await db.runAsync('INSERT INTO looksblob (id, t) VALUES (?, ?)', 1, '{"$blob":"x"}');
    const env = await exportEnvelope(db);
    const row = env.tables.looksblob[0];
    expect(typeof row.t).toBe('string');
    expect(row.t).toBe('{"$blob":"x"}');
  });
});
