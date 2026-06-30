import * as Crypto from 'expo-crypto';
import { useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabase } from '@/components/database-provider';
import { hashColor } from '@/components/template-editor/palette';
import {
  filterExercises,
  type ExerciseFilter,
} from '@/src/domain/exercise/exerciseLibrary';
import {
  EQUIPMENT_VALUES,
  type Equipment,
  type Exercise,
  type ExerciseMuscleLink,
  type MuscleGroup,
} from '@/src/domain/exercise/types';
import {
  listExercisesWithLinks,
  listMuscleGroups,
} from '@/src/adapters/sqlite/exerciseLibraryRepository';
import { resolveExerciseMedia } from '@/src/db/seed/exerciseMediaMap';
import {
  defaultSupersetName,
  validateReusableSupersetDraft,
} from '@/src/domain/superset/supersetManager';
import {
  findExistingReusableSupersetByPair,
  insertReusableSuperset,
} from '@/src/adapters/sqlite/supersetRepository';
import { submitNewlyCreatedSuperset } from '@/src/domain/exercise/pickerBridge';
import { t, tEquipment, tExercise, tMuscleGroup, tRemoveExercise } from '@/src/i18n';
import { useTheme, type ThemeTokens } from '@/src/theme';

import {
  CoachMarkProvider,
  HelpButton,
  PageHelpHost,
  useCoachMarkTarget,
  usePageHelp,
} from '@/components/help';
import { supersetNewHelp } from '@/components/help/content/superset-new';

/**
 * ADR-0025 — DRY hook shared by 7 components in this file.
 */
function useNewSupersetStyles() {
  const { tokens } = useTheme();
  return useMemo(() => makeStyles(tokens), [tokens]);
}

/**
 * Reusable Superset creation page (ADR-0017 Q10 / slice 9.8a).
 *
 * Self-contained sibling-stack route: pick exactly 2 exercises (no
 * 「超級組」sidebar entry — prevents recursion per ADR L162), then 「組合」
 * to INSERT a `superset` row + 2 `superset_exercise` link rows. On
 * success router.back() returns to the library tab; the focus refresh
 * picks up the new entry automatically.
 *
 * FIFO replacement on 3rd selection (ADR L165): when the user taps a
 * third distinct exercise, the oldest selected one is dropped.
 */
