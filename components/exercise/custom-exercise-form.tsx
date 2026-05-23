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
import { t, tEquipment, tMuscle, tMuscleGroup } from '@/src/i18n';
import {
  M_ABS,
  M_BACK,
  M_BICEP_LONG,
  M_BICEP_SHORT,
  M_CALF,
  M_FOREARM,
  M_FRONT_DELT,
  M_HAMSTRING,
  M_LOWER_BACK,
  M_LOWER_CHEST,
  M_LOWER_GLUTE,
  M_MID_DELT,
  M_OBLIQUE,
  M_QUAD,
  M_REAR_DELT,
  M_TRAP,
  M_TRICEP,
  M_UPPER_CHEST,
  M_UPPER_GLUTE,
} from '@/src/db/seed/v006ExerciseLibrary';

import { MgEquipmentPicker, type PickerCell } from './mg-equipment-picker';
import { MuscleBodyTagger } from './muscle-body-tagger';

/**
 * 19 M_* in 5×4 grid order matching reference fitness app body chart:
 *   row 1: trap / upper-chest / lower-chest / back / lower-back
 *   row 2: calf / forearm / tricep / bicep-short / bicep-long
 *   row 3: rear-delt / mid-delt / front-delt / oblique / abs
 *   row 4: upper-glute / lower-glute / hamstring / quad
 */
const M_BUTTONS: readonly string[] = [
  M_TRAP, M_UPPER_CHEST, M_LOWER_CHEST, M_BACK, M_LOWER_BACK,
  M_CALF, M_FOREARM, M_TRICEP, M_BICEP_SHORT, M_BICEP_LONG,
  M_REAR_DELT, M_MID_DELT, M_FRONT_DELT, M_OBLIQUE, M_ABS,
  M_UPPER_GLUTE, M_LOWER_GLUTE, M_HAMSTRING, M_QUAD,
];

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

  // Button-grid toggle handlers (per role section).
  // Primary tap: if already primary → clear; else → set primary (and clear secondary if any).
  // Secondary tap: if already secondary → clear; else → set secondary (and clear primary if any).
  const togglePrimary = useCallback((mid: string) => {
    setPrimary((p) => {
      const np = new Set(p);
      if (np.has(mid)) {
        np.delete(mid);
      } else {
        np.add(mid);
        setSecondary((s) => {
          if (!s.has(mid)) return s;
          const ns = new Set(s);
          ns.delete(mid);
          return ns;
        });
      }
      return np;
    });
  }, []);

  const toggleSecondary = useCallback((mid: string) => {
    setSecondary((s) => {
      const ns = new Set(s);
      if (ns.has(mid)) {
        ns.delete(mid);
      } else {
        ns.add(mid);
        setPrimary((p) => {
          if (!p.has(mid)) return p;
          const np = new Set(p);
          np.delete(mid);
          return np;
        });
      }
      return ns;
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || busy) return;
    const generalErrs = errors.filter((e) => e.field === 'general');
    if (generalErrs.length > 0) {
      Alert.alert(t('alert', 'cannotSave'), generalErrs.map((e) => e.message).join('\n'));
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
    () => {
      const mg = muscleGroups.find((m) => m.id === mgId);
      return mg ? tMuscleGroup(mg.name) : t('page', 'pickCategoryPlaceholder');
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
        <Text style={styles.label}>{t('page', 'nameFieldLabel')}</Text>
        <TextInput
          accessibilityLabel={t('page', 'exerciseNameA11y')}
          placeholder={t('page', 'exerciseNameExamplePlaceholder')}
          value={name}
          onChangeText={setName}
          style={[styles.input, nameError && styles.inputError]}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={60}
        />
        {nameError && <Text style={styles.fieldError}>{nameError.message}</Text>}

        {/* Row 2: 大分類 picker row */}
        <Text style={styles.label}>{t('page', 'categoryLabel')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('page', 'categoryLabel')}：${mgLabel}`}
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
        <Text style={styles.label}>{t('page', 'equipmentLabel')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('page', 'equipmentLabel')}：${tEquipment(equipment)}`}
          onPress={() => setShowEquipmentPicker(true)}
          style={({ pressed }) => [
            styles.pickerRow,
            pressed && styles.btnPressed,
          ]}>
          <Text style={styles.pickerRowText}>{tEquipment(equipment)}</Text>
          <Text style={styles.pickerRowChevron}>▾</Text>
        </Pressable>

        {/* Row 4: 訓練部位 — 按鈕格 + 解剖圖（reference 風格）*/}
        <Text style={styles.label}>{t('page', 'muscleGroupOptionalLabel')}</Text>
        <Text style={styles.helper}>
          {t('page', 'muscleTagHelper')}
        </Text>

        {/* TODO(i18n): 主要/次要訓練部位 headings */}
        <Text style={styles.sectionLabel}>主要訓練部位</Text>
        <View style={styles.btnGrid}>
          {M_BUTTONS.map((mid) => {
            const active = primary.has(mid);
            return (
              <Pressable
                key={`p-${mid}`}
                accessibilityRole="button"
                accessibilityLabel={`${tMuscle(mid)} 主要`}
                onPress={() => togglePrimary(mid)}
                style={({ pressed }) => [
                  styles.muscleBtn,
                  active && styles.muscleBtnPrimaryActive,
                  pressed && styles.btnPressed,
                ]}>
                <Text style={[styles.muscleBtnText, active && styles.muscleBtnTextActive]}>
                  {tMuscle(mid)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionLabel}>次要訓練部位</Text>
        <View style={styles.btnGrid}>
          {M_BUTTONS.map((mid) => {
            const active = secondary.has(mid);
            return (
              <Pressable
                key={`s-${mid}`}
                accessibilityRole="button"
                accessibilityLabel={`${tMuscle(mid)} 次要`}
                onPress={() => toggleSecondary(mid)}
                style={({ pressed }) => [
                  styles.muscleBtn,
                  active && styles.muscleBtnSecondaryActive,
                  pressed && styles.btnPressed,
                ]}>
                <Text style={[styles.muscleBtnText, active && styles.muscleBtnTextActive]}>
                  {tMuscle(mid)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.diagramWrap}>
          <MuscleBodyTagger
            highlight={highlight}
            mode="readonly"
          />
        </View>
      </ScrollView>

      <MgEquipmentPicker
        visible={showMgPicker}
        title={t('page', 'selectCategory')}
        cells={mgPickerCells}
        selectedId={mgId || null}
        onSelect={(id) => setMgId(id)}
        onClose={() => setShowMgPicker(false)}
      />
      <MgEquipmentPicker
        visible={showEquipmentPicker}
        title={t('page', 'selectEquipment')}
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

  // muscle button grid (reference-style 5-col layout, primary + secondary sections)
  sectionLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginTop: 16,
    marginBottom: 8,
  },
  btnGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  muscleBtn: {
    flexBasis: '18.5%',
    flexGrow: 1,
    minHeight: 38,
    paddingHorizontal: 4,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  muscleBtnPrimaryActive: {
    backgroundColor: '#F26B3A',
  },
  muscleBtnSecondaryActive: {
    backgroundColor: '#7CB6E0',
  },
  muscleBtnText: {
    fontSize: 12,
    color: '#374151',
    textAlign: 'center',
  },
  muscleBtnTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
