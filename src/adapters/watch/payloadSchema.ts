/**
 * Watch ↔ iPhone WatchConnectivity (WC) message envelopes — protocol layer.
 *
 * Slice 13d / D3 (ADR-0019 § Slice 13d Amendment). This file is the
 * *protocol-only* slice of D3 — pure TypeScript types + a tiny factory and
 * a discriminating type guard. The `connectivity.ts` bridge wrapper that
 * actually imports `react-native-watch-connectivity` lands later in the D3
 * commit chain (gated on the D0 spike outcome — Branch A vs Branch B).
 *
 * Why split the schema out:
 *   - Jest runs under `testEnvironment: node`, so any module that
 *     `import`s a native bridge at the top level explodes in tests. By
 *     keeping the schema pure, we can unit-test the wire format without
 *     mocks. The `connectivity.ts` wrapper will lazy-`require()` the
 *     native module the same way `src/adapters/healthkit/permission.ts`
 *     does (see L41-48 there for the canonical pattern).
 *   - Watch-side Swift code mirrors these structures via
 *     `WCPayload.swift` (D4/D5). Keeping the TS shape narrow + named
 *     gives the Swift port an unambiguous source-of-truth.
 *
 * Design rules baked into the envelope (per ADR-0019 § Q6):
 *   1. Payload values must be JSON primitives only — `string`, `number`,
 *      `boolean`, `null`, arrays of those, or objects whose own fields
 *      satisfy the same rule. No `Date`, no `Map`, no `Set`, no
 *      `function`, no `undefined`, no `symbol`. Anything that
 *      `JSON.stringify` would silently drop or stringify wrong is out.
 *   2. Time-of-event is always a `number` (epoch milliseconds). The
 *      factory accepts `Date` for ergonomic call-sites and converts.
 *   3. Every envelope carries a unique `msgId` so the receiver can
 *      dedupe via the ring buffer (≥256 slots) specified in Q7.
 *
 * The 17 message kinds come straight from ADR-0019 § Slice 13d
 * Amendment table + Agent F codebase inventory (D3 section + the kinds
 * referenced by D5-D24, plus `live-mirror` — the 17th, sync fast lane
 * 2026-06-01). See per-kind doc-comments below for the decision that
 * introduced each kind.
 */

// ---------------------------------------------------------------------
// Section 1 — Kind enumeration
// ---------------------------------------------------------------------

/**
 * The 18 message kinds. Order here mirrors the table in
 * ADR-0019 § Slice 13d Amendment for grep-ability. New kinds are
 * forbidden without an ADR amendment — the kind set is the cross-end
 * API contract.
 */
export type WCMessageKind =
  | 'handshake'
  | 'start-from-watch'
  | 'start-from-iphone'
  | 'start-reconcile'
  | 'start-resolve'
  | 'set-completed'
  | 'set-modified'
  | 'set-deleted'
  | 'set-added'
  | 'exercise-added'
  | 'exercise-deleted'
  | 'hr-tick'
  | 'kcal-tick'
  | 'live-mirror'
  | 'cast-session'
  | 'end-session'
  | 'discard-session'
  | 'settings-sync'
  | 'history-request'
  | 'notes-request'
  | 'lock-request'
  | 'lock-grant'
  | 'lock-ack'
  | 'lock-takeover'
  | 'lock-sync';

/**
 * All 19 kinds as a frozen tuple — used by the type guard, jest
 * `it.each` tables, and the Swift mirror generator (D4/D5). Keep in
 * sync with `WCMessageKind` literal union above.
 *
 * NEW-Q50 (2026-05-29) — `start-reconcile` added as reverse TUI ack
 * envelope (iPhone → Watch reply to `start-from-watch`).
 *
 * D31 (2026-05-29 late) — `start-resolve` added as Watch → iPhone
 * forward TUI envelope: user picked "中止 iPhone 保留 Watch" in the
 * conflict alert sheet. iPhone receiver hard-deletes the
 * `existingSessionId` via `discardSession` cascade. Fire-and-forget;
 * no reply. `end-reconcile` (iPhone→Watch for end-session ack) still
 * deferred to a later wire-in.
 *
 * Sync fast-lane (2026-06-01) — `live-mirror` added as Watch → iPhone
 * live-session snapshot over `sendMessage` (the <1s foreground fast
 * lane), DUAL-FIRED with the existing `updateApplicationContext`
 * backstop. Carries a monotonic `rev` so the iPhone receiver
 * (`onLiveMirror`) drops out-of-order / stale redeliveries. Fixes the
 * "又慢、又亂、時有時無（尤其遞減組）" live-sync regression that came
 * from riding applicationContext alone (latest-replace, OS-paced,
 * unreliable foreground). NOT durable (no TUI): a dropped live tick
 * self-heals on the next push; `end-session` is the correctness backstop.
 */
