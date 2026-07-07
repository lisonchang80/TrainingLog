import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';

/**
 * Launch data-safety invariant: the migration chain must leave the DB
 * REFERENTIALLY CONSISTENT — no dangling foreign-key references — both on a
 * fresh head migration AND after a populated re-migrate (the app-relaunch /
 * restored-file-re-open disaster scenario).
 *
 * `migrateChain.test.ts` already proves ROW SURVIVAL via full-table snapshot
 * diffs, but a snapshot compare is blind to referential integrity: a future
 * migration that renames a parent table or backfills a child FK column
 * incorrectly could leave orphaned child rows whose snapshot is unchanged yet
 * whose FK target no longer resolves. `PRAGMA foreign_key_check` is the only
 * assertion that catches that class — it walks EVERY FK in the schema and
 * returns one row per violation. An empty result = every child row's parent
 * resolves. That is the invariant an App Store build can never regress on: a
 * DB that opens with dangling FKs corrupts cascade-deletes and can crash on
 * the next constrained write.
 *
 * This is deliberately SEPARATE from the per-migration FK-rejection tests
 * (v009/v011/v013 assert a specific FK rejects an orphan INSERT). Those prove
 * the constraint is DECLARED; this proves the SEEDED + MIGRATED data actually
 * SATISFIES every declared constraint end-to-end.
 */

// Built-in FK targets guaranteed to exist after migrate().
const EX_BENCH = '00000000-0000-4000-8000-000000000001';
const EX_SQUAT = '00000000-0000-4000-8000-000000000002';

/**
 * Seed representative data across every major user-owned table, exercising the
 * FK-heavy shapes: a superset (session_exercise.parent_id +
 * reusable_superset_id), a dropset chain (set.parent_set_id), a
 * template→program linkage, and an achievement_unlock back-ref to both a
 * session and a set. Mirrors the proven insert shapes in migrateChain.test.ts.
 */
async function seedRepresentative(db: BetterSqliteDatabase): Promise<void> {
  await db.runAsync(
    `INSERT INTO program (id, name, main_tag, cycle_length, cycle_count, start_date, is_active, created_at, updated_at)
     VALUES ('prog1','增肌-Q1','增肌',7,4,'2026-01-01',1,100,100)`,
  );
  await db.runAsync(
    `INSERT INTO program_sub_tag (program_id, sub_tag, created_at) VALUES ('prog1','10-12RM',100)`,
  );

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

  // dropset chain: head + follower via parent_set_id
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

  await db.runAsync(
    `INSERT INTO body_metric (id, recorded_at, bodyweight_kg, pbf, smm_kg)
     VALUES ('bm1',5000,72.5,15.2,33.1)`,
  );

  await db.runAsync(
    `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('unit_preference','lb')`,
  );

  // achievement_unlock with BOTH back-refs populated (session_id + set_id) —
  // the FK-heaviest row shape, and the one that a naive delete used to crash.
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

interface FkViolation {
  table: string;
  rowid: number;
  parent: string;
  fkid: number;
}

async function foreignKeyViolations(
  db: BetterSqliteDatabase,
): Promise<FkViolation[]> {
  // PRAGMA foreign_key_check returns (table, rowid, parent, fkid) per
  // violation; an empty array means the whole DB is referentially consistent.
  return db.getAllAsync<FkViolation>(`PRAGMA foreign_key_check`);
}

describe('migrate() referential integrity (PRAGMA foreign_key_check)', () => {
  let db: BetterSqliteDatabase;

  beforeEach(() => {
    db = new BetterSqliteDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('a freshly migrated (seed-only) head DB has ZERO dangling foreign keys', async () => {
    await migrate(db);
    // Only the built-in seeds (exercise library, muscle map, NONE program,
    // achievement definitions) are present — assert they are self-consistent.
    expect(await foreignKeyViolations(db)).toEqual([]);
  });

  it('a populated head DB (superset + dropset + unlock back-refs) has ZERO dangling foreign keys', async () => {
    await migrate(db);
    await seedRepresentative(db);
    expect(await foreignKeyViolations(db)).toEqual([]);
  });

  it('stays FK-consistent after a re-migrate (app-relaunch / restored-file re-open)', async () => {
    await migrate(db);
    await seedRepresentative(db);
    // Disaster scenario: openDatabase() runs migrate() again on the populated
    // file. No new orphans may appear.
    await migrate(db);
    expect(await foreignKeyViolations(db)).toEqual([]);
  });

  it('stays FK-consistent after a rewound-pointer up-migration (restore-path analogue)', async () => {
    await migrate(db);
    await seedRepresentative(db);
    // Simulate a restored older-schema file whose user_version is stamped
    // below the tail migrations: the runner re-applies v019..v029 backfills
    // over the already-populated rows. Those backfills must not orphan any FK.
    await db.execAsync('PRAGMA user_version = 18');
    await migrate(db);
    expect(await foreignKeyViolations(db)).toEqual([]);
  });

  it('foreign_key_check is a MEANINGFUL guard: it flags a deliberately orphaned row', async () => {
    // Sanity check that the assertion isn't a vacuous pass — insert a genuine
    // orphan (FKs off) and confirm the pragma reports it. If this ever stops
    // flagging, the other four tests would be false-green.
    await migrate(db);
    await db.runAsync(`PRAGMA foreign_keys = OFF`);
    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES ('orphan-sess', 1)`,
    );
    await db.runAsync(
      `INSERT INTO session_exercise (id, session_id, exercise_id, ordering, planned_sets, template_id)
       VALUES ('orphan-se','orphan-sess','no-such-exercise',0,1,NULL)`,
    );
    await db.runAsync(`PRAGMA foreign_keys = ON`);

    const violations = await foreignKeyViolations(db);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.table === 'session_exercise')).toBe(true);
  });
});
