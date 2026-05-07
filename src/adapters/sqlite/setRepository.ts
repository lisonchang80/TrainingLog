import type { Database } from '../../db/types';
import type { SetRow, RecordSetInput } from '../../domain/set/types';
import { validateRecordSet } from '../../domain/set/validateRecordSet';
import { createSession, endSession } from './sessionRepository';

/** Insert one set row directly. Caller supplies all fields including IDs/timestamps. */
export async function insertSet(db: Database, set: SetRow): Promise<void> {
  await db.runAsync(
    `INSERT INTO "set" (id, session_id, exercise_id, weight_kg, reps,
                        is_skipped, ordering, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    set.id,
    set.session_id,
    set.exercise_id,
    set.weight_kg,
    set.reps,
    set.is_skipped,
    set.ordering,
    set.created_at
  );
}

export async function listAllSets(db: Database): Promise<SetRow[]> {
  return db.getAllAsync<SetRow>(
    `SELECT id, session_id, exercise_id, weight_kg, reps,
            is_skipped, ordering, created_at
       FROM "set"
      ORDER BY created_at DESC`
  );
}

export interface SetWithExercise extends SetRow {
  exercise_name: string;
}

export async function listAllSetsWithExercise(
  db: Database
): Promise<SetWithExercise[]> {
  return db.getAllAsync<SetWithExercise>(
    `SELECT s.id, s.session_id, s.exercise_id, s.weight_kg, s.reps,
            s.is_skipped, s.ordering, s.created_at,
            e.name AS exercise_name
       FROM "set" s
       JOIN exercise e ON e.id = s.exercise_id
      ORDER BY s.created_at DESC`
  );
}

/**
 * High-level entry point used by the Today tab.
 *
 * Per the #2 design decision: each Save auto-creates a Session, inserts the Set,
 * then immediately ends the Session. #3 will introduce the proper Session
 * lifecycle (open → many sets → end).
 *
 * Wrapped in a transaction so a partial write can't leave an open Session
 * with no Set behind.
 *
 * `uuid` is REQUIRED (no default): Hermes lacks a global `crypto.randomUUID`,
 * so the caller must inject — production passes `randomUUID` from
 * `expo-crypto`; tests pass a deterministic stub.
 */
export async function recordSetAsAutoSession(
  db: Database,
  input: RecordSetInput,
  uuid: () => string,
  now: () => number = Date.now
): Promise<{ session_id: string; set_id: string }> {
  const err = validateRecordSet(input);
  if (err) throw new Error(err);

  const ts = now();
  const session_id = uuid();
  const set_id = uuid();

  await db.withTransactionAsync(async () => {
    await createSession(db, { id: session_id, started_at: ts });
    await insertSet(db, {
      id: set_id,
      session_id,
      exercise_id: input.exercise_id,
      weight_kg: input.weight_kg,
      reps: input.reps,
      is_skipped: 0,
      ordering: 1,
      created_at: ts,
    });
    await endSession(db, { id: session_id, ended_at: ts });
  });

  return { session_id, set_id };
}