function NewSupersetScreen() {
  const db = useDatabase();
  const router = useRouter();
  const navigation = useNavigation();
  const { tokens } = useTheme();
  const styles = useNewSupersetStyles();
  const { width: windowWidth } = useWindowDimensions();
  const cardWidth = Math.floor(
    (windowWidth - SIDEBAR_WIDTH - CONTENT_H_PADDING * 2 - CARD_GAP) / 2
  );
  const cardHeight = Math.floor(cardWidth / 0.92);

  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [links, setLinks] = useState<ExerciseMuscleLink[]>([]);
  const [muscleGroups, setMuscleGroups] = useState<MuscleGroup[]>([]);
  const [selectedMgId, setSelectedMgId] = useState<string | null>(null);
  const [selectedEquipment, setSelectedEquipment] = useState<Equipment | null>(
    null
  );
  const [search, setSearch] = useState('');
  const [selection, setSelection] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const help = usePageHelp('superset-new', supersetNewHelp, {
    autoShowOnce: true,
    // This route is presented as `presentation: 'modal'` (app/_layout.tsx),
    // so the coach overlay must add back the safe-area inset measureInWindow
    // drops on modal hosts. See CoachMarkOverlay's `modalHost` prop.
    modalHost: true,
  });
  const gridTarget = useCoachMarkTarget('superset.grid');
  const selectedTarget = useCoachMarkTarget('superset.selected');
  const combineTarget = useCoachMarkTarget('superset.combine');

  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  useEffect(() => {
    (async () => {
      const [{ exercises: exs, links: lks }, mgs] = await Promise.all([
        listExercisesWithLinks(db),
        listMuscleGroups(db),
      ]);
      setExercises(exs);
      setLinks(lks);
      setMuscleGroups(mgs);
      if (mgs.length > 0) setSelectedMgId(mgs[0].id);
    })();
  }, [db]);

  const filter: ExerciseFilter = useMemo(
    () => ({
      muscleGroupId: selectedMgId,
      muscleId: null,
      equipment: selectedEquipment,
      search,
    }),
    [selectedMgId, selectedEquipment, search]
  );

  const visible = useMemo(
    () => filterExercises(exercises, links, filter),
    [exercises, links, filter]
  );

  const exerciseById = useMemo(() => {
    const m = new Map<string, Exercise>();
    for (const e of exercises) m.set(e.id, e);
    return m;
  }, [exercises]);

  const toggleSelect = useCallback((id: string) => {
    setSelection((prev) => {
      if (prev.includes(id)) {
        return prev.filter((x) => x !== id);
      }
      if (prev.length < 2) {
        return [...prev, id];
      }
      // FIFO replacement per ADR-0017 L165: drop oldest, append new.
      return [prev[1], id];
    });
  }, []);

  const removeFromSelection = useCallback((id: string) => {
    setSelection((prev) => prev.filter((x) => x !== id));
  }, []);

  const onCombine = async () => {
    if (selection.length !== 2 || submitting) return;
    const exA = exerciseById.get(selection[0]);
    const exB = exerciseById.get(selection[1]);
    if (!exA || !exB) return;
    const draft = {
      name: defaultSupersetName(exA, exB),
      color_hex: null,
      exercise_ids: [exA.id, exB.id] as [string, string],
    };
    const errors = validateReusableSupersetDraft(draft);
    if (errors.length > 0) return;
    setSubmitting(true);
    try {
      // Slice 10c #26 — UI pre-check for duplicate (A, B) pair (order-
      // insensitive). insertReusableSuperset has a last-line DB guard that
      // throws, but a pre-check gives a friendlier alert with a「前往」
      // button to the existing template. Race: if two creates land
      // simultaneously, the DB throw is the final guard.
      const existingId = await findExistingReusableSupersetByPair(
        db,
        draft.exercise_ids[0],
        draft.exercise_ids[1]
      );
      if (existingId !== null) {
        // `finally` below resets `submitting`; no need to flip it manually.
        Alert.alert(
          t('alert', 'duplicateSupersetPair'),
          t('alert', 'openExistingSupersetQ'),
          [
            { text: t('common', 'cancel'), style: 'cancel' },
            {
              text: t('common', 'go'),
              onPress: () => router.push(`/superset/${existingId}`),
            },
          ]
        );
        return;
      }
      const newId = await insertReusableSuperset(
        db,
        draft,
        () => Crypto.randomUUID(),
        () => Date.now()
      );
      // Mailbox round-trip for picker mode (slice 9.8b grill Q7) — library
      // useFocusEffect drains this and auto-selects the new superset when in
      // picker mode. Browse mode also drains (no-op) so a stale id never
      // leaks into a later picker session.
      submitNewlyCreatedSuperset(newId);
      router.back();
    } finally {
      setSubmitting(false);
    }
  };

  const selectedExercises = selection
    .map((id) => exerciseById.get(id))
    .filter((e): e is Exercise => !!e);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common', 'cancel')}
          onPress={() => router.back()}
          style={({ pressed }) => [styles.cancelBtn, pressed && styles.pressed]}>
          <Text style={styles.cancelBtnText}>✕</Text>
        </Pressable>
        <View style={styles.searchWrap}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            placeholder={t('page', 'searchExercises')}
            placeholderTextColor={tokens.text.tertiary}
            value={search}
            onChangeText={setSearch}
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <HelpButton onPress={help.open} />
      </View>

      <View ref={selectedTarget.ref} collapsable={false}>
        <SelectedChipRow
          selected={selectedExercises}
          onRemove={removeFromSelection}
        />
      </View>

      <View style={styles.body}>
        <MgSidebar
          muscleGroups={muscleGroups}
          selectedMgId={selectedMgId}
          onSelectMg={setSelectedMgId}
        />
        <View style={styles.content} ref={gridTarget.ref} collapsable={false}>
          <EquipmentChipRow
            value={selectedEquipment}
            onChange={setSelectedEquipment}
          />
          <ExercisePickerGrid
            exercises={visible}
            cardWidth={cardWidth}
            cardHeight={cardHeight}
            selection={selection}
            onTap={toggleSelect}
          />
        </View>
      </View>

      <View style={styles.footer} ref={combineTarget.ref} collapsable={false}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('button', 'combine')}
          onPress={onCombine}
          disabled={selection.length !== 2 || submitting}
          style={({ pressed }) => [
            styles.combineBtn,
            selection.length !== 2 && styles.combineBtnDisabled,
            pressed && selection.length === 2 && styles.pressed,
          ]}>
          <Text style={styles.combineBtnText}>
            {t('button', 'combine')} ({selection.length}/2)
          </Text>
        </Pressable>
      </View>

      <PageHelpHost help={help} />
    </SafeAreaView>
  );
}

