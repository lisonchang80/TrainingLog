/**
 * Slice 13d / D9 + NEW-Q50 D28 — pure builders + orchestrators for the WC
 * handshake and Watch-initiated start.
 *
 * ADR-0019 § Slice 13d Amendment + NEW-Q44 + NEW-Q50 (2026-05-29 evening
 * grill) define a two-stage launch protocol where the **Watch** is the
 * source-of-truth for offline-first standalone session start:
 *
 *   Stage 1 — Watch → iPhone `handshake` envelope carries
 *             { requestId, clientVersion }. iPhone replies with a
 *             **fat-tree** prefetch payload (NEW-Q50 v2): active session
 *             summary (if any) + top-20 templates with their full exercise
 *             trees (including planned reps / weight) + the user's program
 *             list with inline intensity sub_tags + today's planned-day
 *             state (planned exercises included). The Watch picker uses
 *             this to start a session entirely offline — no second
 *             round-trip is required.
 *
 *   Reconcile (NEW-Q50) — Watch generates its own `sessionId` via
 *             `UUID().uuidString` and proceeds straight to the in-session
 *             UI. A `start-from-watch` envelope (now carrying that
 *             Watch-supplied sessionId) is dispatched over the
 *             `transferUserInfo` queue. iPhone orchestrates the reconcile
 *             via `INSERT OR IGNORE` dedup + a reverse-TUI status reply
 *             (`'created' | 'conflict'`). Conflict (iPhone has its own
 *             active session) bubbles to a Watch-side alert sheet (D31).
 *
 * NEW-Q50 翻盤 ledger (vs pre-Q50 D9 sync reply):
 *   - `loadTemplatePrefetchList` → `loadTemplatesFullTree` (fat tree
 *     with `exercises[].defaultSets/defaultReps/defaultWeightKg/exerciseName`).
 *   - `loadTodayPlanned` `kind: 'planned'` variant now embeds the same
 *     `exercises[]` fat tree so the Watch can build a SessionSnapshot
 *     from the planned cell without any further fetch.
 *   - `onStartFromWatch` signature: `(db, env, sendReverseTUI)` — no more
 *     `uuid` injection (sessionId is in `env.payload.sessionId`), no more
 *     sync `replyHandler`. Idempotent via `INSERT OR IGNORE`.
 *
 * Why split pure / impure:
 *   - Pure builders + types stay clock-free + native-bridge-free →
 *     trivially unit-testable under `testEnvironment: node`.
 *   - Impure helpers (DB reads) are also testable via the in-memory
 *     `BetterSqliteDatabase` fixture without an actual WC bridge.
 *
 * See `.claude/skills/ship-partial-pure-logic/SKILL.md` for the original
 * split rationale; NEW-Q50 keeps the same separation but doubles the
 * fat-tree projection cost into the prefetch.
 */

import type { Database } from '../../db/types';
import {
  createSession,
  getActiveSession,
  listSessionExercisesWithName,
  setIsWatchTracked,
} from '../sqlite/sessionRepository';
import { listSetsBySession } from '../sqlite/setRepository';
import { startSessionFromTemplate } from '../sqlite/sessionFromTemplate';
import {
  listDistinctSubTagsByProgram,
  listTemplates,
} from '../sqlite/templateRepository';
import {
  getActiveProgram,
  listProgramSubTags,
  listPrograms,
} from '../sqlite/programRepository';
import { cellForDate } from '../../domain/program/programManager';
import { utcMsToIsoDate } from '../../domain/program/programManager';
import type {
  HandshakePayload,
  JsonValue,
  StartFromIphonePayload,
  StartFromWatchPayload,
  WCMessage,
} from './payloadSchema';

// ---------------------------------------------------------------------
// Stage 1 — reply shape
// ---------------------------------------------------------------------

/**
 * Minimal active-session summary carried in the Stage 1 reply. The
 * Watch picker needs just enough to render "Continue 'Push Day'
 * (4 exercises, started 12 min ago)?" — full exercise + set list is
 * fetched on adopt via the live-mirror channel (Q6 applicationContext).
 */
export interface Stage1SessionSummary {
  sessionId: string;
  /** Epoch ms — `session.started_at`. */
  startedAt: number;
  /** Per-session display title (`''` for freestyle). */
  title: string;
  /** Number of `session_exercise` rows for this session. */
  exerciseCount: number;
}

/**
 * NEW-Q50 D28 — one planned exercise inside a template's fat-tree
 * prefetch entry (or today's planned cell). Mirrors the SwiftUI
 * `WatchPlannedExercise` value type 1:1 so the wire is the consumer
 * data model.
 *
 * Sourced from `template_exercise` JOIN `exercise` — `exerciseName` is
 * denormalised onto the wire so the Watch never needs an Exercise
 * lookup table to render the planned card.
 */
