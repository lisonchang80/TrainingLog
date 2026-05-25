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
import { useTheme, type ThemeTokens } from '@/src/theme';

import { MgEquipmentPicker, type PickerCell } from './mg-equipment-picker';
import { MuscleBodyTagger } from './muscle-body-tagger';

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
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
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
          placeholderTextColor={tokens.text.tertiary}
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

        {/* Tap-cycle 模式：點一次 → 主要 (橘)、再點 → 次要 (藍)、再點 → 取消。
            cycleMuscleRole 已封裝 untagged → primary → secondary → untagged。 */}
        <View style={styles.diagramWrap}>
          <MuscleBodyTagger
            highlight={highlight}
            mode="tap-cycle"
            onTap={cycleMuscleRole}
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

function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: tokens.bg.base },
    headerCancel: {
      color: tokens.action.primary,
      fontSize: 17,
      paddingHorizontal: 8,
    },
    headerSave: {
      color: tokens.action.primary,
      fontSize: 17,
      fontWeight: '600',
      paddingHorizontal: 8,
    },
    headerSaveDisabled: { color: tokens.text.tertiary },
    body: { padding: 20, gap: 8, paddingBottom: 40 },
    label: {
      fontSize: 13,
      fontWeight: '600',
      color: tokens.text.primary,
      marginTop: 8,
    },
    helper: {
      fontSize: 12,
      color: tokens.text.secondary,
      marginBottom: 4,
    },
    input: {
      borderWidth: 1,
      borderColor: tokens.border.default,
      borderRadius: 8,
      padding: 10,
      fontSize: 15,
      color: tokens.text.primary,
      backgroundColor: tokens.bg.surface,
    },
    inputError: { borderColor: tokens.action.destructive },
    fieldError: {
      fontSize: 12,
      color: tokens.action.destructive,
      marginTop: 2,
    },

    pickerRow: {
      borderWidth: 1,
      borderColor: tokens.border.default,
      borderRadius: 8,
      paddingVertical: 12,
      paddingHorizontal: 12,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: tokens.bg.surface,
    },
    pickerRowEmpty: { borderColor: tokens.action.destructive },
    pickerRowText: { fontSize: 15, color: tokens.text.primary },
    pickerRowTextEmpty: { color: tokens.text.tertiary },
    pickerRowChevron: { fontSize: 14, color: tokens.text.tertiary },

    diagramWrap: { alignItems: 'center', marginVertical: 8 },
    btnPressed: { opacity: 0.85 },
  });
}
