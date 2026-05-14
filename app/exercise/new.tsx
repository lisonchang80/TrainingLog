import * as Crypto from 'expo-crypto';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useDatabase } from '@/components/database-provider';
import {
  validateCustomExerciseDraft,
  type CustomExerciseDraft,
  type ValidationError,
} from '@/src/domain/exercise/exerciseLibrary';
import { submitNewlyCreated } from '@/src/domain/exercise/pickerBridge';
import {
  EQUIPMENT_VALUES,
  type Equipment,
  type LoadType,
  type Muscle,
  type MuscleGroup,
  type MuscleRole,
} from '@/src/domain/exercise/types';
import {
  createCustomExercise,
  listMuscleGroups,
  listMuscles,
} from '@/src/adapters/sqlite/exerciseLibraryRepository';
import { listExercises } from '@/src/adapters/sqlite/exerciseRepository';

const LOAD_TYPES: LoadType[] = ['loaded', 'bodyweight', 'assisted'];
const LOAD_TYPE_LABEL: Record<LoadType, string> = {
  loaded: '加重',
  bodyweight: '徒手',
  assisted: '助力',
};

/**
 * Custom Exercise creation form. Per ADR-0010 #9 v1 allows muscle mapping
 * to be empty so the user isn't forced to fill it out at creation time —
 * they can edit later.
 *
 * UX:
 *   - Modal header: 取消 (left) / 儲存 (right)
 *   - Inline error under name field; general errors → Alert
 *   - Body diagram is tappable: cycle 未選 → 主要 → 次要 → 取消;
 *     muscle chips stay as a parallel input surface
 */
