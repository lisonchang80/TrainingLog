/**
 * Slice 13d / D9 partial — pure builders for the WC handshake.
 *
 * ADR-0019 NEW-Q44 specifies a two-stage Watch-launch handshake:
 *
 *   Stage 1 — Watch → iPhone `handshake` envelope carries
 *             { requestId, clientVersion }. iPhone replies with a
 *             small payload: requestId echo + (optional) active
 *             session summary + a template prefetch list. The Watch
 *             picker uses this to decide between Adopt / Discard /
 *             Plan without a second round-trip.
 *
 *   Stage 2 — Watch → iPhone (lazy, only if user picks Adopt) for
 *             the full SessionSnapshot. Race-resistant via the
 *             requestId echo — Watch drops any reply whose requestId
 *             doesn't match its currently-pending nonce.
 *
 * This file ships only the **pure** half of D9: the reply / payload
 * builders + the race predicate. The impure half (sendMessage wiring,
 * sessionRepository reads, fetchSessionSnapshot) lands with the full
 * D9 commit once `connectivity.ts` (the D3 bridge) is on main.
 *
 * Why split:
 *   - Pure logic can be tested under `testEnvironment: node` without
 *     the WC native bridge or in-memory SQLite seed.
 *   - The wire-in commit can land sooner once D0 spike + D3 bridge
 *     are in — no protocol-shape redesign needed.
 *
 * See `.claude/skills/ship-partial-pure-logic/SKILL.md` for the
 * pattern this commit follows.
 */

import type {
  HandshakePayload,
  JsonValue,
  StartFromIphonePayload,
} from './payloadSchema';

// ---------------------------------------------------------------------
// Stage 1 — reply shape
// ---------------------------------------------------------------------

/**
 * Minimal active-session summary carried in the Stage 1 reply. The
 * Watch picker needs just enough to render "Continue 'Push Day'
 * (4 exercises, started 12 min ago)?" — full exercise + set list is
 * Stage 2 (lazy).
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
 * Template prefetch entry. Watch picker shows (id, name) at Stage 1;
 * full template detail (exercise list + planned sets) is fetched
 * on-pick via Stage 2.
 */
export interface Stage1TemplateSummary {
  templateId: string;
  /** Template display name. */
  name: string;
}

/**
 * Stage 1 reply payload. Discriminated by `hasActiveSession` so the
 * Watch picker can `if (reply.hasActiveSession)` and TS narrows away
 * the `session` field on the false variant — eliminates a garbage
 * "session is null but other fields are defined" state at the type
 * level.
 *
 * `requestId` is echoed verbatim from the request envelope so the
 * Watch can match the reply to its currently-pending nonce; stale
 * replies fall away via {@link matchesPendingRequest}.
 *
 * NOTE — the envelope `ts` (top-level send time) is the caller's
 * concern: `makeEnvelope('handshake-reply', payload)` wraps this at
 * wire-in. Keeping the payload pure means the builder is clock-free
 * and unit-testable.
 */
export type Stage1ReplyPayload =
  | {
      requestId: string;
      hasActiveSession: false;
      prefetch: { templates: ReadonlyArray<Stage1TemplateSummary> };
    }
  | {
      requestId: string;
      hasActiveSession: true;
      session: Stage1SessionSummary;
      prefetch: { templates: ReadonlyArray<Stage1TemplateSummary> };
    };

// ---------------------------------------------------------------------
// Stage 2 — SessionSnapshot shape
// ---------------------------------------------------------------------

/**
 * Full session tree shipped in the Stage 2 `start-from-iphone`
 * envelope. The impure caller (`fetchSessionSnapshot`, to land in the
 * D9 wire-in commit) builds this from SQLite via the session +
 * session_exercise + set repositories; this file owns the **shape**
 * so the bridge + Watch-side decoder + tests agree on field set.
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
 *   - `templates` — prefetch list (may be empty)
 */
export function buildStage1Reply(
  request: HandshakePayload,
  activeSession: Stage1SessionSummary | null,
  templates: ReadonlyArray<Stage1TemplateSummary>,
): Stage1ReplyPayload {
  if (activeSession === null) {
    return {
      requestId: request.requestId,
      hasActiveSession: false,
      prefetch: { templates },
    };
  }
  return {
    requestId: request.requestId,
    hasActiveSession: true,
    session: activeSession,
    prefetch: { templates },
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
 * Build the Stage 2 `start-from-iphone` envelope payload from a
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
