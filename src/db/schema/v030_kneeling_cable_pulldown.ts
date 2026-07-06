import type { Database } from '../types';

/**
 * v030 — add one built-in exercise: 跪姿滑輪下拉 (Kneeling Cable Lat Pulldown).
 *
 * Post-v029 manual addition. The build_seed.py generator output
 * (v028ExerciseMediaLibrary.ts / v029ExerciseMuscleLinks.ts) stays FROZEN as
 * shipped — this migration carries the one new exercise as an explicit delta so
 * existing installs (already past v028/v029) pick it up. The exercise IS also
 * recorded in curated-master.json (+ the PLACEHOLDER_EN map), so a future full
 * generator re-run reproduces it inside v028 and this migration degrades to an
 * idempotent no-op.
 *
 * exId 273 (0x111) — the next free id after v028's exId(67..272).
 * Placeholder card (media_path NULL → hash-color thumb, mirrors 對握滑輪下拉).
 * Fine muscle links: primary m-back; secondary m-bicep-long / m-bicep-short
 * (mirrors the 寬握 / 對握滑輪下拉 pulldown family in v029).
 *
 * Idempotent: INSERT OR IGNORE on the stable id / PK → re-run is a no-op.
 *
 * Cross-ADR: ADR-0017 (Exercise Library v2).
 */
const EXERCISE_ID = '00000000-0000-4000-8000-000000000111';

const MUSCLE_LINKS: ReadonlyArray<{ muscle_id: string; role: 'primary' | 'secondary' }> = [
  { muscle_id: 'm-back', role: 'primary' },
  { muscle_id: 'm-bicep-long', role: 'secondary' },
  { muscle_id: 'm-bicep-short', role: 'secondary' },
];

export async function v030_kneeling_cable_pulldown(db: Database): Promise<void> {
  await db.runAsync(
    `INSERT OR IGNORE INTO exercise
       (id, name, load_type, is_builtin, is_custom, muscle_group_id, equipment, media_path)
     VALUES (?, ?, ?, 1, 0, ?, ?, ?)`,
    EXERCISE_ID,
    '跪姿滑輪下拉',
    'loaded',
    'mg-back',
    '滑輪',
    null
  );

  for (const link of MUSCLE_LINKS) {
    await db.runAsync(
      `INSERT OR IGNORE INTO exercise_muscle (exercise_id, muscle_id, role)
       VALUES (?, ?, ?)`,
      EXERCISE_ID,
      link.muscle_id,
      link.role
    );
  }
}
