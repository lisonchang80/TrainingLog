import {
  useFocusEffect,
  useLocalSearchParams,
  useNavigation,
  useRouter,
} from 'expo-router';
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
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
import { resolveExerciseMedia } from '@/src/db/seed/exerciseMediaMap';
import {
  t,
  tDeleteSupersetPrompt,
  tExercise,
  tUsedNSessions,
  tViewExerciseDetails,
} from '@/src/i18n';
import { useTheme, type ThemeTokens } from '@/src/theme';

import {
  CoachMarkProvider,
  HelpButton,
  PageHelpHost,
  useCoachMarkTarget,
  usePageHelp,
} from '@/components/help';
import { supersetDetailHelp } from '@/components/help/content/superset-detail';

/**
 * ADR-0025 — DRY hook for the 3 components in this file that share one
 * memoised style sheet.
 */
function useSupersetStyles() {
  const { tokens } = useTheme();
  return useMemo(() => makeStyles(tokens), [tokens]);
}

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
function SupersetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDatabase();
  const router = useRouter();
  const navigation = useNavigation();
  const styles = useSupersetStyles();
  const help = usePageHelp('superset-detail', supersetDetailHelp, {
    autoShowOnce: true,
  });
  const pairTarget = useCoachMarkTarget('superset.pair');
  const footerTarget = useCoachMarkTarget('superset.footer');
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
        accessibilityLabel={t('common', 'backPlain')}
        onPress={() => router.back()}
        hitSlop={12}>
        <Text style={styles.headerBack}>{t('common', 'backArrow')}</Text>
      </Pressable>
    ),
    [router, styles.headerBack]
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      title: t('page', 'supersetDetails'),
      headerBackVisible: false,
      headerLeft: renderHeaderLeft,
      headerRight: () => <HelpButton onPress={help.open} />,
    });
  }, [navigation, renderHeaderLeft, help.open]);

  if (!data) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.body}>
          <Text style={styles.placeholder}>{t('alert', 'supersetNotFound')}</Text>
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
      t('button', 'deleteSuperset'),
      tDeleteSupersetPrompt(superset.name),
      [
        { text: t('common', 'cancel'), style: 'cancel' },
        {
          text: t('common', 'delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteReusableSuperset(db, superset.id);
              router.back();
            } catch (err) {
              Alert.alert(
                t('alert', 'deleteFailed'),
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
          {t('domain', 'superset')}
          {sessionCount > 0 ? ' ' + tUsedNSessions(sessionCount) : ''}
        </Text>

        <View
          style={styles.exercisesRow}
          ref={pairTarget.ref}
          collapsable={false}>
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

      <View style={styles.footer} ref={footerTarget.ref} collapsable={false}>
        {/* Slice 10c — independent superset history/chart pages were dropped
            in favor of the 3-段 cluster filter on the per-exercise pages.
            We funnel "歷史" / "圖表" to the A-side exercise pre-set to
            cluster_only so the user lands on the same shared cluster view. */}
        <FooterButton
          label={t('domain', 'history')}
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
          label={t('domain', 'chart')}
          onPress={() =>
            exA
              ? router.push(
                  `/exercise-chart/${exA.id}?clusterMode=cluster_only&partner=${exB?.id ?? ''}&side=A`,
                )
              : undefined
          }
        />
        <FooterButton
          label={t('common', 'edit')}
          onPress={() => router.push(`/superset/edit/${superset.id}`)}
        />
        <FooterButton label={t('common', 'delete')} destructive onPress={onDelete} />
      </View>
      <PageHelpHost help={help} />
    </SafeAreaView>
  );
}

/**
 * Wrap from OUTSIDE in CoachMarkProvider so SupersetDetailScreen's
 * useCoachMarkTarget anchors (pair / footer) register against the provider.
 */
export default function SupersetDetailScreenWithHelp() {
  return (
    <CoachMarkProvider>
      <SupersetDetailScreen />
    </CoachMarkProvider>
  );
}

function ExerciseTile({
  exercise,
  onPress,
}: {
  exercise: Exercise | undefined;
  onPress: (() => void) | undefined;
}) {
  const styles = useSupersetStyles();
  if (!exercise) {
    return (
      <View style={[styles.tile, styles.tileEmpty]}>
        <Text style={styles.tileMissing}>{t('status', 'missingExercise')}</Text>
      </View>
    );
  }
  // media_path is a require-map KEY into EXERCISE_MEDIA, NOT a uri. Resolve it
  // to [startFrame, endFrame]; show the start frame (poster). Falls back to the
  // letter placeholder when there's no photo. (Mirrors app/(tabs)/library.tsx.)
  const media = resolveExerciseMedia(exercise.media_path);
  const bg = hashColor(exercise.name || exercise.id);
  const ch = tExercise(exercise.name ?? '')?.charAt(0) || '?';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tViewExerciseDetails(exercise.name)}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
      <View style={styles.tileThumb}>
        {media ? (
          <Image source={media[0]} style={styles.tileThumbImage} />
        ) : (
          <View
            style={[styles.tileThumbPlaceholder, { backgroundColor: bg }]}>
            <Text style={styles.tileThumbInitial}>{ch}</Text>
          </View>
        )}
      </View>
      <Text style={styles.tileName} numberOfLines={2}>
        {tExercise(exercise.name)}
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
  const styles = useSupersetStyles();
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

function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: tokens.bg.base },
    body: { padding: 20, gap: 12 },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    colorDot: { width: 14, height: 14, borderRadius: 7 },
    heading: {
      fontSize: 26,
      fontWeight: '700',
      flexShrink: 1,
      color: tokens.text.primary,
    },
    subheading: {
      fontSize: 14,
      color: tokens.text.secondary,
      marginBottom: 4,
    },
    placeholder: { fontSize: 14, color: tokens.text.secondary, padding: 24 },
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
      backgroundColor: tokens.bg.elevated,
      alignItems: 'center',
    },
    tileEmpty: {
      opacity: 0.5,
    },
    tileMissing: {
      fontSize: 13,
      color: tokens.text.tertiary,
      fontStyle: 'italic',
    },
    tileThumb: {
      width: 80,
      height: 80,
      borderRadius: 40,
      overflow: 'hidden',
      marginBottom: 8,
      backgroundColor: tokens.bg.surface,
    },
    tileThumbImage: { width: '100%', height: '100%' },
    tileThumbPlaceholder: {
      width: '100%',
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
    },
    // White letter on data-driven `hashColor()` bg — kept literal because
    // the placeholder swatch is intentionally accent-colored (see palette.ts).
    tileThumbInitial: { color: '#fff', fontSize: 32, fontWeight: '700' },
    tileName: {
      fontSize: 14,
      fontWeight: '600',
      textAlign: 'center',
      color: tokens.text.primary,
    },
    plus: {
      fontSize: 22,
      fontWeight: '600',
      color: tokens.text.secondary,
    },
    headerBack: {
      color: tokens.action.primary,
      fontSize: 17,
      fontWeight: '400',
      paddingHorizontal: 8,
    },
    footer: {
      flexDirection: 'row',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.border.default,
      backgroundColor: 'transparent',
    },
    footerBtn: {
      flex: 1,
      paddingVertical: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    footerBtnPressed: { opacity: 0.4 },
    footerBtnText: {
      fontSize: 16,
      fontWeight: '500',
      color: tokens.action.primary,
    },
    footerBtnTextDisabled: { color: tokens.text.disabled },
    footerBtnTextDestructive: { color: tokens.action.destructive },
    pressed: { opacity: 0.7 },
  });
}
