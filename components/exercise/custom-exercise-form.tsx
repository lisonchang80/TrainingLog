/**
 * CustomExerciseForm — Slice 9.7 (ADR-0017 Q11 amendment, layout iteration).
 *
 * Shared form for new + edit Custom Exercise flows. Controlled component:
 * caller passes `initial` and `onSubmit`; the form owns its internal state
 * (name / mgId / equipment / primary / secondary) and doesn't read from DB.
 *
 * Q11 amendment 4-row layout:
 *   1. 名稱 — text input (required, dedup, ≤ 60 chars)
 *   2. 大分類 — picker row → MgEquipmentPicker 4×3 (required)
 *   3. 用具 — picker row → MgEquipmentPicker 4×2 (required, default '其他')
 *   4. 訓練部位 — MuscleDiagramTagged (front + back 並列 with labeled leader
 *      lines around each body). Optional — chip count = 19 muscle.
 *
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

import {
  validateCustomExerciseDraft,
  type CustomExerciseDraft,
} from '@/src/domain/exercise/exerciseLibrary';
import {
  EQUIPMENT_VALUES,
  type Equipment,
  type MuscleGroup,
  type MuscleRole,
} from '@/src/domain/exercise/types';
import { t, tEquipment, tMuscleGroup } from '@/src/i18n';

import { MgEquipmentPicker, type PickerCell } from './mg-equipment-picker';
import { MuscleDiagramTagged } from './muscle-diagram-tagged';

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
  onSubmit: (draft: CustomExerciseDraft) => Promise<void>;
  onCancel: () => void;
}

export function CustomExerciseForm({
  title,
  initial,
  existingNames,
  muscleGroups,
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
      // TODO(i18n): 「無法儲存」title — no key (alert.saveFailed ~ 儲存失敗 covers the cause-Alert below).
      Alert.alert('無法儲存', generalErrs.map((e) => e.message).join('\n'));
      return;
    }
    setBusy(true);
    try {
      await onSubmit(draft);
    } catch (err) {
      Alert.alert(t('alert', 'saveFailed'), err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [canSubmit, busy, errors, draft, onSubmit]);

  const highlight = useMemo<Map<string, MuscleRole>>(() => {
    const m = new Map<string, MuscleRole>();
    for (const mid of secondary) m.set(mid, 'secondary');
    for (const mid of primary) m.set(mid, 'primary');
    return m;
  }, [primary, secondary]);

  const nameError = errors.find((e) => e.field === 'name');

  const mgPickerCells: PickerCell[] = useMemo(
    () => muscleGroups.map((mg) => ({ id: mg.id, label: tMuscleGroup(mg.name) })),
    [muscleGroups]
  );
  const equipmentPickerCells: PickerCell[] = useMemo(
    () => EQUIPMENT_VALUES.map((eq) => ({ id: eq, label: tEquipment(eq) })),
    []
  );

  const mgLabel = useMemo(
    // TODO(i18n): 「請選擇大分類」placeholder — no key (alert.pickCategoryFirst body close-ish but different wording)
    () => {
      const mg = muscleGroups.find((m) => m.id === mgId);
      return mg ? tMuscleGroup(mg.name) : '請選擇大分類';
    },
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
              accessibilityLabel={t('common', 'cancel')}
              onPress={onCancel}>
              <Text style={styles.headerCancel}>{t('common', 'cancel')}</Text>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('common', 'save')}
              onPress={handleSubmit}
              disabled={!canSubmit || busy}>
              <Text
                style={[
                  styles.headerSave,
                  (!canSubmit || busy) && styles.headerSaveDisabled,
                ]}>
                {busy ? t('common', 'saving') : t('common', 'save')}
              </Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {/* Row 1: 名稱 */}
        {/* TODO(i18n): 「名稱」field label — no exact key (page.programNamePlaceholder is program-specific) */}
        <Text style={styles.label}>名稱</Text>
        <TextInput
          // TODO(i18n): 「動作名稱」a11y + 「例：吊環划船」placeholder — no keys (page.enterExerciseName is the alert-style copy)
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
        {/* TODO(i18n): 「大分類」/「用具」/「訓練部位（選填）」field labels — no keys yet */}
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
          accessibilityLabel={`用具：${tEquipment(equipment)}`}
          onPress={() => setShowEquipmentPicker(true)}
          style={({ pressed }) => [
            styles.pickerRow,
            pressed && styles.btnPressed,
          ]}>
          <Text style={styles.pickerRowText}>{tEquipment(equipment)}</Text>
          <Text style={styles.pickerRowChevron}>▾</Text>
        </Pressable>

        {/* Row 4: 訓練部位 — 解剖圖 + 標籤同畫面（正面 / 背面並列） */}
        <Text style={styles.label}>訓練部位（選填）</Text>
        {/* TODO(i18n): muscle-tag helper copy — no key */}
        <Text style={styles.helper}>
          點標籤切換：未選 → 主要(橘) → 次要(藍) → 取消。空白時動作詳情頁不顯示解剖圖。
        </Text>

        <View style={styles.diagramWrap}>
          <MuscleDiagramTagged highlight={highlight} onTap={cycleMuscleRole} />
        </View>
      </ScrollView>

      <MgEquipmentPicker
        visible={showMgPicker}
        // TODO(i18n): 「選擇大分類」/「選擇用具」picker titles — no keys (page.selectIntensity covers intensity only)
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
  btnPressed: { opacity: 0.85 },
});