export const WC_MESSAGE_KINDS = [
  'handshake',
  'start-from-watch',
  'start-from-iphone',
  'start-reconcile',
  'start-resolve',
  'set-completed',
  'set-modified',
  'set-deleted',
  'set-added',
  'exercise-added',
  'exercise-deleted',
  'hr-tick',
  'kcal-tick',
  'live-mirror',
  'cast-session',
  'end-session',
  'discard-session',
  'settings-sync',
  'history-request',
  'notes-request',
  'lock-request',
  'lock-grant',
  'lock-ack',
  'lock-takeover',
  'lock-sync',
] as const satisfies readonly WCMessageKind[];

// ---------------------------------------------------------------------
// Section 2 — Per-kind payload shapes
// ---------------------------------------------------------------------

/**
 * `handshake` — Watch → iPhone on app launch / re-launch (Q4 channel
 * #0, NEW-Q44 two-stage). Stage 1 carries Watch app version + a
 * `requestId` (caller-generated nonce; the reply echoes the same id so
 * late replies can be discarded). The actual reply payload (Session
 * snapshot + template prefetch list) is *not* modelled here — it
 * lands in `src/adapters/watch/handshake.ts` (D9) because it pulls in
 * SQLite types.
 */
export interface HandshakePayload {
  /** Caller-generated nonce; echoed back by iPhone in its reply envelope. */
  requestId: string;
  /** Watch app build identifier (e.g. `'13d.0'`); iPhone may reject older clients. */
  clientVersion: string;
  /**
   * ADR-0028 restart-resilience — `true` when the Watch is currently inside a
   * session (set logger), `false`/absent when it's at the picker. The Watch only
   * handshakes from the picker today (so it's effectively always false), but the
   * field is the explicit contract: the iPhone RE-CASTS an active cast session
   * (投影 Watch restore) only when this is NOT true, so a Watch that merely
   * background→foregrounds mid-session can't have its in-progress session
   * clobbered. Append-only; absent on a pre-0028 Watch → treated as false
   * (re-cast), which is correct since such a Watch also only handshakes at the
   * picker.
   */
  hasLocalSession?: boolean;
}

/**
 * `history-request` — Watch → iPhone, request-reply (#311-A, 2026-06-09
 * grill). User tapped 📊 查看歷史 on an in-session exercise card; the Watch
 * (no SQLite) asks the iPhone for the last-3-session history of a single
 * exercise. The REPLY (the formatted records) is NOT a modelled kind — it
 * rides the `sendMessage` replyHandler ack, same as `handshake`'s Stage 1
 * reply (its shape lives in `src/adapters/watch/watchHistory.ts`, which
 * pulls in SQLite types). `exerciseId` is the raw `exercise.id` FK (pivot);
 * `requestId` is a caller nonce so the Watch can discard a stale late ack.
 */
export interface HistoryRequestPayload {
  /** Caller-generated nonce; echoed back by iPhone in its reply. */
  requestId: string;
  /** The `exercise.id` (solo) / per-side `exercise.id` (cluster A/B) to fetch history for. */
  exerciseId: string;
}

/**
 * `notes-request` — Watch → iPhone, request-reply (Goal 3a, 2026-06-26).
 * User tapped 備註 on an in-session exercise card's ⋯ menu; the Watch (no
 * SQLite, and the per-EXERCISE global note is too large to ride the Stage 1
 * prefetch — see `loadTemplateExerciseTree` envelope sizing) pulls the single
 * exercise's `exercise.notes` on demand. Same shape as `history-request`; the
 * REPLY is NOT a modelled kind — it rides the `sendMessage` replyHandler ack
 * (shape per `WatchNotesReplyPayload` in `src/adapters/watch/watchNotes.ts`).
 * Display-only on the wrist (拍板 3a: pull-on-tap, mirror #311 history).
 */
export interface NotesRequestPayload {
  /** Caller-generated nonce; echoed back by iPhone in its reply. */
  requestId: string;
  /** The `exercise.id` whose global note to fetch (the per-exercise note pivot). */
  exerciseId: string;
}

/**
 * `start-from-watch` — Watch initiator → iPhone (Q4 channel #1,
 * NEW-Q42 / NEW-Q50). User tapped 計劃訓練 or chose a template on the
 * Watch picker (D8); iPhone reconciles the session row (handled by
 * D9 handshake module). `templateId` may be null when the user picks
 * a freestyle path (no template at all); `programCycleId` /
 * `intensityId` are present only on planned path.
 *
 * NEW-Q50 (2026-05-29) — `sessionId` is now Watch-generated
 * (`UUID().uuidString`) and trusted by the iPhone via `INSERT OR
 * IGNORE` dedup, allowing the Watch to start the in-session UI
 * offline-first without waiting for an iPhone-side ID round-trip.
 * Append-only on the wire — pre-NEW-Q50 senders that omit this
 * field fall back to a synthetic empty string on read; the iPhone
 * orchestrator treats absent / empty sessionId as a wire-version
 * mismatch and degrades gracefully (logged + no-op).
 */
