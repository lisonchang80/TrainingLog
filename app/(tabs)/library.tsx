import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
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
  filterExercises,
  type ExerciseFilter,
} from '@/src/domain/exercise/exerciseLibrary';
import type {
  Exercise,
  ExerciseMuscleLink,
  LoadType,
  Muscle,
  MuscleGroup,
} from '@/src/domain/exercise/types';
import {
  listExercisesWithLinks,
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
 * Library tab — list every Exercise (built-in + custom) with chip filters by
 * muscle group, muscle, load_type, and free-text search. Tapping an Exercise
 * row opens the detail page with the body diagram. "+ Custom" launches the
 * Custom Exercise form.
 */
export default function LibraryScreen() {
  const db = useDatabase();
  const router = useRouter();
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [links, setLinks] = useState<ExerciseMuscleLink[]>([]);
  const [muscleGroups, setMuscleGroups] = useState<MuscleGroup[]>([]);
  const [muscles, setMuscles] = useState<Muscle[]>([]);

  const [filter, setFilter] = useState<ExerciseFilter>({});

  const refresh = useCallback(async () => {
    const [{ exercises, links }, mgs, ms] = await Promise.all([
      listExercisesWithLinks(db),
      listMuscleGroups(db),
      listMuscles(db),
    ]);
    setExercises(exercises);
    setLinks(links);
    setMuscleGroups(mgs);
    setMuscles(ms);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const filtered = useMemo(
    () => filterExercises(exercises, links, filter),
    [exercises, links, filter]
  );

  const musclesInSelectedMg = useMemo(() => {
    if (!filter.muscleGroupId) return muscles;
    return muscles.filter((m) => m.mg_id === filter.muscleGroupId);
  }, [muscles, filter.muscleGroupId]);

  const setMg = (id: string | null) => {
    setFilter((prev) => ({ ...prev, muscleGroupId: id, muscleId: null }));
  };
  const setMuscle = (id: string | null) => {
    setFilter((prev) => ({ ...prev, muscleId: id }));
  };
  const setLoad = (lt: LoadType | null) => {
    setFilter((prev) => ({ ...prev, loadType: lt }));
  };
  const setSearch = (s: string) => {
    setFilter((prev) => ({ ...prev, search: s }));
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.headerRow}>
          <Text style={styles.heading}>Library</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/exercise/new')}
            style={({ pressed }) => [styles.newBtn, pressed && styles.btnPressed]}>
            <Text style={styles.newBtnText}>+ Custom</Text>
          </Pressable>
        </View>

        <TextInput
          accessibilityLabel="搜尋動作名稱"
          placeholder="搜尋動作名稱"
          value={filter.search ?? ''}
          onChangeText={setSearch}
          style={styles.search}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.filterLabel}>Muscle Group</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <FilterChip label="全部" active={!filter.muscleGroupId} onPress={() => setMg(null)} />
          {muscleGroups.map((mg) => (
            <FilterChip
              key={mg.id}
              label={mg.name}
              active={filter.muscleGroupId === mg.id}
              onPress={() => setMg(mg.id)}
            />
          ))}
        </ScrollView>

        <Text style={styles.filterLabel}>Muscle</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <FilterChip label="全部" active={!filter.muscleId} onPress={() => setMuscle(null)} />
          {musclesInSelectedMg.map((m) => (
            <FilterChip
              key={m.id}
              label={m.name}
              active={filter.muscleId === m.id}
              onPress={() => setMuscle(m.id)}
            />
          ))}
        </ScrollView>

        <Text style={styles.filterLabel}>Load type</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <FilterChip label="全部" active={!filter.loadType} onPress={() => setLoad(null)} />
          {LOAD_TYPES.map((lt) => (
            <FilterChip
              key={lt}
              label={LOAD_TYPE_LABEL[lt]}
              active={filter.loadType === lt}
              onPress={() => setLoad(lt)}
            />
          ))}
        </ScrollView>

        <Text style={styles.resultCount}>{filtered.length} 個動作</Text>

        {filtered.length === 0 ? (
          <Text style={styles.empty}>沒有符合的動作。試著放寬篩選條件。</Text>
        ) : (
          filtered.map((ex) => (
            <Pressable
              key={ex.id}
              accessibilityRole="button"
              onPress={() => router.push(`/exercise/${ex.id}`)}
              style={({ pressed }) => [styles.row, pressed && styles.btnPressed]}>
              <View style={styles.rowMain}>
                <Text style={styles.rowName}>{ex.name}</Text>
                <Text style={styles.rowDetails}>
                  {ex.muscle_group_id
                    ? muscleGroups.find((mg) => mg.id === ex.muscle_group_id)?.name ?? ''
                    : '未分類'}
                  {' · '}
                  {LOAD_TYPE_LABEL[ex.load_type]}
                  {ex.is_custom === 1 ? ' · 自訂' : ''}
                </Text>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        active && styles.chipActive,
        pressed && styles.btnPressed,
      ]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { padding: 16, gap: 8 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  heading: { fontSize: 28, fontWeight: '700' },
  newBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: '#0a7ea4',
  },
  newBtnText: { color: 'white', fontWeight: '600' },
  search: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
    marginBottom: 4,
  },
  filterLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    marginTop: 4,
  },
  chipRow: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 4,
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
  resultCount: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 8,
  },
  empty: { fontSize: 14, opacity: 0.6, fontStyle: 'italic', marginTop: 12 },
  row: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(127,127,127,0.08)',
  },
  rowMain: { gap: 4 },
  rowName: { fontSize: 16, fontWeight: '600' },
  rowDetails: { fontSize: 12, opacity: 0.7 },
  btnPressed: { opacity: 0.85 },
});
