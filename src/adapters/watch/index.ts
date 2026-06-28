/**
 * Watch adapter — slice 13d (ADR-0019 § Slice 13d Amendment).
 *
 * Single import surface for WatchConnectivity (WC) protocol + bridge.
 * Slice 13d D3 ships the protocol-only half (this file's exports);
 * later D3 commits add `connectivity.ts` (the lazy-require wrapper
 * around `react-native-watch-connectivity`).
 */

export {
  WC_MESSAGE_KINDS,
  isWCMessageKind,
  isWCEnvelope,
  makeEnvelope,
  normaliseForWire,
  __resetEnvelopeCounterForTests,
} from './payloadSchema';

export type {
  WCMessageKind,
  WCEnvelope,
  WCMessage,
  WCPayloadMap,
  JsonPrimitive,
  JsonValue,
  HandshakePayload,
  StartFromWatchPayload,
  StartFromIphonePayload,
  StartReconcilePayload,
  StartResolvePayload,
  SetCompletedPayload,
  SetModifiedPayload,
  SetDeletedPayload,
  SetAddedPayload,
  ExerciseAddedPayload,
  ExerciseDeletedPayload,
  HrTickPayload,
  KcalTickPayload,
  LiveMirrorPayload,
  CastSessionPayload,
  EndSessionPayload,
  DiscardSessionPayload,
  SettingsSyncPayload,
  LockRequestPayload,
  LockGrantPayload,
  LockAckPayload,
  LockTakeoverPayload,
  LockSyncPayload,
} from './payloadSchema';

// ADR-0028 — cast edit-token mutual-exclusion lock (pure state machine).
export {
  initialEditLockState,
  reduceEditLock,
  canEdit,
  isLockedOut,
} from './editLock';
export type {
  EditLockRole,
  EditLockStatus,
  EditLockState,
  EditLockEvent,
  EditLockEffect,
  EditLockResult,
  LockMessageKind,
} from './editLock';

// NEW-Q50 (2026-05-29) — removed by D19-C: per-field LWW (`admitDiff` /
// `createLwwMap` / `clearLwwMap` / `LwwMap` / `AdmitDiffResult` /
// `DiffField`) deleted along with `setModifiedReducer.ts`. iPhone-side
// reconcile is now snapshot-replace via `replaceLiveMirror`; LWW
// concept moved to Watch Swift in-memory state (wave D29).

export {
  buildStage1Reply,
  buildStartFromIphone,
  matchesPendingRequest,
  // D9 wire-in — impure DB helpers + orchestrators
  fetchSessionSnapshot,
  loadActiveSessionSummary,
  // NEW-Q50 D28 — fat-tree replacement for the pre-Q50 thin prefetch.
  loadTemplatesFullTree, // changed by D28-A (was loadTemplatePrefetchList)
  onHandshakeRequest,
  onStartFromWatch,
} from './handshake';
export type {
  Stage1ReplyPayload,
  Stage1ReplyPrefetch,
  Stage1SessionSummary,
  // NEW-Q50 D28 — fat-tree types (Stage1TemplateSummary removed by D28-A).
  Stage1TemplateExercise,
  Stage1TemplateFullSummary,
  // 2026-05-29 SetLogger sets[] fix — per-template_set wire shape.
  Stage1TemplateSet,
  StartFromWatchReconcile,
  SessionSnapshot,
  SessionSnapshotExercise,
  SessionSnapshotSet,
} from './handshake';

export {
  // Legacy v1 surface (slated 砍除 once Wave 2 wire-in completes, per
  // NEW-Q50 Q8 hard break). Kept for current `watchSessionStart.ts` +
  // `watchSessionEnd.ts` callers + their tests.
  sendMessage,
  isPaired,
  isReachable,
  updateApplicationContext,
  addMessageListener,
  seenMsgId,
  __resetBridgeForTests,
  // NEW-Q50 v2 surface — TUI + applicationContext primary transport
  // (added by D6-B 2026-05-29 evening, ADR-0019 § Slice 13d NEW-Q50).
  // D9 Wave 2 wire-in will adopt these as sole transport.
  sendUserInfo,
  addUserInfoListener,
  updateAppContext,
  addAppContextListener,
  // #287 Fix C (2026-06-02) — eager bridge mount at app entry. Called once
  // from app/_layout.tsx so the singleton RCTEventEmitter has observers
  // (hasObservers=YES + pendingEvents flush) before the Watch's first
  // envelope arrives on a Release standalone cold boot.
  initWatchBridge,
  __isBridgeMountedForTests,
} from './connectivity';
export type { SendResult, SendOptions } from './connectivity';

// NEW-Q50 D33 (2026-05-30 overnight) — pure Watch sync-status logic
// (SyncState + 30s stuck threshold, ADR-0019 § Slice 13d NEW-Q50 Q7). The
// ⏳ corner indicator + end-fail hint banner SwiftUI views are device-gated
// morning work; this is the testable core they read from.
export {
  computeSyncState,
  shouldShowPendingIndicator,
  DEFAULT_STUCK_THRESHOLD_MS,
} from './syncStatus';
export type { SyncState, SyncStatusInput } from './syncStatus';

// #311-A (2026-06-09 grill) — Watch 📊 exercise-history pull-on-tap handler.
// Request-reply mirror of onHandshakeRequest; reply is formatted display-ready
// (unit + locale resolved iPhone-side) via the pure builder in
// src/domain/watch/watchExerciseHistory.ts. ADR-0019 § Slice 13d D15.
export { onHistoryRequest } from './watchHistory';
export type { WatchHistoryReplyPayload } from './watchHistory';

// Goal 3a (2026-06-26) — Watch 備註 pull-on-tap handler. Same request-reply
// mirror as onHistoryRequest; reads the per-exercise global note (exercise.notes)
// on demand because the Stage 1 prefetch can't carry it (envelope cap).
export { onNotesRequest } from './watchNotes';
export type { WatchNotesReplyPayload } from './watchNotes';
