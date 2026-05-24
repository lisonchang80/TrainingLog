/**
 * Module #6 — Session Manager (pure logic, no DB).
 *
 * Owns the Session lifecycle state machine:
 *
 *     idle ──start──▶ in_progress ──end──▶ ended
 *
 * Repositories handle persistence; this module owns the rules:
 *   - what transitions are legal,
 *   - whether a Set can be recorded right now,
 *   - how to summarize a finished Session.
 *
 * Pure functions only. No side effects, no DB, no React. Unit-tested in
 * isolation — slice 1's `validateRecordSet` is the same pattern.
 */

export type SessionState =
  | { status: 'idle' }
  | { status: 'in_progress'; id: string; started_at: number }
  | { status: 'ended'; id: string; started_at: number; ended_at: number };

export const IDLE: SessionState = { status: 'idle' };

/** Transition idle → in_progress. */
export function start(args: { id: string; started_at: number }): SessionState {
  if (!args.id) throw new Error('Session id is required');
  if (!Number.isFinite(args.started_at)) {
    throw new Error('started_at must be a finite number');
  }
  return { status: 'in_progress', id: args.id, started_at: args.started_at };
}

/** Transition in_progress → ended. Throws if state is not in_progress. */
export function end(state: SessionState, ended_at: number): SessionState {
  if (state.status !== 'in_progress') {
    throw new Error(`Cannot end session in status "${state.status}"`);
  }
  if (!Number.isFinite(ended_at)) {
    throw new Error('ended_at must be a finite number');
  }
  if (ended_at < state.started_at) {
    throw new Error('ended_at cannot be before started_at');
  }
  return {
    status: 'ended',
    id: state.id,
    started_at: state.started_at,
    ended_at,
  };
}

/** True only while the session is in_progress. */
export function canRecordSet(state: SessionState): boolean {
  return state.status === 'in_progress';
}

/** Returns the current session id, or null when idle. */
export function getSessionId(state: SessionState): string | null {
  return state.status === 'idle' ? null : state.id;
}

/** Lift a session row from the DB into a SessionState. */
export function fromRow(
  row: { id: string; started_at: number; ended_at: number | null } | null
): SessionState {
  if (row == null) return IDLE;
  return row.ended_at == null
    ? { status: 'in_progress', id: row.id, started_at: row.started_at }
    : {
        status: 'ended',
        id: row.id,
        started_at: row.started_at,
        ended_at: row.ended_at,
      };
}

interface PerExerciseSummary {
  exercise_id: string;
  exercise_name: string;
  setCount: number;
}

interface SessionSummary {
  totalSets: number;
  exerciseCount: number;
  /** null while the session is still open. */
  durationMs: number | null;
  perExercise: PerExerciseSummary[];
}

/**
 * Aggregate counts over a session's sets. Stable order = first-appearance
 * order of each exercise so the summary UI stays predictable.
 */
export function summarize(
  session: { started_at: number; ended_at: number | null },
  sets: { exercise_id: string; exercise_name: string }[]
): SessionSummary {
  const map = new Map<string, PerExerciseSummary>();
  for (const s of sets) {
    const existing = map.get(s.exercise_id);
    if (existing) {
      existing.setCount += 1;
    } else {
      map.set(s.exercise_id, {
        exercise_id: s.exercise_id,
        exercise_name: s.exercise_name,
        setCount: 1,
      });
    }
  }
  return {
    totalSets: sets.length,
    exerciseCount: map.size,
    durationMs:
      session.ended_at !== null ? session.ended_at - session.started_at : null,
    perExercise: Array.from(map.values()),
  };
}
