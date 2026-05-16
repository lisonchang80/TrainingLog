import type { Database } from '../types';

/**
 * v016 — Session runtime data: rest timer + HealthKit stubs + setting seed
 * (slice 10a foundation per ADR-0019 Q2 + Q9 + 留尾 Q3 拍板).
 *
 * Three groups of changes, all idempotent:
 *
 *   1. **Rest timer columns (ADR-0019 Q2.2 § (B))**:
 *      - `template_exercise.rest_sec INTEGER NULL` — per-exercise rest
 *        seconds at template level. NULL = inherit hardcoded 60s default.
 *      - `session_exercise.rest_sec INTEGER NULL` — same field at session
 *        runtime. `snapshotForSession` copies template_exercise.rest_sec
 *        verbatim (NULL also copies — no coalesce at snapshot time, per
 *        ADR-0019 Q2.2 § (B)). Slice 10b consumer.
 *
 *   2. **HealthKit stub columns on session (留尾 Q3 拍板)**:
 *      - `session.healthkit_workout_uuid TEXT NULL` — links a session row
 *        to the HKWorkout record written in slice 13. Stub-now pattern: UI
 *        in slice 10b can render the 5-tile HR/kcal area with NULL
 *        fallback; slice 13 fills the data once react-native-health is
 *        wired into Expo Dev Build.
 *      - `session.avg_hr_bpm REAL NULL` — average heart rate from HK.
 *      - `session.kcal REAL NULL` — energy burned tile data.
 *
 *   3. **Settings seed (ADR-0019 Q2.3 § (a))**:
 *      - `app_settings` row `auto_popup_rest_timer = '1'` — default ON for
 *        the rest timer modal popup behaviour. Stored as text per the v001
 *        app_settings convention (`value TEXT`, JSON-encoded by callers).
 *        Settings UI in slice 10c lets users toggle this.
 *
 * Idempotency: PRAGMA table_info introspection before each ADD COLUMN +
 * INSERT OR IGNORE for the seed row. Re-runs are safe.
 */
export async function v016_session_runtime_data(db: Database): Promise<void> {
  // 1. template_exercise.rest_sec
  const teCols = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(template_exercise)`,
  );
  if (!teCols.some((c) => c.name === 'rest_sec')) {
    await db.execAsync(`ALTER TABLE template_exercise ADD COLUMN rest_sec INTEGER;`);
  }

  // 2. session_exercise.rest_sec
  const seCols = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(session_exercise)`,
  );
  if (!seCols.some((c) => c.name === 'rest_sec')) {
    await db.execAsync(`ALTER TABLE session_exercise ADD COLUMN rest_sec INTEGER;`);
  }

  // 3. session HealthKit stubs (3 columns)
  const sCols = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(session)`);
  const sHave = new Set(sCols.map((c) => c.name));
  if (!sHave.has('healthkit_workout_uuid')) {
    await db.execAsync(`ALTER TABLE session ADD COLUMN healthkit_workout_uuid TEXT;`);
  }
  if (!sHave.has('avg_hr_bpm')) {
    await db.execAsync(`ALTER TABLE session ADD COLUMN avg_hr_bpm REAL;`);
  }
  if (!sHave.has('kcal')) {
    await db.execAsync(`ALTER TABLE session ADD COLUMN kcal REAL;`);
  }

  // 4. Settings seed: auto_popup_rest_timer = true (default ON)
  await db.runAsync(
    `INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)`,
    'auto_popup_rest_timer',
    '1',
  );
}
