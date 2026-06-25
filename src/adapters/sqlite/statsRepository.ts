/**
 * Stats Repository — slice 9.
 *
 * Loads `StatsSetRecord[]` filtered by a closed-open ms range, joined with:
 *   - exercise.muscle_group_id
 *   - exercise.load_type (for volume math)
 *   - session.bodyweight_snapshot_kg (for assisted volume)
 *
 * Volume is computed in TypeScript via setVolume() rather than in SQL so the
 * load_type asymmetry rules from ADR-0007 stay in one place.
 *
 * Inclusion criterion: a set is included when `session.started_at` falls in
 * [start_ms, end_ms). The ADR uses session-anchored windowing for stats so a
 * session that started at 23:55 and ran past midnight stays in one bucket.
 */

import type { Database } from '../../db/types';
import type { LoadType } from '../../domain/exercise/types';
import type { StatsSetRecord } from '../../domain/stats/types';
import { setVolume } from '../../domain/pr/volumeEngine';

interface RawRow {
  set_id: string;
  session_id: string;
  session_started_at: number;
  session_ended_at: number | null;
  exercise_id: string;
  mg_id: string | null;
  load_type: LoadType;
  weight_kg: number | null;
  reps: number | null;
  bw_snapshot_kg: number | null;
  is_logged: number;
}

export async function loadStatsSetRecords(
  db: Database,
  range: { start_ms: number; end_ms: number }
): Promise<StatsSetRecord[]> {
  // ADR-0012 line 174: volumeEngine 排 `set_kind = 'warmup'`（working + dropset
  // 都算容量）。stats 顯示用同樣語意，warmup 不算進 stats 容量。
  // 在 SQL 邊界過濾，跟 listPriorSetsForExercise / loadReplayRecords pattern 一致
  // (2026-05-27).
  //
  // F3 fix (2026-06-25): also filter `AND s.is_logged = 1` so planned-but-
  // unchecked sets (template / 動作記憶 defaults that `endSession` never
  // purges) don't inflate stats volume. This MIRRORS the History-tab volume
  // (`sessionRepository.ts` per-session SUM CASE `is_logged = 1`) and
  // `listExercisePRSetRows` — both plain `is_logged = 1`, NOT chain-aware.
  // Dropset followers carry DB `is_logged = 0` (only the head flips on ✓; see
  // dropset-chain-semantics skill DB invariant #2), so this drops follower
  // volume EXACTLY as History does — keeping Stats and History in agreement
  // (the explicit goal). We do NOT resolve follower → head here; that would
  // make Stats over-count vs History.
  const rows = await db.getAllAsync<RawRow>(
    `SELECT s.id                  AS set_id,
            s.session_id           AS session_id,
            ss.started_at          AS session_started_at,
            ss.ended_at            AS session_ended_at,
            s.exercise_id          AS exercise_id,
            e.muscle_group_id      AS mg_id,
            e.load_type            AS load_type,
            s.weight_kg            AS weight_kg,
            s.reps                 AS reps,
            ss.bodyweight_snapshot_kg AS bw_snapshot_kg,
            s.is_logged            AS is_logged
       FROM "set" s
       JOIN session ss ON ss.id = s.session_id
       JOIN exercise e ON e.id = s.exercise_id
      WHERE ss.started_at >= ? AND ss.started_at < ?
        AND s.set_kind != 'warmup'
        AND s.is_logged = 1
      ORDER BY ss.started_at ASC, s.created_at ASC`,
    range.start_ms,
    range.end_ms
  );

  // Separate fetch for primary M-layer muscle mapping (m:n) — kept outside
  // the main JOIN to avoid row multiplication. We pull every primary
  // (exercise_id, muscle_id) row referenced by the result set in one query
  // then build a Map<exercise_id, muscle_id[]> for O(1) attach.
  const exIds = Array.from(new Set(rows.map((r) => r.exercise_id)));
  const exToMIds = new Map<string, string[]>();
  if (exIds.length > 0) {
    const placeholders = exIds.map(() => '?').join(',');
    const muscleRows = await db.getAllAsync<{ exercise_id: string; muscle_id: string }>(
      `SELECT exercise_id, muscle_id
         FROM exercise_muscle
        WHERE role = 'primary'
          AND exercise_id IN (${placeholders})`,
      ...exIds
    );
    for (const mr of muscleRows) {
      let list = exToMIds.get(mr.exercise_id);
      if (!list) {
        list = [];
        exToMIds.set(mr.exercise_id, list);
      }
      list.push(mr.muscle_id);
    }
  }

  return rows.map((r) => {
    // Rows are already SQL-filtered to `is_logged = 1`; the value-validity
    // guard below only gates `volume` (a logged row with a null/invalid
    // weight·reps yields null volume, never a NaN).
    const isLogged =
      r.is_logged === 1 &&
      r.weight_kg != null &&
      r.reps != null &&
      Number.isFinite(r.reps) &&
      r.reps >= 1;
    const volume = isLogged
      ? setVolume({
          weight_kg: r.weight_kg,
          reps: r.reps,
          load_type: r.load_type,
          bw_snapshot_kg: r.bw_snapshot_kg,
        })
      : null;
    return {
      session_id: r.session_id,
      session_started_at: r.session_started_at,
      session_ended_at: r.session_ended_at,
      set_id: r.set_id,
      exercise_id: r.exercise_id,
      mg_id: r.mg_id,
      m_ids: exToMIds.get(r.exercise_id) ?? [],
      volume,
      is_logged: isLogged,
    };
  });
}
