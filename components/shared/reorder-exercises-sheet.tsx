/**
 * 🔃 排序動作 modal — full-screen sheet for reordering session_exercises
 * within the current in-progress session (ADR-0019 Q10, slice 10c Phase 6
 * commit 30).
 *
 * Trigger entries (per spec):
 *   - long-press on any exercise card header
 *   - ⚙️ menu's 5th item「🔃 排序動作」（below the 4 main items + separator）
 *
 * Uses `react-native-draggable-flatlist` (just installed). Long-press any
 * row → drag to reposition → release. Top hint banner explains the
 * gesture. [取消] reverts, [完成] commits the new ordering via batch
 * UPDATE session_exercise.ordering.
 *
 * Renders inside the existing GestureHandlerRootView (added at app
 * root in this same commit) — DraggableFlatList needs that for
 * gesture detection.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DraggableFlatList, {
  type RenderItemParams,
} from 'react-native-draggable-flatlist';

import { t, tExercise } from '@/src/i18n';
import { useTheme, type ThemeTokens } from '@/src/theme';

/**
 * Localize a row name produced by `buildSessionReorderRows` /
 * `buildTemplateReorderRows`. Cluster rows arrive as compound
 * "A + B" strings; split on the literal " + " separator before
 * mapping each piece through tExercise(), since the compound
 * isn't a v006 seed key itself.
 */
function localizeRowName(name: string): string {
  if (!name.includes(' + ')) return tExercise(name);
  return name
    .split(' + ')
    .map((part) => tExercise(part))
    .join(' + ');
}

type ReorderItem = {
  id: string;
  name: string;
};

type ReorderExercisesSheetProps = {
  visible: boolean;
  initialItems: ReorderItem[];
  onConfirm: (orderedIds: string[]) => void;
  onCancel: () => void;
};

export function ReorderExercisesSheet({
  visible,
  initialItems,
  onConfirm,
  onCancel,
}: ReorderExercisesSheetProps) {
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const [draft, setDraft] = useState<ReorderItem[]>(initialItems);

  useEffect(() => {
    if (visible) setDraft(initialItems);
  }, [visible, initialItems]);

  const renderItem = ({ item, drag, isActive }: RenderItemParams<ReorderItem>) => (
    <Pressable
      onLongPress={drag}
      delayLongPress={300}
      style={[
        styles.row,
        isActive && styles.rowActive,
      ]}
    >
      <Text style={styles.dragHandle}>≡</Text>
      <Text style={styles.rowName}>{localizeRowName(item.name)}</Text>
    </Pressable>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onCancel}
    >
      <View style={styles.sheet} accessibilityViewIsModal>
        <View style={styles.topBar}>
          <Pressable onPress={onCancel} hitSlop={8} accessibilityRole="button">
            <Text style={styles.topBarBtnText}>{t('common', 'cancel')}</Text>
          </Pressable>
          <Text style={styles.topBarTitle}>{t('button', 'clusterReorderExercises')}</Text>
          <Pressable
            onPress={() => onConfirm(draft.map((d) => d.id))}
            hitSlop={8}
            accessibilityRole="button"
          >
            <Text style={[styles.topBarBtnText, styles.topBarConfirm]}>
              {t('common', 'done')}
            </Text>
          </Pressable>
        </View>
        <View style={styles.hintBanner}>
          <Text style={styles.hintBannerText}>{t('status', 'reorderHint')}</Text>
        </View>
        <DraggableFlatList
          data={draft}
          keyExtractor={(item) => item.id}
          onDragEnd={({ data }) => setDraft(data)}
          renderItem={renderItem}
          containerStyle={{ flex: 1 }}
        />
      </View>
    </Modal>
  );
}

function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    sheet: {
      flex: 1,
      backgroundColor: tokens.bg.base,
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
    topBarBtnText: { fontSize: 15, color: tokens.text.secondary },
    topBarConfirm: { color: tokens.action.primary, fontWeight: '600' },
    hintBanner: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      backgroundColor: tokens.bg.elevated,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: tokens.border.subtle,
    },
    hintBannerText: { fontSize: 13, color: tokens.action.primary },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 16,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: tokens.border.subtle,
      backgroundColor: tokens.bg.base,
    },
    rowActive: {
      backgroundColor: tokens.bg.elevated,
      elevation: 4,
      // Drag-active shadow — kept literal black for cross-mode legibility.
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.15,
      shadowRadius: 4,
    },
    dragHandle: {
      fontSize: 20,
      color: tokens.text.tertiary,
      width: 24,
      textAlign: 'center',
    },
    rowName: { fontSize: 15, color: tokens.text.primary, flex: 1 },
  });
}
