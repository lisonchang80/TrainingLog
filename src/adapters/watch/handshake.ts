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

import type { Database } from '../../db/types';
import {
  createSession,
  getActiveSession,
  listSessionExercisesWithName,
  setIsWatchTracked,
} from '../sqlite/sessionRepository';
import { startSessionFromTemplate } from '../sqlite/sessionFromTemplate';
import { listSetsBySession } from '../sqlite/setRepository';
import { listTemplates } from '../sqlite/templateRepository';
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

// ---------------------------------------------------------------------
// Impure helpers — D9 wire-in (DB reads)
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
 * Load the template prefetch list for Stage 1. Projection of
 * `listTemplates` → `(templateId, name)` pairs, capped at 20 entries.
 *
 * The 20-cap matches the size budget test in `handshake.test.ts` (e):
 * with 20 templates + active session summary the reply stays under 2KB,
 * leaving headroom for the envelope + i18n-localised names. Users with
 * >20 templates get the 20 most-recently-edited (already `listTemplates`'
 * default ORDER BY updated_at DESC).
 */
export async function loadTemplatePrefetchList(
  db: Database,
  limit = 20,
): Promise<Stage1TemplateSummary[]> {
  const templates = await listTemplates(db);
  return templates.slice(0, limit).map((t) => ({
    templateId: t.id,
    name: t.name,
  }));
}

/**
 * Hydrate a SessionSnapshot for the wire from SQLite. Stage 2 of the
 * handshake (and the reply payload for `start-from-watch`) uses this.
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
// Orchestrators — D9 wire-in (handler bodies for addMessageListener)
// ---------------------------------------------------------------------

/**
 * Optional reply handler delivered by `react-native-watch-connectivity`'s
 * 'message' event. The bridge wraps the lib's native callback; handlers
 * MUST null-check before invoking — non-realtime channels (transferUserInfo
 * / applicationContext fallback) deliver `undefined` here.
 */
type ReplyHandler = (resp: Record<string, unknown>) => void;

/**
 * Inbound `handshake` envelope handler (channel #0, Watch→iPhone).
 *
 * Flow: read active session + templates → buildStage1Reply → invoke
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
    const [activeSession, templates] = await Promise.all([
      loadActiveSessionSummary(db),
      loadTemplatePrefetchList(db),
    ]);
    const reply = buildStage1Reply(env.payload, activeSession, templates);
    replyHandler(reply as unknown as Record<string, unknown>);
  } catch (e) {
    // Best-effort: degrade to empty reply so Watch picker can render
    // "no active session, no templates" rather than hang on timeout.
    // Error swallowed at the boundary; surface via console.warn so
    // crash reporting (post-TestFlight) picks it up.
    // eslint-disable-next-line no-console
    console.warn(
      '[handshake] onHandshakeRequest failed, falling back to empty reply:',
      e instanceof Error ? e.message : String(e),
    );
    replyHandler({
      requestId: env.payload.requestId,
      hasActiveSession: false,
      prefetch: { templates: [] },
    });
  }
}

/**
 * Inbound `start-from-watch` envelope handler (channel #1, Watch→iPhone).
 *
 * Flow:
 *   1. If iPhone already has an active session → reject (silent — the
 *      Watch picker should have run a handshake first and seen the
 *      session). Reply with the existing session's snapshot so the
 *      Watch can recover by adopting it instead.
 *   2. Otherwise create the session:
 *      - `templateId != null` → `startSessionFromTemplate` (planned path)
 *      - `templateId == null` → bare `createSession` (freestyle path)
 *   3. Flip `is_watch_tracked=true` (the Watch initiated, so 5-tile
 *      should render on iPhone's detail page).
 *   4. Fetch the snapshot + buildStartFromIphone + reply.
 *
 * The `programCycleId` / `intensityId` fields are forwarded to
 * `startSessionFromTemplate` as `program_id` / `sub_tag` — same shape
 * as iPhone-initiated planned starts (`onStartPlanned` in index.tsx).
 *
 * Errors degrade to a no-snapshot reply (sessionId='', empty snapshot)
 * so the Watch picker doesn't hang. Watch UI treats empty sessionId
 * as "iPhone failed to create" and surfaces an error.
 */
export async function onStartFromWatch(
  db: Database,
  env: WCMessage & { kind: 'start-from-watch'; payload: StartFromWatchPayload },
  uuid: () => string,
  replyHandler?: ReplyHandler,
): Promise<void> {
  if (!replyHandler) return;
  try {
    let sessionId: string;
    const existing = await getActiveSession(db);
    if (existing) {
      // Watch raced past handshake or session was created via iPhone
      // between the Watch picker render and the start-from-watch send.
      // Adopt the existing session rather than create a duplicate.
      sessionId = existing.id;
    } else if (env.payload.templateId == null) {
      // Freestyle path — bare createSession, no template snapshot.
      sessionId = uuid();
      await createSession(db, { id: sessionId, started_at: Date.now() });
    } else {
      // Planned path — same factory iPhone's `onStartPlanned` uses.
      const result = await startSessionFromTemplate(db, {
        template_id: env.payload.templateId,
        uuid,
        program_id: env.payload.programCycleId ?? undefined,
        sub_tag: env.payload.intensityId ?? null,
      });
      sessionId = result.session_id;
    }
    // Watch initiated the start, so flip is_watch_tracked regardless of
    // existing-vs-new (existing session may have been iPhone-side untracked
    // — Watch adopting it now retroactively flips the predicate).
    await setIsWatchTracked(db, { id: sessionId, value: true });

    const snapshot = await fetchSessionSnapshot(db, sessionId);
    const payload: StartFromIphonePayload = snapshot
      ? buildStartFromIphone(snapshot)
      : { sessionId: '', snapshot: {} };
    replyHandler(payload as unknown as Record<string, unknown>);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      '[handshake] onStartFromWatch failed, replying with empty payload:',
      e instanceof Error ? e.message : String(e),
    );
    replyHandler({ sessionId: '', snapshot: {} });
  }
}

