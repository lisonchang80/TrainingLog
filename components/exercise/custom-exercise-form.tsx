/**
 * CustomExerciseForm — Slice 9.7 (ADR-0017 Q11 amendment).
 *
 * Shared form for new + edit Custom Exercise flows. Controlled component:
 * caller passes `initial` and `onSubmit`; the form owns its internal state
 * (name / mgId / equipment / primary / secondary) and doesn't read from DB.
 *
 * Q11 amendment 4-row layout:
 *   1. 名稱 — text input (required, dedup, ≤ 60 chars)
 *   2. 大分類 — picker row → MgEquipmentPicker 4×3 (required)
 *   3. 用具 — picker row → MgEquipmentPicker 4×2 (required, default '其他')
 *   4. 訓練部位 — chip section (optional); 解剖圖 conditional render
 *
 * Q3: 解剖圖 read-only (no onMusclePress); chip row is the only control surface.
 * Q4: muscle section = 解剖圖 inline + chip section 限高 ScrollView (內捲)
 * load_type is derived from equipment in the adapter (inferLoadType).
 */
import { Stack } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BodyDiagram, BodyDiagramLegend } from '@/components/body-diagram';
import {
  validateCustomExerciseDraft,
  type CustomExerciseDraft,
} from '@/src/domain/exercise/exerciseLibrary';
import {
  EQUIPMENT_VALUES,
  type Equipment,
  type Muscle,
  type MuscleGroup,
  type MuscleRole,
} from '@/src/domain/exercise/types';

import { MgEquipmentPicker, type PickerCell } from './mg-equipment-picker';

export interface CustomExerciseInitial {
  name: string;
  muscleGroupId: string;
  equipment: Equipment;
  primaryMuscleIds: ReadonlySet<string>;
  secondaryMuscleIds: ReadonlySet<string>;
}

interface CustomExerciseFormProps {
  title: string;
  initial: CustomExerciseInitial;
  existingNames: readonly string[];
  muscleGroups: MuscleGroup[];
  muscles: Muscle[];
  onSubmit: (draft: CustomExerciseDraft) => Promise<void>;
  onCancel: () => void;
}

