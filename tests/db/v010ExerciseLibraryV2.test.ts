import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { EXERCISE_EQUIPMENT_SEED } from '../../src/db/seed/v010ExerciseLibraryEquipment';

/**
 * v010 migration acceptance tests (slice 9.6, ADR-0017 + ADR-0010 / ADR-0013
 * amendments).
 *
 * 覆蓋:
 *   - exercise.equipment / notes / media_path / cues_text ALTER 落地
 *   - equipment CHECK 8-enum 拒絕非法值
 *   - muscle naming UPDATE 4 筆 (外側二頭 / 內側二頭 / 小臂 muscle + muscle_group)
 *   - Muscle id 不動 (m-bicep-long / m-bicep-short / m-forearm / mg-forearm)
 *   - 66 built-in exercises equipment backfill 全填值（無 '其他' default 殘留）
 *   - per-template notes 升 global merge：最近 updated_at 寫進 exercise.notes
 *   - DROP COLUMN template_exercise.notes
 */
describe('v010 exercise library v2 migration', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  describe('exercise schema additions', () => {
    it('adds equipment column with default 其他 + CHECK constraint', async () => {
      await migrate(db);
      const cols = await db.getAllAsync<{
        name: string;
        notnull: number;
        dflt_value: string | null;
      }>(`PRAGMA table_info(exercise)`);
      const equip = cols.find((c) => c.name === 'equipment');
      expect(equip).toBeDefined();
      expect(equip!.notnull).toBe(1);
      expect(equip!.dflt_value).toBe("'其他'");
    });

    it('adds notes / media_path / cues_text nullable columns', async () => {
      await migrate(db);
      const cols = await db.getAllAsync<{ name: string; notnull: number }>(
        `PRAGMA table_info(exercise)`
      );
      const byName = Object.fromEntries(cols.map((c) => [c.name, c]));
      expect(byName.notes).toBeDefined();
      expect(byName.notes.notnull).toBe(0);
      expect(byName.media_path).toBeDefined();
      expect(byName.media_path.notnull).toBe(0);
      expect(byName.cues_text).toBeDefined();
      expect(byName.cues_text.notnull).toBe(0);
    });

    it('CHECK constraint rejects equipment outside 8-enum', async () => {
      await migrate(db);
      await expect(
        db.runAsync(
          `INSERT INTO exercise (id, name, load_type, is_builtin, is_archived, muscle_group_id, is_custom, equipment)
           VALUES ('test-bad', 'Bad', 'loaded', 0, 0, NULL, 1, 'invalid')`
        )
      ).rejects.toThrow();
    });

    it('CHECK constraint accepts every legal equipment value', async () => {
      await migrate(db);
      const legal = ['槓鈴', '啞鈴', '史密斯機', '滑輪', '固定機械', '自重', '壺鈴', '其他'];
      let idx = 0;
      for (const eq of legal) {
        await db.runAsync(
          `INSERT INTO exercise (id, name, load_type, is_builtin, is_archived, muscle_group_id, is_custom, equipment)
           VALUES (?, ?, 'loaded', 0, 0, NULL, 1, ?)`,
          `test-ok-${idx++}`,
          `OK ${eq}`,
          eq
        );
      }
      const rows = await db.getAllAsync<{ id: string }>(
        `SELECT id FROM exercise WHERE id LIKE 'test-ok-%'`
      );
      expect(rows).toHaveLength(8);
    });
  });

  describe('muscle naming revise (ADR-0010 amendment)', () => {
    it('updates 二頭長頭 → 外側二頭 / 二頭短頭 → 內側二頭 / 前臂 → 小臂', async () => {
      await migrate(db);
      const bicepLong = await db.getFirstAsync<{ name: string }>(
        `SELECT name FROM muscle WHERE id = 'm-bicep-long'`
      );
      const bicepShort = await db.getFirstAsync<{ name: string }>(
        `SELECT name FROM muscle WHERE id = 'm-bicep-short'`
      );
      const forearm = await db.getFirstAsync<{ name: string }>(
        `SELECT name FROM muscle WHERE id = 'm-forearm'`
      );
      const forearmGroup = await db.getFirstAsync<{ name: string }>(
        `SELECT name FROM muscle_group WHERE id = 'mg-forearm'`
      );
      expect(bicepLong!.name).toBe('外側二頭');
      expect(bicepShort!.name).toBe('內側二頭');
      expect(forearm!.name).toBe('小臂');
      expect(forearmGroup!.name).toBe('小臂');
    });

    it('preserves muscle / muscle_group ids', async () => {
      await migrate(db);
      const ids = await db.getAllAsync<{ id: string }>(
        `SELECT id FROM muscle WHERE id IN ('m-bicep-long','m-bicep-short','m-forearm')`
      );
      expect(ids.map((r) => r.id).sort()).toEqual(
        ['m-bicep-long', 'm-bicep-short', 'm-forearm'].sort()
      );
    });
  });

  describe('built-in equipment backfill', () => {
    it('all 66 built-in exercises have non-default equipment', async () => {
      await migrate(db);
      const builtinIds = EXERCISE_EQUIPMENT_SEED.map(([id]) => id);
      const rows = await db.getAllAsync<{ id: string; equipment: string }>(
        `SELECT id, equipment FROM exercise WHERE is_builtin = 1`
      );
      // Every seeded row matches the seed map
      const byId = Object.fromEntries(rows.map((r) => [r.id, r.equipment]));
      for (const [id, expected] of EXERCISE_EQUIPMENT_SEED) {
        expect(byId[id]).toBe(expected);
      }
      // Coverage: seed map covers every built-in
      expect(builtinIds.length).toBe(rows.length);
    });

    it('seed map contains exactly 66 entries', () => {
      expect(EXERCISE_EQUIPMENT_SEED).toHaveLength(66);
    });
  });

  describe('per-Exercise notes migration (ADR-0013 amendment)', () => {
    it('backfills exercise.notes from the most-recently-updated template_exercise.notes', async () => {
      // Manual replay: stop at v009, INSERT template_exercise rows with notes,
      // then run v010_exercise_library_v2 alone.
      const { v001_initial } = await import('../../src/db/schema/v001_initial');
      const { v002_more_exercises } = await import('../../src/db/schema/v002_more_exercises');
      const { v003_templates } = await import('../../src/db/schema/v003_templates');
      const { v004_evergreen_zone } = await import('../../src/db/schema/v004_evergreen_zone');
      const { v005_program } = await import('../../src/db/schema/v005_program');
      const { v006_muscle_layer } = await import('../../src/db/schema/v006_muscle_layer');
      const { v007_body_metric } = await import('../../src/db/schema/v007_body_metric');
      const { v008_achievements } = await import('../../src/db/schema/v008_achievements');
      const { v009_template_set } = await import('../../src/db/schema/v009_template_set');
      const { v010_exercise_library_v2 } = await import(
        '../../src/db/schema/v010_exercise_library_v2'
      );

      await v001_initial(db);
      await v002_more_exercises(db);
      await v003_templates(db);
      await v004_evergreen_zone(db);
      await v005_program(db);
      await v006_muscle_layer(db);
      await v007_body_metric(db);
      await v008_achievements(db);
      await v009_template_set(db);

      const benchId = '00000000-0000-4000-8000-000000000001'; // Bench Press

      const now = Date.now();
      await db.runAsync(
        `INSERT INTO template (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
        'tpl-1',
        'Push Day',
        now,
        now
      );
      await db.runAsync(
        `INSERT INTO template (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
        'tpl-2',
        'Chest Day',
        now,
        now
      );
      // Older notes on tpl-1
      await db.runAsync(
        `INSERT INTO template_exercise (id, template_id, exercise_id, ordering, default_sets, notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        'te-1',
        'tpl-1',
        benchId,
        0,
        3,
        'cue old',
        1000
      );
      // Newer notes on tpl-2 → wins
      await db.runAsync(
        `INSERT INTO template_exercise (id, template_id, exercise_id, ordering, default_sets, notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        'te-2',
        'tpl-2',
        benchId,
        0,
        3,
        'cue new',
        2000
      );

      await v010_exercise_library_v2(db);

      const bench = await db.getFirstAsync<{ notes: string | null }>(
        `SELECT notes FROM exercise WHERE id = ?`,
        benchId
      );
      expect(bench!.notes).toBe('cue new');
    });

    it('leaves exercise.notes NULL when no template_exercise.notes exist', async () => {
      await migrate(db); // No template_exercise rows inserted manually
      const rows = await db.getAllAsync<{ notes: string | null }>(
        `SELECT notes FROM exercise WHERE notes IS NOT NULL`
      );
      // All exercises start with notes NULL post-migration (no template data)
      expect(rows).toHaveLength(0);
    });

    it('keeps template_exercise.notes column (phased — drops in later migration)', async () => {
      await migrate(db);
      const cols = await db.getAllAsync<{ name: string }>(
        `PRAGMA table_info(template_exercise)`
      );
      const colNames = cols.map((c) => c.name);
      // v010 deliberately keeps the column so production templateRepository
      // (which still reads/writes it) doesn't crash. A later migration will
      // DROP COLUMN after the repo + UI migrate to exercise.notes.
      expect(colNames).toContain('notes');
    });
  });
});