/**
 * Wrap from OUTSIDE in CoachMarkProvider so the in-component
 * useCoachMarkTarget hooks (build-flow coach tour) register correctly —
 * a context consumer can't sit beside its own provider.
 */
export default function NewSupersetScreenWithHelp() {
  return (
    <CoachMarkProvider>
      <NewSupersetScreen />
    </CoachMarkProvider>
  );
}

function SelectedChipRow({
  selected,
  onRemove,
}: {
  selected: Exercise[];
  onRemove: (id: string) => void;
}) {
  const styles = useNewSupersetStyles();
  return (
    <View style={styles.chipRow}>
      <Text style={styles.chipRowLabel}>{t('status', 'selected')}</Text>
      {selected.length === 0 ? (
        <Text style={styles.chipRowHint}>{t('alert', 'pickTwoExercises')}</Text>
      ) : (
        selected.map((ex) => (
          <Pressable
            key={ex.id}
            accessibilityRole="button"
            accessibilityLabel={tRemoveExercise(tExercise(ex.name))}
            onPress={() => onRemove(ex.id)}
            style={styles.chip}>
            <Text style={styles.chipText} numberOfLines={1}>
              {tExercise(ex.name)}
            </Text>
            <Text style={styles.chipRemove}>✕</Text>
          </Pressable>
        ))
      )}
    </View>
  );
}