export interface StartFromWatchPayload {
  templateId: string | null;
  programCycleId: string | null;
  intensityId: string | null;
  /** NEW-Q50 — Watch-supplied session id (UUID v4). */
  sessionId: string;
}

/**
 * `start-from-iphone` — iPhone initiator → Watch (Q4 channel #2, Q42).
 * iPhone just created a session (planned or freestyle) and asks Watch
 * to adopt it. Watch hydrates its in-memory mirror from `snapshot`.
 * Wide-shape snapshot (exercises + sets) is OK here because the
 * Watch is the receiver — overflow detection lives in
 * `connectivity.ts` (D3 bridge, future commit), not in this schema.
 */
export interface StartFromIphonePayload {
  sessionId: string;
  /**
   * Minimal session-tree snapshot. Concrete shape (`SessionSnapshot`)
   * lives in `src/adapters/watch/handshake.ts` (D9) to avoid a
   * cyclic import with the SQLite repo layer. Until then it travels
   * as opaque JSON — the protocol layer only commits to
   * "JSON-primitive-clean object", not field-level structure.
   */
  snapshot: Record<string, JsonValue>;
}

/**
 * `cast-session` — iPhone → Watch "投影 Watch / open this session NOW"
 * (2026-06-27). The user is mid-session on the iPhone and presses 投影 Watch
 * to push the running session onto the wrist. Distinct from
 * `start-from-iphone` (which was the never-wired D6/D8 aspiration) and from
 * `live-mirror` (which only PROJECTS onto an already-open Watch session): a
 * `cast-session` tells an idle/picker Watch to NAVIGATE INTO the session,
 * hydrated from `snapshot`. Dual-fired by `pushCastToWatch` over
 * `sendMessage` (instant + ack when reachable → flip is_watch_tracked) AND
 * `sendUserInfo`/TUI (queued backstop — delivered when the Watch app next
 * wakes, so "已送出，手錶開啟後帶入" is literally true). Same wide snapshot
 * shape as `StartFromIphonePayload` so the Watch can reuse its
 * start-from-watch → `SetLoggerView(snapshot:)` swap.
 */
export interface CastSessionPayload {
  sessionId: string;
  /** Full session-tree snapshot (opaque JSON at the protocol layer; concrete
   *  `SessionSnapshot` lives in `handshake.ts`). Mirrors
   *  `StartFromIphonePayload.snapshot`. */
  snapshot: Record<string, JsonValue>;
  /**
   * ADR-0028 — initial edit-token epoch seed (E0). The iPhone is the cast
   * initiator and holds the token (發起方初握); the Watch adopts this epoch and
   * goes LOCKED on receipt. Optional for forward-compat with pre-0028 casts
   * (the Watch falls back to epoch 0 + locked).
   */
  epoch?: number;
}

/**
 * `live-mirror` — Watch → iPhone live-session snapshot (sync fast lane,
 * 2026-06-01). Fires on every in-session mutation (logged ✓ / cell edit /
 * add-remove set / # type-cycle / reorder / delete), coalesced to ≤2/s by
 * a 0.5s window on the Watch producer (`LiveMirrorProducer`).
 *
 * Transport — DUAL-FIRE (Watch `WatchConnectivityCoordinator.updateLiveMirror`):
 *   - `sendMessage` when iPhone `isReachable` — the instant, FIFO-ordered
 *     <1s foreground channel. This is what makes the live mirror actually
 *     live (every intermediate dropset-edit state arrives in order — no
 *     coalescing-induced skipped structural step).
 *   - `updateApplicationContext` always — the background backstop (latest-
 *     state-replace, survives iPhone-backgrounded). NOT a real-time channel.
 *
 * The payload IS the full `SessionSnapshot` dict directly (NOT wrapped in a
 * `snapshot` field — same raw shape the applicationContext path delivers and
 * `parseLiveMirrorSnapshot` / `replaceLiveMirror` consume), so one receiver
 * (`onLiveMirror`) serves both channels. Concrete nested shape lives in
 * `watchLiveMirrorReceiver.ts` (runtime-validated there) to avoid a cyclic
 * import with the SQLite repo layer — hence the loose nested typing here.
 *
 * `rev` is a monotonic ms-since-epoch stamp from the producer; the iPhone
 * keeps a per-session high-water mark and DROPS any snapshot whose
 * `rev <= lastApplied` — this kills the "late appContext clobbers a fresher
 * sendMessage" reorder (a key cause of the 亂七八糟 / dropset scramble).
 */
