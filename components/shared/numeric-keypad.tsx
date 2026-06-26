/**
 * Numeric keypad modal — custom in-app number pad for editing set
 * weight / reps in the session set logger (ADR-0019 § Silent deviations
 * ledger; slice 10c Phase 2 commit 4 落地).
 *
 * Why custom: tapping a number on a session set row opens this modal
 * instead of revealing an inline `<TextInput>` so the system keyboard
 * never covers the card the user is editing. Modal slides from bottom
 * with [取消] [label] [完成] top bar, current value display, and a
 * 4×3 button grid (1-9, optional `.`, 0, ⌫).
 *
 * Pure input handling (`applyKeypadKey` / `parseKeypadBuffer`) is
 * factored out as named exports so unit tests can exercise the buffer
 * manipulation without rendering the modal.
 *
 * Not wired up yet — slice 10c Phase 2 commit 5+ will replace inline
 * TextInput in the session card. Template editor is out of scope for
 * this slice; if the same UX is wanted there later it can adopt this
 * component without further changes.
 */

import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  applyKeypadKey,
  parseKeypadBuffer,
  type KeypadMode,
} from '@/src/domain/keypad';
import { t } from '@/src/i18n';
import { useTheme, type ThemeTokens } from '@/src/theme';

type NumericKeypadProps = {
  visible: boolean;
  /** Numeric value the keypad opens with; converted to a buffer string. */
  initialValue: number;
  /** Title shown in the top bar, e.g. "重量 (kg)" or "次數". */
  label: string;
  /**
   * 'integer' (e.g. reps) hides the `.` key; 'decimal' (e.g. weight) enables it.
   */
  mode: KeypadMode;
  onConfirm: (value: number) => void;
  onCancel: () => void;
};

export function NumericKeypad({
  visible,
  initialValue,
  label,
  mode,
  onConfirm,
  onCancel,
}: NumericKeypadProps) {
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const [buffer, setBuffer] = useState(() => String(initialValue));
  // 反白取代 (2026-06-26) — the value opens "selected"; the first key replaces
  // it. `fresh` is true on (re)open and flips to false after the first press.
  const [fresh, setFresh] = useState(true);

  // Reset buffer + selection whenever the modal re-opens with a (potentially)
  // new value, so the existing value is shown 反白 ready to be overwritten.
  useEffect(() => {
    if (visible) {
      setBuffer(String(initialValue));
      setFresh(true);
    }
  }, [visible, initialValue]);

  const handleKey = (key: string) => {
    setBuffer((b) => applyKeypadKey(b, key, mode, fresh));
    setFresh(false);
  };

  const handleConfirm = () => {
    onConfirm(parseKeypadBuffer(buffer));
  };

  // 4×3 grid; the `.` slot is rendered as an empty spacer in integer mode.
  const grid: { key: string; label: string }[][] = [
    [
      { key: '1', label: '1' },
      { key: '2', label: '2' },
      { key: '3', label: '3' },
    ],
    [
      { key: '4', label: '4' },
      { key: '5', label: '5' },
      { key: '6', label: '6' },
    ],
    [
      { key: '7', label: '7' },
      { key: '8', label: '8' },
      { key: '9', label: '9' },
    ],
    [
      { key: '.', label: mode === 'decimal' ? '.' : '' },
      { key: '0', label: '0' },
      { key: 'back', label: '⌫' },
    ],
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      <Pressable style={styles.backdrop} onPress={onCancel}>
        {/* Stop touch propagation so taps on the sheet don't cancel the modal.
            accessibilityViewIsModal traps VoiceOver focus inside the keypad
            (iOS) so the user can't swipe back to the obscured card behind it. */}
        <Pressable
          accessibilityViewIsModal
          style={styles.sheet}
          onPress={() => {}}
        >
          <View style={styles.topBar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common', 'cancel')}
              onPress={onCancel}
              hitSlop={8}
            >
              <Text style={styles.topBarBtnText}>{t('common', 'cancel')}</Text>
            </Pressable>
            <Text style={styles.topBarTitle}>{label}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common', 'done')}
              onPress={handleConfirm}
              hitSlop={8}
            >
              <Text style={[styles.topBarBtnText, styles.topBarConfirm]}>
                {t('common', 'done')}
              </Text>
            </Pressable>
          </View>

          <View style={styles.display}>
            {/* 反白取代 — while `fresh`, the value renders "selected" so the
                user sees the first key will overwrite it. */}
            <Text
              style={[styles.displayText, fresh && styles.displayTextSelected]}>
              {buffer}
            </Text>
          </View>

          <View style={styles.grid}>
            {grid.map((row, rIdx) => (
              <View key={rIdx} style={styles.gridRow}>
                {row.map(({ key, label: keyLabel }) => {
                  // Empty `.` slot in integer mode renders as a spacer.
                  if (key === '.' && mode !== 'decimal') {
                    return <View key={key} style={styles.keySpacer} />;
                  }
                  return (
                    <Pressable
                      key={key}
                      accessibilityRole="button"
                      accessibilityLabel={
                        key === 'back'
                          ? t('button', 'a11yKeypadBackspace')
                          : keyLabel
                      }
                      onPress={() => handleKey(key)}
                      style={({ pressed }) => [
                        styles.keyBtn,
                        pressed && styles.keyBtnPressed,
                      ]}
                    >
                      <Text style={styles.keyBtnText}>{keyLabel}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      // HIG-standard modal scrim — mode-agnostic.
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: tokens.bg.modal,
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
      borderBottomColor: tokens.border.subtle,
    },
    topBarTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: tokens.text.primary,
    },
    topBarBtnText: {
      fontSize: 15,
      color: tokens.text.secondary,
    },
    topBarConfirm: {
      color: tokens.action.primary,
      fontWeight: '600',
    },
    display: {
      paddingVertical: 24,
      alignItems: 'center',
      backgroundColor: tokens.bg.elevated,
    },
    displayText: {
      fontSize: 36,
      fontWeight: '300',
      color: tokens.text.primary,
      fontVariant: ['tabular-nums'],
    },
    // 反白取代 — selection highlight on the value box (text bg = accent,
    // glyphs = onPrimary) so the "first key replaces" affordance reads
    // like a native text selection.
    displayTextSelected: {
      color: tokens.action.onPrimary,
      backgroundColor: tokens.action.primary,
    },
    grid: {
      paddingHorizontal: 8,
      paddingTop: 12,
      gap: 8,
    },
    gridRow: {
      flexDirection: 'row',
      gap: 8,
    },
    keyBtn: {
      flex: 1,
      height: 56,
      borderRadius: 8,
      backgroundColor: tokens.bg.elevated,
      alignItems: 'center',
      justifyContent: 'center',
    },
    keyBtnPressed: {
      backgroundColor: tokens.bg.surface,
    },
    keyBtnText: {
      fontSize: 24,
      fontWeight: '500',
      color: tokens.text.primary,
    },
    keySpacer: {
      flex: 1,
      height: 56,
    },
  });
}
