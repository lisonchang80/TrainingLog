import {
  useFocusEffect,
  useLocalSearchParams,
  useNavigation,
  useRouter,
} from 'expo-router';
import { useCallback, useLayoutEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
  archiveCustomExercise,
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
  const navigation = useNavigation();
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

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const renderHeaderLeft = useCallback(
    () => (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="返回"
        onPress={() => router.back()}
        hitSlop={12}>
        <Text style={styles.headerBack}>‹ 返回</Text>
      </Pressable>
    ),
    [router]
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      title: '動作詳情',
      headerBackVisible: false,
      headerLeft: renderHeaderLeft,
      headerRight: undefined,
    });
  }, [navigation, renderHeaderLeft]);

  if (!data) {
    return (
      <SafeAreaView style={styles.container}>
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
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.heading}>{data.exercise.name}</Text>
        <Text style={styles.subheading}>
          {mg ? `${mg.name} · ` : ''}
          {LOAD_TYPE_LABEL[data.exercise.load_type] ?? data.exercise.load_type}
          {` · ${data.exercise.equipment}`}
          {data.exercise.is_custom === 1 ? ' · 自訂' : ''}
        </Text>

        {(data.primary.length > 0 || data.secondary.length > 0) && (
          <View style={styles.diagramCard}>
            <BodyDiagram highlight={highlight} />
            <BodyDiagramLegend />
          </View>
        )}

        <MuscleSection title="主要" color="#F26B3A" muscles={data.primary} />
        <MuscleSection title="次要" color="#7CB6E0" muscles={data.secondary} />
      </ScrollView>

      <View style={styles.footer}>
        <FooterButton
          label="歷史"
          onPress={() => router.push(`/exercise-history/${id}`)}
        />
        <FooterButton
          label="圖表"
          onPress={() => router.push(`/exercise-chart/${id}`)}
        />
        <FooterButton
          label="編輯"
          disabled={data.exercise.is_custom !== 1}
          onPress={() => {
            if (data.exercise.is_custom === 1) {
              router.push(`/exercise/edit/${id}`);
            } else {
              Alert.alert('編輯動作', '內建動作目前無可編輯內容。');
            }
          }}
        />
        <FooterButton
          label="刪除"
          destructive
          disabled={data.exercise.is_custom !== 1}
          onPress={() => {
            if (data.exercise.is_custom !== 1) {
              Alert.alert('刪除動作', '內建動作無法刪除。');
              return;
            }
            Alert.alert(
              '刪除動作',
              `確認刪除「${data.exercise.name}」？歷史紀錄會保留，但動作會從動作庫移除。`,
              [
                { text: '取消', style: 'cancel' },
                {
                  text: '刪除',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await archiveCustomExercise(db, id);
                      router.back();
                    } catch (err) {
                      Alert.alert(
                        '刪除失敗',
                        err instanceof Error ? err.message : String(err)
                      );
                    }
                  },
                },
              ]
            );
          }}
        />
      </View>
    </SafeAreaView>
  );
}

function FooterButton({
  label,
  onPress,
  disabled,
  destructive,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.footerBtn,
        pressed && !disabled && styles.footerBtnPressed,
      ]}>
      <Text
        style={[
          styles.footerBtnText,
          destructive && !disabled && styles.footerBtnTextDestructive,
          disabled && styles.footerBtnTextDisabled,
        ]}>
        {label}
      </Text>
    </Pressable>
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
  headerBack: {
    color: '#0a7ea4',
    fontSize: 17,
    fontWeight: '400',
    paddingHorizontal: 8,
  },
  footer: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(127,127,127,0.3)',
    backgroundColor: 'rgba(255,255,255,0.0)',
  },
  footerBtn: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerBtnPressed: { opacity: 0.4 },
  footerBtnText: { fontSize: 16, fontWeight: '500', color: '#0a7ea4' },
  footerBtnTextDisabled: { color: 'rgba(127,127,127,0.5)' },
  footerBtnTextDestructive: { color: '#DC2626' },
});
