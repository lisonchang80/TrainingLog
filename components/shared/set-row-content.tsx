/**
 * Set-row body — shared between template editor and session set logger
 * (ADR-0019 Q9, slice 10c Phase 1).
 *
 * Renders the inner row content of a single set: [label btn] [reps] ×
 * [weight] kg [optional note indicator] [optional dropset +/− buttons].
 *
 * Generic over the set type via `S extends SetRowItem` so callers in
 * template-editor (passing `TemplateSet`) and session set logger
 * (passing `SessionSet`) can route their domain-specific objects through
 * `onCycleLabel` / `onShowSetNote` without losing type information.
 *
 * Local string buffers shadow `set.reps` / `set.weight` so the user can
 * type partial values like "12." without the controlled <TextInput>
 * eating the trailing dot via the `Number("12.") === 12 → "12"` round-
 * trip. The buffers re-sync from prop only when the *parsed* local
 * value diverges from the prop value — so external mutations
 * (cycleSetKind, cluster clone) refresh the field but a mid-typed "12."
 * (which parses to set.weight = 12) is left alone.
 *
 * Styles are co-located here to keep the component standalone; the
 * template editor previously owned identical style entries which have
 * been removed in favour of importing from this module.
 */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

/**
 * Structural minimum a set object must expose for SetRowContent to
 * render. TemplateSet (template editor) and SessionSet (session set
 * logger) both satisfy this — no shared base type required.
 */
export type SetRowItem = {
  id: string;
  reps: number;
  weight: number;
  notes: string | null;
};

type SetRowContentProps<S extends SetRowItem> = {
  set: S;
  /** Display label for col 1: '熱' / '{N}' / 'D{N}' / '' (follower). */
  setLabel: string;
  /** Compact mode — narrower fields used inside cluster card. */
  compact?: boolean;
  /** Dropset follower row (no cycle, may show − to remove). */
  isDropsetFollower: boolean;
  /** Last row of cluster — show + button to append a follower. */
  isClusterLast: boolean;
  /** Disable − button (only one follower left, can't go below). */
  minusDisabled: boolean;
  /** Suppress 📝 note indicator (e.g., when caller renders it elsewhere). */
  hideNoteIndicator?: boolean;
  /**
   * Slice 10c Phase 2 commit 8 (ADR-0019 Q6) — session set logger swap:
   * if provided, the reps/weight cells render as tap-targets that open the
   * caller's NumericKeypad modal instead of inline TextInput (so the system
   * keyboard never covers the card being edited). Template editor omits
   * this prop and keeps its inline TextInput behavior unchanged.
   */
  onTapNumber?: (
    set: S,
    field: 'reps' | 'weight',
    currentValue: number,
  ) => void;
  onUpdateSet: (set_id: string, patch: { reps?: number; weight?: number }) => void;
  onShowSetNote: (set: S) => void;
  onRemoveDropsetRow: (set_id: string) => void;
  onAddDropsetRow: (set_id: string) => void;
  onCycleLabel: (set: S) => void;
};