export interface Stage1TemplateExercise {
  templateExerciseId: string;
  exerciseId: string;
  exerciseName: string;
  ordering: number;
  defaultSets: number;
  /** May be null when the source template_exercise leaves reps open. */
  defaultReps: number | null;
  /** May be null when the source template_exercise leaves weight open. */
  defaultWeightKg: number | null;
}

/**
 * NEW-Q50 D28 — replaces pre-Q50 `Stage1TemplateSummary`. Fat-tree
 * projection: each template carries its full planned exercise list so
 * the Watch can build a SessionSnapshot offline without a second
 * round-trip.
 *
 * Caps: enforced upstream in `loadTemplatesFullTree` (default 20
 * templates × ~10 exercises each ≈ 30 KB JSON, well under the 64 KB
 * WC envelope ceiling). See NEW-Q50 Q3=a for sizing rationale.
 */
export interface Stage1TemplateFullSummary {
  templateId: string;
  /** Template display name. */
  name: string;
  /** Planned exercises, ordered by template_exercise.ordering ASC. */
  exercises: ReadonlyArray<Stage1TemplateExercise>;
}

/**
 * Phase 2.5 — one intensity 副標籤 inside a Program's prefetch entry.
 * Maps 1:1 to the Watch picker's `IntensityOption` value type. The id
 * IS the sub_tag string (sub_tag is the natural key per ADR-0003 §
 * Template triple) — keeping it stable lets the Watch send back the
 * same string on `start-from-watch.intensityId` without an extra map.
 */
export interface Stage1IntensitySummary {
  /** sub_tag value used by `template.sub_tag` (also the natural key). */
  id: string;
  /** Display label — currently identical to `id`; reserved for future i18n. */
  name: string;
}

/**
 * Phase 2.5 — one program in the prefetch list. Intensities are inlined
 * (not a separate top-level field) because the Watch picker's
 * `ProgramOption` value type already embeds them — keeps the wire shape
 * 1:1 with the consumer's data model.
 *
 * `id` is the program row's primary key (used verbatim by the Watch as
 * `start-from-watch.programCycleId` — the legacy WC field name is a
 * misnomer; per ADR-0004 there's no separate program_cycle entity, the
 * cycles are implicit cycle_index 0..N within a single program row).
 *
 * Sourcing of `intensities`: UNION of two existing helpers per the
 * `program-sub-tag-union-source` skill —
 *   (a) `listDistinctSubTagsByProgram` — sub_tags currently in use by
 *       templates classified under this program.
 *   (b) `listProgramSubTags` — the persistent label dictionary (v022)
 *       that survives template renames / re-attaches.
 * Querying only one source silently drops labels; the union dedupes
 * via a `Set<string>` before projection.
 */
export interface Stage1ProgramSummary {
  /** program.id (NOT program_cycle.id — see field doc above). */
  id: string;
  /** Program display name. */
  name: string;
  intensities: ReadonlyArray<Stage1IntensitySummary>;
}

/**
 * Phase 2.5 + NEW-Q50 D28 — today's planned-day state, computed
 * iPhone-side from the active program's start_date + today's date +
 * the cell grid.
 *
 * Discriminated union; mirrors the Watch picker's `TodayPlanned` enum
 * (Swift `PickerModels.swift`). The Watch picker:
 *   - 'planned' → renders a tappable row with `label` (top of the
 *     計劃訓練 section). NEW-Q50: `exercises` is the fat-tree
 *     projection of the cell's template — Watch can build a session
 *     offline from this without any further fetch.
 *   - 'restDay' → renders grey「今天休息 💤」row, non-tappable.
 *   - 'noActiveProgram' → renders empty-state「沒有啟用的計劃」.
 *
 * `templateId` (planned variant) is the program_cell's `template_id`
 * — the Watch passes it back on `start-from-watch.templateId` so the
 * iPhone reconcile can build a matching session row when the cross-
 * device race-loser side needs to recreate the session.
 *
 * `programDayId` is the program_cell.id of today's cell — Watch uses
 * this as the natural key for future per-cell start-tracking (Phase 3+).
 */
export type Stage1TodayPlanned =
  | {
      kind: 'planned';
      label: string;
      programDayId: string;
      /** NEW-Q50 — fat tree so Watch can build offline. */
      templateId: string;
      exercises: ReadonlyArray<Stage1TemplateExercise>;
    }
  | { kind: 'restDay' }
  | { kind: 'noActiveProgram' };

