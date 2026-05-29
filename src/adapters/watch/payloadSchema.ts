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
 * The 13 message kinds come straight from ADR-0019 § Slice 13d
 * Amendment table + Agent F codebase inventory (D3 section + the kinds
 * referenced by D5-D24). See per-kind doc-comments below for the
 * decision that introduced each kind.
 */

// ---------------------------------------------------------------------
// Section 1 — Kind enumeration
// ---------------------------------------------------------------------

/**
 * The 13 message kinds. Order here mirrors the table in
 * ADR-0019 § Slice 13d Amendment for grep-ability. New kinds are
 * forbidden without an ADR amendment — the kind set is the cross-end
 * API contract.
 */
export type WCMessageKind =
  | 'handshake'
  | 'start-from-watch'
  | 'start-from-iphone'
  | 'set-completed'
  | 'set-modified'
  | 'set-deleted'
  | 'set-added'
  | 'exercise-added'
  | 'exercise-deleted'
  | 'hr-tick'
  | 'kcal-tick'
  | 'end-session'
  | 'settings-sync';

/**
 * All 13 kinds as a frozen tuple — used by the type guard, jest
 * `it.each` tables, and the Swift mirror generator (D4/D5). Keep in
 * sync with `WCMessageKind` literal union above.
 */
export const WC_MESSAGE_KINDS = [
  'handshake',
  'start-from-watch',
  'start-from-iphone',
  'set-completed',
  'set-modified',
  'set-deleted',
  'set-added',
  'exercise-added',
  'exercise-deleted',
  'hr-tick',
  'kcal-tick',
  'end-session',
  'settings-sync',
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
 * throttled via `applicationContext` (per ADR-0019 NEW design rule —
 * not `sendMessage`; this protocol-layer type doesn't care about the
 * transport). Latest-wins; envelope `ts` orders against prior tick.
 */
export interface HrTickPayload {
  sessionId: string;
  bpm: number;
  /** Original HK sample time (may lag envelope `ts` by throttle window). */
  sampleTs: number;
}

/**
 * `kcal-tick` — Watch → iPhone (Q4 channel #10, Q14 (c)). Same
 * throttle + transport as `hr-tick`; cumulative kcal since session
 * start.
 */
export interface KcalTickPayload {
  sessionId: string;
  kcal: number;
  sampleTs: number;
}

/**
 * `end-session` — either side → other side (Q10, NEW-Q45). Sender
 * declares "I am finalizing this session at `ts` on `side`"; the
 * receiver runs its own finalize + clears in-memory mirror. iPhone
 * additionally arms a 5-sec reconcile timeout (per ADR-0019 § Q23) —
 * if Watch never ack'd, flip `is_watch_tracked` to false.
 */
export interface EndSessionPayload {
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
 * Discriminated union of all 13 envelope shapes. TypeScript narrows
 * `payload` automatically when you switch on `kind`.
 */
export type WCMessage =
  | WCEnvelope<'handshake', HandshakePayload>
  | WCEnvelope<'start-from-watch', StartFromWatchPayload>
  | WCEnvelope<'start-from-iphone', StartFromIphonePayload>
  | WCEnvelope<'set-completed', SetCompletedPayload>
  | WCEnvelope<'set-modified', SetModifiedPayload>
  | WCEnvelope<'set-deleted', SetDeletedPayload>
  | WCEnvelope<'set-added', SetAddedPayload>
  | WCEnvelope<'exercise-added', ExerciseAddedPayload>
  | WCEnvelope<'exercise-deleted', ExerciseDeletedPayload>
  | WCEnvelope<'hr-tick', HrTickPayload>
  | WCEnvelope<'kcal-tick', KcalTickPayload>
  | WCEnvelope<'end-session', EndSessionPayload>
  | WCEnvelope<'settings-sync', SettingsSyncPayload>;

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
  'set-completed': SetCompletedPayload;
  'set-modified': SetModifiedPayload;
  'set-deleted': SetDeletedPayload;
  'set-added': SetAddedPayload;
  'exercise-added': ExerciseAddedPayload;
  'exercise-deleted': ExerciseDeletedPayload;
  'hr-tick': HrTickPayload;
  'kcal-tick': KcalTickPayload;
  'end-session': EndSessionPayload;
  'settings-sync': SettingsSyncPayload;
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
