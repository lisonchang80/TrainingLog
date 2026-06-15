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
  type TemplateSummary,
} from '../sqlite/templateRepository';
import {
  getActiveProgram,
  listProgramSubTags,
  listPrograms,
} from '../sqlite/programRepository';
import { cellForDate } from '../../domain/program/programManager';
import { localMsToIsoDate } from '../../domain/program/programManager';
import { getAppMode, type AppMode } from '../sqlite/settingsRepository';
import { tExercise } from '../../i18n/strings';
import type {
  HandshakePayload,
  JsonValue,
  StartFromIphonePayload,
  StartFromWatchPayload,
  WCMessage,
} from './payloadSchema';
import { toWireRecord } from './connectivity';

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
 * 2026-05-29 SetLogger sets[] fix — one planned set inside a template's
 * fat-tree exercise. Mirrors per-row `template_set` projection so the
 * Watch can populate SetLoggerView with real weight/reps/setKind
 * instead of the deprecated `template_exercise.default_*` summary
 * columns (which the Watch fell back to before this fix, surfacing
 * "— kg / 0 次" for any template whose set rows diverge from the
 * summary).
 *
 * Slim shape (no setId / parentSetId / notes) to stay within the
 * 64 KB WC envelope cap — see `loadTemplateExerciseTree` doc for the
 * sizing calculation. Cluster (`parent_set_id`) + per-set notes can
 * be added later when Watch SetLoggerView grows cluster support
 * (D11 phase D-H).
 *
 * `reps` / `weightKg` are NOT NULL in `template_set` schema (v009);
 * the v009 migration synthesises `0` for legacy rows whose
 * `template_exercise.default_*` were null. Pass-through here — the
 * Watch consumer can show `0` as a real value (legacy 0 = "not set");
 * users can fix via the iPhone template editor.
 */
export interface Stage1TemplateSet {
  /**
   * template_set.set_kind enum: 'warmup' | 'working' | 'dropset'.
   * Single-char wire field name (`k`) to keep the per-set tax
   * minimal — full name expands to ~10 extra chars/row × 600 worst-
   * case sets ≈ 6 KB. See sizing note below.
   */
  k: 'warmup' | 'working' | 'dropset';
  /** template_set.reps (NOT NULL; legacy migrated rows may be 0). */
  r: number;
  /** template_set.weight in kg (NOT NULL; legacy migrated rows may be 0). */
  w: number;
}

// 2026-05-29 SetLogger sets[] fix — wire-shape sizing notes:
//
// (1) `position` is intentionally omitted because the loader ORDER
//     BYs position ASC; the array index IS the position. Saved ~12
//     chars/row × 600 worst-case sets ≈ 7 KB on the 20×10×3
//     prefetch.
//
// (2) Field names compacted to single chars (`k`/`r`/`w`) — full
//     `setKind`/`reps`/`weightKg` would add ~24 chars/row × 600 =
//     14 KB, pushing the worst-case envelope past the 64 KB WC
//     hard ceiling. Watch-side Codable mirrors map these via
//     CodingKeys to readable property names (setKind/reps/weightKg).
//
// Together (1)+(2) keep the 20-template / 10-exercise / 3-set
// stress shape under the 64 KB cap (measured ≈ 50 KB with
// headroom).

/**
 * NEW-Q50 D28 — one planned exercise inside a template's fat-tree
 * prefetch entry (or today's planned cell). Mirrors the SwiftUI
 * `WatchPlannedExercise` value type 1:1 so the wire is the consumer
 * data model.
 *
 * Sourced from `template_exercise` JOIN `exercise` — `exerciseName` is
 * denormalised onto the wire so the Watch never needs an Exercise
 * lookup table to render the planned card.
 *
 * 2026-05-29 SetLogger sets[] fix — added `sets` array carrying the
 * per-row `template_set` projection (ADR-0016 §migration transform
 * made `template_set` the canonical source-of-truth post-v009; the
 * `default_*` columns above are kept on the wire only as fallback
 * for back-compat with older Watch builds that pre-date this field).
 * When `sets.length > 0`, Watch buildSnapshotFromFatTree uses sets[]
 * verbatim; when empty, it falls back to the old defaults path.
 */