/**
 * NEW-Q50 D28 — extended prefetch envelope (v2 fat tree). `templates`
 * now carries the full exercise tree (previously a thin {id, name}
 * list pre-Q50). `programs` + `todayPlanned` were added by Phase 2.5
 * and retained verbatim under Q50.
 *
 * `programs` / `todayPlanned` stay optional at the type level so the
 * same shape still type-checks for callers that pre-date Phase 2.5
 * (e.g. mock builders in unit tests). The orchestrator
 * (`onHandshakeRequest`) always populates both — `programs: []` when
 * no user programs exist, `todayPlanned: { kind: 'noActiveProgram' }`
 * when there's no active program. Watch-side Codable decode is
 * tolerant of missing keys via `JSONDecoder`'s default-value-on-
 * absent behaviour.
 */
export interface Stage1ReplyPrefetch {
  templates: ReadonlyArray<Stage1TemplateFullSummary>;
  programs?: ReadonlyArray<Stage1ProgramSummary>;
  todayPlanned?: Stage1TodayPlanned;
}

export type Stage1ReplyPayload =
  | {
      requestId: string;
      hasActiveSession: false;
      prefetch: Stage1ReplyPrefetch;
    }
  | {
      requestId: string;
      hasActiveSession: true;
      session: Stage1SessionSummary;
      prefetch: Stage1ReplyPrefetch;
    };

// ---------------------------------------------------------------------
// NEW-Q50 D28 — reverse-TUI reconcile response shape
// ---------------------------------------------------------------------

/**
 * Discriminated union for the iPhone → Watch reverse-TUI reply that
 * acknowledges (or refuses) a `start-from-watch` request.
 *
 * NEW-Q50 Q5 = b (first-write-wins + Watch UI escalation):
 *   - 'created' → iPhone successfully created (or no-op'd via INSERT
 *     OR IGNORE) the session row for the Watch-supplied sessionId.
 *     Watch UI flips its corner ⏳ → ✓ indicator.
 *   - 'conflict' → iPhone already has a different active session.
 *     Watch UI surfaces an alert sheet (D31) letting the user pick
 *     which side to keep.
 *
 * Tested independently of the WC bridge — `onStartFromWatch` accepts
 * a `sendReverseTUI` callback (mock in unit tests, real transferUserInfo
 * + envelope wrap at wire-in).
 */
export type StartFromWatchReconcile =
  | { status: 'created'; sessionId: string }
  | {
      status: 'conflict';
      sessionId: string;
      existingSessionId: string;
      existingTitle: string;
      existingStartedAt: number;
    };

// ---------------------------------------------------------------------
// SessionSnapshot shape (used by reverse iPhone→Watch direction)
// ---------------------------------------------------------------------

/**
 * Full session tree shipped on the iPhone→Watch direction (stretch /
 * Wave 2 — `pushStartToWatch` still uses sendMessage with this shape
 * until the iPhone-side direction is also flipped to TUI). This file
 * owns the shape so the bridge + Watch-side decoder + tests agree on
 * field set.
 *
 * All fields are JSON-primitive-clean by construction — the wire
 * layer (`makeEnvelope` → `normaliseForWire`) further enforces this
 * at the envelope factory boundary.
 */
export interface SessionSnapshot {
  sessionId: string;
  /** Per-session display title; `''` for freestyle. */
  title: string;
  /** Epoch ms. */
  startedAt: number;
  exercises: ReadonlyArray<SessionSnapshotExercise>;
}

export interface SessionSnapshotExercise {
  sessionExerciseId: string;
  exerciseId: string;
  exerciseName: string;
  ordering: number;
  plannedSets: number;
  sets: ReadonlyArray<SessionSnapshotSet>;
}

