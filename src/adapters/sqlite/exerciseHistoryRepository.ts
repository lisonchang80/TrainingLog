/**
 * Exercise History — cross-Template, cross-Program aggregate (ADR-0006 scope c).
 *
 * Returns every set ever recorded for a given exercise_id, joined with its
 * session start time and bw snapshot (needed for load_type='assisted'
 * effective-load math).
 *
 * Includes only `is_skipped = 0` sets.
 */

import type { Database } from '../../db/types';
import type { LoadType } from '../../domain/exercise/types';

/** One row per set; fields needed by PR / Volume engines + UI display. */
export interface ExerciseHistorySet {
  set_id: string;
  session_id: string;
  session_started_at: number;
  session_ended_at: number | null;
  bw_snapshot_kg: number | null;
  weight_kg: number | null;
  reps: number | null;
  ordering: number;
  created_at: number;
  load_type: LoadType;
}

/**
 * Single grouping unit by Session, used by the timeline list on
 * the Exercise History page.
 */
export interface ExerciseHistorySession {
  session_id: string;
  session_started_at: number;
  session_ended_at: number | null;
  bw_snapshot_kg: number | null;
  sets: ExerciseHistorySet[];
}

export interface ExerciseHistoryHeader {
  exercise_id: string;
  exercise_name: string;
  load_type: LoadType;
  total_sessions: number;
  /** Sessions in last 7 days (started_at >= now - 7*24h) */
  sessions_last_7_days: number;
}

/**
 * All performed sets for one exercise, joined with session metadata.
 * Order: latest set first (created_at DESC).
 */
export async function listExerciseHistorySets(
  db: Database,
  exercise_id: string
): Promise<ExerciseHistorySet[]> {
  return db.getAllAsync<ExerciseHistorySet>(
    `SELECT s.id           AS set_id,
            s.session_id   AS session_id,
            ss.started_at  AS session_started_at,
            ss.ended_at    AS session_ended_at,
            ss.bodyweight_snapshot_kg AS bw_snapshot_kg,
            s.weight_kg    AS weight_kg,
            s.reps         AS reps,
            s.ordering     AS ordering,
            s.created_at   AS created_at,
            e.load_type    AS load_type
       FROM "set" s
       JOIN session ss ON ss.id = s.session_id
       JOIN exercise e ON e.id = s.exercise_id
      WHERE s.exercise_id = ?
        AND s.is_skipped = 0
      ORDER BY s.created_at DESC, s.id DESC`,
    exercise_id
  );
}

/**
 * Same data, regrouped per Session (session DESC, sets within session ASC).
 * Each session row carries its bw snapshot once for assisted-class display.
 */
export async function listExerciseHistoryBySession(
  db: Database,
  exercise_id: string
): Promise<ExerciseHistorySession[]> {
  const rows = await db.getAllAsync<ExerciseHistorySet>(
    `SELECT s.id           AS set_id,
            s.session_id   AS session_id,
            ss.started_at  AS session_started_at,
            ss.ended_at    AS session_ended_at,
            ss.bodyweight_snapshot_kg AS bw_snapshot_kg,
            s.weight_kg    AS weight_kg,
            s.reps         AS reps,
            s.ordering     AS ordering,
            s.created_at   AS created_at,
            e.load_type    AS load_type
       FROM "set" s
       JOIN session ss ON ss.id = s.session_id
       JOIN exercise e ON e.id = s.exercise_id
      WHERE s.exercise_id = ?
        AND s.is_skipped = 0
      ORDER BY ss.started_at DESC, s.ordering ASC`,
    exercise_id
  );

  const grouped = new Map<string, ExerciseHistorySession>();
  const order: string[] = [];

  for (const r of rows) {
    let sess = grouped.get(r.session_id);
    if (!sess) {
      sess = {
        session_id: r.session_id,
        session_started_at: r.session_started_at,
        session_ended_at: r.session_ended_at,
        bw_snapshot_kg: r.bw_snapshot_kg,
        sets: [],
      };
      grouped.set(r.session_id, sess);
      order.push(r.session_id);
    }
    sess.sets.push(r);
  }

  return order.map((id) => grouped.get(id)!);
}

/**
 * Header stats for the page top: name, total sessions performing this exercise,
 * sessions in last 7 days.
 */
export async function getExerciseHistoryHeader(
  db: Database,
  exercise_id: string,
  now: () => number = Date.now
): Promise<ExerciseHistoryHeader | null> {
  const ex = await db.getFirstAsync<{
    id: string;
    name: string;
    load_type: LoadType;
  }>(`SELECT id, name, load_type FROM exercise WHERE id = ?`, exercise_id);
  if (!ex) return null;

  const totalRow = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(DISTINCT session_id) AS n
       FROM "set"
      WHERE exercise_id = ? AND is_skipped = 0`,
    exercise_id
  );

  const cutoff = now() - 7 * 24 * 60 * 60 * 1000;
  const recentRow = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(DISTINCT s.session_id) AS n
       FROM "set" s
       JOIN session ss ON ss.id = s.session_id
      WHERE s.exercise_id = ?
        AND s.is_skipped = 0
        AND ss.started_at >= ?`,
    exercise_id,
    cutoff
  );

  return {
    exercise_id: ex.id,
    exercise_name: ex.name,
    load_type: ex.load_type,
    total_sessions: totalRow?.n ?? 0,
    sessions_last_7_days: recentRow?.n ?? 0,
  };
}

/**
 * Helper: list prior-set rows for the SAME (exercise_id) BEFORE a cutoff
 * timestamp. Used by the PR-chip-on-save flow to ask "given this set was
 * just inserted, what PR did it break?". Caller passes new set's created_at
 * as cutoff (exclusive).
 */
export async function listPriorSetsForExercise(
  db: Database,
  exercise_id: string,
  before_created_at: number
): Promise<ExerciseHistorySet[]> {
  return db.getAllAsync<ExerciseHistorySet>(
    `SELECT s.id           AS set_id,
            s.session_id   AS session_id,
            ss.started_at  AS session_started_at,
            ss.ended_at    AS session_ended_at,
            ss.bodyweight_snapshot_kg AS bw_snapshot_kg,
            s.weight_kg    AS weight_kg,
            s.reps         AS reps,
            s.ordering     AS ordering,
            s.created_at   AS created_at,
            e.load_type    AS load_type
       FROM "set" s
       JOIN session ss ON ss.id = s.session_id
       JOIN exercise e ON e.id = s.exercise_id
      WHERE s.exercise_id = ?
        AND s.is_skipped = 0
        AND s.created_at < ?
      ORDER BY s.created_at DESC, s.id DESC`,
    exercise_id,
    before_created_at
  );
}