export interface LiveMirrorPayload {
  sessionId: string;
  title: string;
  /** Epoch ms. */
  startedAt: number;
  /** Opaque session-tree exercises (validated by `parseLiveMirrorSnapshot`). */
  exercises: JsonValue[];
  /** Monotonic revision (ms-since-epoch at emit) — anti-reorder. */
  rev?: number;
  /**
   * ADR-0028 edit-token epoch the SENDER (the current holder) is editing
   * under. Only the holder emits live-mirror, so this stamps every projection
   * with the world-generation that produced it. The receiver applies only when
   * `epoch >= its own`; a STRICTLY-greater epoch means "I've been superseded"
   * → demote to locked + adopt (universal self-heal / force-take detection).
   * Optional for forward-compat with pre-0028 senders (treated as epoch 0).
   */
  epoch?: number;
  /** Which side produced it (echo suppression / forward-compat). */
  originator?: 'watch' | 'iphone';
  /** Tombstones (Phase D precise-purge). */
  deletedIds?: { exerciseIds?: string[]; setIds?: string[] };
}

/**
 * `start-reconcile` — iPhone → Watch reverse-TUI reply to
 * `start-from-watch` (NEW-Q50 Q4 + Q5). Carries the iPhone-side
 * reconciliation outcome:
 *
 *   - `'created'` — Watch-supplied sessionId landed in the iPhone DB
 *     (either first delivery, or idempotent dedup via `INSERT OR
 *     IGNORE`). Watch continues with its standalone session.
 *
 *   - `'conflict'` — iPhone already has a DIFFERENT active session
 *     (first-write-wins per Q5). Payload includes existing session
 *     metadata so the Watch can render the D31 conflict alert sheet
 *     ("您的 iPhone 已有訓練中 [title]；要中止 Watch 端、或...").
 *
 * Sent via `transferUserInfo` (Q4 — fire-and-forget queued TUI).
 * Same shape as the `StartFromWatchReconcile` type used inside the
 * `onStartFromWatch` orchestrator — keeping them as one shared shape
 * (re-exported via `handshake.ts` for test ergonomics).
 */
export type StartReconcilePayload =
  | { status: 'created'; sessionId: string }
  | {
      status: 'conflict';
      sessionId: string;
      existingSessionId: string;
      existingTitle: string;
      existingStartedAt: number;
    };

/**
 * `start-resolve` — Watch → iPhone forward-TUI conflict resolution
 * envelope (D31 / NEW-Q50 Q5 escalation tail). Fires when the user
 * picked "中止 iPhone 保留 Watch" in the conflict alert that landed
 * after a `start-reconcile { status: 'conflict' }` reply.
 *
 * Semantics: "Watch is the new winner. Discard your session row at
 * `existingSessionId` and let my local `localSessionId` take over."
 *
 * iPhone receiver MUST:
 *   - Hard-delete `existingSessionId` via `discardSession` (cascades
 *     set / session_exercise / achievement_unlock / app_settings
 *     edit-mode snapshot in one transaction — see
 *     `src/adapters/sqlite/sessionRepository.ts`).
 *   - Idempotent: if `existingSessionId` already gone, `discardSession`
 *     is a sequence of `DELETE WHERE` no-ops; safe to redeliver.
 *   - NOT touch `localSessionId` — that row may not exist yet (the
 *     original `start-from-watch` envelope can still be in iOS's TUI
 *     queue), or may already have been INSERT OR IGNORE'd by a
 *     prior delivery. Watch is the source of truth for that row;
 *     iPhone's reconcile pipeline (still `start-reconcile`) will
 *     adopt it as normal.
 *
 * Sent via `transferUserInfo` (Q4 — fire-and-forget queued TUI).
 * No reply envelope — Watch UI dismisses the alert immediately,
 * does not block on ack. iPhone delivers when reachable.
 */
export interface StartResolvePayload {
  /** Watch's locally-minted sessionId (the one that won). Diagnostic only — iPhone uses existingSessionId to know what to delete. */
  localSessionId: string;
  /** iPhone's existing-but-losing sessionId. Hard-delete target. */
  existingSessionId: string;
}

/**
 * `set-completed` — either side → other side. User flipped a set's
 * `is_logged` from 0→1 (or 1→0); also carries the committed weight +
 * reps so the receiver can apply without a separate diff round-trip.
 */
export interface SetCompletedPayload {
  sessionId: string;
  setId: string;
  is_logged: boolean;
  weight: number;
  reps: number;
}

/**
 * `set-modified` — either side → other side. Per-field diff merge
 * (NEW-Q43, Option A — in-memory `(setId, field) → ts` last-writer-wins
 * map). Only fields the user actually changed should appear; the
 * receiver applies field-by-field after the LWW map admits the diff.
 *
 * `fieldTs` is a per-field timestamp map keyed by field name. The
 * top-level envelope `ts` is the *send* time; `fieldTs[X]` is the
 * client-side time the user committed that field. They differ when
 * a batch of edits ships in a single envelope.
 */
export interface SetModifiedPayload {
  sessionId: string;
  setId: string;
  /** Sparse — only changed fields appear. */
  diff: {
    weight?: number;
    reps?: number;
    rpe?: number | null;
    rest_sec?: number | null;
    notes?: string | null;
    set_kind?: 'warmup' | 'working' | 'dropset' | 'superset';
  };
  /** Per-field epoch ms; missing field = treat envelope `ts` as the field ts. */
  fieldTs: Record<string, number>;
}

