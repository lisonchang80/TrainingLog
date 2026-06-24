import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { v028_exercise_media_library } from '../../src/db/schema/v028_exercise_media_library';
import {
  NEW_EXERCISE_SEEDS,
  MEDIA_UPDATE_EXISTING,
  ARCHIVE_EXISTING_IDS,
} from '../../src/db/seed/v028ExerciseMediaLibrary';
import { EXERCISE_MEDIA } from '../../src/db/seed/exerciseMediaMap';

/**
 * v028 acceptance — Exercise media library bundling (Free Exercise DB curation,
 * grill 2026-06-24 "C 折衷 + 只留 3 個獨有").
 *
 * Net active built-in library = 233 (24 reused + 206 new + 3 kept); 39 archived.
 */
describe('v028 exercise media library migration', () => {
  let db: BetterSqliteDatabase;

  // existing built-in ids (stable exId pattern) used as FK-safe spot anchors.
  const EX_BENCH = '00000000-0000-4000-8000-000000000001'; // Bench Press (media-update)
  const EX_DEADLIFT = '00000000-0000-4000-8000-000000000003'; // 硬舉 (archived)
  const EX_HYPEREXT = '00000000-0000-4000-8000-000000000017'; // 山羊挺身 (kept active)
  const EX_BENCHDIP = '00000000-0000-4000-8000-000000000037'; // 板凳撐體 (kept active)
  const EX_DONKEY = '00000000-0000-4000-8000-00000000003a'; // 驢式提踵 (kept active)

  beforeEach(() => {
    db = new BetterSqliteDatabase(':memory:');
  });
  afterEach(() => {
    db.close();
  });

  const count = async (sql: string): Promise<number> =>
    (await db.getFirstAsync<{ n: number }>(sql))?.n ?? -1;

  it('seed constants have the locked shapes', () => {
    expect(NEW_EXERCISE_SEEDS).toHaveLength(206);
    expect(MEDIA_UPDATE_EXISTING).toHaveLength(24);
    expect(ARCHIVE_EXISTING_IDS).toHaveLength(39);
    expect(Object.keys(EXERCISE_MEDIA)).toHaveLength(167);
    // 143 of the 206 new are real (have a media_key); the rest placeholders.
    expect(NEW_EXERCISE_SEEDS.filter((e) => e.media_key).length).toBe(143);
  });

  it('lands 233 active built-ins (66 + 206 − 39 archived) and 272 total', async () => {
    await migrate(db);
    expect(await count(`SELECT COUNT(*) n FROM exercise WHERE is_builtin = 1`)).toBe(272);
    expect(
      await count(`SELECT COUNT(*) n FROM exercise WHERE is_builtin = 1 AND is_archived = 0`),
    ).toBe(233);
    expect(await count(`SELECT COUNT(*) n FROM exercise WHERE is_archived = 1`)).toBe(39);
  });

  it('inserts 206 new exercises with correct fields (spot: 槓鈴前蹲 real)', async () => {
    await migrate(db);
    const real = NEW_EXERCISE_SEEDS.find((e) => e.name === '槓鈴前蹲')!;
    const row = await db.getFirstAsync<{
      load_type: string;
      muscle_group_id: string;
      equipment: string;
      media_path: string | null;
      is_builtin: number;
      is_archived: number;
    }>(`SELECT load_type, muscle_group_id, equipment, media_path, is_builtin, is_archived
        FROM exercise WHERE id = ?`, real.id);
    expect(row).toMatchObject({
      load_type: real.load_type,
      muscle_group_id: 'mg-leg',
      equipment: '槓鈴',
      media_path: 'Front_Barbell_Squat',
      is_builtin: 1,
      is_archived: 0,
    });
  });

  it('placeholder new exercises store NULL media_path', async () => {
    await migrate(db);
    const ph = NEW_EXERCISE_SEEDS.find((e) => !e.media_key)!;
    const row = await db.getFirstAsync<{ media_path: string | null }>(
      `SELECT media_path FROM exercise WHERE id = ?`,
      ph.id,
    );
    expect(row?.media_path).toBeNull();
  });

  it('gives 24 same-name built-ins their real photo without archiving them', async () => {
    await migrate(db);
    for (const [id, key] of MEDIA_UPDATE_EXISTING) {
      const row = await db.getFirstAsync<{ media_path: string | null; is_archived: number }>(
        `SELECT media_path, is_archived FROM exercise WHERE id = ?`,
        id,
      );
      expect(row?.media_path).toBe(key);
      expect(row?.is_archived).toBe(0);
    }
    // spot: Bench Press got its medium-grip photo.
    const bench = await db.getFirstAsync<{ media_path: string }>(
      `SELECT media_path FROM exercise WHERE id = ?`,
      EX_BENCH,
    );
    expect(bench?.media_path).toBe('Barbell_Bench_Press_-_Medium_Grip');
  });

  it('archives the 39 superseded built-ins but keeps the 3 genuinely-unique active', async () => {
    await migrate(db);
    for (const id of ARCHIVE_EXISTING_IDS) {
      const row = await db.getFirstAsync<{ is_archived: number }>(
        `SELECT is_archived FROM exercise WHERE id = ?`,
        id,
      );
      expect(row?.is_archived).toBe(1);
    }
    expect(ARCHIVE_EXISTING_IDS).toContain(EX_DEADLIFT); // 硬舉 superseded → archived
    for (const keptId of [EX_HYPEREXT, EX_BENCHDIP, EX_DONKEY]) {
      expect(ARCHIVE_EXISTING_IDS).not.toContain(keptId);
      const row = await db.getFirstAsync<{ is_archived: number }>(
        `SELECT is_archived FROM exercise WHERE id = ?`,
        keptId,
      );
      expect(row?.is_archived).toBe(0);
    }
  });

  it('every stored media_path resolves to a bundled require map entry (no dangling key)', async () => {
    await migrate(db);
    const rows = await db.getAllAsync<{ media_path: string }>(
      `SELECT DISTINCT media_path FROM exercise WHERE media_path IS NOT NULL`,
    );
    expect(rows).toHaveLength(167); // 24 reused + 143 new-real
    for (const { media_path } of rows) {
      expect(EXERCISE_MEDIA[media_path]).toBeDefined();
    }
  });

  it('is idempotent — re-running v028 keeps counts stable and never throws', async () => {
    await migrate(db);
    await v028_exercise_media_library(db);
    await v028_exercise_media_library(db);
    expect(await count(`SELECT COUNT(*) n FROM exercise WHERE is_builtin = 1`)).toBe(272);
    expect(await count(`SELECT COUNT(*) n FROM exercise WHERE is_archived = 1`)).toBe(39);
    expect(
      await count(`SELECT COUNT(*) n FROM exercise WHERE media_path IS NOT NULL`),
    ).toBe(167);
  });

  it('bumps PRAGMA user_version to at least 28', async () => {
    await migrate(db);
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(row?.user_version).toBeGreaterThanOrEqual(28);
  });
});
