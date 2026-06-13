import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { insertBodyMetric } from '../../src/adapters/sqlite/bodyMetricRepository';
import { setUnitPreference } from '../../src/adapters/sqlite/settingsRepository';
import {
  JSON_EXPORT_FORMAT_VERSION,
  buildJsonExport,
  makeExportFileName,
  writeJsonExport,
  type JsonExportEnvelope,
  type ExportFs,
} from '../../src/services/jsonExport';

/**
 * Slice 15b C6 — JSON export (ADR-0011 §5, frozen v1 EXPORT ONLY).
 *
 * Exercises the PURE serializer against a real migrated schema seeded across
 * ≥3 tables (exercise / body_metric / app_settings) via better-sqlite3 in
 * jest's node env. Covers: envelope shape, every user table present,
 * SQLite-internal tables excluded, row round-trip, userVersion capture,
 * determinism given a fixed `exportedAt`, and the thin injectable writer.
 */
describe('Slice 15b C6 — buildJsonExport (pure serializer)', () => {
  let db: BetterSqliteDatabase;
  const FIXED_OPTS = { appVersion: '1.0.0', exportedAt: '2026-06-13T12:00:00.000Z' };

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    // Seed across 3 distinct tables.
    await db.runAsync(
      `INSERT INTO exercise (id, name, load_type, is_builtin, is_archived)
       VALUES (?, ?, ?, ?, ?)`,
      'ex-bench',
      'Bench Press',
      'loaded',
      1,
      0
    );
    await db.runAsync(
      `INSERT INTO exercise (id, name, load_type, is_builtin, is_archived)
       VALUES (?, ?, ?, ?, ?)`,
      'ex-pullup',
      'Pull Up',
      'bodyweight',
      0,
      0
    );
    await insertBodyMetric(
      db,
      { recorded_at: 1_717_228_800_000, bodyweight_kg: 80.5, pbf: 15.2, smm_kg: 38.1 },
      () => 'bm-1'
    );
    await setUnitPreference(db, 'lb');
  });

  afterEach(() => {
    db.close();
  });

  async function parse(): Promise<JsonExportEnvelope> {
    const json = await buildJsonExport(db, FIXED_OPTS);
    return JSON.parse(json) as JsonExportEnvelope;
  }

  it('returns a pretty-printed JSON string (2-space indent)', async () => {
    const json = await buildJsonExport(db, FIXED_OPTS);
    expect(typeof json).toBe('string');
    expect(json).toContain('\n  "formatVersion"');
    // Round-trips as valid JSON.
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('wraps rows in the self-describing envelope (ADR-0011 §5)', async () => {
    const env = await parse();
    expect(env.formatVersion).toBe(JSON_EXPORT_FORMAT_VERSION);
    expect(env.formatVersion).toBe(1);
    expect(env.appVersion).toBe('1.0.0');
    expect(env.exportedAt).toBe('2026-06-13T12:00:00.000Z');
    expect(typeof env.userVersion).toBe('number');
    expect(typeof env.tables).toBe('object');
  });

  it('captures PRAGMA user_version (migration schema version)', async () => {
    const env = await parse();
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(env.userVersion).toBe(row?.user_version);
    expect(env.userVersion).toBeGreaterThan(0); // migrate() bumped it
  });

  it('includes every seeded user table', async () => {
    const env = await parse();
    expect(Object.keys(env.tables)).toEqual(expect.arrayContaining(['exercise', 'body_metric', 'app_settings']));
  });

  it('dumps EVERY user table from sqlite_master (not a hardcoded list)', async () => {
    const env = await parse();
    const masterTables = (
      await db.getAllAsync<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table'"
      )
    )
      .map((r) => r.name)
      .filter((n) => !n.startsWith('sqlite_'))
      .sort();
    expect(Object.keys(env.tables).sort()).toEqual(masterTables);
  });

  it('excludes SQLite-internal bookkeeping tables', async () => {
    const env = await parse();
    for (const name of Object.keys(env.tables)) {
      expect(name.startsWith('sqlite_')).toBe(false);
    }
    expect(env.tables).not.toHaveProperty('sqlite_sequence');
  });

  it('round-trips the exercise table identically to SELECT * (drift-proof)', async () => {
    const env = await parse();
    // The serialized rows must equal exactly what the DB returns directly —
    // independent of how many builtins migrate() seeds or which columns the
    // schema has evolved to. This is the strongest round-trip assertion.
    const direct = await db.getAllAsync('SELECT * FROM exercise');
    expect(env.tables.exercise).toEqual(direct);
  });

  it('includes the two custom exercises we seeded (by id)', async () => {
    const env = await parse();
    const byId = new Map(env.tables.exercise.map((r) => [r.id, r]));
    expect(byId.get('ex-bench')).toMatchObject({
      name: 'Bench Press',
      load_type: 'loaded',
      is_archived: 0,
    });
    expect(byId.get('ex-pullup')).toMatchObject({
      name: 'Pull Up',
      load_type: 'bodyweight',
      is_archived: 0,
    });
  });

  it('round-trips body_metric rows including REAL + the seeded id', async () => {
    const env = await parse();
    expect(env.tables.body_metric).toEqual([
      {
        id: 'bm-1',
        recorded_at: 1_717_228_800_000,
        bodyweight_kg: 80.5,
        pbf: 15.2,
        smm_kg: 38.1,
      },
    ]);
  });

  it('round-trips app_settings (the lb unit preference we set)', async () => {
    const env = await parse();
    const unitRow = env.tables.app_settings.find((r) => r.key === 'unit_preference');
    expect(unitRow).toBeDefined();
    // setSetting JSON-encodes the value, so the stored string is '"lb"'.
    expect(String(unitRow?.value)).toContain('lb');
  });

  it('handles reserved-word table names (the "set" table) without error', async () => {
    const env = await parse();
    // `set` is a SQL reserved word; the serializer double-quotes identifiers.
    expect(env.tables).toHaveProperty('set');
    expect(Array.isArray(env.tables.set)).toBe(true);
  });

  it('is deterministic given fixed opts (byte-identical across runs)', async () => {
    const a = await buildJsonExport(db, FIXED_OPTS);
    const b = await buildJsonExport(db, FIXED_OPTS);
    expect(a).toBe(b);
  });

  it('reflects caller-supplied appVersion / exportedAt verbatim', async () => {
    const json = await buildJsonExport(db, {
      appVersion: '9.9.9-beta',
      exportedAt: '1999-12-31T23:59:59.000Z',
    });
    const env = JSON.parse(json) as JsonExportEnvelope;
    expect(env.appVersion).toBe('9.9.9-beta');
    expect(env.exportedAt).toBe('1999-12-31T23:59:59.000Z');
  });

  it('emits an empty array for a table with no rows', async () => {
    await db.runAsync('DELETE FROM body_metric');
    const env = await parse();
    expect(env.tables.body_metric).toEqual([]);
  });
});

describe('Slice 15b C6 — export file naming + thin writer', () => {
  it('makeExportFileName is sortable + collision-resistant', () => {
    expect(makeExportFileName(1_700_000_000_000)).toBe(
      'traininglog-export-1700000000000.json'
    );
  });

  it('writeJsonExport delegates to the injected fs and returns the file URI', () => {
    const written: { name: string; content: string }[] = [];
    const fakeFs: ExportFs = {
      baseDirUri: 'file:///docs/',
      writeFile: (name, content) => {
        written.push({ name, content });
        return `file:///docs/${name}`;
      },
    };
    const uri = writeJsonExport('{"hello":"world"}', 1_700_000_000_000, { fs: fakeFs });
    expect(uri).toBe('file:///docs/traininglog-export-1700000000000.json');
    expect(written).toEqual([
      { name: 'traininglog-export-1700000000000.json', content: '{"hello":"world"}' },
    ]);
  });
});