export default function NewExerciseScreen() {
  const db = useDatabase();
  const router = useRouter();
  const [name, setName] = useState('');
  const [loadType, setLoadType] = useState<LoadType>('loaded');
  const [mgId, setMgId] = useState<string | null>(null);
  const [equipment, setEquipment] = useState<Equipment>('其他');
  const [primary, setPrimary] = useState<Set<string>>(new Set());
  const [secondary, setSecondary] = useState<Set<string>>(new Set());
  const [muscleGroups, setMuscleGroups] = useState<MuscleGroup[]>([]);
  const [muscles, setMuscles] = useState<Muscle[]>([]);
  const [existingNames, setExistingNames] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([listMuscleGroups(db), listMuscles(db), listExercises(db)]).then(
      ([mgs, ms, exs]) => {
        setMuscleGroups(mgs);
        setMuscles(ms);
        setExistingNames(exs.filter((e) => e.is_archived !== 1).map((e) => e.name));
      }
    );
  }, [db]);

  const draft: CustomExerciseDraft = useMemo(
    () => ({
      name,
      load_type: loadType,
      muscle_group_id: mgId,
      equipment,
      primaryMuscleIds: Array.from(primary),
      secondaryMuscleIds: Array.from(secondary),
    }),
    [name, loadType, mgId, equipment, primary, secondary]
  );

  const errors = useMemo(
    () => validateCustomExerciseDraft(draft, { existingNames }),
    [draft, existingNames]
  );
  const canSubmit = errors.length === 0;

  // Cycle a muscle through unselected → primary → secondary → unselected.
  // Used by both muscle chips and body-diagram tap so the two surfaces
  // stay in sync.
  const cycleMuscleRole = useCallback(
    (id: string) => {
      const wasPrimary = primary.has(id);
      const wasSecondary = secondary.has(id);
      if (!wasPrimary && !wasSecondary) {
        setPrimary((p) => new Set(p).add(id));
        return;
      }
      if (wasPrimary) {
        setPrimary((p) => {
          const next = new Set(p);
          next.delete(id);
          return next;
        });
        setSecondary((s) => new Set(s).add(id));
        return;
      }
      // wasSecondary → unselected
      setSecondary((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    },
    [primary, secondary]
  );

  const onSubmit = useCallback(async () => {
    if (!canSubmit || busy) return;
    // Surface general (non-field) errors via Alert; field errors render inline
    const generalErrs = errors.filter((e) => e.field === 'general');
    if (generalErrs.length > 0) {
      Alert.alert('無法儲存', generalErrs.map((e) => e.message).join('\n'));
      return;
    }
    setBusy(true);
    try {
      const id = await createCustomExercise(db, draft, () => Crypto.randomUUID());
      // Hand the new id off to the caller (picker auto-selects it; browse
      // mode silently drains the mailbox on focus).
      submitNewlyCreated(id);
      // Dismiss the modal — caller's useFocusEffect (Library / picker) will
      // refresh and the new exercise appears in the grid.
      router.back();
    } catch (err) {
      Alert.alert('儲存失敗', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [canSubmit, busy, errors, db, draft, router]);

  const musclesByMg = useMemo(() => {
    const map = new Map<string, Muscle[]>();
    for (const m of muscles) {
      if (!map.has(m.mg_id)) map.set(m.mg_id, []);
      map.get(m.mg_id)!.push(m);
    }
    return map;
  }, [muscles]);

  // Build the role-highlight map fed into the body diagram.
  const highlight = useMemo<Map<string, MuscleRole>>(() => {
    const m = new Map<string, MuscleRole>();
    for (const id of secondary) m.set(id, 'secondary');
    for (const id of primary) m.set(id, 'primary'); // primary wins on overlap
    return m;
  }, [primary, secondary]);

  const nameError = errors.find((e) => e.field === 'name');

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen
        options={{
          title: '新增自訂動作',
          headerLeft: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="取消"
              onPress={() => router.back()}>
              <Text style={styles.headerCancel}>取消</Text>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="儲存"
              onPress={onSubmit}
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
      <ScrollView contentContainerStyle={styles.body}>
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
        {nameError && (
          <Text style={styles.fieldError}>{nameError.message}</Text>
        )}

        <Text style={styles.label}>Load type</Text>
        <View style={styles.chipRow}>
          {LOAD_TYPES.map((lt) => (
            <Pressable
              key={lt}
              onPress={() => setLoadType(lt)}
              style={({ pressed }) => [
                styles.chip,
                loadType === lt && styles.chipActive,
                pressed && styles.btnPressed,
              ]}>
              <Text style={[styles.chipText, loadType === lt && styles.chipTextActive]}>
                {LOAD_TYPE_LABEL[lt]}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>器械（ADR-0017 Q6）</Text>
        <View style={styles.chipRow}>
          {EQUIPMENT_VALUES.map((eq) => (
            <Pressable
              key={eq}
              onPress={() => setEquipment(eq)}
              style={({ pressed }) => [
                styles.chip,
                equipment === eq && styles.chipActive,
                pressed && styles.btnPressed,
              ]}>
              <Text style={[styles.chipText, equipment === eq && styles.chipTextActive]}>
                {eq}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>主要 Muscle Group（可選）</Text>
        <View style={styles.chipRow}>
          <Pressable
            onPress={() => setMgId(null)}
            style={({ pressed }) => [
              styles.chip,
              !mgId && styles.chipActive,
              pressed && styles.btnPressed,
            ]}>
            <Text style={[styles.chipText, !mgId && styles.chipTextActive]}>未指定</Text>
          </Pressable>
          {muscleGroups.map((mg) => (
            <Pressable
              key={mg.id}
              onPress={() => setMgId(mg.id)}
              style={({ pressed }) => [
                styles.chip,
                mgId === mg.id && styles.chipActive,
                pressed && styles.btnPressed,
              ]}>
              <Text style={[styles.chipText, mgId === mg.id && styles.chipTextActive]}>
                {mg.name}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>主要 / 次要 muscle</Text>
        <Text style={styles.helper}>
          點兩下切換：未選 → 主要 → 次要 → 取消。空白也 OK（可日後補）。
        </Text>

        <View style={styles.diagramWrap}>
          <BodyDiagram highlight={highlight} onMusclePress={cycleMuscleRole} />
          <BodyDiagramLegend />
        </View>

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
    </SafeAreaView>
  );
}

// Discard the unused ValidationError import warning at module level if linter
// strips it; the type re-export keeps it referenced.
export type { ValidationError };

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
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(127,127,127,0.10)',
  },
  chipActive: { backgroundColor: '#0a7ea4' },
  chipText: { fontSize: 13, color: '#374151' },
  chipTextActive: { color: 'white', fontWeight: '600' },
  diagramWrap: { alignItems: 'center', marginVertical: 8 },
  muscleGroupBlock: { marginTop: 4 },
  muscleGroupTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
    marginTop: 6,
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
