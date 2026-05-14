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

import { useDatabase } from '@/components/database-provider';
import {
  validateCustomExerciseDraft,
  type CustomExerciseDraft,
} from '@/src/domain/exercise/exerciseLibrary';
import type { LoadType, Muscle, MuscleGroup } from '@/src/domain/exercise/types';
import {
  createCustomExercise,
  listMuscleGroups,
  listMuscles,
} from '@/src/adapters/sqlite/exerciseLibraryRepository';

const LOAD_TYPES: LoadType[] = ['loaded', 'bodyweight', 'assisted'];
const LOAD_TYPE_LABEL: Record<LoadType, string> = {
  loaded: '加重',
  bodyweight: '徒手',
  assisted: '助力',
};

/**
 * Custom Exercise creation form. Per ADR-0010 #9 v1 allows muscle mapping
 * to be empty so the user isn't forced to fill it out at creation time —
 * they can edit later (in a future slice).
 */
export default function NewExerciseScreen() {
  const db = useDatabase();
  const router = useRouter();
  const [name, setName] = useState('');
  const [loadType, setLoadType] = useState<LoadType>('loaded');
  const [mgId, setMgId] = useState<string | null>(null);
  const [primary, setPrimary] = useState<Set<string>>(new Set());
  const [secondary, setSecondary] = useState<Set<string>>(new Set());
  const [muscleGroups, setMuscleGroups] = useState<MuscleGroup[]>([]);
  const [muscles, setMuscles] = useState<Muscle[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([listMuscleGroups(db), listMuscles(db)]).then(([mgs, ms]) => {
      setMuscleGroups(mgs);
      setMuscles(ms);
    });
  }, [db]);

  const draft: CustomExerciseDraft = useMemo(
    () => ({
      name,
      load_type: loadType,
      muscle_group_id: mgId,
      primaryMuscleIds: Array.from(primary),
      secondaryMuscleIds: Array.from(secondary),
    }),
    [name, loadType, mgId, primary, secondary]
  );

  const errors = useMemo(() => validateCustomExerciseDraft(draft), [draft]);
  const canSubmit = errors.length === 0;

  const togglePrimary = useCallback((id: string) => {
    setPrimary((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        next.add(id);
        // ensure exclusive: clear from secondary
        setSecondary((s) => {
          const ns = new Set(s);
          ns.delete(id);
          return ns;
        });
      }
      return next;
    });
  }, []);

  const toggleSecondary = useCallback((id: string) => {
    setSecondary((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        next.add(id);
        setPrimary((p) => {
          const np = new Set(p);
          np.delete(id);
          return np;
        });
      }
      return next;
    });
  }, []);

  const onSubmit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    try {
      const id = await createCustomExercise(db, draft, () => Crypto.randomUUID());
      router.replace(`/exercise/${id}`);
    } catch (err) {
      Alert.alert('儲存失敗', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const musclesByMg = useMemo(() => {
    const map = new Map<string, Muscle[]>();
    for (const m of muscles) {
      if (!map.has(m.mg_id)) map.set(m.mg_id, []);
      map.get(m.mg_id)!.push(m);
    }
    return map;
  }, [muscles]);

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
        }}
      />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.heading}>新增自訂動作</Text>

        <Text style={styles.label}>名稱</Text>
        <TextInput
          accessibilityLabel="動作名稱"
          placeholder="例：吊環划船"
          value={name}
          onChangeText={setName}
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={60}
        />

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
                      onPress={() => {
                        if (!isPrimary && !isSecondary) {
                          togglePrimary(m.id);
                        } else if (isPrimary) {
                          // primary → secondary
                          setPrimary((p) => {
                            const np = new Set(p);
                            np.delete(m.id);
                            return np;
                          });
                          setSecondary((s) => new Set(s).add(m.id));
                        } else {
                          // secondary → off
                          toggleSecondary(m.id);
                        }
                      }}
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

        {errors.length > 0 && (
          <View style={styles.errors}>
            {errors.map((e, i) => (
              <Text key={i} style={styles.errorText}>• {e.message}</Text>
            ))}
          </View>
        )}

        <Pressable
          accessibilityRole="button"
          disabled={!canSubmit || busy}
          onPress={onSubmit}
          style={({ pressed }) => [
            styles.submitBtn,
            (!canSubmit || busy) && styles.submitBtnDisabled,
            pressed && styles.btnPressed,
          ]}>
          <Text style={styles.submitBtnText}>{busy ? '儲存中…' : '儲存'}</Text>
        </Pressable>
      </ScrollView>
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
  body: { padding: 20, gap: 8 },
  heading: { fontSize: 24, fontWeight: '700', marginBottom: 12 },
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
  errors: {
    backgroundColor: 'rgba(220,38,38,0.10)',
    padding: 10,
    borderRadius: 8,
    marginTop: 8,
  },
  errorText: { fontSize: 13, color: '#B91C1C' },
  submitBtn: {
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#0a7ea4',
    alignItems: 'center',
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { color: 'white', fontWeight: '700', fontSize: 16 },
  btnPressed: { opacity: 0.85 },
});