/**
 * `set-deleted` — either side → other side. Receiver removes the set
 * from its in-memory mirror; cluster row (if any) stays per
 * Agent G live-mirror reducer rules.
 */
export interface SetDeletedPayload {
  sessionId: string;
  setId: string;
}

/**
 * `set-added` — either side → other side. Receiver inserts at the
 * given ordinal under the named exercise. `setId` is generated by
 * the sender (uuid) so both sides agree on the identity before the
 * SQLite write lands.
 */
export interface SetAddedPayload {
  sessionId: string;
  sessionExerciseId: string;
  setId: string;
  ordinal: number;
  weight: number;
  reps: number;
  set_kind: 'warmup' | 'working' | 'dropset' | 'superset';
}

/**
 * `exercise-added` — either side → other side. Receiver appends a new
 * session_exercise card. `sessionExerciseId` is sender-generated for
 * the same reason as `set-added.setId`.
 */
export interface ExerciseAddedPayload {
  sessionId: string;
  sessionExerciseId: string;
  exerciseId: string;
  exerciseName: string;
  ordering: number;
  /** Default planned set count (3 per ADR-0019 § Q9 wave 11). */
  plannedSets: number;
}

/**
 * `exercise-deleted` — either side → other side. Receiver removes the
 * card from its mirror; remaining ordinals re-pack on the receiver.
 */
export interface ExerciseDeletedPayload {
  sessionId: string;
  sessionExerciseId: string;
}

/**
 * `hr-tick` — Watch → iPhone (Q4 channel #9, Q14 (c), Q15). 3-5s
 * throttled on the Watch (`LiveTicksProducer.swift`). Latest-wins;
 * envelope `ts` orders against prior tick.
 *
 * Transport (point2 live-sync, 2026-06-12 — supersedes the original
 * D-planning note that said applicationContext): `sendMessage` when
 * reachable ONLY. The Watch→iPhone applicationContext slot is owned by
 * the live-mirror raw `SessionSnapshot` backstop (sync fast lane
 * 2026-06-01) — a tick pushed there would clobber it; and TUI is out
 * per the live-kind rule (a durable queue replaying stale HR minutes
 * later is worse than dropping — a missed tick self-heals on the next
 * 3-5s emit). Receiver: `watchLiveTicksReceiver.ts` (display-only
 * React state, no DB).
 */
export interface HrTickPayload {
  sessionId: string;
  bpm: number;
  /** Original HK sample time (may lag envelope `ts` by throttle window). */
  sampleTs: number;
}

/**
 * `kcal-tick` — Watch → iPhone (Q4 channel #10, Q14 (c)). Same
 * throttle + transport as `hr-tick` (sendMessage-when-reachable only —
 * see `HrTickPayload` doc); cumulative ACTIVE kcal since session start.
 */
export interface KcalTickPayload {
  sessionId: string;
  kcal: number;
  sampleTs: number;
}

/**
 * `end-session` — either side → other side (Q10, NEW-Q45). Sender
 * declares "I am finalizing this session on `side`"; the receiver runs
 * its own finalize + clears in-memory mirror. iPhone additionally arms a
 * 5-sec reconcile timeout (per ADR-0019 § Q23) — if Watch never ack'd,
 * flip `is_watch_tracked` to false.
 *
 * Slice 13d WC ship-blocker fix (E1/E2, grill 2026-05-30, Q1/Q2/Q4):
 * a Watch-led end now carries an authoritative `endedAt` + final
 * `snapshot` so the iPhone can finalize at the TRUE finish time AND
 * reconcile-by-membership (purge rows the Watch deleted) in one txn —
 * see `finalizeEndAndRoute` + `reconcileAndPurgeToSnapshot`. Both new
 * fields are OPTIONAL so a pre-fix iPhone-led end (`side: 'iphone'`,
 * which finalizes locally and needs no snapshot) and any legacy sender
 * still type-check; the receiver degrades gracefully (Q3/Q4 fail-safe):
 *   - `endedAt` absent → receiver falls back to its own `Date.now()`.
 *   - `snapshot` absent → receiver finalizes ONLY, skips the purge.
 */
export interface EndSessionPayload {
  sessionId: string;
  side: 'iphone' | 'watch';
  /**
   * Q4 (E1) — authoritative end timestamp from the SENDER's clock
   * (epoch ms). The receiver writes this as `session.ended_at` instead
   * of its own receive-time, so a Watch-led end delivered LATE via
   * `transferUserInfo` (iPhone was backgrounded / locked / out of range)
   * still records the real finish moment + the correct HK
   * `[started_at, ended_at]` kcal/HR window. Watch & paired iPhone
   * clocks are pairing-synced so skew is negligible.
   */
  endedAt?: number;
  /**
   * Q1+Q2 (E2) — final authoritative session-tree snapshot the receiver
   * reconciles against (membership purge + finalize in one txn). Same
   * opaque-JSON shape as `StartFromIphonePayload.snapshot` (concrete
   * `SessionSnapshot` lives in `handshake.ts`; the receiver re-validates
   * it via `parseLiveMirrorSnapshot` — NOT here — which is the Q3
   * guarded-purge gate: a malformed / suspiciously-empty snapshot drops
   * to finalize-only rather than wiping real data).
   */
  snapshot?: Record<string, JsonValue>;
}