export interface SessionSnapshotSet {
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

// ---------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------

/**
 * Build the Stage 1 reply payload. Pure — caller provides:
 *
 *   - `request` — the original Stage 1 envelope payload (for the
 *     requestId echo)
 *   - `activeSession` — `null` if no in-progress session, otherwise
 *     the queried summary
 *   - `templates` — fat-tree prefetch list (may be empty)
 *   - `programs` (Phase 2.5, optional) — program list with inline
 *     intensities. Omitted = absent on the wire (forward-compat with
 *     pre-2.5 callers); use `[]` to explicitly send an empty list.
 *   - `todayPlanned` (Phase 2.5, optional) — today's planned-day state.
 *     Omitted = absent on the wire; Watch defaults to `noActiveProgram`
 *     when missing.
 */
export function buildStage1Reply(
  request: HandshakePayload,
  activeSession: Stage1SessionSummary | null,
  templates: ReadonlyArray<Stage1TemplateFullSummary>,
  programs?: ReadonlyArray<Stage1ProgramSummary>,
  todayPlanned?: Stage1TodayPlanned,
): Stage1ReplyPayload {
  const prefetch: Stage1ReplyPrefetch = { templates };
  if (programs !== undefined) prefetch.programs = programs;
  if (todayPlanned !== undefined) prefetch.todayPlanned = todayPlanned;
  if (activeSession === null) {
    return {
      requestId: request.requestId,
      hasActiveSession: false,
      prefetch,
    };
  }
  return {
    requestId: request.requestId,
    hasActiveSession: true,
    session: activeSession,
    prefetch,
  };
}

/**
 * Race-resistance predicate. The Watch holds the requestId it most
 * recently sent; any reply whose requestId doesn't match (e.g. iPhone
 * replied to an older handshake that the Watch already moved past) is
 * dropped. Use case: pickup-after-kill, where the Watch fires a fresh
 * handshake while a stale reply for the previous nonce is still
 * in-flight.
 */
export function matchesPendingRequest(
  reply: Stage1ReplyPayload,
  pendingRequestId: string,
): boolean {
  return reply.requestId === pendingRequestId;
}

/**
 * Build the iPhone→Watch `start-from-iphone` envelope payload from a
 * fetched SessionSnapshot. Pure transform — caller does the SQLite
 * read, this only projects the shape into the wire-facing payload.
 *
 * The projection is explicit (not a spread) so future field
 * additions on `SessionSnapshot` don't accidentally leak into the
 * wire layer without an audit.
 */
export function buildStartFromIphone(
  snapshot: SessionSnapshot,
): StartFromIphonePayload {
  return {
    sessionId: snapshot.sessionId,
    snapshot: snapshotToWire(snapshot),
  };
}

function snapshotToWire(snapshot: SessionSnapshot): Record<string, JsonValue> {
  return {
    sessionId: snapshot.sessionId,
    title: snapshot.title,
    startedAt: snapshot.startedAt,
    exercises: snapshot.exercises.map((ex) => ({
      sessionExerciseId: ex.sessionExerciseId,
      exerciseId: ex.exerciseId,
      exerciseName: ex.exerciseName,
      ordering: ex.ordering,
      plannedSets: ex.plannedSets,
      sets: ex.sets.map((s) => ({
        setId: s.setId,
        ordinal: s.ordinal,
        weight: s.weight,
        reps: s.reps,
        rpe: s.rpe,
        rest_sec: s.rest_sec,
        notes: s.notes,
        set_kind: s.set_kind,
        is_logged: s.is_logged,
      })),
    })),
  };
}

// ---------------------------------------------------------------------
// Impure helpers — DB reads
// ---------------------------------------------------------------------

/**
 * Project the active in-progress session into the minimal Stage 1 summary,
 * or `null` when no session is active.
 *
 * "Active" = `session.ended_at IS NULL`, matching `getActiveSession`. The
 * exercise count is a `COUNT(*)` on `session_exercise` keyed by session_id;
 * the JOIN goes through `listSessionExercisesWithName` to share its index
 * (`session_exercise(session_id, ordering)`) — cheaper than a dedicated
 * `SELECT COUNT(*)` since most active sessions have <20 exercises.
 *
 * Returns null if the session row exists but somehow has no `id`/`started_at`
 * (shouldn't happen with v001 NOT NULL constraints, but the projection is
 * defensive).
 */
export async function loadActiveSessionSummary(
  db: Database,
): Promise<Stage1SessionSummary | null> {
  const session = await getActiveSession(db);
  if (!session) return null;
  const exercises = await listSessionExercisesWithName(db, session.id);
  return {
    sessionId: session.id,
    startedAt: session.started_at,
    title: session.title ?? '',
    exerciseCount: exercises.length,
  };
}

/**
 * Phase 2.5 — load the program prefetch list for Stage 1. Each entry
 * carries its inline intensities (sub_tag union from both the legacy
 * template-derived source and the v022 persistent label dictionary).
 *
 * The 10-cap matches the size-budget headroom test in
 * `handshake.test.ts` — with 10 programs × 5 intensities + 20 templates +
 * active session summary the reply stays under 2 KB. Users with
 * >10 programs get the 10 most-recently-edited (`listPrograms` orders
 * by `is_active DESC, updated_at DESC`).
 *
 * Per the `program-sub-tag-union-source` skill: querying only one of
 * (templates ∪ dictionary) silently drops labels. The UNION dedupes
 * via a `Set<string>` before projection.
 *
 * `listPrograms` already filters the reserved「無」program (v017 seed),
 * so we don't surface it as a user-pickable option. Watch-side renders
 * a synthetic「通用」 row on top of this list — not modelled here.
 */
export async function loadProgramsPrefetchList(
  db: Database,
  limit = 10,
): Promise<Stage1ProgramSummary[]> {
  const programs = await listPrograms(db);
  const capped = programs.slice(0, limit);
  const out: Stage1ProgramSummary[] = [];
  for (const p of capped) {
    // Union: (a) sub_tags actually used by templates under this program +
    // (b) the persistent label dictionary (v022). Set dedupes ordered-by-
    // first-seen → stable across calls.
    const [tplTags, dictTags] = await Promise.all([
      listDistinctSubTagsByProgram(db, p.id),
      listProgramSubTags(db, p.id),
    ]);
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const t of [...tplTags, ...dictTags]) {
      if (!t || seen.has(t)) continue;
      seen.add(t);
      merged.push(t);
    }
    merged.sort((a, b) => a.localeCompare(b));
    out.push({
      id: p.id,
      name: p.name,
      intensities: merged.map((tag) => ({ id: tag, name: tag })),
    });
  }
  return out;
}

