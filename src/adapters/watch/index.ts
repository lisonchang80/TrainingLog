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
  SetCompletedPayload,
  SetModifiedPayload,
  SetDeletedPayload,
  SetAddedPayload,
  ExerciseAddedPayload,
  ExerciseDeletedPayload,
  HrTickPayload,
  KcalTickPayload,
  EndSessionPayload,
  SettingsSyncPayload,
} from './payloadSchema';

export { createLwwMap, clearLwwMap, admitDiff } from './setModifiedReducer';
export type { LwwMap, AdmitDiffResult, DiffField } from './setModifiedReducer';

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
} from './connectivity';
export type { SendResult, SendOptions } from './connectivity';
