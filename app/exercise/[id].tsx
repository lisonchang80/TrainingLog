import {
  useFocusEffect,
  useLocalSearchParams,
  useNavigation,
  useRouter,
} from 'expo-router';
import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ExerciseMediaFrames } from '@/components/exercise/exercise-media-frames';
import { MuscleBodyTagger } from '@/components/exercise/muscle-body-tagger';
import { SetNoteSheet } from '@/components/shared/set-note-sheet';
import { useDatabase } from '@/components/database-provider';
import { resolveExerciseHighlight } from '@/src/domain/exercise/exerciseLibrary';
import type {
  ExerciseWithMuscles,
  MuscleGroup,
  MuscleRole,
} from '@/src/domain/exercise/types';
import {
  archiveCustomExercise,
  getExerciseMuscleLinks,
  getExerciseNotes,
  getExerciseWithMuscles,
  listMuscleGroups,
  listMuscles,
  updateExerciseNotes,
} from '@/src/adapters/sqlite/exerciseLibraryRepository';
import {
  t,
  tDeleteExerciseFromLibrary,
  tEquipment,
  tExercise,
  tExerciseNoteHeader,
  tLoadType,
  tMuscleGroup,
} from '@/src/i18n';
import { useTheme, type ThemeTokens } from '@/src/theme';

/**
 * ADR-0025 — DRY hook for the 3 components in this file that share the
 * memoised style sheet. Each sub-component calls `useExerciseStyles()`
 * instead of repeating the useTheme + useMemo pair.
 */
function useExerciseStyles() {
  const { tokens } = useTheme();
  return useMemo(() => makeStyles(tokens), [tokens]);
}

/**
 * exerciseLibrary load_type DB enum → tLoadType key. DB row uses `loaded` /
 * `bodyweight` / `assisted`; tLoadType accepts `weighted` / `bodyweight` /
 * `assisted`. Pure data — keep adjacency to the read site for clarity.
 */