/**
 * NEW-Q50 D28 — hydrate the planned-exercise tree for a single
 * template_id. Pure projection of a JOIN between `template_exercise`
 * and `exercise` (to denormalise `exercise.name` onto each row).
 *
 * Returns rows in `ordering ASC` to match the Watch picker's render
 * order. Empty array when the template has no exercises (e.g. blank
 * template created via「另存模板」 with zero sets logged).
 *
 * Defaults projection:
 *   - `defaultSets` reads the NOT-NULL column verbatim.
 *   - `defaultReps` + `defaultWeightKg` are nullable in the schema
 *     (caller-side optional); null surfaces as `null` on the wire.
 *   - `exerciseName` falls back to `''` if the JOIN finds no matching
 *     exercise row (defensive — the v003 FK should prevent this,
 *     but the projection stays safe under historic backfill gaps).
 */
async function loadTemplateExerciseTree(
  db: Database,
  templateId: string,
): Promise<Stage1TemplateExercise[]> {
  type Row = {
    id: string;
    exercise_id: string;
    exercise_name: string | null;
    ordering: number;
    default_sets: number;
    default_reps: number | null;
    default_weight_kg: number | null;
  };
  const rows = await db.getAllAsync<Row>(
    `SELECT te.id, te.exercise_id, e.name AS exercise_name,
            te.ordering, te.default_sets, te.default_reps,
            te.default_weight_kg
       FROM template_exercise te
       LEFT JOIN exercise e ON e.id = te.exercise_id
      WHERE te.template_id = ?
      ORDER BY te.ordering ASC`,
    templateId,
  );
  return rows.map((r) => ({
    templateExerciseId: r.id,
    exerciseId: r.exercise_id,
    exerciseName: r.exercise_name ?? '',
    ordering: r.ordering,
    defaultSets: r.default_sets,
    defaultReps: r.default_reps,
    defaultWeightKg: r.default_weight_kg,
  }));
}

/**
 * NEW-Q50 D28 — load the **fat-tree** template prefetch list for
 * Stage 1. Each template carries its full planned exercise list so
 * the Watch can start an offline session without any further fetch.
 *
 * Replaces pre-Q50 `loadTemplatePrefetchList(db)` which projected only
 * `(templateId, name)` pairs.
 *
 * Cap rationale (default 20):
 *   - WC envelope ceiling is 64 KB.
 *   - Estimated 20 templates × ~10 exercises × ~100 bytes per row ≈
 *     20 KB → well within the cap with headroom for the envelope
 *     wrap + i18n-localised exercise names.
 *   - Users with >20 templates get the 20 most-recently-edited
 *     (`listTemplates` orders by `updated_at DESC`).
 *
 * Performance note: this is N+1-ish — one SELECT for the template
 * list + one SELECT per template for the exercise tree. Acceptable
 * at N≤20 with better-sqlite3 (sub-millisecond per query); a single
 * JOIN with bucket-on-receive would be marginally faster but
 * substantially less readable. Re-evaluate if N caps grow.
 */
export async function loadTemplatesFullTree(
  db: Database,
  limit = 20,
): Promise<Stage1TemplateFullSummary[]> {
  const templates = await listTemplates(db);
  const capped = templates.slice(0, limit);
  const out: Stage1TemplateFullSummary[] = [];
  for (const t of capped) {
    const exercises = await loadTemplateExerciseTree(db, t.id);
    out.push({
      templateId: t.id,
      name: t.name,
      exercises,
    });
  }
  return out;
}

/**
 * Phase 2.5 + NEW-Q50 D28 — compute today's planned-day state for the
 * Stage 1 reply, with the planned variant now carrying the fat-tree
 * exercise list so the Watch can build an offline session from it.
 *
 * Mirrors the iPhone 訓練 tab's `resolveTodayPlan` logic, projected onto
 * the Watch picker's 3-case enum. Templates that the cell points at but
 * have been deleted fall back to `restDay` (matches the iPhone-side
 * behaviour — never start a session against a phantom template).
 *
 * `today` parameter is injectable for unit tests; production callers
 * pass `Date.now()` and we convert to ISO via `utcMsToIsoDate`.
 *
 * The label string is human-readable e.g. "推日 W3D1（今日）" — wired
 * to the same naming convention as the iPhone Today banner.
 */
