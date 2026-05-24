/**
 * SessionTitleEditor — in-session header tap-to-edit (Card 11 / ADR-0014 +
 * ADR-0019 Q7.7).
 *
 * Behaviour:
 *   - Display mode: Pressable rendering `title` (or `placeholder` italic +
 *     dimmed when empty). Tap → enter edit mode.
 *   - Edit mode: <TextInput autoFocus>. Commit on blur OR onSubmitEditing
 *     → write through `updateSessionTitle` then notify via `onUpdated` so
 *     the parent's local state stays in sync without a round-trip read.
 *
 * The component holds its own draft text in local state; the parent owns
 * the persisted value via `initialTitle` (re-mounting / re-keying with a
 * fresh initial is the way to externally reset). Empty strings are valid
 * and round-trip as ''.
 */

import { useState, useRef } from 'react';
import { Pressable, StyleSheet, Text, TextInput } from 'react-native';

import { useDatabase } from '@/components/database-provider';
import { updateSessionTitle } from '@/src/adapters/sqlite/sessionRepository';
import { t } from '@/src/i18n';

export interface SessionTitleEditorProps {
  sessionId: string;
  initialTitle: string;
  placeholder?: string;
  onUpdated?: (title: string) => void;
}

export function SessionTitleEditor({
  sessionId,
  initialTitle,
  placeholder,
  onUpdated,
}: SessionTitleEditorProps) {
  const db = useDatabase();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialTitle);
  const inputRef = useRef<TextInput>(null);

  const commit = async () => {
    // Trim trailing whitespace but allow empty string (= freestyle / placeholder).
    const next = draft.trim();
    setEditing(false);
    if (next === initialTitle) return; // no-op
    setDraft(next);
    try {
      await updateSessionTitle(db, sessionId, next);
      onUpdated?.(next);
    } catch {
      // Best-effort: if the write fails the parent's initialTitle stays
      // stale and a future refresh will reconcile. Avoid an alert here —
      // the header tap-to-edit is a low-stakes UI and we don't want to
      // hijack the screen for a write blip.
    }
  };

  if (editing) {
    return (
      <TextInput
        ref={inputRef}
        value={draft}
        onChangeText={setDraft}
        onBlur={commit}
        onSubmitEditing={commit}
        autoFocus
        returnKeyType="done"
        placeholder={placeholder}
        placeholderTextColor="#9ca3af"
        style={styles.input}
      />
    );
  }

  const isEmpty = initialTitle.length === 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('button', 'a11yTapEditTitle')}
      onPress={() => {
        setDraft(initialTitle);
        setEditing(true);
      }}
      hitSlop={8}
      style={styles.touch}>
      <Text
        style={[styles.heading, isEmpty && styles.placeholder]}
        numberOfLines={1}
        ellipsizeMode="tail">
        {isEmpty ? placeholder ?? '' : initialTitle}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  touch: {
    // Take the same horizontal slot the old <Text style={styles.heading}>
    // occupied — bounded so the header's right-side action cluster keeps
    // its slot. flexShrink lets the title truncate (numberOfLines=1) rather
    // than push the actions off-screen.
    flexShrink: 1,
  },
  heading: {
    // Mirror app/(tabs)/index.tsx → styles.heading (fontSize 28, weight 700).
    fontSize: 28,
    fontWeight: '700',
  },
  placeholder: {
    fontStyle: 'italic',
    opacity: 0.5,
  },
  input: {
    fontSize: 28,
    fontWeight: '700',
    paddingVertical: 0,
    // Same horizontal slot — let the input grow to fill what the action
    // cluster doesn't claim. paddingVertical 0 keeps the baseline aligned
    // with the surrounding header buttons.
    flexShrink: 1,
    flexGrow: 1,
  },
});
