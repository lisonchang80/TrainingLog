/**
 * Set-row body — shared between template editor and session set logger
 * (ADR-0019 Q9, slice 10c Phase 1).
 *
 * Renders the inner row content of a single set: [label btn] [weight] kg
 * × [reps] [optional note indicator] [optional dropset +/− buttons].
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
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useTheme, type ThemeTokens } from '@/src/theme';

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
   * Slice 10c overnight (2026-05-17): cluster card uses a SHARED `#` button
   * that cycles both A and B's set_kind in lockstep — so the per-side
   * SetRowContent suppresses its own label button. Solo card never sets this.
   */
  hideLabel?: boolean;
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
  hideLabel,
  onTapNumber,
  onUpdateSet,
  onShowSetNote,
  onRemoveDropsetRow,
  onAddDropsetRow,
  onCycleLabel,
}: SetRowContentProps<S>) {
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
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
    <View style={[styles.setRow, compact && styles.setRowCompact]}>
      {hideLabel ? null : (
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
      )}
      {onTapNumber ? (
        <Pressable
          onPress={() => onTapNumber(set, 'weight', set.weight)}
          hitSlop={4}
          style={[styles.setInput, compact && styles.setInputCompact]}
        >
          <Text style={[styles.setInputText, compact && styles.setInputTextCompact]}>{String(set.weight)}</Text>
        </Pressable>
      ) : (
        <TextInput
          style={[styles.setInput, styles.setInputTextInline, compact && styles.setInputCompact]}
          value={weightText}
          onChangeText={handleWeightChange}
          keyboardType="decimal-pad"
        />
      )}
      <Text style={[styles.setUnit, compact && styles.setUnitCompact]}>kg</Text>
      <Text style={[styles.setUnit, compact && styles.setUnitCompact]}>×</Text>
      {onTapNumber ? (
        <Pressable
          onPress={() => onTapNumber(set, 'reps', set.reps)}
          hitSlop={4}
          style={[styles.setInput, compact && styles.setInputCompact]}
        >
          <Text style={[styles.setInputText, compact && styles.setInputTextCompact]}>{String(set.reps)}</Text>
        </Pressable>
      ) : (
        <TextInput
          style={[styles.setInput, compact && styles.setInputCompact]}
          value={repsText}
          onChangeText={handleRepsChange}
          keyboardType="number-pad"
        />
      )}
      {/* Dropset follower −/+ — directly after reps, before note slot
          (2026-05-20 user request: 「請放在次數的右邊」). − always shown
          (minusDisabled state when chain at minimum 2 rows); + only on
          chain-last follower; placeholder reserves + slot on non-last
          followers so input columns stay aligned across all rows. */}
      {isDropsetFollower ? (
        <View style={styles.dropsetLeftGroup}>
          <Pressable
            onPress={() => onRemoveDropsetRow(set.id)}
            disabled={minusDisabled}
            hitSlop={6}
            style={[
              styles.dropsetInlineBtn,
              minusDisabled && styles.dropsetTailBtnDisabled,
            ]}>
            <Text
              style={[
                styles.dropsetInlineBtnText,
                minusDisabled && styles.dropsetTailBtnTextDisabled,
              ]}>
              −
            </Text>
          </Pressable>
          {isClusterLast ? (
            <Pressable
              onPress={() => onAddDropsetRow(set.id)}
              hitSlop={6}
              style={styles.dropsetInlineBtn}>
              <Text style={styles.dropsetInlineBtnText}>+</Text>
            </Pressable>
          ) : (
            <View style={styles.dropsetInlineBtnPlaceholder} />
          )}
        </View>
      ) : null}
      {/*
        overnight #5 第 4 點: note slot 永遠保留 column (沒備註 placeholder 同寬)
        — 避免欄位 shift, 三排 set rows 嚴格 column-aligned.
        hideNoteIndicator (cluster 用) 直接 skip 兩種, 因為 cluster 自己渲染 shared 📝.
      */}
      {hideNoteIndicator ? null : hasNote ? (
        <Pressable
          onPress={() => onShowSetNote(set)}
          style={styles.setNoteIndicator}
          hitSlop={6}>
          <Text style={styles.setNoteIndicatorText}>📝</Text>
        </Pressable>
      ) : (
        <View style={styles.setNoteIndicatorPlaceholder} />
      )}
      {/* dropset −/+ buttons rendered at LEFT (label slot) above (2026-05-20). */}
    </View>
  );
}