const LOAD_TYPE_KEY: Record<string, 'weighted' | 'bodyweight' | 'assisted'> = {
  loaded: 'weighted',
  bodyweight: 'bodyweight',
  assisted: 'assisted',
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
  const styles = useExerciseStyles();
  const [data, setData] = useState<ExerciseWithMuscles | null>(null);
  const [highlight, setHighlight] = useState<Map<string, MuscleRole>>(new Map());
  const [muscleGroups, setMuscleGroups] = useState<MuscleGroup[]>([]);
  // Per-Exercise GLOBAL note (exercise.notes) — the SAME column the in-session
  // exercise card edits (ADR-0017), so edits here & in a session stay in sync.
  const [notes, setNotes] = useState<string | null>(null);
  const [noteSheetOpen, setNoteSheetOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!id) return;
    const [d, links, mgs, ms, n] = await Promise.all([
      getExerciseWithMuscles(db, id),
      getExerciseMuscleLinks(db, id),
      listMuscleGroups(db),
      listMuscles(db),
      getExerciseNotes(db, id),
    ]);
    setData(d);
    setNotes(n);
    // Precise per-muscle links if present; otherwise fall back to lighting the
    // whole muscle group so curated exercises with only a group still show a
    // body diagram (v028 library — 206 new exercises have no fine links).
    setHighlight(resolveExerciseHighlight(links, d?.exercise.muscle_group_id, ms));
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
      title: t('page', 'exerciseDetail'),
      headerBackVisible: false,
      headerLeft: renderHeaderLeft,
      headerRight: undefined,
    });
  }, [navigation, renderHeaderLeft]);

  if (!data) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.body}>
          <Text style={styles.placeholder}>{t('alert', 'exerciseNotFoundOrArchived')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const mg = data.exercise.muscle_group_id
    ? muscleGroups.find((g) => g.id === data.exercise.muscle_group_id)
    : null;
  const loadTypeKey = LOAD_TYPE_KEY[data.exercise.load_type];

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.heading}>{tExercise(data.exercise.name)}</Text>
        <Text style={styles.subheading}>
          {mg ? `${tMuscleGroup(mg.name)} · ` : ''}
          {loadTypeKey ? tLoadType(loadTypeKey) : data.exercise.load_type}
          {` · ${tEquipment(data.exercise.equipment)}`}
          {data.exercise.is_custom === 1 ? t('common', 'custom') : ''}
        </Text>

        {data.exercise.media_path && (
          <ExerciseMediaFrames
            mediaKey={data.exercise.media_path}
            style={styles.mediaCard}
          />
        )}

        {highlight.size > 0 && (
          <View style={styles.diagramCard}>
            <MuscleBodyTagger highlight={highlight} mode="readonly" />
          </View>
        )}

        {notes && notes.trim().length > 0 && (
          <View style={styles.noteCard}>
            <Text style={styles.noteLabel}>{t('domain', 'note')}</Text>
            <Text style={styles.noteText}>{notes}</Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <FooterButton
          label={t('domain', 'history')}
          onPress={() => router.push(`/exercise-history/${id}`)}
        />
        <FooterButton
          label={t('domain', 'chart')}
          onPress={() => router.push(`/exercise-chart/${id}`)}
        />
        <FooterButton
          label={t('domain', 'note')}
          onPress={() => setNoteSheetOpen(true)}
        />
        <FooterButton
          label={t('common', 'edit')}
          disabled={data.exercise.is_custom !== 1}
          onPress={() => {
            if (data.exercise.is_custom === 1) {
              router.push(`/exercise/edit/${id}`);
            } else {
              Alert.alert(t('button', 'editExercise'), t('alert', 'builtinExerciseNoEdit'));
            }
          }}
        />
        <FooterButton
          label={t('common', 'delete')}
          destructive
          disabled={data.exercise.is_custom !== 1}
          onPress={() => {
            if (data.exercise.is_custom !== 1) {
              Alert.alert(t('button', 'deleteExercise'), t('alert', 'builtinExerciseNoDelete'));
              return;
            }
            Alert.alert(
              t('button', 'deleteExercise'),
              tDeleteExerciseFromLibrary(tExercise(data.exercise.name)),
              [
                { text: t('common', 'cancel'), style: 'cancel' },
                {
                  text: t('common', 'delete'),
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      await archiveCustomExercise(db, id);
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
          }}
        />
      </View>

      <SetNoteSheet
        visible={noteSheetOpen}
        initialValue={notes}
        title={tExerciseNoteHeader(tExercise(data.exercise.name))}
        placeholder={t('page', 'notePlaceholder')}
        onConfirm={async (next) => {
          try {
            await updateExerciseNotes(db, id, next);
            setNotes(next);
          } catch (e) {
            Alert.alert(
              t('alert', 'saveFailed'),
              e instanceof Error ? e.message : String(e),
            );
          }
          setNoteSheetOpen(false);
        }}
        onCancel={() => setNoteSheetOpen(false)}
      />
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
  const styles = useExerciseStyles();
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

function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: tokens.bg.base },
    body: { padding: 20, gap: 12 },
    heading: { fontSize: 26, fontWeight: '700', color: tokens.text.primary },
    subheading: {
      fontSize: 14,
      color: tokens.text.secondary,
      marginBottom: 4,
    },
    placeholder: { fontSize: 14, color: tokens.text.secondary, padding: 24 },
    mediaCard: {
      width: '100%',
      aspectRatio: 16 / 9,
      borderRadius: 14,
      overflow: 'hidden',
      backgroundColor: tokens.bg.elevated,
    },
    diagramCard: {
      borderRadius: 14,
      padding: 12,
      backgroundColor: tokens.bg.elevated,
      alignItems: 'center',
    },
    noteCard: {
      borderRadius: 14,
      padding: 14,
      backgroundColor: tokens.bg.elevated,
      gap: 6,
    },
    noteLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: tokens.text.secondary,
    },
    noteText: {
      fontSize: 15,
      lineHeight: 21,
      color: tokens.text.primary,
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
  });
}
