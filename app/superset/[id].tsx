import {
  useFocusEffect,
  useLocalSearchParams,
  useNavigation,
  useRouter,
} from 'expo-router';
import { useCallback, useLayoutEffect, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabase } from '@/components/database-provider';
import { hashColor } from '@/components/template-editor/palette';
import type { Exercise } from '@/src/domain/exercise/types';
import type { ReusableSupersetWithExercises } from '@/src/domain/superset/types';
import {
  deleteReusableSuperset,
  getReusableSupersetSessionCount,
  getReusableSupersetWithExercises,
} from '@/src/adapters/sqlite/supersetRepository';

/**
 * Reusable Superset detail page (ADR-0017 Q17 / slice 9.8a).
 *
 * Layout per Q17 main page (L228-234):
 *   - title + color indicator
 *   - 2 exercise thumbnails horizontal (tap → push /exercise/[id])
 *   - no media (each child exercise has its own)
 *   - no muscle diagram (two distinct exercises, can't be merged)
 *
 * Footer aligns the普通 Exercise idiom shipped in slice 9.7 (per Q5 grill):
 *   [歷史] [圖表] [編輯] [刪除]
 *
 * 9.8a scope disables 歷史 / 圖表 (no session data possible without explode
 * integration shipped in 9.8b). 9.8c will enable them once data exists.
 */
export default function SupersetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDatabase();
  const router = useRouter();
  const navigation = useNavigation();
  const [data, setData] = useState<ReusableSupersetWithExercises | null>(null);
  // Slice 10c #24 — dynamic session count (replaces `superset.use_count`,
  // which only bumps on Template explode and under-counts real usage).
  const [sessionCount, setSessionCount] = useState<number>(0);

  const refresh = useCallback(async () => {
    if (!id) return;
    const [d, n] = await Promise.all([
      getReusableSupersetWithExercises(db, id),
      getReusableSupersetSessionCount(db, id),
    ]);
    setData(d);
    setSessionCount(n);
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
      title: '超級組詳情',
      headerBackVisible: false,
      headerLeft: renderHeaderLeft,
      headerRight: undefined,
    });
  }, [navigation, renderHeaderLeft]);

  if (!data) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.body}>
          <Text style={styles.placeholder}>超級組不存在或已刪除。</Text>
        </View>
      </SafeAreaView>
    );
  }

  const { superset, exercises } = data;
  const barColor = superset.color_hex ?? hashColor(superset.name);
  const exA = exercises[0];
  const exB = exercises[1];

  const onDelete = () => {
    Alert.alert(
      '刪除超級組',
      `確認刪除「${superset.name}」？已加進 Template 的副本會保留。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '刪除',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteReusableSuperset(db, superset.id);
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
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.titleRow}>
          <View style={[styles.colorDot, { backgroundColor: barColor }]} />
          <Text style={styles.heading}>{superset.name}</Text>
        </View>
        <Text style={styles.subheading}>
          超級組
          {sessionCount > 0 ? ` · 已使用 ${sessionCount} 次` : ''}
        </Text>

        <View style={styles.exercisesRow}>
          <ExerciseTile
            exercise={exA}
            onPress={
              exA ? () => router.push(`/exercise/${exA.id}`) : undefined
            }
          />
          <Text style={styles.plus}>+</Text>
          <ExerciseTile
            exercise={exB}
            onPress={
              exB ? () => router.push(`/exercise/${exB.id}`) : undefined
            }
          />
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {/* Slice 10c — independent superset history/chart pages were dropped
            in favor of the 3-段 cluster filter on the per-exercise pages.
            We funnel "歷史" / "圖表" to the A-side exercise pre-set to
            cluster_only so the user lands on the same shared cluster view. */}
        <FooterButton
          label="歷史"
          onPress={() =>
            exA
              ? router.push(
                  // Slice 10c overnight #11 — carry `partner=B.id` so the
                  // destination renders the A↔B switcher. RS always has both
                  // sides; `exB?.id ?? ''` is a safe fallback — an empty
                  // partner trips the switcher's null-guard → falls back to
                  // the plain '動作歷史' title.
                  `/exercise-history/${exA.id}?clusterMode=cluster_only&partner=${exB?.id ?? ''}&side=A`,
                )
              : undefined
          }
        />
        <FooterButton
          label="圖表"
          onPress={() =>
            exA
              ? router.push(
                  `/exercise-chart/${exA.id}?clusterMode=cluster_only&partner=${exB?.id ?? ''}&side=A`,
                )
              : undefined
          }
        />
        <FooterButton
          label="編輯"
          onPress={() => router.push(`/superset/edit/${superset.id}`)}
        />
        <FooterButton label="刪除" destructive onPress={onDelete} />
      </View>
    </SafeAreaView>
  );
}

function ExerciseTile({
  exercise,
  onPress,
}: {
  exercise: Exercise | undefined;
  onPress: (() => void) | undefined;
}) {
  if (!exercise) {
    return (
      <View style={[styles.tile, styles.tileEmpty]}>
        <Text style={styles.tileMissing}>動作遺失</Text>
      </View>
    );
  }
  const thumbnail = exercise.media_path;
  const bg = hashColor(exercise.name || exercise.id);
  const ch = exercise.name?.charAt(0) ?? '?';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`查看 ${exercise.name} 詳情`}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
      <View style={styles.tileThumb}>
        {thumbnail ? (
          <Image source={{ uri: thumbnail }} style={styles.tileThumbImage} />
        ) : (
          <View
            style={[styles.tileThumbPlaceholder, { backgroundColor: bg }]}>
            <Text style={styles.tileThumbInitial}>{ch}</Text>
          </View>
        )}
      </View>
      <Text style={styles.tileName} numberOfLines={2}>
        {exercise.name}
      </Text>
    </Pressable>
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
      disabled={disabled}
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

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { padding: 20, gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  colorDot: { width: 14, height: 14, borderRadius: 7 },
  heading: { fontSize: 26, fontWeight: '700', flexShrink: 1 },
  subheading: { fontSize: 14, opacity: 0.7, marginBottom: 4 },
  placeholder: { fontSize: 14, opacity: 0.6, padding: 24 },
  exercisesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginTop: 12,
  },
  tile: {
    flex: 1,
    borderRadius: 14,
    padding: 14,
    backgroundColor: 'rgba(127,127,127,0.10)',
    alignItems: 'center',
  },
  tileEmpty: {
    opacity: 0.5,
  },
  tileMissing: { fontSize: 13, opacity: 0.5, fontStyle: 'italic' },
  tileThumb: {
    width: 80,
    height: 80,
    borderRadius: 40,
    overflow: 'hidden',
    marginBottom: 8,
    backgroundColor: '#fff',
  },
  tileThumbImage: { width: '100%', height: '100%' },
  tileThumbPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileThumbInitial: { color: '#fff', fontSize: 32, fontWeight: '700' },
  tileName: { fontSize: 14, fontWeight: '600', textAlign: 'center' },
  plus: { fontSize: 22, fontWeight: '600', opacity: 0.7 },
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
  pressed: { opacity: 0.7 },
});