export async function loadTodayPlanned(
  db: Database,
  nowMs: number = Date.now(),
): Promise<Stage1TodayPlanned> {
  const active = await getActiveProgram(db);
  if (!active) return { kind: 'noActiveProgram' };
  const today = utcMsToIsoDate(nowMs);
  const cell = cellForDate({
    program: active.program,
    cells: active.cells,
    date: today,
  });
  if (!cell || !cell.template_id) {
    return { kind: 'restDay' };
  }
  // Look up the template name for the label.
  const tplRow = await db.getFirstAsync<{ name: string }>(
    `SELECT name FROM template WHERE id = ?`,
    cell.template_id,
  );
  if (!tplRow) {
    // Cell points at a deleted template — same fallback as
    // resolveTodayPlan (kind: 'rest').
    return { kind: 'restDay' };
  }
  // NEW-Q50 D28 — expand the planned cell's template into the fat
  // exercise tree so the Watch can build a SessionSnapshot offline.
  const exercises = await loadTemplateExerciseTree(db, cell.template_id);
  // Label format: "<template name> W<cycle>D<day>（今日）" — cycle and
  // day are 1-based in the user-facing label per the iPhone Today
  // banner convention.
  const w = cell.cycle_index + 1;
  const d = cell.day_index + 1;
  const subTagSuffix = cell.sub_tag ? ` · ${cell.sub_tag}` : '';
  const label = `${tplRow.name} W${w}D${d}（今日）${subTagSuffix}`;
  return {
    kind: 'planned',
    label,
    programDayId: cell.id,
    templateId: cell.template_id,
    exercises,
  };
}

/**
 * Hydrate a SessionSnapshot for the wire from SQLite. Used by the
 * iPhone→Watch direction (`pushStartToWatch` — kept on sendMessage
 * pending the symmetric NEW-Q50 follow-up grill).
 *
 * Projection notes:
 *   - `weight` reads from `set.weight_kg` (column rename at the wire
 *     boundary — kg is implicit, no other units supported per ADR-0001).
 *   - `rpe` is hardcoded `null` — no `set.rpe` column exists yet (the
 *     SessionSnapshotSet shape reserves the field for a future migration;
 *     forward-compat without a wire breaking change).
 *   - `rest_sec` denormalises from `session_exercise.rest_sec` onto each
 *     set in that exercise — the protocol shape (per-set rest) is more
 *     general than the storage shape (per-exercise rest) so the wire
 *     can later support per-set rest without a wire protocol change.
 *   - `ordinal` reads from `set.ordering` (column rename to match the
 *     SessionSnapshotSet field).
 *   - `set_kind` falls back to `'working'` for legacy rows where the
 *     column might be null (pre-v015) — defensive, modern rows always
 *     carry the value.
 *
 * Returns null when the session row no longer exists (Watch held a
 * stale sessionId after iPhone-side discard).
 */
export async function fetchSessionSnapshot(
  db: Database,
  sessionId: string,
): Promise<SessionSnapshot | null> {
  const row = await db.getFirstAsync<{
    id: string;
    started_at: number;
    title: string;
  }>(
    `SELECT id, started_at, title FROM session WHERE id = ?`,
    sessionId,
  );
  if (!row) return null;

  const seRows = await listSessionExercisesWithName(db, sessionId);
  const setRows = await listSetsBySession(db, sessionId);

  // Bucket sets by session_exercise_id for O(n) projection. Sets whose
  // `session_exercise_id` is null (legacy pre-v019 backfill miss) are
  // currently dropped from the snapshot — Watch hydration only needs
  // sets it can attribute to a session_exercise card. If we later need
  // to surface "orphan" sets we'll bucket them under a synthetic key.
  const setsByExercise = new Map<string, typeof setRows>();
  for (const s of setRows) {
    if (s.session_exercise_id == null) continue;
    const bucket = setsByExercise.get(s.session_exercise_id);
    if (bucket) {
      bucket.push(s);
    } else {
      setsByExercise.set(s.session_exercise_id, [s]);
    }
  }

  const exercises: SessionSnapshotExercise[] = seRows.map((se) => {
    const bucket = setsByExercise.get(se.id) ?? [];
    const restSec = se.rest_sec ?? null;
    return {
      sessionExerciseId: se.id,
      exerciseId: se.exercise_id,
      exerciseName: se.exercise_name,
      ordering: se.ordering,
      plannedSets: se.planned_sets,
      sets: bucket.map((s) => ({
        setId: s.id,
        ordinal: s.ordering,
        weight: s.weight_kg,
        reps: s.reps,
        rpe: null,
        rest_sec: restSec,
        notes: s.notes,
        set_kind:
          (s.set_kind as SessionSnapshotSet['set_kind']) ?? 'working',
        is_logged: s.is_logged === 1,
      })),
    };
  });

  return {
    sessionId: row.id,
    title: row.title ?? '',
    startedAt: row.started_at,
    exercises,
  };
}

