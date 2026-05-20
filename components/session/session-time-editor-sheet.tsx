/**
 * SessionTimeEditorSheet — bottom sheet for editing a session's
 * started_at / ended_at timestamps. Reached via tap on the 訓練時間
 * tile in session detail page edit mode (ADR-0019 § history edit).
 *
 * Stub for Agent B in overnight #60. Real implementation: two
 * DateTimePicker (started_at, ended_at) + live duration preview +
 * validation (started_at < ended_at) + save callback.
 */
import React from 'react';

export interface SessionTimeEditorSheetProps {
  visible: boolean;
  started_at_ms: number;
  ended_at_ms: number;
  onSave: (args: {
    started_at_ms: number;
    ended_at_ms: number;
  }) => void | Promise<void>;
  onClose: () => void;
}

export function SessionTimeEditorSheet(
  _props: SessionTimeEditorSheetProps,
): React.ReactNode {
  return null;
}

export default SessionTimeEditorSheet;
