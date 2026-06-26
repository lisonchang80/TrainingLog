/**
 * Per-set notes editor modal — session set logger's 右滑「備註」action
 * (ADR-0019 Q9, slice 10c Phase 2 commit 7c).
 *
 * Bottom sheet layout matching `numeric-keypad.tsx`:
 *   [取消] [備註] [完成]
 *   <multi-line TextInput>
 *
 * Empty / whitespace-only input persists as NULL (so the 📝 indicator
 * hides cleanly). Confirm fires `onConfirm(notes | null)`; caller writes
 * to DB via `updateSetFields`.
 *
 * Slice 10c Phase 2 commit 7c only — could later be reused by template
 * editor if/when per-set notes UX lands there, but template-side is out
 * of scope for this slice.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { t } from '@/src/i18n';
import { useTheme, type ThemeTokens } from '@/src/theme';

type SetNoteSheetProps = {
  visible: boolean;
  initialValue: string | null;
  /** Title shown in the top bar. Defaults to localized 備註. */
  title?: string;
  /** Placeholder shown inside the input. */
  placeholder?: string;
  onConfirm: (notes: string | null) => void;
  onCancel: () => void;
};

export function SetNoteSheet({
  visible,
  initialValue,
  title,
  placeholder,
  onConfirm,
  onCancel,
}: SetNoteSheetProps) {
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const resolvedTitle = title ?? t('domain', 'note');
  const resolvedPlaceholder = placeholder ?? t('page', 'setNotePlaceholder');
  const [draft, setDraft] = useState(initialValue ?? '');

  useEffect(() => {
    if (visible) setDraft(initialValue ?? '');
  }, [visible, initialValue]);

  const handleConfirm = () => {
    const trimmed = draft.trim();
    onConfirm(trimmed === '' ? null : trimmed);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      {/* 2026-06-27 — the bottom sheet + autoFocus TextInput was hidden behind
          the keyboard (no avoidance). KeyboardAvoidingView (padding on iOS)
          pads the bottom by the keyboard height so the flex-end sheet floats
          just above it. */}
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={onCancel}>
          <Pressable style={styles.sheet} onPress={() => {}} accessibilityViewIsModal>
            <View style={styles.topBar}>
            <Pressable onPress={onCancel} hitSlop={8} accessibilityRole="button">
              <Text style={styles.topBarBtnText}>{t('common', 'cancel')}</Text>
            </Pressable>
            <Text style={styles.topBarTitle}>{resolvedTitle}</Text>
            <Pressable onPress={handleConfirm} hitSlop={8} accessibilityRole="button">
              <Text style={[styles.topBarBtnText, styles.topBarConfirm]}>
                {t('common', 'done')}
              </Text>
            </Pressable>
          </View>

          <TextInput
            style={styles.input}
            multiline
            value={draft}
            onChangeText={setDraft}
            placeholder={resolvedPlaceholder}
            placeholderTextColor={tokens.text.tertiary}
            autoFocus
            textAlignVertical="top"
          />
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    fill: {
      flex: 1,
    },
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
    input: {
      margin: 16,
      minHeight: 120,
      maxHeight: 240,
      padding: 12,
      borderRadius: 8,
      backgroundColor: tokens.bg.elevated,
      fontSize: 15,
      color: tokens.text.primary,
    },
  });
}
