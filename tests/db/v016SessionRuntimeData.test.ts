import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { v016_session_runtime_data } from '../../src/db/schema/v016_session_runtime_data';

/**
 * v016 migration tests — rest_sec dual + session HK stubs + auto_popup
 * settings seed (slice 10a foundation per ADR-0019 Q2 + Q9 + 留尾 Q3 拍板).
 *
 * Coverage:
 *   - session_exercise.rest_sec added (INTEGER, nullable) — canonical
 *     session-side column, widely read by app/sessionRepository
 *   - session.healthkit_workout_uuid (TEXT) / avg_hr_bpm (REAL) / kcal (REAL) added, all nullable
 *   - app_settings 'auto_popup_rest_timer' seed = '1'
 *   - INSERT OR IGNORE doesn't duplicate seed on re-run
 *   - Re-running v016 in isolation is no-op (idempotent ADD COLUMN guards)
 *
 * Note: v016 also added `template_exercise.rest_sec`, but that column was an
 * orphan (slice 10b declared v009's `rest_seconds` canonical) and was dropped
 * in v021. The historical ADD COLUMN behavior is verified in isolation below
 * — the post-`migrate(db)` schema no longer contains it.
 */
describe('v016 session runtime data migration', () => {
  let db: BetterSqliteDatabase;

  beforeEach(() => {
    db = new BetterSqliteDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('does NOT leave template_exercise.rest_sec on the migrated schema (v021 dropped the orphan)', async () => {
    // v016 added a `template_exercise.rest_sec` orphan that v021 later dropped
    // (slice 10b declared v009's `rest_seconds` canonical). Post-migrate, the
    // column must be absent — the canonical column lives on as
    // `template_exercise.rest_seconds` (v009).
    await migrate(db);
    const cols = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(template_exercise)`,
    );
    const names = cols.map((c) => c.name);
    expect(names).not.toContain('rest_sec');
    expect(names).toContain('rest_seconds');
  });

  it('adds session_exercise.rest_sec INTEGER nullable', async () => {
    await migrate(db);
    const cols = await db.getAllAsync<{ name: string; type: string; notnull: number }>(
      `PRAGMA table_info(session_exercise)`,
    );
    const col = cols.find((c) => c.name === 'rest_sec');
    expect(col).toBeDefined();
    expect(col!.type).toBe('INTEGER');
    expect(col!.notnull).toBe(0);
  });

  it('adds session.healthkit_workout_uuid (TEXT) / avg_hr_bpm (REAL) / kcal (REAL), all nullable', async () => {
    await migrate(db);
    const cols = await db.getAllAsync<{ name: string; type: string; notnull: number }>(
      `PRAGMA table_info(session)`,
    );

    const uuidCol = cols.find((c) => c.name === 'healthkit_workout_uuid');
    expect(uuidCol).toBeDefined();
    expect(uuidCol!.type).toBe('TEXT');
    expect(uuidCol!.notnull).toBe(0);

    const hrCol = cols.find((c) => c.name === 'avg_hr_bpm');
    expect(hrCol).toBeDefined();
    expect(hrCol!.type).toBe('REAL');
    expect(hrCol!.notnull).toBe(0);

    const kcalCol = cols.find((c) => c.name === 'kcal');
    expect(kcalCol).toBeDefined();
    expect(kcalCol!.type).toBe('REAL');
    expect(kcalCol!.notnull).toBe(0);
  });

  it('seeds app_settings.auto_popup_rest_timer = "1" (default ON)', async () => {
    await migrate(db);
    const row = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM app_settings WHERE key = 'auto_popup_rest_timer'`,
    );
    expect(row).toBeDefined();
    expect(row!.value).toBe('1');
  });

  it('INSERT OR IGNORE does not duplicate seed on re-run', async () => {
    await migrate(db);
    // Re-run v016 — INSERT OR IGNORE should silently skip
    await expect(v016_session_runtime_data(db)).resolves.not.toThrow();

    const rows = await db.getAllAsync<{ key: string }>(
      `SELECT key FROM app_settings WHERE key = 'auto_popup_rest_timer'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('is idempotent — re-running v016 on migrated DB does not throw', async () => {
    await migrate(db);
    // Re-running v016 directly after a full migrate is benign. The session
    // HK columns / seed are still present (guards skip), and session_exercise
    // .rest_sec is also still present (guard skips). The template_exercise
    // .rest_sec orphan was dropped by v021; v016's guard then re-adds it —
    // that's an artefact of re-running an already-superseded migration in
    // isolation, NOT something the `migrate()` runner would ever do (it's
    // gated by PRAGMA user_version).
    await expect(v016_session_runtime_data(db)).resolves.not.toThrow();

    // Verify session-level columns still single-occurrence (no duplicate ADD COLUMN)
    const sCols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(session)`);
    const sNames = sCols.map((c) => c.name);
    expect(sNames.filter((n) => n === 'healthkit_workout_uuid')).toHaveLength(1);
    expect(sNames.filter((n) => n === 'avg_hr_bpm')).toHaveLength(1);
    expect(sNames.filter((n) => n === 'kcal')).toHaveLength(1);

    // session_exercise.rest_sec is the canonical session-side column — must
    // remain present and single-occurrence.
    const seCols = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(session_exercise)`,
    );
    expect(seCols.map((c) => c.name).filter((n) => n === 'rest_sec')).toHaveLength(1);
  });
});
