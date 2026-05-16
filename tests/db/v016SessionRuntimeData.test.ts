import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { v016_session_runtime_data } from '../../src/db/schema/v016_session_runtime_data';

/**
 * v016 migration tests — rest_sec dual + session HK stubs + auto_popup
 * settings seed (slice 10a foundation per ADR-0019 Q2 + Q9 + 留尾 Q3 拍板).
 *
 * Coverage:
 *   - template_exercise.rest_sec + session_exercise.rest_sec added (INTEGER, nullable)
 *   - session.healthkit_workout_uuid (TEXT) / avg_hr_bpm (REAL) / kcal (REAL) added, all nullable
 *   - app_settings 'auto_popup_rest_timer' seed = '1'
 *   - INSERT OR IGNORE doesn't duplicate seed on re-run
 *   - Re-running migration is no-op
 */
describe('v016 session runtime data migration', () => {
  let db: BetterSqliteDatabase;

  beforeEach(() => {
    db = new BetterSqliteDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('adds template_exercise.rest_sec INTEGER nullable', async () => {
    await migrate(db);
    const cols = await db.getAllAsync<{ name: string; type: string; notnull: number }>(
      `PRAGMA table_info(template_exercise)`,
    );
    const col = cols.find((c) => c.name === 'rest_sec');
    expect(col).toBeDefined();
    expect(col!.type).toBe('INTEGER');
    expect(col!.notnull).toBe(0);
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

  it('is idempotent — re-running v016 on migrated DB is a no-op', async () => {
    await migrate(db);
    await expect(v016_session_runtime_data(db)).resolves.not.toThrow();

    // Verify columns still single-occurrence (no duplicate ADD COLUMN)
    const sCols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(session)`);
    const sNames = sCols.map((c) => c.name);
    expect(sNames.filter((n) => n === 'healthkit_workout_uuid')).toHaveLength(1);
    expect(sNames.filter((n) => n === 'avg_hr_bpm')).toHaveLength(1);
    expect(sNames.filter((n) => n === 'kcal')).toHaveLength(1);

    const teCols = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(template_exercise)`,
    );
    expect(teCols.map((c) => c.name).filter((n) => n === 'rest_sec')).toHaveLength(1);

    const seCols = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(session_exercise)`,
    );
    expect(seCols.map((c) => c.name).filter((n) => n === 'rest_sec')).toHaveLength(1);
  });
});
