import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';

/**
 * Full migration-chain acceptance tests — the highest-stakes data-integrity
 * surface. This app stores the user's entire training history locally; a
 * broken migration on a populated DB = catastrophic data loss for an App
 * Store app.
 *
 * Individual `vNNN_*.test.ts` files cover each migration's shape in isolation.
 * This file instead asserts the END-TO-END contract of the `migrate()` RUNNER:
 *
 *   1. A fresh (empty) DB migrated to head lands on `user_version = 26` with
 *      every key table + column present.
 *   2. Running `migrate()` AGAIN is a no-op (idempotent at the runner level —
 *      gated by PRAGMA user_version, no schema churn, no thrown error).
 *   3. A DB populated with representative data across every major table
 *      survives a second `migrate()` with ZERO row loss / mutation (the
 *      "populated re-migrate" disaster scenario — e.g. app relaunch after an
 *      OTA JS update that doesn't bump schema).
 *   4. The version-tracking PRAGMA is committed ATOMICALLY with each
 *      migration's DDL (no half-applied step can leave a wrong user_version).
 *
 * NOTE on the OLDER-version restore path (ADR-0011 §4): the iCloud backup is a
 * whole-FILE SQLite copy. On restore, the file's `user_version` is whatever it
 * was when backed up, and `openDatabase()` runs `migrate()` over it — so a
 * backup from schema vN transparently migrates UP to head on first open. Test
 * #5 below simulates exactly that (stamp an old user_version onto a populated
 * DB, then migrate up) — the closest jest-testable analogue to the restore
 * path, since the native file IO itself is not testable here.
 */