export interface Stage1TemplateExercise {
  templateExerciseId: string;
  exerciseId: string;
  exerciseName: string;
  ordering: number;
  defaultSets: number;
  /**
   * Omitted when the source template_exercise leaves reps open.
   * F5 (2026-06-12): was `number | null` — Stage1 builders now OMIT the
   * key instead of sending an explicit `null` (wire null rule, see the
   * `wc-add-envelope-kind` skill: dict-field null only survives today
   * because RN's JSI dict conversion silently drops it; builders must
   * not rely on that). Swift decode is `try? c.decode(...)` → absent
   * key tolerated (nil).
   */
  defaultReps?: number;
  /** Omitted when the source template_exercise leaves weight open (same F5 rule). */
  defaultWeightKg?: number;
  /**
   * 2026-05-29 SetLogger sets[] fix — per-row `template_set` projection
   * ordered by `position ASC`. Empty array when the template_exercise
   * has no template_set rows (rare — v009 migration backfilled all
   * pre-existing template_exercise rows). Always present on the wire
   * (may be `[]`); Swift-side Codable decode tolerates absence too,
   * so older iPhone payloads still parse.
   */
  sets: ReadonlyArray<Stage1TemplateSet>;
  /**
   * D15 superset card — cluster linkage from `template_exercise`. The Watch
   * builds its SessionSnapshot locally from this fat tree (NEW-Q50), so the
   * linkage must travel here (not just the dormant session-snapshot path).
   *
   *   - `reusableSupersetId` — RS identity (template_exercise.reusable_superset_id,
   *     v013). Two ADJACENT exercises sharing the same non-null value form one
   *     superset; the Watch folds them into a single superset card. Copied
   *     verbatim (foreign id → no remap), so grouping by it needs no id rewrite
   *     when the Watch mints fresh sessionExerciseIds.
   *   - `parentId` — template_exercise.parent_id (v009): OMITTED on the A
   *     side / a solo row, the parent template_exercise's id on the B side.
   *     Carried for forward-compat + A/B disambiguation; grouping uses
   *     reusableSupersetId + `ordering` so no parent-id remap is required.
   *
   * Both OPTIONAL — older iPhone payloads omit them; Swift decode tolerates
   * absence (defaults to nil → solo render). F5 (2026-06-12): narrowed from
   * `?: string | null` — builders omit the key on NULL DB columns instead of
   * sending explicit `null` (wire null rule, `wc-add-envelope-kind` skill).
   */
  parentId?: string;
  reusableSupersetId?: string;
}

/**
 * Stage1 prefetch v3 (2026-06-13 Y-dup grill) — one concrete template
 * variant inside a name group. The ADR-0003 identity triple is
 * `(name, program_id, sub_tag)`; the Watch resolves the user's
 * (計劃, 強度) sheet picks against these via strict-NULL matching
 * (mirror of `planResolveTarget` / `findTemplateByTriple`'s NULL idiom),
 * falling back to the group representative on a miss (Q2/Q6/Q7).
 *
 * `programId` / `subTag` are OMITTED (not explicit null) when the DB
 * column is NULL — wire null rule (`wc-add-envelope-kind` skill);
 * Swift decodes absence as nil.
 */
export interface Stage1TemplateVariant {
  templateId: string;
  /** Program id of the variant triple; OMITTED when NULL (通用). */
  programId?: string;
  /** sub_tag of the variant triple; OMITTED when NULL (通用). */
  subTag?: string;
  /**
   * Planned exercises, ordered by template_exercise.ordering ASC.
   * OMITTED for the representative (`variants[0]`) — its tree IS the
   * group's top-level `exercises`. Wire-level dedup only (Q5's
   * "per-variant 全帶" semantics hold: every variant's tree is on the
   * wire exactly once): without it the degenerate 20-singleton-name
   * reply would carry every tree twice and blow past the 64 KB WC
   * envelope ceiling. Swift: absence → use the group tree.
   */
  exercises?: ReadonlyArray<Stage1TemplateExercise>;
}