function MgSidebar({
  muscleGroups,
  selectedMgId,
  onSelectMg,
}: {
  muscleGroups: MuscleGroup[];
  selectedMgId: string | null;
  onSelectMg: (id: string) => void;
}) {
  const styles = useNewSupersetStyles();
  return (
    <View style={styles.sidebarWrap}>
      <ScrollView
        style={styles.sidebar}
        contentContainerStyle={styles.sidebarContent}
        showsVerticalScrollIndicator={false}>
        {muscleGroups.map((mg) => {
          const isActive = selectedMgId === mg.id;
          return (
            <Pressable
              key={mg.id}
              accessibilityRole="button"
              onPress={() => onSelectMg(mg.id)}
              style={styles.sidebarRow}>
              {isActive && <View style={styles.sidebarActiveBar} />}
              <Text
                style={[
                  styles.sidebarText,
                  isActive && styles.sidebarTextActive,
                ]}>
                {tMuscleGroup(mg.name)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function EquipmentChipRow({
  value,
  onChange,
}: {
  value: Equipment | null;
  onChange: (eq: Equipment | null) => void;
}) {
  const styles = useNewSupersetStyles();
  return (
    <View style={styles.equipRowOuter}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.equipRow}>
        <EquipmentChipBtn
          label={t('common', 'all')}
          active={value === null}
          onPress={() => onChange(null)}
        />
        {EQUIPMENT_VALUES.map((eq) => (
          <EquipmentChipBtn
            key={eq}
            label={tEquipment(eq)}
            active={value === eq}
            onPress={() => onChange(value === eq ? null : eq)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function EquipmentChipBtn({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const styles = useNewSupersetStyles();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.equipChip,
        active && styles.equipChipActive,
        pressed && styles.pressed,
      ]}>
      <Text style={[styles.equipText, active && styles.equipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function ExercisePickerGrid({
  exercises,
  cardWidth,
  cardHeight,
  selection,
  onTap,
}: {
  exercises: Exercise[];
  cardWidth: number;
  cardHeight: number;
  selection: readonly string[];
  onTap: (id: string) => void;
}) {
  const styles = useNewSupersetStyles();
  if (exercises.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{t('status', 'noExercisesMatch')}</Text>
      </View>
    );
  }
  const rows: Exercise[][] = [];
  for (let i = 0; i < exercises.length; i += 2) {
    rows.push(exercises.slice(i, i + 2));
  }
  return (
    <ScrollView
      style={styles.gridList}
      contentContainerStyle={styles.gridContent}
      showsVerticalScrollIndicator={false}>
      {rows.map((pair, i) => (
        <View key={i} style={styles.gridRow}>
          <ExercisePickerCard
            exercise={pair[0]}
            width={cardWidth}
            height={cardHeight}
            selected={selection.includes(pair[0].id)}
            rank={selection.indexOf(pair[0].id)}
            onPress={() => onTap(pair[0].id)}
          />
          {pair[1] ? (
            <ExercisePickerCard
              exercise={pair[1]}
              width={cardWidth}
              height={cardHeight}
              selected={selection.includes(pair[1].id)}
              rank={selection.indexOf(pair[1].id)}
              onPress={() => onTap(pair[1].id)}
            />
          ) : (
            <View style={{ width: cardWidth, height: cardHeight }} />
          )}
        </View>
      ))}
    </ScrollView>
  );
}

function ExercisePickerCard({
  exercise,
  width,
  height,
  selected,
  rank,
  onPress,
}: {
  exercise: Exercise;
  width: number;
  height: number;
  selected: boolean;
  rank: number;
  onPress: () => void;
}) {
  const styles = useNewSupersetStyles();
  // media_path is a require-map KEY into EXERCISE_MEDIA, NOT a uri. Resolve it
  // to [startFrame, endFrame]; show the start frame (poster). Falls back to the
  // letter placeholder when there's no photo. (Mirrors app/(tabs)/library.tsx.)
  const media = resolveExerciseMedia(exercise.media_path);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { width, height },
        selected && styles.cardSelected,
        pressed && styles.pressed,
      ]}>
      {selected && rank >= 0 && (
        <View style={styles.selectedBadge}>
          <Text style={styles.selectedBadgeText}>{rank + 1}</Text>
        </View>
      )}
      <View style={styles.thumbWrap}>
        {media ? (
          <Image source={media[0]} style={styles.thumbImage} />
        ) : (
          <PlaceholderThumb exercise={exercise} />
        )}
      </View>
      <Text style={styles.cardName} numberOfLines={2}>
        {tExercise(exercise.name)}
      </Text>
    </Pressable>
  );
}

function PlaceholderThumb({ exercise }: { exercise: Exercise }) {
  const styles = useNewSupersetStyles();
  const bg = hashColor(exercise.name || exercise.id);
  const ch = tExercise(exercise.name ?? '')?.charAt(0) || '?';
  return (
    <View style={[styles.thumbPlaceholder, { backgroundColor: bg }]}>
      <Text style={styles.thumbInitial}>{ch}</Text>
    </View>
  );
}

const SIDEBAR_WIDTH = 92;
const CARD_GAP = 10;
const CONTENT_H_PADDING = 12;

function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: tokens.bg.base },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 8,
      gap: 10,
    },
    cancelBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: tokens.bg.elevated,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cancelBtnText: {
      color: tokens.text.primary,
      fontSize: 20,
      fontWeight: '600',
      lineHeight: 22,
    },
    searchWrap: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: tokens.bg.elevated,
      borderRadius: 999,
      paddingHorizontal: 14,
      height: 40,
    },
    searchIcon: {
      fontSize: 14,
      marginRight: 6,
      color: tokens.text.secondary,
    },
    searchInput: {
      flex: 1,
      color: tokens.text.primary,
      fontSize: 15,
      padding: 0,
    },
    chipRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    chipRowLabel: { color: tokens.text.secondary, fontSize: 13 },
    chipRowHint: { color: tokens.text.tertiary, fontSize: 13 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      // Selected-state chip uses success-tint (semantic green pairing with
      // the success-colored combine button below).
      backgroundColor: 'rgba(52,199,89,0.18)',
      borderRadius: 14,
      paddingLeft: 10,
      paddingRight: 6,
      height: 28,
      gap: 6,
      maxWidth: 180,
    },
    chipText: {
      color: tokens.action.success,
      fontSize: 13,
      fontWeight: '600',
      flexShrink: 1,
    },
    chipRemove: {
      color: tokens.action.success,
      fontSize: 14,
      fontWeight: '700',
      paddingHorizontal: 2,
      opacity: 0.85,
    },

    body: { flex: 1, flexDirection: 'row' },

    sidebarWrap: { width: SIDEBAR_WIDTH, overflow: 'hidden' },
    sidebar: { flex: 1 },
    sidebarContent: { paddingVertical: 12 },
    sidebarRow: {
      flexDirection: 'row',
      alignItems: 'center',
      height: 42,
      paddingLeft: 12,
    },
    sidebarActiveBar: {
      position: 'absolute',
      left: 0,
      top: 8,
      bottom: 8,
      width: 3,
      backgroundColor: tokens.action.success,
      borderRadius: 2,
    },
    sidebarText: {
      color: tokens.text.secondary,
      fontSize: 17,
      fontWeight: '500',
    },
    sidebarTextActive: { color: tokens.text.primary, fontWeight: '700' },

    content: { flex: 1, flexDirection: 'column', minWidth: 0 },
    equipRowOuter: { height: 56 },
    equipRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    equipChip: {
      paddingHorizontal: 14,
      height: 32,
      borderRadius: 16,
      backgroundColor: tokens.bg.elevated,
      alignItems: 'center',
      justifyContent: 'center',
    },
    equipChipActive: { backgroundColor: 'rgba(52,199,89,0.18)' },
    equipText: { color: tokens.text.secondary, fontSize: 14 },
    equipTextActive: { color: tokens.action.success, fontWeight: '600' },

    gridList: { flex: 1, alignSelf: 'stretch', width: '100%' },
    gridContent: {
      paddingHorizontal: CONTENT_H_PADDING,
      paddingBottom: 24,
      gap: CARD_GAP,
      alignItems: 'stretch',
    },
    gridRow: {
      flexDirection: 'row',
      alignSelf: 'stretch',
      gap: CARD_GAP,
    },
    card: {
      flexShrink: 0,
      backgroundColor: tokens.bg.elevated,
      borderRadius: 14,
      padding: 10,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: 'transparent',
    },
    cardSelected: {
      borderColor: tokens.action.success,
      backgroundColor: 'rgba(52,199,89,0.15)',
    },
    selectedBadge: {
      position: 'absolute',
      top: 8,
      right: 8,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: tokens.action.success,
      alignItems: 'center',
      justifyContent: 'center',
    },
    selectedBadgeText: {
      color: tokens.action.onPrimary,
      fontSize: 13,
      fontWeight: '700',
    },
    thumbWrap: {
      width: 96,
      height: 96,
      borderRadius: 48,
      backgroundColor: tokens.bg.surface,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      marginBottom: 8,
    },
    thumbImage: { width: '100%', height: '100%' },
    thumbPlaceholder: {
      width: '100%',
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Letter on data-driven hashColor() bg — literal (accent swatch).
    thumbInitial: { color: '#fff', fontSize: 36, fontWeight: '700' },
    cardName: {
      color: tokens.text.primary,
      fontSize: 14,
      fontWeight: '600',
      textAlign: 'center',
    },

    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    emptyText: { color: tokens.text.secondary, fontSize: 15 },
    pressed: { opacity: 0.7 },

    footer: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.border.subtle,
    },
    combineBtn: {
      height: 48,
      borderRadius: 12,
      backgroundColor: tokens.action.success,
      alignItems: 'center',
      justifyContent: 'center',
    },
    combineBtnDisabled: {
      backgroundColor: tokens.bg.elevated,
    },
    combineBtnText: {
      color: tokens.action.onPrimary,
      fontSize: 16,
      fontWeight: '700',
    },
  });
}
