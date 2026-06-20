import type { Database } from '../db/types';
import { listExercises } from '../adapters/sqlite/exerciseRepository';
import {
  getActiveSession,
  listSessionExercisesWithName,
  type SessionExerciseRowWithName,
} from '../adapters/sqlite/sessionRepository';
import { getActiveProgram } from '../adapters/sqlite/programRepository';
import {
  listTemplates,
  type TemplateSummary,
} from '../adapters/sqlite/templateRepository';
import {
  getAutoPopupRestTimer,
  getUnitPreference,
} from '../adapters/sqlite/settingsRepository';
import {
  listSetsBySession,
  type SessionSetWithExercise,
} from '../adapters/sqlite/setRepository';
import { listExercisePRSetRows } from '../adapters/sqlite/exerciseHistoryRepository';
import { computePRSnapshot, type PRSnapshot } from '../domain/pr/prQuery';
import { todayCell, localMsToIsoDate } from '../domain/program/programManager';
import type { ProgramCell, ProgramWithCells } from '../domain/program/types';
import type { Session } from '../domain/session/types';
import type { Exercise } from '../domain/exercise/types';
import type { UnitPreference } from '../domain/body/types';

/**
 * Flat, fully-derived snapshot of everything the Training tab (`app/(tabs)/
 * index.tsx`) renders for the current DB state. Mirrors the field set the
 * screen's `refresh()` callback used to fan out + setState inline (report 09
 * #3, 2026-06-20). `activeSession` is the RAW domain row — the screen maps it
 * through `sessionManager.fromRow` into its `SessionState` machine (a UI-state
 * concern kept out of this data layer).
 */
export interface TrainingTabState {
  exercises: Exercise[];
  activeSession: Session | null;
  activeProgram: ProgramWithCells | null;
  unit: UnitPreference;
  autoPopupTimer: boolean;
  templatesById: Record<string, TemplateSummary>;
  programCellToday: ProgramCell | null;
  setsInSession: SessionSetWithExercise[];
  plan: SessionExerciseRowWithName[];
  bwSnapshotKg: number | null;
  sessionTitle: string;
  prSnapshotById: Record<string, PRSnapshot>;
}

/**
 * Load + derive the entire Training-tab state in one call. Extracted from the
 * screen's inline `refresh()` (the de-facto state-sync engine invoked from
 * ~20 sites) so the breadth-critical query fan-out + derivation is
 * unit-testable against a fixture DB instead of being trapped in a component
 * closure (report 09 #3).
 *
 * Behaviour preserved 1:1 from the old inline version:
 *   - 6-way parallel base read (exercises / active session / active program /
 *     templates / unit / auto-popup-timer)
 *   - templates folded into an id-keyed map
 *   - today's program cell via `todayCell` (date injectable via `now` for
 *     deterministic tests; production defaults to `Date.now`)
 *   - when a session is active: second parallel read (sets + planned
 *     session_exercise rows) + a per-planned-exercise all-time PR snapshot
 *     fan-out; otherwise every session-scoped field is cleared to its empty
 *     value (no orphan state from a previous session)
 *
 * The screen consumes this with a flat series of setState calls + the one
 * `fromRow` mapping (see `refresh` in index.tsx).
 */
export async function loadTrainingTabState(
  db: Database,
  opts?: { now?: () => number },
): Promise<TrainingTabState> {
  const now = opts?.now ?? Date.now;

  const [exercises, activeSession, activeProgram, tpls, unit, autoPopupTimer] =
    await Promise.all([
      listExercises(db),
      getActiveSession(db),
      getActiveProgram(db),
      listTemplates(db),
      getUnitPreference(db),
      // getAutoPopupRestTimer defaults a missing key to ON (v016 seed intent).
      getAutoPopupRestTimer(db),
    ]);

  const templatesById: Record<string, TemplateSummary> = {};
  for (const t of tpls) templatesById[t.id] = t;

  const programCellToday = todayCell({
    active: activeProgram,
    today: localMsToIsoDate(now()),
  });

  if (!activeSession) {
    return {
      exercises,
      activeSession: null,
      activeProgram,
      unit,
      autoPopupTimer,
      templatesById,
      programCellToday,
      setsInSession: [],
      plan: [],
      bwSnapshotKg: null,
      sessionTitle: '',
      prSnapshotById: {},
    };
  }

  const [setsInSession, plan] = await Promise.all([
    listSetsBySession(db, activeSession.id),
    listSessionExercisesWithName(db, activeSession.id),
  ]);

  // All-time PR snapshot per planned exercise. Per-exercise queries — cheap
  // given a typical session has <10 planned exercises. Uses the lean
  // `listExercisePRSetRows` (weight_kg/reps only; same is_skipped/is_logged
  // predicate as the history UI → identical PR).
  const prSnapshotById: Record<string, PRSnapshot> = {};
  await Promise.all(
    plan.map(async (p) => {
      const history = await listExercisePRSetRows(db, p.exercise_id);
      prSnapshotById[p.exercise_id] = computePRSnapshot(
        history.map((h) => ({ weight_kg: h.weight_kg, reps: h.reps })),
      );
    }),
  );

  return {
    exercises,
    activeSession,
    activeProgram,
    unit,
    autoPopupTimer,
    templatesById,
    programCellToday,
    setsInSession,
    plan,
    bwSnapshotKg: activeSession.bodyweight_snapshot_kg ?? null,
    sessionTitle: activeSession.title ?? '',
    prSnapshotById,
  };
}