/**
 * NEW-Q50 D28 — replaces pre-Q50 `Stage1TemplateSummary`. Fat-tree
 * projection: each template carries its full planned exercise list so
 * the Watch can build a SessionSnapshot offline without a second
 * round-trip.
 *
 * Stage1 prefetch v3 (2026-06-13): one entry per template NAME (the
 * Y-dup fix — the picker shows one row per name, Q1). The top-level
 * `templateId`/`exercises` are the REPRESENTATIVE variant's (newest
 * `updated_at` in the group) so an older Watch build that ignores
 * `variants` keeps today's behaviour (Q12 tolerant-decode compat).
 * New builds resolve the concrete variant from `variants` instead.
 *
 * Caps: enforced upstream in `loadTemplatesFullTree` — GLOBAL variant
 * budget (default 20) spent group-first so a name group is never split
 * (Q8). Sizing rationale unchanged: ≈20 trees stay well under the
 * 64 KB WC envelope ceiling.
 */
export interface Stage1TemplateFullSummary {
  templateId: string;
  /** Template display name. */
  name: string;
  /** Planned exercises, ordered by template_exercise.ordering ASC. */
  exercises: ReadonlyArray<Stage1TemplateExercise>;
  /**
   * All variants in this name group, newest-edited first (index 0 ==
   * the representative). Always present from v3 builders; optional in
   * the type so older fixture payloads / Swift decoders tolerate
   * absence.
   */
  variants?: ReadonlyArray<Stage1TemplateVariant>;
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
      /**
       * Pre-formatted single-line label (e.g. "腿日 W3D1（今日）· 12RM").
       * Kept for backward compat + any single-line consumer.
       */
      label: string;
      /**
       * #7 (2026-05-30) — structured fields so the Watch can render the
       * planned cell on TWO lines: template name on line 1, then
       * "計劃：<program> · 強度：<intensity>" on line 2. `label` is the
       * legacy flat form; these break it apart so the Watch picker shows
       * a clearer hierarchy. `programName` is the user's program name (not
       * localised — user-authored). `intensity` is the sub_tag (OMITTED when
       * the cell has no intensity tag — F5 2026-06-12, was `string | null`;
       * wire null rule per the `wc-add-envelope-kind` skill. Swift decode is
       * `try? c.decode(...)` → absent key tolerated).
       */
      templateName: string;
      programName: string;
      intensity?: string;
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
  /**
   * Slice 16 / ADR-0026 D2 — app-wide mode flag. `'minimal'` tells the
   * Watch to hide the 「計劃訓練」section and skip both picker sheets
   * (ProgramPicker + IntensityPicker) on template tap. Optional at the
   * type level for forward-compat with pre-slice-16 callers; absent on
   * the wire = Watch defaults to `'plan'` (today's full behaviour). This
   * is an explicit flag, NOT an empty-data signal (ADR-0026 D2 rejects
   * implicit degradation as ambiguous/fragile).
   */
  appMode?: AppMode;
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
  /**
   * Bidirectional sync refactor (slice 13d sync-refactor, 2026-05-31).
   * All three are OPTIONAL — legacy producers (pre-refactor Watch /
   * iPhone) omit them and the receiver tolerates their absence:
   *
   *   - `rev` — per-`originator` monotonic version. The receiver MAY
   *     ignore a snapshot whose `rev` is <= the last `rev` it applied
   *     from the same `originator` (out-of-order / stale-packet guard,
   *     and same-field latest-wins). Absent → no ordering guard (legacy).
   *   - `originator` — which side produced this snapshot. Used for echo
   *     suppression (don't re-emit a snapshot you just applied) and for
   *     per-originator `rev` tracking.
   *   - `deletedIds` — tombstones: row ids the originator deleted during
   *     THIS session. The receiver PRECISELY purges these (NOT a
   *     mass-purge of snapshot-absent rows — see `reconcileSessionTree`).
   *     This is what propagates a live delete <1s in either direction.
   *     Absent → no live deletions in this tick.
   *
   * Tombstone id contract: `deletedIds` reference the originator's row
   * ids. Cross-device purge-by-id is only reliable once both sides share
   * ids (the Watch receiver adopts the iPhone's canonical ids — a Phase C
   * concern). Until then a tombstone that finds no local row is a safe
   * no-op (the row still gets removed by the authoritative end-session
   * mass-purge), so honouring tombstones is a monotonic improvement with
   * no regression.
   */
  rev?: number;
  originator?: SnapshotOriginator;
  deletedIds?: SessionTombstones;
}

