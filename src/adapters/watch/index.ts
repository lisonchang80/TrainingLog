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
} from './handshake';
export type {
  Stage1ReplyPayload,
  Stage1SessionSummary,
  Stage1TemplateSummary,
  SessionSnapshot,
  SessionSnapshotExercise,
  SessionSnapshotSet,
} from './handshake';