/**
 * `discard-session` — Watch → iPhone forward-TUI abort envelope (D31 wave 2,
 * 2026-05-29 late). Fired when the user taps [放棄] in FinishPageView,
 * the explicit "this session never happened" path. iPhone receiver
 * hard-deletes the row via `discardSession` (cascades through
 * achievement_unlock + set + session_exercise + app_settings
 * edit-snapshot in one txn — same code as start-resolve uses).
 *
 * Semantic vs `end-session`:
 *   - `end-session` → iPhone calls `finalizeEndAndRoute` which sets
 *     `ended_at` and preserves the row in history. Session shows up
 *     under History tab.
 *   - `discard-session` → iPhone calls `discardSession` which DELETES
 *     the row entirely. Nothing in history. User's intent: "scrap it".
 *
 * Side discriminator mirrors `EndSessionPayload`. iPhone receiver
 * filters `side === 'watch'` to ignore its own outbound (defensive;
 * iPhone-initiated discard is a different path entirely, not yet
 * wired). Watch only ever sends `side: 'watch'`.
 *
 * Sent via `transferUserInfo` (Q4 — fire-and-forget queued TUI).
 * Same ordering guarantee as start-resolve: iOS FIFO TUI delivery
 * preserves causality with any prior `start-from-watch` envelope
 * (Watch creates session → user abandons → iPhone processes start
 * first, then discard — no zombie row).
 */
export interface DiscardSessionPayload {
  sessionId: string;
  side: 'iphone' | 'watch';
}

/**
 * `settings-sync` — iPhone → Watch (Q4 channel #12, NEW-Q39).
 * Transient per-session settings (e.g. unit display, RPE visibility);
 * cleared when the session ends. Schemaless on purpose — each key
 * carries its own JSON-primitive value.
 */
export interface SettingsSyncPayload {
  sessionId: string;
  settings: Record<string, JsonPrimitive | JsonPrimitive[]>;
}

// ---------------------------------------------------------------------
// Section 2b — Edit-token lock kinds (ADR-0028)
// ---------------------------------------------------------------------
//
// Cast pairing mutual-exclusion lock. Exactly one side holds the edit token
// at a time (the holder edits + pushes one-way live-mirror); the other is a
// read-only mirror with a lock overlay + unlock button. A monotonic `epoch`
// arbitrates every transfer. Transfer = 3-step handshake
// (lock-request → lock-grant → lock-ack); an unreachable holder is resolved by
// the requester's REQUEST timeout (force-take → lock-takeover, or keep-lock).
// A stale requester (epoch behind) gets re-locked at the current epoch via
// lock-sync. See ADR-0028 for the full state machine + invariants.

/**
 * `lock-request` — locked side → holder. "I want the edit token." Carries the
 * requester's currently-known `epoch` so the holder can detect a stale request
 * (request.epoch < holder.epoch → reply lock-sync instead of granting).
 */
export interface LockRequestPayload {
  sessionId: string;
  /** Requester's currently-known token epoch. */
  epoch: number;
}

/**
 * `lock-grant` — holder → requester. "You may have it; here is my final state;
 * I'm handing over." `epoch` is the NEW generation (old + 1) the requester
 * adopts on becoming holder. `snapshot` is the holder's flushed final state so
 * the new holder is guaranteed up-to-date before editing (確保已經更新). The
 * granter goes LOCKED only after it receives the matching lock-ack.
 */
export interface LockGrantPayload {
  sessionId: string;
  /** New epoch (previous + 1) the requester adopts. */
  epoch: number;
  /** Holder's flushed final session-tree snapshot (opaque JSON; concrete
   *  `SessionSnapshot` in `handshake.ts`). Mirrors `CastSessionPayload.snapshot`. */
  snapshot: Record<string, JsonValue>;
}

/**
 * `lock-ack` — requester (now holder) → granter. "Got it, I'm holder at
 * `epoch` now." On receipt the granter transitions to LOCKED. If the granter
 * never receives an ack it stays in OFFERING until its ack-timeout, then
 * reverts to HOLDER (transfer failed); the epoch rule self-heals any transient
 * double-holder on the next message.
 */
export interface LockAckPayload {
  sessionId: string;
  /** The epoch the new holder adopted (echoes the grant). */
  epoch: number;
}