export type SnapshotOriginator = 'watch' | 'iphone';

/** Row ids the originator deleted during the current session (Q5 墓碑). */
export interface SessionTombstones {
  exerciseIds: ReadonlyArray<string>;
  setIds: ReadonlyArray<string>;
}

export interface SessionSnapshotExercise {
  sessionExerciseId: string;
  exerciseId: string;
  exerciseName: string;
  ordering: number;
  plannedSets: number;
  sets: ReadonlyArray<SessionSnapshotSet>;
  /**
   * Cluster linkage (ADR-0018 v014, shipped to the Watch for D15 superset
   * card). On the parent (A side) / a solo exercise this is null; on the
   * child (B side) of a superset it holds the parent session_exercise's
   * `sessionExerciseId`. The Watch pairs A+B by matching `parentId` to a
   * preceding exercise's `sessionExerciseId` to fold them into one
   * superset card. OPTIONAL — older wire payloads omit it; consumers
   * default to null (solo render). Authored ONLY on iPhone (template
   * snapshot path); the Watch never creates a superset, so the reverse
   * live-mirror leaves it absent and the iPhone reconcile preserves the
   * DB value.
   */
  parentId?: string | null;
  /**
   * Reusable Superset identity (ADR-0018 v014). NULL = solo / manual /
   * ad-hoc; NOT NULL = the two rows sharing this id form one RS-exploded
   * superset. Travels alongside `parentId` so the Watch can label the
   * card and route the ⋯ menu A/B history. OPTIONAL — see `parentId`.
   */
  reusableSupersetId?: string | null;
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
  /**
   * Dropset-chain parent: NULL for a head / working / warmup row; on a
   * follower it carries the HEAD row's `setId`. The iPhone reconcile resolves
   * this (wire id → on-device id) to fold a head + its followers into one
   * cluster. OPTIONAL because it travels ABSENT over WC for non-followers
   * (Swift `JSONEncoder` drops nil); `parseLiveMirrorSnapshot` normalises
   * absent → null, so a parsed snapshot always carries the field, while raw
   * fixtures / wire dicts may omit it.
   */
  parent_set_id?: string | null;
  /**
   * Watch display rank (slice 13d 2026-06-02, device-bug #1/#2). The Watch's
   * effective sort key — a base set = its `ordinal`, a reordered / mid-
   * inserted set = a fractional override (`setRankOverrides` /
   * `AddedSet.displayRank`). The Watch already sorts its live snapshot by this
   * (`LiveMirror.mergeSets`), but the wire `ordinal` is glued to set IDENTITY
   * (the iPhone reconcile matches by `(session_exercise_id, ordinal)` value),
   * so the ordinal alone can't carry display order. `display_rank` travels it
   * → the iPhone lands it in `set.display_rank` and renders by
   * `display_rank ?? ordering`. OPTIONAL — older Watch builds omit it (Swift
   * `JSONEncoder` drops nil → absent over WC); `parseLiveMirrorSnapshot`
   * normalises absent → null and the iPhone then falls back to `ordering`.
   */
  display_rank?: number | null;
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
 *   - `appMode` (slice 16 / ADR-0026 D2, optional) — `'plan' | 'minimal'`.
 *     Omitted = absent on the wire; Watch defaults to `'plan'`.
 */
export function buildStage1Reply(
  request: HandshakePayload,
  activeSession: Stage1SessionSummary | null,
  templates: ReadonlyArray<Stage1TemplateFullSummary>,
  programs?: ReadonlyArray<Stage1ProgramSummary>,
  todayPlanned?: Stage1TodayPlanned,
  appMode?: AppMode,
): Stage1ReplyPayload {
  const prefetch: Stage1ReplyPrefetch = { templates };
  if (programs !== undefined) prefetch.programs = programs;
  if (todayPlanned !== undefined) prefetch.todayPlanned = todayPlanned;
  if (appMode !== undefined) prefetch.appMode = appMode;
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
  const wire: Record<string, JsonValue> = {
    sessionId: snapshot.sessionId,
    title: snapshot.title,
    startedAt: snapshot.startedAt,
    exercises: snapshot.exercises.map((ex) => ({
      sessionExerciseId: ex.sessionExerciseId,
      exerciseId: ex.exerciseId,
      exerciseName: ex.exerciseName,
      ordering: ex.ordering,
      plannedSets: ex.plannedSets,
      // Cluster linkage (D15 superset card) — null travels as JSON null,
      // which is plist-clean inside the `start-from-iphone` reply (this is
      // a sendMessage reply, not applicationContext, so null keys are fine).
      parentId: ex.parentId ?? null,
      reusableSupersetId: ex.reusableSupersetId ?? null,
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
        parent_set_id: s.parent_set_id ?? null,
      })),
    })),
  };
  // Bidirectional sync fields — project ONLY when present so legacy wire
  // payloads stay byte-identical (and stay plist-clean: no key, not null).
  if (snapshot.rev !== undefined) wire.rev = snapshot.rev;
  if (snapshot.originator !== undefined) wire.originator = snapshot.originator;
  if (snapshot.deletedIds !== undefined) {
    wire.deletedIds = {
      exerciseIds: [...snapshot.deletedIds.exerciseIds],
      setIds: [...snapshot.deletedIds.setIds],
    };
  }
  return wire;
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
 *     (caller-side optional); NULL surfaces as an ABSENT key on the wire
 *     (F5 2026-06-12 — never an explicit `null`; see the wire null rule
 *     in the `wc-add-envelope-kind` skill).
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
    parent_id: string | null;
    reusable_superset_id: string | null;
  };
  const rows = await db.getAllAsync<Row>(
    `SELECT te.id, te.exercise_id, e.name AS exercise_name,
            te.ordering, te.default_sets, te.default_reps,
            te.default_weight_kg, te.parent_id, te.reusable_superset_id
       FROM template_exercise te
       LEFT JOIN exercise e ON e.id = te.exercise_id
      WHERE te.template_id = ?
      ORDER BY te.ordering ASC`,
    templateId,
  );

  // 2026-05-29 SetLogger sets[] fix — fetch template_set rows for each
  // template_exercise in this template. N+1-ish query inside the
  // already N+1-ish loadTemplatesFullTree (1 SELECT per template + 1
  // SELECT per exercise) — acceptable at N≤20 templates × ~10 exercises
  // with better-sqlite3 (sub-ms per query). Re-evaluate if caps grow.
  //
  // Per-set wire bytes ≈ 50 (4 fields × short JSON). Worst-case
  // budget at the 20-template / 10-exercise / 5-set ceiling = 1000
  // sets × 50 B = 50 KB — within the 64 KB envelope cap with headroom
  // for the rest of the prefetch envelope (~30 KB exercise rows).
  type SetRow = {
    template_exercise_id: string;
    position: number;
    set_kind: string;
    reps: number;
    weight: number;
  };
  const out: Stage1TemplateExercise[] = [];
  for (const r of rows) {
    const setRows = await db.getAllAsync<SetRow>(
      `SELECT template_exercise_id, position, set_kind, reps, weight
         FROM template_set
        WHERE template_exercise_id = ?
        ORDER BY position ASC`,
      r.id,
    );
    const ex: Stage1TemplateExercise = {
      templateExerciseId: r.id,
      exerciseId: r.exercise_id,
      // Bug Y (task #271) — localise the exercise name at the iPhone wire
      // boundary. The DB stores the v001 seed literal in English (e.g.
      // 'Bench Press'); the iPhone app localises via `tExercise()` at
      // render time, but the Watch has no i18n table for seed names, so
      // the raw value crossed the wire and the picker showed English.
      // `tExercise` switches on the iPhone's `currentLocale` → the Watch
      // gets the name in the user's chosen language. Custom (non-seed)
      // names pass through unchanged via tExercise's fallback. This is
      // display-only — `exerciseId` (the FK) stays raw, and the Watch
      // never round-trips the name back into the DB (onStartFromWatch
      // rebuilds the tree from template_id; replaceLiveMirror writes
      // exercise_id), so there is no seed-pollution risk.
      exerciseName: r.exercise_name ? tExercise(r.exercise_name) : '',
      ordering: r.ordering,
      defaultSets: r.default_sets,
      // `position` is intentionally omitted from the projection —
      // the array index IS the position because we ORDER BY
      // position ASC above. Field names are single chars (k/r/w)
      // to fit the WC envelope cap. See Stage1TemplateSet doc.
      sets: setRows.map((s) => ({
        // Defensive: cast to the union; schema CHECK constraint
        // enforces these three values, but the wire type narrows
        // the string for the Swift consumer.
        k: (s.set_kind === 'warmup' || s.set_kind === 'dropset')
          ? s.set_kind
          : 'working',
        r: s.reps,
        w: s.weight,
      })),
    };
    // F5 (2026-06-12, audit F5 後半) — nullable columns project as an
    // ABSENT key, never an explicit `null`. Reply dicts cross the JS →
    // native boundary where RN's JSI conversion happens to drop dict-null
    // today (feature-flag dependent — a flipped default would turn every
    // explicit null into an NSNull → WCSession 7010 reject, killing the
    // handshake = picker lifeline). Swift `Stage1TemplateExercise` decode
    // is `try? c.decode(...)` per field → absent key → nil. Guarded by
    // the reply-null regression scan in handshake.test.ts.
    if (r.default_reps != null) ex.defaultReps = r.default_reps;
    if (r.default_weight_kg != null) ex.defaultWeightKg = r.default_weight_kg;
    // D15 superset card — carry cluster linkage so the Watch can fold an
    // adjacent same-RS pair into a superset card when it builds the local
    // SessionSnapshot. Verbatim copy (foreign id → no remap).
    if (r.parent_id != null) ex.parentId = r.parent_id;
    if (r.reusable_superset_id != null) {
      ex.reusableSupersetId = r.reusable_superset_id;
    }
    out.push(ex);
  }
  return out;
}