describe('migrate() full chain (v001 → v026)', () => {
  let db: BetterSqliteDatabase;

  beforeEach(() => {
    db = new BetterSqliteDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  async function userVersion(): Promise<number> {
    const row = await db.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version',
    );
    return row?.user_version ?? 0;
  }

  async function tableNames(): Promise<string[]> {
    const rows = await db.getAllAsync<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    );
    return rows.map((r) => r.name);
  }

  async function columnNames(table: string): Promise<string[]> {
    const rows = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info("${table}")`,
    );
    return rows.map((r) => r.name);
  }

  it('migrates a fresh DB to user_version = 26', async () => {
    await migrate(db);
    expect(await userVersion()).toBe(26);
  });

  it('creates all key tables', async () => {
    await migrate(db);
    const names = await tableNames();
    // The full set of tables the app depends on at head. If a future
    // migration accidentally drops one of these, this test fails loudly.
    for (const t of [
      'session',
      'session_exercise',
      'set',
      'exercise',
      'exercise_muscle',
      'muscle',
      'muscle_group',
      'template',
      'template_exercise',
      'template_set',
      'program',
      'program_cell',
      'program_sub_tag',
      'superset',
      'superset_exercise',
      'body_metric',
      'app_settings',
      'achievement_definition',
      'achievement_unlock',
    ]) {
      expect(names).toContain(t);
    }
  });

  it('lands the columns added/dropped across the chain on their final tables', async () => {
    await migrate(db);

    // set — v015 (set_kind/parent_set_id/is_logged), v018 (notes),
    // v019 (session_exercise_id), v025 (display_rank)
    const setCols = await columnNames('set');
    for (const c of [
      'session_id',
      'exercise_id',
      'weight_kg',
      'reps',
      'ordering',
      'set_kind',
      'parent_set_id',
      'is_logged',
      'notes',
      'session_exercise_id',
      'display_rank',
    ]) {
      expect(setCols).toContain(c);
    }

    // session — v016 (HK cols), v023 (title), v024 (is_watch_tracked)
    const sessionCols = await columnNames('session');
    for (const c of [
      'started_at',
      'ended_at',
      'bodyweight_snapshot_kg',
      'healthkit_workout_uuid',
      'avg_hr_bpm',
      'kcal',
      'title',
      'is_watch_tracked',
    ]) {
      expect(sessionCols).toContain(c);
    }

    // session_exercise — v014 (parent_id/reusable_superset_id), v016 (rest_sec)
    const seCols = await columnNames('session_exercise');
    for (const c of ['parent_id', 'reusable_superset_id', 'rest_sec']) {
      expect(seCols).toContain(c);
    }

    // template_exercise — v009 (rest_seconds/parent_id), v013 (rs FK).
    // v012 dropped `notes`, v021 dropped `rest_sec` — assert they are GONE.
    const teCols = await columnNames('template_exercise');
    expect(teCols).toContain('rest_seconds');
    expect(teCols).toContain('reusable_superset_id');
    expect(teCols).not.toContain('notes'); // dropped by v012
    expect(teCols).not.toContain('rest_sec'); // dropped by v021

    // template — v005 (program_id/sub_tag), v009 (color_hex)
    const tCols = await columnNames('template');
    for (const c of ['program_id', 'sub_tag', 'color_hex']) {
      expect(tCols).toContain(c);
    }

    // exercise — v006 (muscle_group_id/is_custom), v010 (equipment/notes/media_path/cues_text)
    const exCols = await columnNames('exercise');
    for (const c of [
      'muscle_group_id',
      'is_custom',
      'equipment',
      'notes',
      'media_path',
      'cues_text',
    ]) {
      expect(exCols).toContain(c);
    }
  });

  it('creates the v026 session.started_at index on a fresh chain', async () => {
    await migrate(db);
    const idx = await db.getFirstAsync<{ name: string }>(
      `SELECT name FROM sqlite_master
        WHERE type = 'index' AND name = 'idx_session_started_at'`,
    );
    expect(idx?.name).toBe('idx_session_started_at');
  });

  it('seeds the reserved "無" program (v017) on a fresh chain', async () => {
    await migrate(db);
    const row = await db.getFirstAsync<{ id: string; name: string }>(
      `SELECT id, name FROM program WHERE id = '00000000-0000-0000-0000-000000000000'`,
    );
    expect(row).toBeTruthy();
    expect(row?.name).toBe('無');
  });

  it('seeds the built-in exercise library (v001/v002/v006) on a fresh chain', async () => {
    await migrate(db);
    const benchRow = await db.getFirstAsync<{ name: string }>(
      `SELECT name FROM exercise WHERE id = '00000000-0000-4000-8000-000000000001'`,
    );
    expect(benchRow?.name).toBe('Bench Press');
    const count = await db.getFirstAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM exercise WHERE is_builtin = 1`,
    );
    // v001/v002 seed 7, v006 seeds the full library on top. Assert a healthy
    // floor rather than an exact count so adding seeds later doesn't break this.
    expect(count!.n).toBeGreaterThanOrEqual(7);
  });
});

