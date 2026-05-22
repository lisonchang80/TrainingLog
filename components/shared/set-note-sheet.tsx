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

import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { t } from '@/src/i18n';

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
  const resolvedTitle = title ?? t('domain', 'note');
  // TODO(i18n): set-specific placeholder distinct from exercise notePlaceholder — needs new strings.ts key.
  const resolvedPlaceholder = placeholder ?? '這組想留下什麼？（例：RPE 8、左肘有點緊）';
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
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.topBar}>
            <Pressable onPress={onCancel} hitSlop={8}>
              <Text style={styles.topBarBtnText}>{t('common', 'cancel')}</Text>
            </Pressable>
            <Text style={styles.topBarTitle}>{resolvedTitle}</Text>
            <Pressable onPress={handleConfirm} hitSlop={8}>
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
            placeholderTextColor="#9ca3af"
            autoFocus
            textAlignVertical="top"
          />
        </Pressable>
      </Pressable>
    </Modal>
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
  topBarConfirm: {
    color: '#007AFF',
    fontWeight: '600',
  },
  input: {
    margin: 16,
    minHeight: 120,
    maxHeight: 240,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#f9fafb',
    fontSize: 15,
    color: '#111827',
  },
});