/**
 * NEW-Q50 D28 — load the **fat-tree** template prefetch list for
 * Stage 1. Each template carries its full planned exercise list so
 * the Watch can start an offline session without any further fetch.
 *
 * Replaces pre-Q50 `loadTemplatePrefetchList(db)` which projected only
 * `(templateId, name)` pairs.
 *
 * Stage1 prefetch v3 (2026-06-13 Y-dup grill Q8) — grouped-by-name with
 * a GLOBAL variant budget spent group-first:
 *   - Groups ordered by their representative's `updated_at` DESC
 *     (`listTemplates` is `ORDER BY updated_at DESC`; first occurrence
 *     of a name == its newest variant, and Map preserves insertion
 *     order).
 *   - Each admitted group carries ALL of its variants — a name group is
 *     never split (a split would re-create the silent-miss the Y-dup
 *     fix exists to kill).
 *   - The first group is admitted even if it alone exceeds the budget
 *     (degenerate >20-variants-one-name case: an empty reply would be
 *     strictly worse); after that, the first group that doesn't fit
 *     ends the scan (no skip-ahead — keeps "most recent N" semantics
 *     predictable).
 *
 * Cap rationale (default 20):
 *   - WC envelope ceiling is 64 KB.
 *   - Estimated 20 variant trees × ~10 exercises × ~100 bytes per row ≈
 *     20 KB → well within the cap with headroom for the envelope
 *     wrap + i18n-localised exercise names.
 *
 * Performance note: this is N+1-ish — one SELECT for the template
 * list + one SELECT per variant for the exercise tree. Acceptable
 * at N≤20 with better-sqlite3 (sub-millisecond per query); a single
 * JOIN with bucket-on-receive would be marginally faster but
 * substantially less readable. Re-evaluate if N caps grow.
 */