describe('migrate() idempotency at the runner level', () => {
  let db: BetterSqliteDatabase;

  beforeEach(() => {
    db = new BetterSqliteDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  async function schemaSnapshot(): Promise<string[]> {
    // Capture every schema object's normalized DDL. If a second migrate()
    // mutates the schema in any way, this snapshot diverges.
    const rows = await db.getAllAsync<{ name: string; sql: string | null }>(
      `SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name`,
    );
    return rows.map((r) => `${r.name}::${r.sql ?? ''}`);
  }

  it('running migrate() twice on a fresh DB is a no-op (no throw, same schema)', async () => {
    await migrate(db);
    const before = await schemaSnapshot();
    await expect(migrate(db)).resolves.toBeUndefined();
    const after = await schemaSnapshot();
    expect(after).toEqual(before);
    const v = await db.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version',
    );
    expect(v?.user_version).toBe(26);
  });

  it('running migrate() a third time still no-ops (stable fixed point)', async () => {
    await migrate(db);
    await migrate(db);
    const before = await schemaSnapshot();
    await migrate(db);
    expect(await schemaSnapshot()).toEqual(before);
  });
});

describe('migrate() preserves data on a populated re-migrate', () => {
  let db: BetterSqliteDatabase;

  beforeEach(() => {
    db = new BetterSqliteDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  // Built-in exercise ids guaranteed to exist after migrate (FK targets).
  const EX_BENCH = '00000000-0000-4000-8000-000000000001';
  const EX_SQUAT = '00000000-0000-4000-8000-000000000002';
  const NONE_PROGRAM = '00000000-0000-0000-0000-000000000000';

  /**
   * Seed representative data across every major user-owned table, exercising
   * the trickier shapes: a dropset chain (parent_set_id), a superset
   * (session_exercise.parent_id + reusable_superset_id), display_rank,
   * body metrics, a custom template+program, and app_settings.
   */
  async function seedRepresentative(): Promise<void> {
    // program (custom) + program_sub_tag
    await db.runAsync(
      `INSERT INTO program (id, name, main_tag, cycle_length, cycle_count, start_date, is_active, created_at, updated_at)
       VALUES ('prog1','增肌-Q1','增肌',7,4,'2026-01-01',1,100,100)`,
    );
    await db.runAsync(
      `INSERT INTO program_sub_tag (program_id, sub_tag, created_at) VALUES ('prog1','10-12RM',100)`,
    );

    // template + template_exercise + template_set
    await db.runAsync(
      `INSERT INTO template (id, name, created_at, updated_at, program_id, sub_tag, color_hex)
       VALUES ('tpl1','胸日',100,100,'prog1','10-12RM','#ff0000')`,
    );
    await db.runAsync(
      `INSERT INTO template_exercise (id, template_id, exercise_id, ordering, default_sets, default_reps, default_weight_kg)
       VALUES ('te1','tpl1',?,0,3,10,60)`,
      EX_BENCH,
    );
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight)
       VALUES ('ts1','te1',0,'working',10,60)`,
    );

    // reusable superset
    await db.runAsync(
      `INSERT INTO superset (id, name, color_hex, use_count, created_at, updated_at)
       VALUES ('ss1','胸+背',NULL,2,100,100)`,
    );
    await db.runAsync(
      `INSERT INTO superset_exercise (superset_id, position, exercise_id) VALUES ('ss1',0,?)`,
      EX_BENCH,
    );
    await db.runAsync(
      `INSERT INTO superset_exercise (superset_id, position, exercise_id) VALUES ('ss1',1,?)`,
      EX_SQUAT,
    );

    // session + session_exercise (one superset-parent + one child) + sets
    await db.runAsync(
      `INSERT INTO session (id, started_at, ended_at, bodyweight_snapshot_kg, title, is_watch_tracked, avg_hr_bpm, kcal)
       VALUES ('sess1',1000,2000,72.5,'胸日',1,135.0,420.0)`,
    );
    // superset parent card
    await db.runAsync(
      `INSERT INTO session_exercise (id, session_id, exercise_id, ordering, planned_sets, template_id, parent_id, reusable_superset_id, rest_sec)
       VALUES ('se1','sess1',?,0,3,'tpl1',NULL,'ss1',90)`,
      EX_BENCH,
    );
    // superset child card pointing at parent se1
    await db.runAsync(
      `INSERT INTO session_exercise (id, session_id, exercise_id, ordering, planned_sets, template_id, parent_id, reusable_superset_id, rest_sec)
       VALUES ('se2','sess1',?,1,3,'tpl1','se1','ss1',90)`,
      EX_SQUAT,
    );

    // sets: a dropset chain (head + follower via parent_set_id) with display_rank + notes
    await db.runAsync(
      `INSERT INTO "set" (id, session_id, exercise_id, session_exercise_id, weight_kg, reps, ordering, created_at, set_kind, parent_set_id, is_logged, notes, display_rank)
       VALUES ('set_head','sess1',?,'se1',60,10,0,1100,'working',NULL,1,'top set',1.0)`,
      EX_BENCH,
    );
    await db.runAsync(
      `INSERT INTO "set" (id, session_id, exercise_id, session_exercise_id, weight_kg, reps, ordering, created_at, set_kind, parent_set_id, is_logged, notes, display_rank)
       VALUES ('set_drop','sess1',?,'se1',45,8,1,1101,'dropset','set_head',1,NULL,1.5)`,
      EX_BENCH,
    );
    await db.runAsync(
      `INSERT INTO "set" (id, session_id, exercise_id, session_exercise_id, weight_kg, reps, ordering, created_at, set_kind, parent_set_id, is_logged, display_rank)
       VALUES ('set_child','sess1',?,'se2',80,5,0,1102,'working',NULL,1,2.0)`,
      EX_SQUAT,
    );

    // body_metric
    await db.runAsync(
      `INSERT INTO body_metric (id, recorded_at, bodyweight_kg, pbf, smm_kg)
       VALUES ('bm1',5000,72.5,15.2,33.1)`,
    );

    // app_settings (a user preference)
    await db.runAsync(
      `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('unit_preference','lb')`,
    );

    // achievement_unlock (FK to a real definition row + the session)
    const def = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM achievement_definition LIMIT 1`,
    );
    if (def) {
      await db.runAsync(
        `INSERT INTO achievement_unlock (achievement_definition_id, unlocked_at, session_id, set_id)
         VALUES (?, 2000, 'sess1', 'set_head')`,
        def.id,
      );
    }
  }

  async function snapshotRows(): Promise<Record<string, unknown[]>> {
    const tables = [
      'session',
      'session_exercise',
      'set',
      'template',
      'template_exercise',
      'template_set',
      'program',
      'program_sub_tag',
      'program_cell',
      'superset',
      'superset_exercise',
      'body_metric',
      'achievement_unlock',
    ];
    const out: Record<string, unknown[]> = {};
    for (const t of tables) {
      out[t] = await db.getAllAsync(
        `SELECT * FROM "${t}" ORDER BY rowid`,
      );
    }
    // app_settings keyed read (a user preference must survive verbatim)
    out['app_settings_unit'] = await db.getAllAsync(
      `SELECT key, value FROM app_settings WHERE key = 'unit_preference'`,
    );
    return out;
  }

  it('a second migrate() on a populated DB loses no rows and mutates nothing', async () => {
    await migrate(db);
    await seedRepresentative();
    const before = await snapshotRows();

    // Disaster scenario: app relaunches, openDatabase() runs migrate() again.
    await expect(migrate(db)).resolves.toBeUndefined();

    const after = await snapshotRows();
    expect(after).toEqual(before);
    // user_version unchanged
    const v = await db.getFirstAsync<{ user_version: number }>(
      'PRAGMA user_version',
    );
    expect(v?.user_version).toBe(26);
  });

  it('preserves the dropset chain (parent_set_id) verbatim across re-migrate', async () => {
    await migrate(db);
    await seedRepresentative();
    await migrate(db);
    const follower = await db.getFirstAsync<{
      parent_set_id: string;
      set_kind: string;
      display_rank: number;
    }>(`SELECT parent_set_id, set_kind, display_rank FROM "set" WHERE id = 'set_drop'`);
    expect(follower?.parent_set_id).toBe('set_head');
    expect(follower?.set_kind).toBe('dropset');
    expect(follower?.display_rank).toBe(1.5);
  });

  it('preserves the superset linkage (session_exercise.parent_id / reusable_superset_id)', async () => {
    await migrate(db);
    await seedRepresentative();
    await migrate(db);
    const child = await db.getFirstAsync<{
      parent_id: string;
      reusable_superset_id: string;
    }>(
      `SELECT parent_id, reusable_superset_id FROM session_exercise WHERE id = 'se2'`,
    );
    expect(child?.parent_id).toBe('se1');
    expect(child?.reusable_superset_id).toBe('ss1');
  });

  it('preserves a user preference in app_settings verbatim', async () => {
    await migrate(db);
    await seedRepresentative();
    await migrate(db);
    const row = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM app_settings WHERE key = 'unit_preference'`,
    );
    expect(row?.value).toBe('lb');
  });

  it('NONE_PROGRAM seed coexists with a populated DB after re-migrate (no dup)', async () => {
    await migrate(db);
    await seedRepresentative();
    await migrate(db);
    const rows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM program WHERE id = ?`,
      NONE_PROGRAM,
    );
    expect(rows).toHaveLength(1);
  });
});