// ---------------------------------------------------------------------
// Orchestrators — wire-in (handler bodies for the WC bridge)
// ---------------------------------------------------------------------

/**
 * Optional reply handler delivered by `react-native-watch-connectivity`'s
 * 'message' event. The bridge wraps the lib's native callback; handlers
 * MUST null-check before invoking — non-realtime channels (transferUserInfo
 * / applicationContext fallback) deliver `undefined` here.
 */
type ReplyHandler = (resp: Record<string, unknown>) => void;

/**
 * NEW-Q50 D28 — reverse-TUI sender callback. The wire-in commit wires
 * this to `session.transferUserInfo(envelope)` wrapped in a reverse
 * envelope (`kind: 'start-reconcile'`). Pure orchestrator code accepts
 * the callback as a parameter so unit tests can substitute a mock.
 */
type ReverseTUISender = (response: StartFromWatchReconcile) => void;

/**
 * Inbound `handshake` envelope handler (channel #0, Watch→iPhone).
 *
 * Flow: read active session + fat-tree templates + programs +
 * todayPlanned in parallel → `buildStage1Reply` → invoke
 * `replyHandler` with the reply payload. The Watch-side WC delegate
 * receives this as the `sendMessage` ack.
 *
 * Race-resistance is the Watch side's job — `matchesPendingRequest`
 * (this module's pure predicate) drops stale replies on the Watch. The
 * iPhone always answers the requestId verbatim (echo'd via `buildStage1Reply`).
 *
 * Per Q11 best-effort semantics:
 *   - If `replyHandler` is missing → silently drop. Lib bug / TUI fallback;
 *     not the iPhone's problem to compensate.
 *   - If the DB read throws → reply with a synthetic null-session payload
 *     so the Watch picker doesn't hang on a missing ack. The error is
 *     captured to console for diagnostics.
 */
export async function onHandshakeRequest(
  db: Database,
  env: WCMessage & { kind: 'handshake'; payload: HandshakePayload },
  replyHandler?: ReplyHandler,
): Promise<void> {
  if (!replyHandler) return;
  try {
    // Phase 2.5 + NEW-Q50 D28 — fan out programs + todayPlanned in
    // parallel with the active-session + fat-tree templates reads. All
    // four are cheap independent queries; Promise.all keeps the
    // round-trip latency at the slowest individual query.
    const [activeSession, templates, programs, todayPlanned] = await Promise.all([
      loadActiveSessionSummary(db),
      loadTemplatesFullTree(db),
      loadProgramsPrefetchList(db),
      loadTodayPlanned(db),
    ]);
    const reply = buildStage1Reply(
      env.payload,
      activeSession,
      templates,
      programs,
      todayPlanned,
    );
    replyHandler(reply as unknown as Record<string, unknown>);
  } catch (e) {
    // Best-effort: degrade to empty reply so Watch picker can render
    // "no active session, no templates" rather than hang on timeout.
    // Error swallowed at the boundary; surface via console.warn so
    // crash reporting (post-TestFlight) picks it up.
    //
    // NEW-Q50 D28: fallback `templates: []` is now of the fat-tree
    // shape (empty array still type-checks against
    // `Stage1TemplateFullSummary[]`).
    // eslint-disable-next-line no-console
    console.warn(
      '[handshake] onHandshakeRequest failed, falling back to empty reply:',
      e instanceof Error ? e.message : String(e),
    );
    replyHandler({
      requestId: env.payload.requestId,
      hasActiveSession: false,
      prefetch: {
        templates: [],
        programs: [],
        todayPlanned: { kind: 'noActiveProgram' },
      },
    });
  }
}

