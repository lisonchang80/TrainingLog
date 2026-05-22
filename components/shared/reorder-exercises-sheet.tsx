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

import { useEffect, useState } from 'react';
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

import { t } from '@/src/i18n';

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
      <Text style={styles.rowName}>{item.name}</Text>
    </Pressable>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onCancel}
    >
      <View style={styles.sheet}>
        <View style={styles.topBar}>
          <Pressable onPress={onCancel} hitSlop={8}>
            <Text style={styles.topBarBtnText}>{t('common', 'cancel')}</Text>
          </Pressable>
          <Text style={styles.topBarTitle}>{t('button', 'clusterReorderExercises')}</Text>
          <Pressable
            onPress={() => onConfirm(draft.map((d) => d.id))}
            hitSlop={8}
          >
            <Text style={[styles.topBarBtnText, styles.topBarConfirm]}>
              {t('common', 'done')}
            </Text>
          </Pressable>
        </View>
        <View style={styles.hintBanner}>
          {/* TODO(i18n): drag-to-reorder hint banner — needs new strings.ts key. */}
          <Text style={styles.hintBannerText}>
            長按任一列拖曳重新排序，完成後按右上「完成」儲存。
          </Text>
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

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    backgroundColor: '#fff',
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
  topBarTitle: { fontSize: 16, fontWeight: '600', color: '#111827' },
  topBarBtnText: { fontSize: 15, color: '#6b7280' },
  topBarConfirm: { color: '#007AFF', fontWeight: '600' },
  hintBanner: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(10,126,164,0.08)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  hintBannerText: { fontSize: 13, color: '#0a7ea4' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f3f4f6',
    backgroundColor: '#fff',
  },
  rowActive: {
    backgroundColor: '#f9fafb',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  dragHandle: {
    fontSize: 20,
    color: '#9ca3af',
    width: 24,
    textAlign: 'center',
  },
  rowName: { fontSize: 15, color: '#111827', flex: 1 },
});
