/**
 * Slice 13d / D19 — iPhone-side Live Mirror reducer.
 *
 * Immutable reducer over inbound WC envelopes that maintains the
 * iPhone's in-memory mirror of the Watch's live session state
 * (ADR-0019 § Q19, NEW-Q40 + NEW-Q41). The mirror feeds the
 * `app/(tabs)/index.tsx` in-session view and the iPhone Live Activity
 * widget (D23). SQLite remains the source-of-truth; this mirror is
 * pure, ephemeral, cleared on session end.
 *
 * Six mirror-affecting message kinds (per Z scaffold + NEW-Q40
 * bidirectional table):
 *   - `set-completed`    → flip is_logged + update committed weight/reps
 *   - `set-modified`     → per-field LWW diff merge (via D20 admitDiff)
 *   - `set-deleted`      → remove set from its exercise
 *   - `set-added`        → insert at supplied ordinal (sorted)
 *   - `exercise-added`   → append + sort by `ordering`
 *   - `exercise-deleted` → cascade-drop card + its sets
 *
 * Seven out-of-scope kinds are no-ops: `handshake` / `start-from-watch`
 * / `start-from-iphone` / `hr-tick` / `kcal-tick` / `end-session` /
 * `settings-sync`. The reducer returns the prior state object
 * (referential equality preserved so React skip-renders).
 *
 * Coarse stale-ts rule (NEW-Q43 reducer surface): an envelope whose
 * `ts <= state.lastAppliedTs` is dropped without touching state. Per-
 * field LWW under `set-modified` is one layer deeper — `admitDiff`
 * handles intra-set field-level reconciliation; the coarse rule here
 * just prevents the entire reducer from time-traveling. After any
 * accepted mutation, `lastAppliedTs` advances to `env.ts`.
 *
 * Defensive guards (Z scaffold (g)):
 *   - `null` / non-object env → return state
 *   - unknown `kind` → return state
 *
 * The reducer is structurally immutable — callers must replace the
 * top-level state reference; `lwwMap.ts` (Map instance) is mutated
 * in-place because the LWW protocol is intentionally stateful per
 * NEW-Q43 Option A.
 */

import type { WCMessage } from '../adapters/watch';
import { admitDiff, createLwwMap } from '../adapters/watch';
import type { LwwMap } from '../adapters/watch';

export interface MirrorSet {
  setId: string;
  ordinal: number;
  weight: number | null;
  reps: number | null;
  rpe: number | null;
  rest_sec: number | null;
  notes: string | null;
  set_kind: 'warmup' | 'working' | 'dropset' | 'superset';
  is_logged: boolean;
}

export interface MirrorExercise {
  sessionExerciseId: string;
  exerciseId: string;
  exerciseName: string;
  ordering: number;
  plannedSets: number;
  sets: MirrorSet[];
}

export interface LiveMirrorState {
  /** `null` until first envelope binds a session. */
  sessionId: string | null;
  exercises: MirrorExercise[];
  /** Largest `ts` of any envelope this reducer has accepted. */
  lastAppliedTs: number;
  /** Per-field LWW tracker. Mutated in-place by admitDiff (Option A). */
  lwwMap: LwwMap;
}

export function initialLiveMirrorState(): LiveMirrorState {
  return {
    sessionId: null,
    exercises: [],
    lastAppliedTs: 0,
    lwwMap: createLwwMap(),
  };
}

const MIRROR_AFFECTING_KINDS = new Set<string>([
  'set-completed',
  'set-modified',
  'set-deleted',
  'set-added',
  'exercise-added',
  'exercise-deleted',
]);

export function liveMirrorReducer(
  state: LiveMirrorState,
  env: WCMessage | null | undefined,
): LiveMirrorState {
  if (!env || typeof env !== 'object') return state;
  if (typeof env.kind !== 'string') return state;
  if (!MIRROR_AFFECTING_KINDS.has(env.kind)) return state;
  if (typeof env.ts !== 'number' || env.ts <= state.lastAppliedTs) return state;

  switch (env.kind) {
    case 'set-completed':
      return applySetCompleted(state, env.payload, env.ts);
    case 'set-modified':
      return applySetModified(state, env.payload, env.ts);
    case 'set-deleted':
      return applySetDeleted(state, env.payload, env.ts);
    case 'set-added':
      return applySetAdded(state, env.payload, env.ts);
    case 'exercise-added':
      return applyExerciseAdded(state, env.payload, env.ts);
    case 'exercise-deleted':
      return applyExerciseDeleted(state, env.payload, env.ts);
    default:
      return state;
  }
}