export async function loadTemplatesFullTree(
  db: Database,
  limit = 20,
): Promise<Stage1TemplateFullSummary[]> {
  const templates = await listTemplates(db);
  // Group by name, preserving newest-first group order (see docblock).
  const groups = new Map<string, TemplateSummary[]>();
  for (const t of templates) {
    const g = groups.get(t.name);
    if (g) g.push(t);
    else groups.set(t.name, [t]);
  }
  const out: Stage1TemplateFullSummary[] = [];
  let budget = limit;
  for (const [name, rows] of groups) {
    if (out.length > 0 && rows.length > budget) break;
    let representativeTree: ReadonlyArray<Stage1TemplateExercise> = [];
    const variants: Stage1TemplateVariant[] = [];
    for (let i = 0; i < rows.length; i++) {
      const v = rows[i];
      const exercises = await loadTemplateExerciseTree(db, v.id);
      if (i === 0) representativeTree = exercises;
      variants.push({
        templateId: v.id,
        // Wire null rule — omit the key entirely on NULL (通用) columns.
        ...(v.program_id != null ? { programId: v.program_id } : {}),
        ...(v.sub_tag != null ? { subTag: v.sub_tag } : {}),
        // Representative's tree rides top-level only (see
        // Stage1TemplateVariant.exercises docblock — 64 KB dedup).
        ...(i === 0 ? {} : { exercises }),
      });
    }
    out.push({
      templateId: rows[0].id,
      name,
      exercises: representativeTree,
      variants,
    });
    budget -= rows.length;
    if (budget <= 0) break;
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
 * pass `Date.now()` and we convert to the user's LOCAL ISO day via
 * `localMsToIsoDate` (NOT the UTC variant — that would pick the wrong day
 * near midnight for users east/west of UTC).
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
  const today = localMsToIsoDate(nowMs);
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
  const planned: Extract<Stage1TodayPlanned, { kind: 'planned' }> = {
    kind: 'planned',
    label,
    // #7 — structured fields for the Watch's 2-line planned-cell render.
    templateName: tplRow.name,
    programName: active.program.name,
    programDayId: cell.id,
    templateId: cell.template_id,
    exercises,
  };
  // F5 (2026-06-12) — NULL sub_tag projects as an ABSENT key, never an
  // explicit `null` (wire null rule, `wc-add-envelope-kind` skill). An
  // empty-string sub_tag still passes through verbatim ('' is plist-clean
  // and pre-F5 behaviour); only null/undefined omit the key.
  if (cell.sub_tag != null) planned.intensity = cell.sub_tag;
  return planned;
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
      // Bug Y (task #271) — localise at the wire boundary, same as the
      // Stage 1 prefetch (loadTemplateExerciseTree). This iPhone→Watch
      // snapshot-push path is currently dormant (pushStartToWatch sends
      // an empty `{}` snapshot; the live data channel is the D29 Watch→
      // iPhone live mirror), but localise here too so the path is correct
      // the day it's wired. `snapshotToWire` stays a pure passthrough —
      // localisation belongs with the DB read where the seed name origins.
      exerciseName: tExercise(se.exercise_name),
      ordering: se.ordering,
      plannedSets: se.planned_sets,
      // Cluster linkage (D15 superset card). listSessionExercisesWithName
      // already SELECTs these columns; pass them through so the Watch can
      // fold a parent+child pair into one superset card.
      parentId: se.parent_id ?? null,
      reusableSupersetId: se.reusable_superset_id ?? null,
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
        parent_set_id: s.parent_set_id ?? null,
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
    // are cheap independent queries; Promise.all keeps the round-trip
    // latency at the slowest individual query.
    //
    // Slice 16 / ADR-0026 D2 — `getAppMode` joins the fan-out so the
    // Watch learns 計劃/極簡 mode via the explicit prefetch flag.
    const [activeSession, templates, programs, todayPlanned, appMode] =
      await Promise.all([
        loadActiveSessionSummary(db),
        loadTemplatesFullTree(db),
        loadProgramsPrefetchList(db),
        loadTodayPlanned(db),
        getAppMode(db),
      ]);
    const reply = buildStage1Reply(
      env.payload,
      activeSession,
      templates,
      programs,
      todayPlanned,
      appMode,
    );
    replyHandler(toWireRecord(reply));
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
