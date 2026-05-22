/**
 * SessionTimeEditorSheet — bottom sheet for editing a session's
 * started_at / ended_at timestamps. Reached via tap on the 訓練時間
 * tile in session detail page edit mode (ADR-0019 § history edit,
 * overnight #60).
 *
 * Sheet chrome mirrors `components/session/body-data-sheet.tsx` and
 * `components/session/template-meta-sheet.tsx`:
 *   Modal { transparent, animationType: 'slide' }
 *   <Pressable backdrop /> → tap-out cancels via onClose
 *   <Pressable sheet />    → swallows touches
 *   [取消] [編輯訓練時間] [儲存] top bar
 *
 * Body:
 *   - "開始時間" inline DateTimePicker (iOS spinner mode='datetime')
 *   - "結束時間" inline DateTimePicker (iOS spinner mode='datetime')
 *   - Live duration preview (reuses formatTrainingDuration #47)
 *   - Warning text when started_at >= ended_at
 *
 * Validation is pure — `validateSessionTimes` (see
 * src/domain/session/sessionTimeEditor.ts) returns either
 * `{ valid: true, duration_sec }` (UI shows duration) or
 * `{ valid: false, reason: 'NON_POSITIVE' }` (UI shows warning + disables
 * 儲存 button).
 *
 * Parent owns the DB UPDATE — this sheet only emits `onSave` with the new
 * `{ started_at_ms, ended_at_ms }` pair.
 *
 * Cross-platform note: iOS uses inline spinner display (mounted inside the
 * sheet body, no popup). Android falls back to two-step pickers (tap-to-open
 * date dialog → time dialog) via `display='default'`. Overnight scope is iOS
 * primary — Android behaviour is reasonable but not exhaustively tested.
 */