export function CustomExerciseForm({
  title,
  initial,
  existingNames,
  muscleGroups,
  muscles,
  onSubmit,
  onCancel,
}: CustomExerciseFormProps) {
  const [name, setName] = useState(initial.name);
  const [mgId, setMgId] = useState(initial.muscleGroupId);
  const [equipment, setEquipment] = useState<Equipment>(initial.equipment);
  const [primary, setPrimary] = useState<Set<string>>(new Set(initial.primaryMuscleIds));
  const [secondary, setSecondary] = useState<Set<string>>(new Set(initial.secondaryMuscleIds));
  const [busy, setBusy] = useState(false);
  const [showMgPicker, setShowMgPicker] = useState(false);
  const [showEquipmentPicker, setShowEquipmentPicker] = useState(false);

  const draft: CustomExerciseDraft = useMemo(
    () => ({
      name,
      muscle_group_id: mgId,
      equipment,
      primaryMuscleIds: Array.from(primary),
      secondaryMuscleIds: Array.from(secondary),
    }),
    [name, mgId, equipment, primary, secondary]
  );

  const errors = useMemo(
    () => validateCustomExerciseDraft(draft, { existingNames }),
    [draft, existingNames]
  );
  const canSubmit = errors.length === 0;

  const cycleMuscleRole = useCallback((mid: string) => {
    setPrimary((p) => {
      const wasPrimary = p.has(mid);
      if (wasPrimary) {
        const np = new Set(p);
        np.delete(mid);
        setSecondary((s) => new Set(s).add(mid));
        return np;
      }
      // wasn't primary — check secondary
      if (secondary.has(mid)) {
        setSecondary((s) => {
          const ns = new Set(s);
          ns.delete(mid);
          return ns;
        });
        return p;
      }
      // wasn't selected — promote to primary
      return new Set(p).add(mid);
    });
  }, [secondary]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || busy) return;
    const generalErrs = errors.filter((e) => e.field === 'general');
    if (generalErrs.length > 0) {
      Alert.alert('無法儲存', generalErrs.map((e) => e.message).join('\n'));
      return;
    }
    setBusy(true);
    try {
      await onSubmit(draft);
    } catch (err) {
      Alert.alert('儲存失敗', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [canSubmit, busy, errors, draft, onSubmit]);

  const musclesByMg = useMemo(() => {
    const map = new Map<string, Muscle[]>();
    for (const m of muscles) {
      if (!map.has(m.mg_id)) map.set(m.mg_id, []);
      map.get(m.mg_id)!.push(m);
    }
    return map;
  }, [muscles]);

  const highlight = useMemo<Map<string, MuscleRole>>(() => {
    const m = new Map<string, MuscleRole>();
    for (const mid of secondary) m.set(mid, 'secondary');
    for (const mid of primary) m.set(mid, 'primary');
    return m;
  }, [primary, secondary]);

  const nameError = errors.find((e) => e.field === 'name');

  const mgPickerCells: PickerCell[] = useMemo(
    () => muscleGroups.map((mg) => ({ id: mg.id, label: mg.name })),
    [muscleGroups]
  );
  const equipmentPickerCells: PickerCell[] = useMemo(
    () => EQUIPMENT_VALUES.map((eq) => ({ id: eq, label: eq })),
    []
  );

  const mgLabel = useMemo(
    () => muscleGroups.find((mg) => mg.id === mgId)?.name ?? '請選擇大分類',
    [muscleGroups, mgId]
  );

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen
        options={{
          title,
          headerLeft: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="取消"
              onPress={onCancel}>
              <Text style={styles.headerCancel}>取消</Text>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="儲存"
              onPress={handleSubmit}
              disabled={!canSubmit || busy}>
              <Text
                style={[
                  styles.headerSave,
                  (!canSubmit || busy) && styles.headerSaveDisabled,
                ]}>
                {busy ? '儲存中…' : '儲存'}
              </Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {/* Row 1: 名稱 */}
        <Text style={styles.label}>名稱</Text>
        <TextInput
          accessibilityLabel="動作名稱"
          placeholder="例：吊環划船"
          value={name}
          onChangeText={setName}
          style={[styles.input, nameError && styles.inputError]}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={60}
        />
        {nameError && <Text style={styles.fieldError}>{nameError.message}</Text>}

        {/* Row 2: 大分類 picker row */}
        <Text style={styles.label}>大分類</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`大分類：${mgLabel}`}
          onPress={() => setShowMgPicker(true)}
          style={({ pressed }) => [
            styles.pickerRow,
            !mgId && styles.pickerRowEmpty,
            pressed && styles.btnPressed,
          ]}>
          <Text style={[styles.pickerRowText, !mgId && styles.pickerRowTextEmpty]}>
            {mgLabel}
          </Text>
          <Text style={styles.pickerRowChevron}>▾</Text>
        </Pressable>

        {/* Row 3: 用具 picker row */}
        <Text style={styles.label}>用具</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`用具：${equipment}`}
          onPress={() => setShowEquipmentPicker(true)}
          style={({ pressed }) => [
            styles.pickerRow,
            pressed && styles.btnPressed,
          ]}>
          <Text style={styles.pickerRowText}>{equipment}</Text>
          <Text style={styles.pickerRowChevron}>▾</Text>
        </Pressable>

        {/* Row 4: 訓練部位 */}
        <Text style={styles.label}>訓練部位（選填）</Text>
        <Text style={styles.helper}>
          點兩下切換：未選 → 主要 → 次要 → 取消。空白也 OK；空白時動作詳情頁不顯示解剖圖。
        </Text>

        <View style={styles.diagramWrap}>
          <BodyDiagram highlight={highlight} />
          <BodyDiagramLegend />
        </View>

        <View style={styles.muscleScrollWrap}>
          <ScrollView
            style={styles.muscleScroll}
            contentContainerStyle={styles.muscleScrollContent}
            nestedScrollEnabled>
            {muscleGroups.map((mg) => {
              const list = musclesByMg.get(mg.id) ?? [];
              if (list.length === 0) return null;
              return (
                <View key={mg.id} style={styles.muscleGroupBlock}>
                  <Text style={styles.muscleGroupTitle}>{mg.name}</Text>
                  <View style={styles.chipRow}>
                    {list.map((m) => {
                      const isPrimary = primary.has(m.id);
                      const isSecondary = secondary.has(m.id);
                      return (
                        <Pressable
                          key={m.id}
                          onPress={() => cycleMuscleRole(m.id)}
                          style={({ pressed }) => [
                            styles.muscleChip,
                            isPrimary && styles.muscleChipPrimary,
                            isSecondary && styles.muscleChipSecondary,
                            pressed && styles.btnPressed,
                          ]}>
                          <Text
                            style={[
                              styles.muscleChipText,
                              (isPrimary || isSecondary) && styles.muscleChipTextActive,
                            ]}>
                            {m.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </ScrollView>

      <MgEquipmentPicker
        visible={showMgPicker}
        title="選擇大分類"
        cells={mgPickerCells}
        selectedId={mgId || null}
        onSelect={(id) => setMgId(id)}
        onClose={() => setShowMgPicker(false)}
      />
      <MgEquipmentPicker
        visible={showEquipmentPicker}
        title="選擇用具"
        cells={equipmentPickerCells}
        selectedId={equipment}
        onSelect={(id) => setEquipment(id as Equipment)}
        onClose={() => setShowEquipmentPicker(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerCancel: {
    color: '#0a7ea4',
    fontSize: 17,
    paddingHorizontal: 8,
  },
  headerSave: {
    color: '#0a7ea4',
    fontSize: 17,
    fontWeight: '600',
    paddingHorizontal: 8,
  },
  headerSaveDisabled: { color: '#9CA3AF' },
  body: { padding: 20, gap: 8, paddingBottom: 40 },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginTop: 8,
  },
  helper: { fontSize: 12, color: '#6B7280', marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
  },
  inputError: { borderColor: '#B91C1C' },
  fieldError: { fontSize: 12, color: '#B91C1C', marginTop: 2 },

  pickerRow: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
  },
  pickerRowEmpty: { borderColor: '#FCA5A5' },
  pickerRowText: { fontSize: 15, color: '#111827' },
  pickerRowTextEmpty: { color: '#9CA3AF' },
  pickerRowChevron: { fontSize: 14, color: '#9CA3AF' },

  diagramWrap: { alignItems: 'center', marginVertical: 8 },

  muscleScrollWrap: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    backgroundColor: '#FAFAFA',
    marginTop: 4,
    height: 220,
  },
  muscleScroll: { flex: 1 },
  muscleScrollContent: { padding: 10 },

  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  muscleGroupBlock: { marginTop: 4 },
  muscleGroupTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    marginTop: 6,
    marginBottom: 2,
  },
  muscleChip: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    backgroundColor: 'rgba(127,127,127,0.05)',
  },
  muscleChipPrimary: {
    borderColor: '#F26B3A',
    backgroundColor: 'rgba(242,107,58,0.18)',
  },
  muscleChipSecondary: {
    borderColor: '#7CB6E0',
    backgroundColor: 'rgba(124,182,224,0.18)',
  },
  muscleChipText: { fontSize: 13, color: '#374151' },
  muscleChipTextActive: { fontWeight: '600' },
  btnPressed: { opacity: 0.85 },
});
