import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { v029_exercise_muscle_links } from '../../src/db/schema/v029_exercise_muscle_links';
import { EXERCISE_MUSCLE_LINKS } from '../../src/db/seed/v029ExerciseMuscleLinks';
import { NEW_EXERCISE_SEEDS } from '../../src/db/seed/v028ExerciseMediaLibrary';

/**
 * v029 acceptance — fine-grained exercise_muscle links for the v028 curated
 * library (DATA-ONLY migration; INSERT OR IGNORE into the existing table).
 *
 * The 143 new exercises with a media_key get FE-DB-derived primary/secondary
 * muscle rows; the 63 placeholders (media_key NULL) stay group-fallback.
 */
describe('v029 exercise muscle links migration', () => {
  let db: BetterSqliteDatabase;

  // Stable exId anchors among the 206 new exercises (from v028 seed).
  const EX_DECLINE_DB_PRESS = '00000000-0000-4000-8000-00000000005b'; // 下斜啞鈴臥推 (chest)
  const EX_FRONT_SQUAT = '00000000-0000-4000-8000-000000000043'; // 槓鈴前蹲 (quad)
  const EX_DEADLIFT = '00000000-0000-4000-8000-000000000045'; // 槓鈴硬舉 (lower back)

  beforeEach(() => {
    db = new BetterSqliteDatabase(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  const count = async (
    sql: string,
    ...args: (string | number | null)[]
  ): Promise<number> =>
    (await db.getFirstAsync<{ n: number }>(sql, ...args))?.n ?? -1;

  const rolesOf = async (
    exerciseId: string
  ): Promise<Record<string, 'primary' | 'secondary'>> => {
    const rows = await db.getAllAsync<{ muscle_id: string; role: 'primary' | 'secondary' }>(
      `SELECT muscle_id, role FROM exercise_muscle WHERE exercise_id = ?`,
      exerciseId
    );
    return Object.fromEntries(rows.map((r) => [r.muscle_id, r.role]));
  };

  it('seed has the expected shape (556 rows, primaries before secondaries)', () => {
    expect(EXERCISE_MUSCLE_LINKS.length).toBe(556);
    // All 143 keyed exercises produced links; 63 placeholders did not.
    const keyed = NEW_EXERCISE_SEEDS.filter((e) => e.media_key).map((e) => e.id);
    const linkedIds = new Set(EXERCISE_MUSCLE_LINKS.map((l) => l.exercise_id));
    for (const id of keyed) expect(linkedIds.has(id)).toBe(true);
    expect(linkedIds.size).toBe(143);
    // Within the flat list, no secondary row appears before the last primary row
    // (primary-wins ordering relied on by the INSERT OR IGNORE PK behaviour).
    const lastPrimary = EXERCISE_MUSCLE_LINKS.map((l) => l.role).lastIndexOf('primary');
    const firstSecondary = EXERCISE_MUSCLE_LINKS.map((l) => l.role).indexOf('secondary');
    expect(firstSecondary).toBeGreaterThan(lastPrimary);
  });

  it('after migrate, exercise_muscle row count for new exercises matches the seed', async () => {
    await migrate(db);
    const newIds = NEW_EXERCISE_SEEDS.map((e) => `'${e.id}'`).join(',');
    const n = await count(
      `SELECT COUNT(*) n FROM exercise_muscle WHERE exercise_id IN (${newIds})`
    );
    expect(n).toBe(EXERCISE_MUSCLE_LINKS.length);
    expect(n).toBe(556);
  });

  it('spot: a bench-press type has chest primary + shoulders/triceps secondary', async () => {
    await migrate(db);
    const roles = await rolesOf(EX_DECLINE_DB_PRESS);
    expect(roles['m-upper-chest']).toBe('primary');
    expect(roles['m-lower-chest']).toBe('primary');
    expect(roles['m-tricep']).toBe('secondary');
    expect(roles['m-front-delt']).toBe('secondary');
    expect(roles['m-mid-delt']).toBe('secondary');
    expect(roles['m-rear-delt']).toBe('secondary');
  });

  it('spot: a squat has quad primary + glutes/hamstrings/calf secondary', async () => {
    await migrate(db);
    const roles = await rolesOf(EX_FRONT_SQUAT);
    expect(roles['m-quad']).toBe('primary');
    expect(roles['m-upper-glute']).toBe('secondary');
    expect(roles['m-lower-glute']).toBe('secondary');
    expect(roles['m-hamstring']).toBe('secondary');
    expect(roles['m-calf']).toBe('secondary');
  });

  it('spot: a deadlift has lower-back primary + posterior chain secondary (m-back deduped)', async () => {
    await migrate(db);
    const roles = await rolesOf(EX_DEADLIFT);
    expect(roles['m-lower-back']).toBe('primary');
    expect(roles['m-back']).toBe('secondary'); // lats + middle back both → m-back, one row
    expect(roles['m-hamstring']).toBe('secondary');
    expect(roles['m-trap']).toBe('secondary');
    // m-back must not be duplicated.
    const backRows = await count(
      `SELECT COUNT(*) n FROM exercise_muscle WHERE exercise_id = ? AND muscle_id = 'm-back'`,
      EX_DEADLIFT
    );
    expect(backRows).toBe(1);
  });

  it('every referenced muscle_id exists in the muscle table (FK sanity)', async () => {
    await migrate(db);
    const orphans = await count(
      `SELECT COUNT(*) n FROM exercise_muscle em
       WHERE NOT EXISTS (SELECT 1 FROM muscle m WHERE m.id = em.muscle_id)`
    );
    expect(orphans).toBe(0);
    // And every referenced exercise_id exists too.
    const exOrphans = await count(
      `SELECT COUNT(*) n FROM exercise_muscle em
       WHERE NOT EXISTS (SELECT 1 FROM exercise e WHERE e.id = em.exercise_id)`
    );
    expect(exOrphans).toBe(0);
  });

  it('placeholder exercises (media_key NULL) get no links (keep group fallback)', async () => {
    await migrate(db);
    const ph = NEW_EXERCISE_SEEDS.find((e) => !e.media_key)!;
    const n = await count(
      `SELECT COUNT(*) n FROM exercise_muscle WHERE exercise_id = ?`,
      ph.id
    );
    expect(n).toBe(0);
  });

  it('is idempotent — re-running v029 keeps the row count unchanged', async () => {
    await migrate(db);
    const newIds = NEW_EXERCISE_SEEDS.map((e) => `'${e.id}'`).join(',');
    const before = await count(
      `SELECT COUNT(*) n FROM exercise_muscle WHERE exercise_id IN (${newIds})`
    );
    await v029_exercise_muscle_links(db);
    await v029_exercise_muscle_links(db);
    const after = await count(
      `SELECT COUNT(*) n FROM exercise_muscle WHERE exercise_id IN (${newIds})`
    );
    expect(after).toBe(before);
  });

  it('bumps PRAGMA user_version to at least 29', async () => {
    await migrate(db);
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(row?.user_version).toBeGreaterThanOrEqual(29);
  });
});