/**
 * `lock-takeover` — new holder → old (unreachable) holder. Best-effort notice
 * that the requester force-took the token at `epoch` after the holder failed to
 * grant within the REQUEST timeout. The old holder demotes to LOCKED on receipt
 * (or on the next live-mirror, which also carries the higher epoch). Carries no
 * snapshot — the force-taker could not obtain the holder's final state (the
 * accepted data-loss cost of force-take).
 */
export interface LockTakeoverPayload {
  sessionId: string;
  /** The new epoch the force-taker claimed. */
  epoch: number;
}

/**
 * `lock-sync` — holder → a stale requester. Sent when a lock-request arrives
 * with `epoch < holder.epoch` (the requester missed a prior transfer). Re-locks
 * the requester at the current generation with the holder's current snapshot,
 * instead of granting. Keeps both ends converged without an extra round-trip.
 */
export interface LockSyncPayload {
  sessionId: string;
  /** Holder's current token epoch. */
  epoch: number;
  /** Holder's current session-tree snapshot (opaque JSON). */
  snapshot: Record<string, JsonValue>;
}

// ---------------------------------------------------------------------
// Section 3 — JSON-value helpers (Q6 wire-format constraint)
// ---------------------------------------------------------------------

/**
 * The set of values WatchConnectivity actually round-trips cleanly.
 * `undefined` is excluded on purpose — `JSON.stringify` drops it; if
 * a sender means "missing field", the field must be absent or `null`.
 */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

// ---------------------------------------------------------------------
// Section 4 — Envelope + discriminated union
// ---------------------------------------------------------------------

/**
 * Wire envelope. `kind` is the discriminator; `payload` is narrowed
 * by the kind via `WCMessage` below.
 *
 * `msgId` invariant: globally unique across both ends per
 * session-lifetime. Senders generate via `crypto.randomUUID()` (or
 * a per-end equivalent). Receiver dedupe = ring buffer of ≥256 slots
 * keyed by `msgId` (per ADR-0019 § Q7).
 */
export interface WCEnvelope<K extends WCMessageKind, P> {
  msgId: string;
  /** Epoch ms — the send time on the originating device. */
  ts: number;
  kind: K;
  payload: P;
}

/**
 * Discriminated union of all 17 envelope shapes. TypeScript narrows
 * `payload` automatically when you switch on `kind`.
 */
export type WCMessage =
  | WCEnvelope<'handshake', HandshakePayload>
  | WCEnvelope<'start-from-watch', StartFromWatchPayload>
  | WCEnvelope<'start-from-iphone', StartFromIphonePayload>
  | WCEnvelope<'start-reconcile', StartReconcilePayload>
  | WCEnvelope<'start-resolve', StartResolvePayload>
  | WCEnvelope<'set-completed', SetCompletedPayload>
  | WCEnvelope<'set-modified', SetModifiedPayload>
  | WCEnvelope<'set-deleted', SetDeletedPayload>
  | WCEnvelope<'set-added', SetAddedPayload>
  | WCEnvelope<'exercise-added', ExerciseAddedPayload>
  | WCEnvelope<'exercise-deleted', ExerciseDeletedPayload>
  | WCEnvelope<'hr-tick', HrTickPayload>
  | WCEnvelope<'kcal-tick', KcalTickPayload>
  | WCEnvelope<'live-mirror', LiveMirrorPayload>
  | WCEnvelope<'cast-session', CastSessionPayload>
  | WCEnvelope<'end-session', EndSessionPayload>
  | WCEnvelope<'discard-session', DiscardSessionPayload>
  | WCEnvelope<'settings-sync', SettingsSyncPayload>
  | WCEnvelope<'history-request', HistoryRequestPayload>
  | WCEnvelope<'notes-request', NotesRequestPayload>
  | WCEnvelope<'lock-request', LockRequestPayload>
  | WCEnvelope<'lock-grant', LockGrantPayload>
  | WCEnvelope<'lock-ack', LockAckPayload>
  | WCEnvelope<'lock-takeover', LockTakeoverPayload>
  | WCEnvelope<'lock-sync', LockSyncPayload>;

// ---------------------------------------------------------------------
// Section 5 — Per-kind payload lookup (compile-time, used by factory)
// ---------------------------------------------------------------------

/**
 * Compile-time map from kind to its payload type. Lets `makeEnvelope`
 * type-check the second argument against the first.
 */
export interface WCPayloadMap {
  handshake: HandshakePayload;
  'start-from-watch': StartFromWatchPayload;
  'start-from-iphone': StartFromIphonePayload;
  'start-reconcile': StartReconcilePayload;
  'start-resolve': StartResolvePayload;
  'set-completed': SetCompletedPayload;
  'set-modified': SetModifiedPayload;
  'set-deleted': SetDeletedPayload;
  'set-added': SetAddedPayload;
  'exercise-added': ExerciseAddedPayload;
  'exercise-deleted': ExerciseDeletedPayload;
  'hr-tick': HrTickPayload;
  'kcal-tick': KcalTickPayload;
  'live-mirror': LiveMirrorPayload;
  'cast-session': CastSessionPayload;
  'end-session': EndSessionPayload;
  'discard-session': DiscardSessionPayload;
  'settings-sync': SettingsSyncPayload;
  'history-request': HistoryRequestPayload;
  'notes-request': NotesRequestPayload;
  'lock-request': LockRequestPayload;
  'lock-grant': LockGrantPayload;
  'lock-ack': LockAckPayload;
  'lock-takeover': LockTakeoverPayload;
  'lock-sync': LockSyncPayload;
}

