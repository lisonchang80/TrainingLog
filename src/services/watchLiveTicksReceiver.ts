/**
 * point2 live-sync (2026-06-12) — iPhone `hr-tick` / `kcal-tick` receiver.
 *
 * Per ADR-0019 Q4 channels #9/#10 (payload types `HrTickPayload` /
 * `KcalTickPayload` shipped in `payloadSchema.ts` since D3; both ends
 * were zero-wired until now). The Watch streams its HKLiveWorkoutBuilder
 * readings (`SessionController.streamedStats`, D17) through a 3-5s
 * throttle (`LiveTicksProducer.swift`) into per-kind `sendMessage`
 * envelopes; this module is the iPhone-side pure state layer that the
 * in-session 5-tile `SessionStatsPanel` (❤️ 心率 / 🔥 大卡) reads.
 *
 * Transport reality (deviation from the original D-planning comment in
 * `payloadSchema.ts`, which said applicationContext): ticks ride
 * `sendMessage`-when-reachable ONLY.
 *   - applicationContext is a SINGLE latest-state slot per direction and
 *     has been owned by the live-mirror raw `SessionSnapshot` dict since
 *     the 2026-06-01 sync fast lane — an envelope-shaped tick pushed
 *     there would clobber the structural backstop AND land in
 *     `onLiveMirror` as a bad payload.
 *   - TUI is out per the live-kind rule (skill `wc-add-envelope-kind`):
 *     a durable FIFO queue replaying stale HR ticks minutes later is
 *     strictly worse than dropping them — a missed tick self-heals on
 *     the next 3-5s emit.
 *
 * Design notes:
 *   - NO database writes. Ticks are display-only ephemera; persisting
 *     them would re-open the live-tick-resurrects-discarded-session
 *     hazard (live-mirror audit H1) for zero benefit. State lives in a
 *     React `useState` in `app/(tabs)/index.tsx`; this module owns the
 *     pure reducers so the logic is unit-testable under node (no
 *     orchestrator/DB layer needed — contrast `watchLiveMirrorReceiver`).
 *   - NEVER throws. A malformed envelope returns the previous state
 *     object UNCHANGED (same reference), so React's setState bails out
 *     of re-rendering.
 *   - Out-of-order guard: `sendMessage` is FIFO per channel, but a
 *     queued backlog can in principle deliver late. Each metric keeps
 *     the envelope `ts` of its last applied tick and drops anything
 *     `<=` it (per the payloadSchema doc: "envelope `ts` orders against
 *     prior tick"). The guard is per-metric — an hr-tick never blocks a
 *     kcal-tick.
 *   - Session switch: a tick for a DIFFERENT sessionId replaces the
 *     whole state (only one live session exists at a time; the newest
 *     tick's session is by definition the current one). The render-side
 *     projection (`liveTicksForSession`) additionally gates on the
 *     iPhone's own active session id, so a stale tick from a just-ended
 *     session can never paint onto a new session's tiles.
 *   - Staleness on producer death (Watch app killed mid-session) is
 *     accepted: the tile freezes at the last received value until the
 *     session ends (panel unmounts). A liveness timeout would need a
 *     clock tick in the parent for marginal value — deferred.
 */

/**
 * Latest Watch live readings, single value per metric (latest-wins).
 * `null` metric = no tick of that kind received yet for this session.
 * `bpmTs` / `kcalTs` are envelope-`ts` high-water marks (epoch ms on the
 * Watch's clock); `0` = none applied yet.
 */
export interface WatchLiveTicks {
  sessionId: string;
  bpm: number | null;
  bpmTs: number;
  kcal: number | null;
  kcalTs: number;
}

/** What the 5-tile panel consumes — see `liveTicksForSession`. */
export interface LiveTickProjection {
  bpm: number | null;
  kcal: number | null;
}

const EMPTY_PROJECTION: LiveTickProjection = { bpm: null, kcal: null };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Runtime-validate one inbound tick envelope down to the fields we use.
 * The bridge types `env` via `WCPayloadMap`, but the wire shape is
 * untrusted (a foreign/buggy producer must not poison React state) —
 * same defensive stance as `parseLiveMirrorSnapshot`.
 *
 * `minExclusive` encodes the per-metric sanity floor: bpm must be > 0
 * (a 0-bpm reading is sensor garbage), kcal may be exactly 0 (session
 * just started — cumulative-since-start per the payload spec).
 */
function parseTick(
  env: unknown,
  valueField: 'bpm' | 'kcal',
): { sessionId: string; value: number; ts: number } | null {
  if (!isRecord(env)) return null;
  const { ts, payload } = env;
  if (!isFiniteNumber(ts)) return null;
  if (!isRecord(payload)) return null;
  const sessionId = payload.sessionId;
  if (typeof sessionId !== 'string' || sessionId.length === 0) return null;
  const value = payload[valueField];
  if (!isFiniteNumber(value)) return null;
  if (valueField === 'bpm' ? value <= 0 : value < 0) return null;
  return { sessionId, value, ts };
}

/**
 * Apply an inbound `hr-tick` envelope to the current tick state.
 * Returns `prev` (same reference — setState no-op) when the envelope is
 * malformed or stale; otherwise a new state object.
 */
export function applyHrTick(
  prev: WatchLiveTicks | null,
  env: unknown,
): WatchLiveTicks | null {
  const tick = parseTick(env, 'bpm');
  if (!tick) return prev;
  if (prev && prev.sessionId === tick.sessionId) {
    if (tick.ts <= prev.bpmTs) return prev; // stale / duplicate — drop
    return { ...prev, bpm: tick.value, bpmTs: tick.ts };
  }
  // First tick ever, or a new session — start fresh (the other metric
  // resets to null rather than inheriting a previous session's value).
  return {
    sessionId: tick.sessionId,
    bpm: tick.value,
    bpmTs: tick.ts,
    kcal: null,
    kcalTs: 0,
  };
}

/**
 * Apply an inbound `kcal-tick` envelope. Same contract as `applyHrTick`;
 * `kcal` is cumulative active energy since session start (latest-wins).
 */
export function applyKcalTick(
  prev: WatchLiveTicks | null,
  env: unknown,
): WatchLiveTicks | null {
  const tick = parseTick(env, 'kcal');
  if (!tick) return prev;
  if (prev && prev.sessionId === tick.sessionId) {
    if (tick.ts <= prev.kcalTs) return prev; // stale / duplicate — drop
    return { ...prev, kcal: tick.value, kcalTs: tick.ts };
  }
  return {
    sessionId: tick.sessionId,
    bpm: null,
    bpmTs: 0,
    kcal: tick.value,
    kcalTs: tick.ts,
  };
}

/**
 * Project tick state onto the session the iPhone currently shows.
 * Anything from another session (or no ticks at all) renders as
 * `{bpm: null, kcal: null}` → the panel's '—' fallback. This is the
 * second gate behind the reducer-level session replace: it covers the
 * window where the iPhone's active session changed but no fresh tick
 * has arrived yet.
 */
export function liveTicksForSession(
  ticks: WatchLiveTicks | null,
  sessionId: string | null,
): LiveTickProjection {
  if (!ticks || !sessionId || ticks.sessionId !== sessionId) {
    return EMPTY_PROJECTION;
  }
  return { bpm: ticks.bpm, kcal: ticks.kcal };
}
