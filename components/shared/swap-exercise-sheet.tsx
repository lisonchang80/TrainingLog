/**
 * 🔀 換動作 picker — session set logger ⚙️ menu path
 * (ADR-0019 Q11 + ADR-0014 sibling-rename propagation 留尾, slice 10c
 * Phase 4 commit 20).
 *
 * Bottom-sheet Modal with [取消] [換動作] [完成] top bar + scrollable
 * exercise list. User taps an exercise → onConfirm fires with the new
 * exercise_id. Simple search/filter is omitted for v1 (the in-app
 * exercise library page already handles that — this is a fast in-session
 * swap with sort by name).
 *
 * Caller controls which exercise to highlight as "current" (it's
 * disabled in the picker so the user can't no-op-swap).
 */

import { useMemo } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

type ExerciseOption = {
  id: string;
  name: string;
};

type SwapExerciseSheetProps = {
  visible: boolean;
  currentExerciseId: string | null;
  exercises: ExerciseOption[];
  onConfirm: (new_exercise_id: string) => void;
  onCancel: () => void;
};

export function SwapExerciseSheet({
  visible,
  currentExerciseId,
  exercises,
  onConfirm,
  onCancel,
}: SwapExerciseSheetProps) {
  const sorted = useMemo(
    () => [...exercises].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant')),
    [exercises],
  );

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
              <Text style={styles.topBarBtnText}>取消</Text>
            </Pressable>
            <Text style={styles.topBarTitle}>🔀 換動作</Text>
            <View style={{ width: 30 }} />
          </View>
          <ScrollView style={styles.list}>
            {sorted.map((ex) => {
              const isCurrent = ex.id === currentExerciseId;
              return (
                <Pressable
                  key={ex.id}
                  onPress={() => {
                    if (!isCurrent) onConfirm(ex.id);
                  }}
                  disabled={isCurrent}
                  style={({ pressed }) => [
                    styles.row,
                    isCurrent && styles.rowCurrent,
                    pressed && !isCurrent && styles.rowPressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.rowText,
                      isCurrent && styles.rowTextCurrent,
                    ]}
                  >
                    {ex.name}
                    {isCurrent ? '（目前）' : ''}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
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
    height: '70%',
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
  list: { flex: 1 },
  row: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f3f4f6',
  },
  rowCurrent: {
    backgroundColor: 'rgba(127,127,127,0.10)',
  },
  rowPressed: {
    backgroundColor: '#f3f4f6',
  },
  rowText: { fontSize: 15, color: '#111827' },
  rowTextCurrent: { color: '#9ca3af' },
});