// ---------------------------------------------------------------------
// Section 6 — Type guards
// ---------------------------------------------------------------------

/**
 * Narrow a `string` to a known kind. Used by `connectivity.ts` (D3
 * bridge) before dispatching an inbound message to its handler.
 */
export function isWCMessageKind(value: unknown): value is WCMessageKind {
  return (
    typeof value === 'string' &&
    (WC_MESSAGE_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Shallow shape check for an envelope. Does NOT validate payload
 * fields — the receiver handler is responsible for per-kind payload
 * validation (or, more sustainably, the receiver lifts the parsed
 * object through one of the per-kind narrowers below).
 */
export function isWCEnvelope(value: unknown): value is WCMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.msgId === 'string' &&
    v.msgId.length > 0 &&
    typeof v.ts === 'number' &&
    Number.isFinite(v.ts) &&
    isWCMessageKind(v.kind) &&
    typeof v.payload === 'object' &&
    v.payload !== null
  );
}

// ---------------------------------------------------------------------
// Section 7 — Date-to-epoch normalisation (Q6 rule 2)
// ---------------------------------------------------------------------

/**
 * Walks a payload object and replaces any `Date` it finds with the
 * equivalent epoch ms. Pure, non-mutating. Used by `makeEnvelope` so
 * call-sites can pass `Date` ergonomically while the wire stays
 * JSON-primitive.
 *
 * Rejection rules (matches Q6):
 *   - `undefined` → throws (would silently drop on stringify).
 *   - `function` / `symbol` → throws.
 *   - `Map` / `Set` → throws (stringify renders as `{}`).
 *
 * `null`, plain arrays, and plain object literals pass through;
 * `Date` is converted; everything else (primitives) passes through.
 */
export function normaliseForWire<T>(payload: T): JsonValue {
  return walk(payload);
}

function walk(value: unknown): JsonValue {
  if (value === null) return null;
  if (value instanceof Date) return value.getTime();
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') {
    return value as JsonPrimitive;
  }
  if (t === 'undefined') {
    throw new TypeError(
      'WC payload cannot contain `undefined` — use `null` or omit the field',
    );
  }
  if (t === 'function' || t === 'symbol') {
    throw new TypeError(`WC payload cannot contain ${t}`);
  }
  if (Array.isArray(value)) {
    return value.map(walk);
  }
  if (value instanceof Map || value instanceof Set) {
    throw new TypeError('WC payload cannot contain Map / Set');
  }
  // Plain object: walk own enumerable keys, drop nothing.
  const out: Record<string, JsonValue> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = walk(v);
  }
  return out;
}

// ---------------------------------------------------------------------
// Section 8 — Envelope factory
// ---------------------------------------------------------------------

/**
 * Monotonic counter for the in-process `msgId` fallback. Real msgIds
 * should come from `crypto.randomUUID()` — we use it when available
 * (Node 19+, watchOS 10+) and fall back to a counter + epoch suffix
 * otherwise. Either way the value is unique within this process.
 */
let envelopeCounter = 0;

function generateMsgId(): string {
  // Prefer crypto.randomUUID when available (Node 19+, JSC iOS 17+,
  // RN 0.74+). We do NOT import 'crypto' to keep this file
  // bundler-friendly under both Hermes and ts-jest.
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto && typeof g.crypto.randomUUID === 'function') {
    return g.crypto.randomUUID();
  }
  envelopeCounter += 1;
  return `wc-${Date.now()}-${envelopeCounter}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Build a fully-typed envelope. The `kind` literal narrows the
 * payload parameter to the matching per-kind interface (TS error if
 * shape doesn't fit). `Date` instances inside `payload` are
 * transparently converted to epoch ms; `undefined` / `function` /
 * `Map` / `Set` throw at runtime so callers find out before the
 * envelope hits the WC bridge.
 *
 * The returned object is JSON-stringify-safe — `JSON.parse(JSON.stringify(env))`
 * round-trips structurally.
 */
export function makeEnvelope<K extends WCMessageKind>(
  kind: K,
  payload: WCPayloadMap[K],
): WCEnvelope<K, WCPayloadMap[K]> {
  const normalised = normaliseForWire(payload) as unknown as WCPayloadMap[K];
  return {
    msgId: generateMsgId(),
    ts: Date.now(),
    kind,
    payload: normalised,
  };
}

/** Test-only: reset the in-process counter so suite ordering is stable. */
export function __resetEnvelopeCounterForTests(): void {
  envelopeCounter = 0;
}