/**
 * NEW-Q50 D28 — Inbound `start-from-watch` envelope handler. Replaces
 * the pre-Q50 sync `replyHandler` path with an idempotent
 * `INSERT OR IGNORE`-style reconcile + a reverse-TUI status reply.
 *
 * Signature change: `(db, env, sendReverseTUI)` — `uuid` injection is
 * gone (Watch now supplies sessionId in the envelope payload), and the
 * sync `replyHandler` is replaced by the async-friendly reverse-TUI
 * sender callback.
 *
 * Flow (per NEW-Q50 Q2 + Q5):
 *   1. If `env.payload.sessionId` is missing/empty → degraded wire
 *      (pre-Q50 sender or buggy client). Log + send a synthetic
 *      'created' reconcile with empty sessionId so the Watch picker
 *      doesn't hang. No DB write.
 *   2. If iPhone has a different active session →
 *      reverse-TUI 'conflict' with the existing session's metadata so
 *      the Watch can render its alert sheet (D31). NO new INSERT.
 *   3. Otherwise → `INSERT OR IGNORE INTO session` with the
 *      Watch-supplied sessionId (handles natural dedup for at-least-
 *      once TUI delivery + cross-channel races) + flip
 *      `is_watch_tracked=true` + reverse-TUI 'created'.
 *
 * No SessionSnapshot is hydrated here — Watch is the SoT for the
 * session contents (Q1=a + Q6=a applicationContext mirror).
 *
 * Errors degrade to a silent no-op (no reconcile reply). Reverse-TUI
 * sender failures are caller's concern (transferUserInfo is fire-and-
 * forget on the iPhone side).
 */
export async function onStartFromWatch(
  db: Database,
  env: WCMessage & { kind: 'start-from-watch'; payload: StartFromWatchPayload },
  sendReverseTUI: ReverseTUISender,
  uuid?: () => string,
): Promise<void> {
  const suppliedId = env.payload.sessionId;
  if (!suppliedId) {
    // Degraded wire (pre-Q50 sender). Best-effort 'created' reply so
    // the Watch doesn't hang on a missing ack; no DB write.
    // eslint-disable-next-line no-console
    console.warn(
      '[handshake] onStartFromWatch dropped — payload.sessionId missing/empty',
    );
    sendReverseTUI({ status: 'created', sessionId: '' });
    return;
  }
  try {
    const existing = await getActiveSession(db);
    if (existing && existing.id !== suppliedId) {
      // First-write-wins: iPhone already has a different active session.
      // Don't INSERT; surface the conflict so the Watch can escalate
      // via the alert sheet (D31).
      sendReverseTUI({
        status: 'conflict',
        sessionId: suppliedId,
        existingSessionId: existing.id,
        existingTitle: existing.title ?? '',
        existingStartedAt: existing.started_at,
      });
      return;
    }
    if (!existing) {
      // No active session — create one with the Watch-supplied id.
      // `INSERT OR IGNORE` semantics: the v001 `session.id` PRIMARY KEY
      // would otherwise raise a UNIQUE violation on cross-channel races
      // (applicationContext mirror landing the same id first). We do the
      // check + insert sequentially under the orchestrator scope; race
      // protection at the SQL level is handled by `createSession`'s
      // INSERT which would throw on dup, caught below as best-effort.
      //
      // 2026-05-29 deep-night smoke fix (B2): branch on templateId.
      // Pre-fix: createSession always with title='' + no template_id +
      // no session_exercise rows — iPhone in-progress banner ALWAYS
      // showed「空白訓練」regardless of what template Watch picked,
      // because the wire dropped templateId on the floor.
      //
      // Post-fix: if templateId is supplied AND we have a uuid factory,
      // delegate to `startSessionFromTemplate` (which handles the full
      // tree: session.title = template.name + session_exercise rows
      // copied from template_exercise + session_set rows copied from
      // template_set, all in one transaction). Caller supplies sessionId
      // override so first-write-wins keying still holds.
      const templateId = env.payload.templateId;
      if (templateId && uuid) {
        await startSessionFromTemplate(db, {
          template_id: templateId,
          session_id: suppliedId,
          uuid,
          now: () => env.ts,
          program_id: env.payload.programCycleId ?? undefined,
          sub_tag: env.payload.intensityId ?? undefined,
        });
      } else {
        // Freestyle fallback path — either templateId is null (Watch
        // 空白訓練 path) OR uuid factory not injected (test path /
        // pre-NEW-Q50 caller). Empty title means iPhone in-progress
        // banner renders the「空白訓練」/「freestyle」label.
        await createSession(db, {
          id: suppliedId,
          started_at: env.ts,
          title: '',
        });
      }
    }
    // Existing OR fresh insert: flip is_watch_tracked unconditionally
    // — a session matching the supplied id is now Watch-tracked
    // (existing.id === suppliedId means the same Watch-started session
    // already landed via another channel; flag it as Watch-tracked
    // either way).
    await setIsWatchTracked(db, { id: suppliedId, value: true });
    sendReverseTUI({ status: 'created', sessionId: suppliedId });
  } catch (e) {
    // Best-effort: log + silent drop. Reverse-TUI not invoked since
    // we can't truthfully claim 'created'; Watch will eventually
    // observe via applicationContext live mirror or end-session TUI.
    // eslint-disable-next-line no-console
    console.warn(
      '[handshake] onStartFromWatch failed:',
      e instanceof Error ? e.message : String(e),
    );
  }
}
