/**
 * In-session Body data editor sheet — replaces the previous inline panel on
 * the Today screen (slice 10c overnight #4 第 3 點).
 *
 * Opens from the Today header ⋯ menu → 「Body data」. Same three fields as
 * the inline panel (體重 / PBF / SMM), same save semantics — caller handles
 * the actual DB insert via `onSave` (parent already owns the
 * `insertBodyMetric` call + reload). The snapshot badge is rendered inside
 * the sheet so the user can confirm the value frozen on the active session
 * before editing.
 *
 * Mirrors `components/shared/set-note-sheet.tsx`:
 *   Modal { transparent, animationType: 'slide' }
 *   <Pressable backdrop /> → tap-out cancels
 *   <Pressable sheet />    → swallows touches
 *   [取消] [Body data] [儲存]  top bar
 *
 * The 「儲存」 button doubles as the bottom-bar save action so the sheet
 * keeps a single canonical commit gesture (no dangling 「儲存 body data」
 * button below the inputs). Disabled while `busy` true.
 *
 * Snapshot badge: shown above the inputs when `bwSnapshotKg != null`. The
 * inline 🔒 BW snapshot pill from the old layout moves here verbatim (per
 * spec: "snapshot badge: 先砍 — snapshot 資訊在 sheet 內看").
 */

import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { UnitPreference } from '@/src/domain/body/types';
import { formatWeight } from '@/src/domain/body/unitConversion';

interface BodyDataSheetProps {
  visible: boolean;
  unit: UnitPreference;
  /** Session-frozen bw snapshot (kg). NULL = no snapshot yet → hide badge. */
  bwSnapshotKg: number | null;
  /** Initial input values (caller-owned so the parent can reset on save). */
  bwInput: string;
  pbfInput: string;
  smmInput: string;
  onBwInputChange: (v: string) => void;
  onPbfInputChange: (v: string) => void;
  onSmmInputChange: (v: string) => void;
  /** Triggered by top-bar 「儲存」. Parent runs validateBodyMetric + insert. */
  onSave: () => void;
  onClose: () => void;
  /** Disables save while parent's DB write is in flight. */
  busy: boolean;
}

export function BodyDataSheet({
  visible,
  unit,
  bwSnapshotKg,
  bwInput,
  pbfInput,
  smmInput,
  onBwInputChange,
  onPbfInputChange,
  onSmmInputChange,
  onSave,
  onClose,
  busy,
}: BodyDataSheetProps) {
  // Mirror set-note-sheet's autofocus-on-open pattern by keying off `visible`.
  const [, setMountTick] = useState(0);
  useEffect(() => {
    if (visible) setMountTick((t) => t + 1);
  }, [visible]);

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
            <Text style={styles.topBarTitle}>Body data</Text>
            <Pressable onPress={onSave} hitSlop={8} disabled={busy}>
              <Text
                style={[
                  styles.topBarBtnText,
                  styles.topBarConfirm,
                  busy && styles.topBarBtnDisabled,
                ]}
              >
                {busy ? '儲存中…' : '儲存'}
              </Text>
            </Pressable>
          </View>

          <View style={styles.body}>
            {bwSnapshotKg != null ? (
              <View style={styles.snapshotBadge}>
                <Text style={styles.snapshotBadgeText}>
                  🔒 BW snapshot · {formatWeight(bwSnapshotKg, unit)}
                </Text>
              </View>
            ) : null}

            <View style={styles.row}>
              <Field
                label={`體重 (${unit})`}
                value={bwInput}
                onChange={onBwInputChange}
              />
              <Field label="PBF (%)" value={pbfInput} onChange={onPbfInputChange} />
              <Field
                label={`SMM (${unit})`}
                value={smmInput}
                onChange={onSmmInputChange}
              />
            </View>

            <Text style={styles.hint}>此 Session 的 bw_snapshot 不會被改寫。</Text>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        keyboardType="decimal-pad"
        value={value}
        onChangeText={onChange}
        placeholder="—"
        placeholderTextColor="#9ca3af"
      />
    </View>
  );
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
  snapshotBadge: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(10,126,164,0.15)',
  },
  snapshotBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0a7ea4',
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  field: {
    flex: 1,
    gap: 4,
  },
  fieldLabel: {
    fontSize: 11,
    opacity: 0.7,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#f9fafb',
  },
  hint: {
    fontSize: 11,
    opacity: 0.6,
  },
});
