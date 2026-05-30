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
 * the persisted value via `initialTitle`. A `useEffect` syncs `draft ←
 * initialTitle` whenever the prop changes outside edit mode, so an async
 * refresh that lands AFTER first mount (e.g. session.title loaded from DB
 * AFTER the `in_progress` branch first rendered with title='') still seeds
 * the draft correctly. Empty strings are valid and round-trip as ''.
 *
 * Bug F2 (2026-05-25): tap-to-edit on a non-empty title used to render a
 * blank TextField because the local `draft` state was initialised from
 * `initialTitle` at first mount only — if the parent's title prop arrived
 * AFTER the first render, `useState(initialTitle)` captured `''` and never
 * updated. The `useEffect` sync below fixes that; tap-to-edit also seeds
 * `selection` to cursor-at-end so the user can immediately append.
 *
 * Bug F4 (2026-05-25): exposes an imperative `blur()` via `forwardRef` +
 * `useImperativeHandle` so call sites that open a secondary surface (e.g.
 * the in-session ⋯ menu) can commit-on-blur the title editor BEFORE the
 * new surface steals focus. Wiring at call sites is per-screen — see
 * `SessionTitleEditorHandle` in `./session-title-editor.behavior.ts`.
 *
 * ADR-0025 — colors come from `useTheme().tokens`. The previous default
 * `Text` color (system primary) and hard-coded `#9ca3af` placeholder were
 * unreadable in dark mode.
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Pressable, StyleSheet, Text, TextInput } from 'react-native';

import { useDatabase } from '@/components/database-provider';
import { updateSessionTitle } from '@/src/adapters/sqlite/sessionRepository';
import { t } from '@/src/i18n';
import { useTheme, type ThemeTokens } from '@/src/theme';

import {
  decideCommit,
  nextDraftOnPropSync,
  type SessionTitleEditorHandle,
} from './session-title-editor.behavior';

// Re-export the imperative handle type so call sites can
// `import { SessionTitleEditorHandle } from '@/components/session/session-title-editor'`
// without needing to know about the bare-TS sibling.
export type { SessionTitleEditorHandle };

interface SessionTitleEditorProps {
  sessionId: string;
  initialTitle: string;
  placeholder?: string;
  onUpdated?: (title: string) => void;
  /**
   * Typography size. `'hero'` (default) mirrors Today's session header (28pt,
   * weight 700) — used by `app/(tabs)/index.tsx`. `'nav'` mirrors the
   * detail-page nav-bar title (17pt, weight 700) — used by
   * `app/session/[id].tsx` per ADR-0014 § history detail header. Only typography
   * changes; tap-to-edit semantics + commit-on-blur are identical.
   */
  size?: 'hero' | 'nav';
}

export const SessionTitleEditor = forwardRef<
  SessionTitleEditorHandle,
  SessionTitleEditorProps
>(function SessionTitleEditor(
  { sessionId, initialTitle, placeholder, onUpdated, size = 'hero' },
  ref,
) {
  const db = useDatabase();
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens, size), [tokens, size]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialTitle);
  const inputRef = useRef<TextInput>(null);

  // F2 — keep `draft` in sync with `initialTitle` whenever the prop changes
  // and we're NOT mid-edit. Covers the race where the parent loads
  // session.title AFTER this component first mounted with title=''. The
  // decision is delegated to `nextDraftOnPropSync` for unit testability.
  useEffect(() => {
    const next = nextDraftOnPropSync({ initialTitle, draft, editing });
    if (next !== null) setDraft(next);
  }, [initialTitle, draft, editing]);

  // F4 — expose blur() so call sites that open a secondary surface (kebab
  // menu, sheet) can commit the title BEFORE the new surface mounts. The
  // ref-current optional-chain makes this a no-op when not in edit mode
  // (no TextInput rendered → inputRef.current is null).
  useImperativeHandle(
    ref,
    () => ({
      blur: () => {
        inputRef.current?.blur();
      },
    }),
    [],
  );

  const commit = async () => {
    // Delegate the persist-vs-noop decision to `decideCommit` (pure,
    // unit-tested). Empty strings are valid (= freestyle / placeholder).
    const decision = decideCommit({ draft, initialTitle });
    setEditing(false);
    if (!decision.shouldPersist) return;
    setDraft(decision.next);
    try {
      await updateSessionTitle(db, sessionId, decision.next);
      onUpdated?.(decision.next);
    } catch {
      // Best-effort: if the write fails the parent's initialTitle stays
      // stale and a future refresh will reconcile. Avoid an alert here —
      // the header tap-to-edit is a low-stakes UI and we don't want to
      // hijack the screen for a write blip.
    }
  };

  if (editing) {
    // F2 — cursor-at-end seeding via `selection` lets the user immediately
    // append to an existing title without retyping or manually positioning.
    const cursorAtEnd = draft.length;
    return (
      <TextInput
        ref={inputRef}
        value={draft}
        onChangeText={setDraft}
        onBlur={commit}
        onSubmitEditing={commit}
        autoFocus
        selection={{ start: cursorAtEnd, end: cursorAtEnd }}
        returnKeyType="done"
        placeholder={placeholder}
        placeholderTextColor={tokens.text.tertiary}
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
        // Defensive: sync draft to the latest initialTitle here too, since
        // the useEffect sync above runs after render. This guarantees the
        // very first edit-mode render has the correct value even if a prop
        // update is in flight.
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
      {/* #5 (2026-05-30) — 編輯提示 ✏ icon，讓使用者知道標題可點擊編輯。 */}
      <Text style={styles.editHint}> ✏</Text>
    </Pressable>
  );
});

function makeStyles(tokens: ThemeTokens, size: 'hero' | 'nav') {
  // `'hero'` matches Today's session header `styles.heading` (fontSize 28).
  // `'nav'` matches detail page `styles.headerTitleText` (fontSize 17). Weight
  // 700 + primary text color are shared across both.
  const fontSize = size === 'nav' ? 17 : 28;
  return StyleSheet.create({
    touch: {
      // Take the same horizontal slot the old <Text style={styles.heading}>
      // occupied — bounded so the header's right-side action cluster keeps
      // its slot. flexShrink lets the title truncate (numberOfLines=1) rather
      // than push the actions off-screen.
      flexShrink: 1,
      // #5 — title text + ✏ icon on one row.
      flexDirection: 'row',
      alignItems: 'center',
    },
    heading: {
      fontSize,
      fontWeight: '700',
      color: tokens.text.primary,
      // #5 — truncate the title (numberOfLines=1) instead of pushing the ✏
      // icon out of the row.
      flexShrink: 1,
    },
    editHint: {
      // Dimmed pencil affordance; scales with the title size variant.
      fontSize: size === 'nav' ? 13 : 18,
      color: tokens.text.tertiary,
    },
    placeholder: {
      fontStyle: 'italic',
      opacity: 0.5,
    },
    input: {
      fontSize,
      fontWeight: '700',
      paddingVertical: 0,
      color: tokens.text.primary,
      // Same horizontal slot — let the input grow to fill what the action
      // cluster doesn't claim. paddingVertical 0 keeps the baseline aligned
      // with the surrounding header buttons.
      flexShrink: 1,
      flexGrow: 1,
    },
  });
}