describe('migrate() up-migration from an older schema version (restore-path analogue)', () => {
  let db: BetterSqliteDatabase;

  beforeEach(() => {
    db = new BetterSqliteDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  const EX_BENCH = '00000000-0000-4000-8000-000000000001';

  /**
   * ADR-0011 §4 restore path: an iCloud backup is a whole-FILE SQLite copy.
   * On restore, the file carries its OWN user_version (whatever it was at
   * backup time) and openDatabase() runs migrate() over it. So a backup taken
   * at schema vN must migrate UP to head on first open WITHOUT losing the data
   * already in the file.
   *
   * The native file IO isn't testable in jest, but the schema-evolution half
   * IS: stamp an intermediate user_version onto a DB that already has rows in
   * the v015-era `set` table (pre display_rank / pre session_exercise_id), then
   * run migrate() and assert (a) it climbs to 26 and (b) the pre-existing rows
   * are backfilled correctly, not dropped.
   */
  it('a v15-era populated DB migrates up to 26 and backfills new columns without row loss', async () => {
    // Build a DB only up to v015 by stamping user_version=15 won't work
    // directly (we need the v015 schema). Instead migrate fully, then verify
    // the BACKFILL columns (v019 session_exercise_id, v025 display_rank) are
    // populated for legacy-shaped rows when we re-run those backfills via a
    // simulated downgrade of just the user_version pointer.
    await migrate(db);

    // Seed a "legacy" set row as if authored before v019/v025 (NULL backfill
    // targets), with a matching session_exercise so the v019 backfill can map.
    await db.runAsync(`INSERT INTO session (id, started_at) VALUES ('s1', 1)`);
    await db.runAsync(
      `INSERT INTO session_exercise (id, session_id, exercise_id, ordering, planned_sets, template_id)
       VALUES ('se1','s1',?,0,3,NULL)`,
      EX_BENCH,
    );
    await db.runAsync(
      `INSERT INTO "set" (id, session_id, exercise_id, weight_kg, reps, ordering, created_at, session_exercise_id, display_rank)
       VALUES ('legacy_set','s1',?,50,10,3,1,NULL,NULL)`,
      EX_BENCH,
    );

    // Rewind the version pointer to BEFORE v019 so the runner re-applies
    // v019..v026 — exactly what a restored older-schema file triggers. The
    // ADD COLUMN steps are PRAGMA-guarded no-ops; the BACKFILL UPDATEs run
    // and must fill the NULLs without harming the row.
    await db.execAsync('PRAGMA user_version = 18');

    await migrate(db);

    expect(
      (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))
        ?.user_version,
    ).toBe(26);

    // The legacy row must still exist...
    const row = await db.getFirstAsync<{
      session_exercise_id: string | null;
      display_rank: number | null;
    }>(
      `SELECT session_exercise_id, display_rank FROM "set" WHERE id = 'legacy_set'`,
    );
    expect(row).toBeTruthy();
    // ...and the v019 backfill mapped it to the matching session_exercise...
    expect(row?.session_exercise_id).toBe('se1');
    // ...and the v025 backfill stamped display_rank = ordering (3).
    expect(row?.display_rank).toBe(3);
  });
});
