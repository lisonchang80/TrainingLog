/**
 * 🔃 排序組數 modal — full-screen sheet for reordering sets within ONE
 * (session, exercise) (slice 10c Phase 2 commit 9 留尾, mirrors
 * `reorder-exercises-sheet.tsx` per "mirror existing pattern, don't reinvent"
 * philosophy).
 *
 * Trigger entry: long-press any set row inside the exercise card body.
 * UX flow: long press → modal opens with all sets of that exercise → drag
 * to reposition → [完成] commits batch UPDATE set.ordering via
 * `reorderSessionSetsForExercise` (slot-based renumber preserves other
 * exercises' set orderings).
 *
 * Renders inside the existing GestureHandlerRootView at app root.
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

export type ReorderSetItem = {
  id: string;
  label: string; // e.g. "熱", "1", "2"
  weight_kg: number | null;
  reps: number | null;
};

type ReorderSetsSheetProps = {
  visible: boolean;
  exerciseName: string;
  initialItems: ReorderSetItem[];
  onConfirm: (orderedIds: string[]) => void;
  onCancel: () => void;
};

export function ReorderSetsSheet({
  visible,
  exerciseName,
  initialItems,
  onConfirm,
  onCancel,
}: ReorderSetsSheetProps) {
  const [draft, setDraft] = useState<ReorderSetItem[]>(initialItems);

  useEffect(() => {
    if (visible) setDraft(initialItems);
  }, [visible, initialItems]);

  const renderItem = ({
    item,
    drag,
    isActive,
  }: RenderItemParams<ReorderSetItem>) => (
    <Pressable
      onLongPress={drag}
      delayLongPress={300}
      style={[styles.row, isActive && styles.rowActive]}
    >
      <Text style={styles.dragHandle}>≡</Text>
      <Text style={styles.rowLabel}>{item.label}</Text>
      <Text style={styles.rowDetails}>
        {item.weight_kg ?? 0} × {item.reps ?? 0}
      </Text>
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
            <Text style={styles.topBarBtnText}>取消</Text>
          </Pressable>
          <Text style={styles.topBarTitle} numberOfLines={1}>
            🔃 排序組數 · {exerciseName}
          </Text>
          <Pressable
            onPress={() => onConfirm(draft.map((d) => d.id))}
            hitSlop={8}
          >
            <Text style={[styles.topBarBtnText, styles.topBarConfirm]}>
              完成
            </Text>
          </Pressable>
        </View>
        <View style={styles.hintBanner}>
          <Text style={styles.hintBannerText}>
            長按任一組拖曳重新排序，完成後按右上「完成」儲存。
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
    gap: 8,
  },
  topBarTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    flex: 1,
    textAlign: 'center',
  },
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
  rowLabel: {
    fontSize: 15,
    color: '#111827',
    fontWeight: '600',
    minWidth: 28,
  },
  rowDetails: { fontSize: 15, color: '#374151', flex: 1 },
});