export function SetRowContent<S extends SetRowItem>({
  set,
  setLabel,
  compact,
  isDropsetFollower,
  isClusterLast,
  minusDisabled,
  hideNoteIndicator,
  onTapNumber,
  onUpdateSet,
  onShowSetNote,
  onRemoveDropsetRow,
  onAddDropsetRow,
  onCycleLabel,
}: SetRowContentProps<S>) {
  const hasNote =
    !hideNoteIndicator && !!(set.notes && set.notes.trim().length > 0);

  const [repsText, setRepsText] = useState(() => String(set.reps));
  const [weightText, setWeightText] = useState(() => String(set.weight));
  useEffect(() => {
    const local = Number(repsText);
    if (Number.isFinite(local) && local === set.reps) return;
    setRepsText(String(set.reps));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set.reps]);
  useEffect(() => {
    const local = Number(weightText);
    if (Number.isFinite(local) && local === set.weight) return;
    setWeightText(String(set.weight));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [set.weight]);

  const handleRepsChange = (t: string) => {
    const cleaned = t.replace(/[^0-9]/g, '');
    setRepsText(cleaned);
    onUpdateSet(set.id, { reps: cleaned === '' ? 0 : Number(cleaned) });
  };

  const handleWeightChange = (t: string) => {
    let cleaned = t.replace(/[^0-9.]/g, '');
    const firstDot = cleaned.indexOf('.');
    if (firstDot !== -1) {
      cleaned =
        cleaned.slice(0, firstDot + 1) +
        cleaned.slice(firstDot + 1).replace(/\./g, '');
    }
    setWeightText(cleaned);
    if (cleaned === '' || cleaned === '.') {
      onUpdateSet(set.id, { weight: 0 });
      return;
    }
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) {
      onUpdateSet(set.id, { weight: parsed });
    }
  };

  return (
    <View style={styles.setRow}>
      <Pressable
        onPress={() => {
          if (!isDropsetFollower) onCycleLabel(set);
        }}
        disabled={isDropsetFollower}
        hitSlop={6}
        style={({ pressed }) => [
          compact ? styles.setLabelBtnCompact : styles.setLabelBtn,
          isDropsetFollower && styles.setLabelBtnDisabled,
          pressed && !isDropsetFollower && styles.setLabelBtnPressed,
        ]}>
        <Text
          style={[
            styles.setLabelText,
            compact && styles.setLabelTextCompact,
            isDropsetFollower && styles.setLabelTextDisabled,
          ]}>
          {setLabel}
        </Text>
      </Pressable>
      {onTapNumber ? (
        <Pressable
          onPress={() => onTapNumber(set, 'reps', set.reps)}
          hitSlop={4}
          style={[styles.setInput, compact && styles.setInputCompact]}
        >
          <Text style={styles.setInputText}>{String(set.reps)}</Text>
        </Pressable>
      ) : (
        <TextInput
          style={[styles.setInput, compact && styles.setInputCompact]}
          value={repsText}
          onChangeText={handleRepsChange}
          keyboardType="number-pad"
        />
      )}
      <Text style={styles.setUnit}>{compact ? '×' : 'reps'}</Text>
      {onTapNumber ? (
        <Pressable
          onPress={() => onTapNumber(set, 'weight', set.weight)}
          hitSlop={4}
          style={[styles.setInput, compact && styles.setInputCompact]}
        >
          <Text style={styles.setInputText}>{String(set.weight)}</Text>
        </Pressable>
      ) : (
        <TextInput
          style={[styles.setInput, compact && styles.setInputCompact]}
          value={weightText}
          onChangeText={handleWeightChange}
          keyboardType="decimal-pad"
        />
      )}
      <Text style={styles.setUnit}>kg</Text>
      {hasNote ? (
        <Pressable
          onPress={() => onShowSetNote(set)}
          style={styles.setNoteIndicator}
          hitSlop={6}>
          <Text style={styles.setNoteIndicatorText}>📝</Text>
        </Pressable>
      ) : null}
      {isDropsetFollower ? (
        <Pressable
          onPress={() => onRemoveDropsetRow(set.id)}
          disabled={minusDisabled}
          style={[
            styles.dropsetInlineBtn,
            minusDisabled && styles.dropsetTailBtnDisabled,
          ]}
          hitSlop={6}>
          <Text
            style={[
              styles.dropsetInlineBtnText,
              minusDisabled && styles.dropsetTailBtnTextDisabled,
            ]}>
            −
          </Text>
        </Pressable>
      ) : null}
      {isDropsetFollower && isClusterLast ? (
        <Pressable
          onPress={() => onAddDropsetRow(set.id)}
          style={styles.dropsetInlineBtn}
          hitSlop={6}>
          <Text style={styles.dropsetInlineBtnText}>+</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  setRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  setLabelBtn: {
    width: 32,
    height: 24,
    borderRadius: 6,
    backgroundColor: '#fafafa',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 2,
    borderTopColor: '#f3f4f6',
    borderLeftColor: '#d1d5db',
    borderRightColor: '#9ca3af',
    borderBottomColor: '#6b7280',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 1.5,
    elevation: 2,
  },
  setLabelBtnCompact: {
    width: 26,
    height: 20,
    borderRadius: 5,
    backgroundColor: '#fafafa',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 2,
    borderTopColor: '#f3f4f6',
    borderLeftColor: '#d1d5db',
    borderRightColor: '#9ca3af',
    borderBottomColor: '#6b7280',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 1.5,
    elevation: 2,
  },
  setLabelBtnDisabled: {
    backgroundColor: 'transparent',
    borderTopColor: 'transparent',
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: 'transparent',
    shadowOpacity: 0,
    elevation: 0,
  },
  setLabelBtnPressed: {
    backgroundColor: '#e5e7eb',
    borderTopWidth: 2,
    borderBottomWidth: 1,
    borderTopColor: '#6b7280',
    borderLeftColor: '#9ca3af',
    borderRightColor: '#d1d5db',
    borderBottomColor: '#f3f4f6',
    shadowOpacity: 0,
    elevation: 0,
    transform: [{ translateY: 1 }],
  },
  setLabelText: { fontSize: 13, fontWeight: '600', color: '#374151' },
  setLabelTextCompact: { fontSize: 11 },
  setLabelTextDisabled: { color: '#9ca3af' },
  setInput: {
    minWidth: 48,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#fff',
    fontSize: 13,
    textAlign: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  setInputCompact: {
    minWidth: 34,
    paddingHorizontal: 4,
    paddingVertical: 3,
    fontSize: 11,
  },
  setInputText: {
    fontSize: 13,
    color: '#111827',
    textAlign: 'center',
  },
  setUnit: { fontSize: 12, color: '#6B7280' },
  setNoteIndicator: { paddingHorizontal: 4, paddingVertical: 2, marginLeft: 4 },
  setNoteIndicatorText: { fontSize: 14 },
  dropsetInlineBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,149,0,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  dropsetInlineBtnText: { fontSize: 14, fontWeight: '700', color: '#FF9500' },
  dropsetTailBtnDisabled: { opacity: 0.35 },
  dropsetTailBtnTextDisabled: { color: '#9CA3AF' },
});
