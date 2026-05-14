import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BodyDiagram, BodyDiagramLegend } from '@/components/body-diagram';
import { useDatabase } from '@/components/database-provider';
import { muscleHighlightMap } from '@/src/domain/exercise/exerciseLibrary';
import type {
  ExerciseWithMuscles,
  Muscle,
  MuscleGroup,
  MuscleRole,
} from '@/src/domain/exercise/types';
import {
  getExerciseMuscleLinks,
  getExerciseWithMuscles,
  listMuscleGroups,
} from '@/src/adapters/sqlite/exerciseLibraryRepository';

const LOAD_TYPE_LABEL: Record<string, string> = {
  loaded: '加重 (loaded)',
  bodyweight: '徒手 (bodyweight)',
  assisted: '助力 (assisted)',
};

/**
 * Exercise detail page — shows the muscle activation chips + the body diagram.
 *
 * Per ADR-0010 acceptance criterion #4: 19 muscle individual highlight,
 * primary in warm color, secondary in cool color.
 */
export default function ExerciseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDatabase();
  const router = useRouter();
  const [data, setData] = useState<ExerciseWithMuscles | null>(null);
  const [highlight, setHighlight] = useState<Map<string, MuscleRole>>(new Map());
  const [muscleGroups, setMuscleGroups] = useState<MuscleGroup[]>([]);

  const refresh = useCallback(async () => {
    if (!id) return;
    const [d, links, mgs] = await Promise.all([
      getExerciseWithMuscles(db, id),
      getExerciseMuscleLinks(db, id),
      listMuscleGroups(db),
    ]);
    setData(d);
    setHighlight(muscleHighlightMap(links));
    setMuscleGroups(mgs);
  }, [db, id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const screenOptions = {
    title: '動作詳情',
    headerBackTitle: '返回',
    headerRight: () => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="完成"
        onPress={() => router.back()}>
        <Text style={styles.headerDone}>完成</Text>
      </Pressable>
    ),
  };

  if (!data) {
    return (
      <SafeAreaView style={styles.container}>
        <Stack.Screen options={screenOptions} />
        <View style={styles.body}>
          <Text style={styles.placeholder}>動作不存在或已封存。</Text>
        </View>
      </SafeAreaView>
    );
  }

  const mg = data.exercise.muscle_group_id
    ? muscleGroups.find((g) => g.id === data.exercise.muscle_group_id)
    : null;

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={screenOptions} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.heading}>{data.exercise.name}</Text>
        <Text style={styles.subheading}>
          {mg ? `${mg.name} · ` : ''}
          {LOAD_TYPE_LABEL[data.exercise.load_type] ?? data.exercise.load_type}
          {data.exercise.is_custom === 1 ? ' · 自訂' : ''}
        </Text>

        <View style={styles.diagramCard}>
          <BodyDiagram highlight={highlight} />
          <BodyDiagramLegend />
        </View>

        <MuscleSection title="主要" color="#F26B3A" muscles={data.primary} />
        <MuscleSection title="次要" color="#7CB6E0" muscles={data.secondary} />
      </ScrollView>
    </SafeAreaView>
  );
}

function MuscleSection({
  title,
  color,
  muscles,
}: {
  title: string;
  color: string;
  muscles: Muscle[];
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={[styles.sectionSwatch, { backgroundColor: color }]} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {muscles.length === 0 ? (
        <Text style={styles.empty}>無</Text>
      ) : (
        <View style={styles.chipRow}>
          {muscles.map((m) => (
            <View key={m.id} style={[styles.muscleChip, { borderColor: color }]}>
              <Text style={styles.muscleChipText}>{m.name}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { padding: 20, gap: 12 },
  heading: { fontSize: 26, fontWeight: '700' },
  subheading: { fontSize: 14, opacity: 0.7, marginBottom: 4 },
  placeholder: { fontSize: 14, opacity: 0.6, padding: 24 },
  diagramCard: {
    borderRadius: 14,
    padding: 12,
    backgroundColor: 'rgba(127,127,127,0.06)',
    alignItems: 'center',
  },
  section: { gap: 6, marginTop: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionSwatch: { width: 14, height: 14, borderRadius: 4 },
  sectionTitle: { fontSize: 16, fontWeight: '600' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  muscleChip: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1.5,
    backgroundColor: 'rgba(255,255,255,0.0)',
  },
  muscleChipText: { fontSize: 13 },
  empty: { fontSize: 13, opacity: 0.5, fontStyle: 'italic' },
  headerDone: {
    color: '#0a7ea4',
    fontSize: 17,
    fontWeight: '600',
    paddingHorizontal: 8,
  },
});