function applySetCompleted(
  state: LiveMirrorState,
  payload: Extract<WCMessage, { kind: 'set-completed' }>['payload'],
  ts: number,
): LiveMirrorState {
  const { setId, is_logged, weight, reps } = payload;
  let mutated = false;
  const newExercises = state.exercises.map((ex) => {
    const idx = ex.sets.findIndex((s) => s.setId === setId);
    if (idx < 0) return ex;
    mutated = true;
    const newSets = ex.sets.slice();
    newSets[idx] = { ...newSets[idx], is_logged, weight, reps };
    return { ...ex, sets: newSets };
  });
  if (!mutated) return state;
  return { ...state, exercises: newExercises, lastAppliedTs: ts };
}

function applySetModified(
  state: LiveMirrorState,
  payload: Extract<WCMessage, { kind: 'set-modified' }>['payload'],
  ts: number,
): LiveMirrorState {
  const { setId, diff, fieldTs } = payload;
  const exerciseIdx = state.exercises.findIndex((ex) =>
    ex.sets.some((s) => s.setId === setId),
  );
  if (exerciseIdx < 0) return state;

  const result = admitDiff(state.lwwMap, setId, diff, fieldTs, ts);
  if (Object.keys(result.accepted).length === 0) {
    return state;
  }

  const newExercises = state.exercises.slice();
  const ex = newExercises[exerciseIdx];
  const setIdx = ex.sets.findIndex((s) => s.setId === setId);
  const newSets = ex.sets.slice();
  newSets[setIdx] = { ...newSets[setIdx], ...result.accepted };
  newExercises[exerciseIdx] = { ...ex, sets: newSets };

  return { ...state, exercises: newExercises, lastAppliedTs: ts };
}

function applySetDeleted(
  state: LiveMirrorState,
  payload: Extract<WCMessage, { kind: 'set-deleted' }>['payload'],
  ts: number,
): LiveMirrorState {
  const { setId } = payload;
  let mutated = false;
  const newExercises = state.exercises.map((ex) => {
    const filtered = ex.sets.filter((s) => s.setId !== setId);
    if (filtered.length === ex.sets.length) return ex;
    mutated = true;
    return { ...ex, sets: filtered };
  });
  if (!mutated) return state;
  return { ...state, exercises: newExercises, lastAppliedTs: ts };
}

function applySetAdded(
  state: LiveMirrorState,
  payload: Extract<WCMessage, { kind: 'set-added' }>['payload'],
  ts: number,
): LiveMirrorState {
  const { sessionExerciseId, setId, ordinal, weight, reps, set_kind } = payload;
  const exerciseIdx = state.exercises.findIndex(
    (ex) => ex.sessionExerciseId === sessionExerciseId,
  );
  if (exerciseIdx < 0) return state;

  const newSet: MirrorSet = {
    setId,
    ordinal,
    weight,
    reps,
    rpe: null,
    rest_sec: null,
    notes: null,
    set_kind,
    is_logged: false,
  };

  const newExercises = state.exercises.slice();
  const ex = newExercises[exerciseIdx];
  const newSets = [...ex.sets, newSet].sort((a, b) => a.ordinal - b.ordinal);
  newExercises[exerciseIdx] = { ...ex, sets: newSets };

  return { ...state, exercises: newExercises, lastAppliedTs: ts };
}

function applyExerciseAdded(
  state: LiveMirrorState,
  payload: Extract<WCMessage, { kind: 'exercise-added' }>['payload'],
  ts: number,
): LiveMirrorState {
  const newExercise: MirrorExercise = {
    sessionExerciseId: payload.sessionExerciseId,
    exerciseId: payload.exerciseId,
    exerciseName: payload.exerciseName,
    ordering: payload.ordering,
    plannedSets: payload.plannedSets,
    sets: [],
  };
  const newExercises = [...state.exercises, newExercise].sort(
    (a, b) => a.ordering - b.ordering,
  );
  return { ...state, exercises: newExercises, lastAppliedTs: ts };
}

function applyExerciseDeleted(
  state: LiveMirrorState,
  payload: Extract<WCMessage, { kind: 'exercise-deleted' }>['payload'],
  ts: number,
): LiveMirrorState {
  const filtered = state.exercises.filter(
    (ex) => ex.sessionExerciseId !== payload.sessionExerciseId,
  );
  if (filtered.length === state.exercises.length) return state;
  return { ...state, exercises: filtered, lastAppliedTs: ts };
}
