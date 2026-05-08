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
  is_skipped: number;
}

export async function loadStatsSetRecords(
  db: Database,
  range: { start_ms: number; end_ms: number }
): Promise<StatsSetRecord[]> {
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
            s.is_skipped           AS is_skipped
       FROM "set" s
       JOIN session ss ON ss.id = s.session_id
       JOIN exercise e ON e.id = s.exercise_id
      WHERE ss.started_at >= ? AND ss.started_at < ?
      ORDER BY ss.started_at ASC, s.created_at ASC`,
    range.start_ms,
    range.end_ms
  );

  return rows.map((r) => {
    const isLogged =
      r.is_skipped === 0 &&
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
      volume,
      is_logged: isLogged,
    };
  });
}