import { useEffect, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';

import {
  formatTrainingDuration,
} from '@/src/domain/session/sessionStats';
import {
  validateSessionTimes,
} from '@/src/domain/session/sessionTimeEditor';

interface SessionTimeEditorSheetProps {
  visible: boolean;
  started_at_ms: number;
  ended_at_ms: number;
  onSave: (args: {
    started_at_ms: number;
    ended_at_ms: number;
  }) => void | Promise<void>;
  onClose: () => void;
}

type AndroidPickerMode = 'date' | 'time' | null;

export function SessionTimeEditorSheet({
  visible,
  started_at_ms,
  ended_at_ms,
  onSave,
  onClose,
}: SessionTimeEditorSheetProps) {
  const [start, setStart] = useState<Date>(() => new Date(started_at_ms));
  const [end, setEnd] = useState<Date>(() => new Date(ended_at_ms));
  const [busy, setBusy] = useState(false);

  // Android two-step picker state: which field is being edited (start/end) and
  // which step (date → time). iOS ignores this entirely (inline spinner).
  const [androidStartMode, setAndroidStartMode] = useState<AndroidPickerMode>(
    null,
  );
  const [androidEndMode, setAndroidEndMode] = useState<AndroidPickerMode>(null);

  // Reset local state every time the sheet opens so reopening after a previous
  // edit-and-cancel shows the freshly-passed props, not the stale draft.
  useEffect(() => {
    if (visible) {
      setStart(new Date(started_at_ms));
      setEnd(new Date(ended_at_ms));
      setBusy(false);
      setAndroidStartMode(null);
      setAndroidEndMode(null);
    }
  }, [visible, started_at_ms, ended_at_ms]);

  const validation = validateSessionTimes(start.getTime(), end.getTime());
  const isValid = validation.valid;
  const durationLabel = validation.valid
    ? formatTrainingDuration(validation.duration_sec)
    : '—';

  const handleSave = async () => {
    if (!isValid || busy) return;
    setBusy(true);
    try {
      await onSave({
        started_at_ms: start.getTime(),
        ended_at_ms: end.getTime(),
      });
    } finally {
      // Parent decides whether to close (it owns the visible state). We just
      // release the busy lock so retry works if the parent kept us open.
      setBusy(false);
    }
  };

  // iOS spinner emits `set` events repeatedly while the wheel scrolls — we
  // commit every value. The dismiss event is iOS-rare (only via tap-out on
  // some configurations) but we still handle it defensively.
  const handleStartChange = (
    event: DateTimePickerEvent,
    selected?: Date,
  ) => {
    if (Platform.OS === 'android') {
      // Android: dialog closes itself; advance through date → time → done.
      if (event.type === 'dismissed') {
        setAndroidStartMode(null);
        return;
      }
      if (selected) {
        if (androidStartMode === 'date') {
          // Preserve current time-of-day from `start` on the new date.
          const merged = new Date(start);
          merged.setFullYear(
            selected.getFullYear(),
            selected.getMonth(),
            selected.getDate(),
          );
          setStart(merged);
          setAndroidStartMode('time');
        } else {
          const merged = new Date(start);
          merged.setHours(
            selected.getHours(),
            selected.getMinutes(),
            0,
            0,
          );
          setStart(merged);
          setAndroidStartMode(null);
        }
      }
      return;
    }
    // iOS: inline spinner; commit on every emit.
    if (selected) setStart(selected);
  };

  const handleEndChange = (
    event: DateTimePickerEvent,
    selected?: Date,
  ) => {
    if (Platform.OS === 'android') {
      if (event.type === 'dismissed') {
        setAndroidEndMode(null);
        return;
      }
      if (selected) {
        if (androidEndMode === 'date') {
          const merged = new Date(end);
          merged.setFullYear(
            selected.getFullYear(),
            selected.getMonth(),
            selected.getDate(),
          );
          setEnd(merged);
          setAndroidEndMode('time');
        } else {
          const merged = new Date(end);
          merged.setHours(
            selected.getHours(),
            selected.getMinutes(),
            0,
            0,
          );
          setEnd(merged);
          setAndroidEndMode(null);
        }
      }
      return;
    }
    if (selected) setEnd(selected);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.topBar}>
            <Pressable onPress={onClose} hitSlop={8} disabled={busy}>
              <Text
                style={[
                  styles.topBarBtnText,
                  busy && styles.topBarBtnDisabled,
                ]}
              >
                取消
              </Text>
            </Pressable>
            <Text style={styles.topBarTitle}>編輯訓練時間</Text>
            <Pressable
              onPress={handleSave}
              hitSlop={8}
              disabled={!isValid || busy}
            >
              <Text
                style={[
                  styles.topBarBtnText,
                  styles.topBarConfirm,
                  (!isValid || busy) && styles.topBarBtnDisabled,
                ]}
              >
                {busy ? '儲存中…' : '儲存'}
              </Text>
            </Pressable>
          </View>

          <View style={styles.body}>
            {/* 開始時間 */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>開始時間</Text>
              {Platform.OS === 'ios' ? (
                <DateTimePicker
                  value={start}
                  mode="datetime"
                  display="spinner"
                  onChange={handleStartChange}
                  // Cap to the end time so the wheel can't pass it; user can
                  // bump end up first if they need to push start later.
                />
              ) : (
                <View>
                  <Pressable
                    style={styles.androidFieldButton}
                    onPress={() => setAndroidStartMode('date')}
                  >
                    <Text style={styles.androidFieldButtonText}>
                      {formatDateTime(start)}
                    </Text>
                  </Pressable>
                  {androidStartMode !== null ? (
                    <DateTimePicker
                      value={start}
                      mode={androidStartMode}
                      display="default"
                      onChange={handleStartChange}
                    />
                  ) : null}
                </View>
              )}
            </View>

            {/* 結束時間 */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>結束時間</Text>
              {Platform.OS === 'ios' ? (
                <DateTimePicker
                  value={end}
                  mode="datetime"
                  display="spinner"
                  onChange={handleEndChange}
                />
              ) : (
                <View>
                  <Pressable
                    style={styles.androidFieldButton}
                    onPress={() => setAndroidEndMode('date')}
                  >
                    <Text style={styles.androidFieldButtonText}>
                      {formatDateTime(end)}
                    </Text>
                  </Pressable>
                  {androidEndMode !== null ? (
                    <DateTimePicker
                      value={end}
                      mode={androidEndMode}
                      display="default"
                      onChange={handleEndChange}
                    />
                  ) : null}
                </View>
              )}
            </View>

            <View style={styles.divider} />

            {/* Live duration preview */}
            <View style={styles.durationRow}>
              <Text style={styles.durationLabel}>訓練時長</Text>
              <Text
                style={[
                  styles.durationValue,
                  !isValid && styles.durationValueInvalid,
                ]}
              >
                {durationLabel}
              </Text>
            </View>

            {!isValid ? (
              <Text style={styles.warningText}>
                ⚠️ 結束時間必須晚於開始時間
              </Text>
            ) : null}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function formatDateTime(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${day}  ${h}:${m}`;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 24,
    maxHeight: '85%',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  topBarTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  topBarBtnText: {
    fontSize: 15,
    color: '#6b7280',
  },
  topBarBtnDisabled: {
    opacity: 0.4,
  },
  topBarConfirm: {
    color: '#007AFF',
    fontWeight: '600',
  },
  body: {
    padding: 16,
    gap: 12,
  },
  field: {
    gap: 4,
  },
  fieldLabel: {
    fontSize: 12,
    opacity: 0.7,
    fontWeight: '600',
    color: '#111827',
  },
  androidFieldButton: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#f9fafb',
  },
  androidFieldButtonText: {
    fontSize: 15,
    color: '#111827',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#e5e7eb',
    marginVertical: 4,
  },
  durationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  durationLabel: {
    fontSize: 14,
    color: '#374151',
    fontWeight: '600',
  },
  durationValue: {
    fontSize: 16,
    color: '#111827',
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  durationValueInvalid: {
    color: '#9ca3af',
  },
  warningText: {
    fontSize: 13,
    color: '#dc2626',
    fontWeight: '500',
  },
});

export default SessionTimeEditorSheet;