/**
 * ADR-0025 — token-driven styles. The skeuomorphic 3D button shading
 * (multi-layer border colors, drop shadow) is intentional and kept
 * literal across modes; in dark mode the button bg shifts to a slightly
 * elevated surface so the 3D effect still reads.
 */
function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    // overnight #52 — 統一 set/cycle row sizing 規格 A/B:
    //   spec A (compact=false / solo)  : gap 12, label 40×32 fs:16, input min 60 padH 12 padV 6 fs:16
    //   spec B (compact=true  / cluster): gap  6, label 28×22 fs:11, input min 32 padH  5 padV 3 fs:12
    setRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    setRowCompact: { gap: 6 },
    setLabelBtn: {
      width: 40,
      height: 32,
      borderRadius: 6,
      backgroundColor: tokens.bg.surface,
      borderTopWidth: 1,
      borderLeftWidth: 1,
      borderRightWidth: 1,
      borderBottomWidth: 2,
      // Skeuomorphic 3D bevel — kept literal across modes (the gradient of
      // light-to-dark border faces preserves the "physical button" look).
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
      width: 28,
      height: 22,
      borderRadius: 4,
      backgroundColor: tokens.bg.surface,
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
      backgroundColor: tokens.bg.elevated,
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
    setLabelText: { fontSize: 16, fontWeight: '600', color: tokens.text.primary },
    setLabelTextCompact: { fontSize: 11 },
    setLabelTextDisabled: { color: tokens.text.tertiary },
    setInput: {
      minWidth: 60,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 6,
      // #1 (2026-05-30) — weight/reps 值格子要跟頁面背景有對比。
      // 原本 `bg.surface` 在淺色 == `bg.base`（頁底），格子整個融進背景看不出
      // 邊界。改用 `bg.elevated`（淺色淡灰 / 深色提亮）+ 細框，淺/深都讀得出
      // 這是一個可輸入的格子。
      backgroundColor: tokens.bg.elevated,
      borderWidth: 1,
      borderColor: tokens.border.default,
      fontSize: 16,
      textAlign: 'center',
      alignItems: 'center',
      justifyContent: 'center',
    },
    setInputCompact: {
      minWidth: 32,
      paddingHorizontal: 5,
      paddingVertical: 3,
      fontSize: 12,
    },
    setInputText: {
      fontSize: 16,
      color: tokens.text.primary,
      textAlign: 'center',
    },
    setInputTextCompact: {
      fontSize: 12,
    },
    // Applied to the bare TextInput variant so its text color follows theme.
    setInputTextInline: {
      color: tokens.text.primary,
    },
    // overnight #52 — kg / × separator fontSize 對齊新 cell fontSize 避免視覺錯位
    setUnit: { fontSize: 16, color: tokens.text.secondary },
    setUnitCompact: { fontSize: 12 },
    setNoteIndicator: {
      paddingHorizontal: 4,
      paddingVertical: 2,
      marginLeft: 4,
    },
    setNoteIndicatorText: { fontSize: 14 },
    setNoteIndicatorPlaceholder: { width: 28, marginLeft: 4 },
    dropsetInlineBtn: {
      width: 22,
      height: 22,
      borderRadius: 11,
      // Warning-tinted "dropset" affordance — kept literal because it's a
      // semantically-meaningful color tint (matches dropset chip styling
      // upstream) not a generic surface.
      backgroundColor: 'rgba(255,149,0,0.15)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    dropsetInlineBtnPlaceholder: { width: 22, height: 22 },
    dropsetInlineBtnText: {
      fontSize: 14,
      fontWeight: '700',
      color: tokens.action.warning,
    },
    dropsetTailBtnDisabled: { opacity: 0.35 },
    dropsetTailBtnTextDisabled: { color: tokens.text.tertiary },
    dropsetLeftGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
  });
}
