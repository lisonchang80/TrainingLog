import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
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
  type Muscle,
  type MuscleGroup,
} from '@/src/domain/exercise/types';
import {
  getExerciseSessionCounts,
  listExercisesWithLinks,
  listMuscleGroups,
  listMuscles,
} from '@/src/adapters/sqlite/exerciseLibraryRepository';
import {
  getActiveSession,
  listSessionUsedExercises,
} from '@/src/adapters/sqlite/sessionRepository';
import { listReusableSupersetsWithExercises } from '@/src/adapters/sqlite/supersetRepository';
import type { ReusableSupersetWithExercises } from '@/src/domain/superset/types';
import {
  clearNewlyCreatedSuperset,
  clearPick,
  consumeNewlyCreated,
  consumeNewlyCreatedSuperset,
  submitPick,
} from '@/src/domain/exercise/pickerBridge';
import {
  EMPTY_SELECTION,
  addSelection,
  isSelected,
  selectionRank,
  toggleSelection,
} from '@/src/domain/exercise/pickerSelection';

/**
 * Library screen (slice 9.6 / ADR-0017 Q1, Q6, Q7, Q15).
 *
 * Left vertical sidebar (11 MG + 「超級組」tab) + horizontal Equipment chip
 * row + 2-col grid of cards (circle thumbnail / N 次 badge / 講解 pill / name).
 * Selecting a MG indents its sub-muscles below it; tapping a sub-muscle
 * filters the grid further.
 *
 * Two route modes (Q15):
 *   - default / browse: from tab bar; tap a card → /exercise/[id]
 *   - picker: not yet wired here (L2 step) — multi-select + 完成 footer
 */
export default function LibraryScreen() {
  const db = useDatabase();
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string }>();
  const isPickerMode = params.mode === 'picker';
  const { width: windowWidth } = useWindowDimensions();
  const cardWidth = Math.floor(
    (windowWidth - SIDEBAR_WIDTH - CONTENT_H_PADDING * 2 - CARD_GAP) / 2
  );
  const cardHeight = Math.floor(cardWidth / 0.92);

  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [links, setLinks] = useState<ExerciseMuscleLink[]>([]);
  const [muscleGroups, setMuscleGroups] = useState<MuscleGroup[]>([]);
  const [muscles, setMuscles] = useState<Muscle[]>([]);
  const [sessionCounts, setSessionCounts] = useState<Map<string, number>>(
    new Map()
  );
  const [supersets, setSupersets] = useState<ReusableSupersetWithExercises[]>(
    []
  );

  const [selectedMgId, setSelectedMgId] = useState<string | null>(null);
  const [isSupersetTab, setIsSupersetTab] = useState(false);
  const [selectedMuscleId, setSelectedMuscleId] = useState<string | null>(null);
  const [selectedEquipment, setSelectedEquipment] = useState<Equipment | null>(
    null
  );
  const [search, setSearch] = useState('');
  const [selection, setSelection] = useState<readonly string[]>(EMPTY_SELECTION);
  // Parallel selection array for reusable supersets (slice 9.8b grill Q1 — dual
  // array `PickerPayload`). Independent rank-within-kind: user sees ex#1 / rs#1
  // numbering rather than a global order.
  const [supersetSelection, setSupersetSelection] = useState<readonly string[]>(
    EMPTY_SELECTION
  );
  // Slice 10c #20 — items already inside the in-progress session render
  // dimmed + tap-disabled (but ⓘ stays live) so the user can't add a
  // duplicate. Solo and RS buckets are independent (see
  // listSessionUsedExercises doc). Empty sets in browse mode = nothing dims.
  const [disabledExerciseIds, setDisabledExerciseIds] = useState<Set<string>>(
    () => new Set()
  );
  const [disabledSupersetIds, setDisabledSupersetIds] = useState<Set<string>>(
    () => new Set()
  );

  // Drop any stale picker-mode mailbox on mount so a prior abandoned pick
  // does not leak into a fresh picker session.
  useEffect(() => {
    if (isPickerMode) {
      clearPick();
      clearNewlyCreatedSuperset();
    }
  }, [isPickerMode]);

  const refresh = useCallback(async () => {
    const [{ exercises, links }, mgs, ms, counts, ss] = await Promise.all([
      listExercisesWithLinks(db),
      listMuscleGroups(db),
      listMuscles(db),
      getExerciseSessionCounts(db),
      listReusableSupersetsWithExercises(db),
    ]);
    setExercises(exercises);
    setLinks(links);
    setMuscleGroups(mgs);
    setMuscles(ms);
    setSessionCounts(counts);
    setSupersets(ss);
    // Default to first MG on first load if none selected yet.
    if (selectedMgId === null && !isSupersetTab && mgs.length > 0) {
      setSelectedMgId(mgs[0].id);
    }
  }, [db, selectedMgId, isSupersetTab]);

  useFocusEffect(
    useCallback(() => {
      refresh();
      // Drain the newly-created mailbox on every focus. In picker mode we
      // auto-select the new exercise; in browse mode we just clear it so a
      // stale id never leaks into a later picker session.
      const newId = consumeNewlyCreated();
      if (newId && isPickerMode) {
        setSelection((prev) => addSelection(prev, newId));
      }
      // Same round-trip for newly-created reusable supersets (slice 9.8b
      // grill Q7) — picker auto-selects the new superset on return from
      // /superset/new; browse mode drains to prevent stale leak.
      const newSupId = consumeNewlyCreatedSuperset();
      if (newSupId && isPickerMode) {
        setSupersetSelection((prev) => addSelection(prev, newSupId));
      }
      // #20 — only in picker mode do we look up "already in this session"
      // for the dim/disable layer. Browse mode keeps both sets empty so
      // the library tab never dims anything.
      if (isPickerMode) {
        void (async () => {
          const active = await getActiveSession(db);
          if (!active) {
            setDisabledExerciseIds(new Set());
            setDisabledSupersetIds(new Set());
            return;
          }
          const used = await listSessionUsedExercises(db, active.id);
          setDisabledExerciseIds(used.solo_exercise_ids);
          setDisabledSupersetIds(used.rs_template_ids);
        })();
      } else {
        setDisabledExerciseIds(new Set());
        setDisabledSupersetIds(new Set());
      }
    }, [refresh, isPickerMode, db])
  );

  const subMuscles = useMemo(() => {
    if (!selectedMgId) return [];
    return muscles
      .filter((m) => m.mg_id === selectedMgId)
      .sort((a, b) => a.display_order - b.display_order);
  }, [muscles, selectedMgId]);

  const filter: ExerciseFilter = useMemo(
    () => ({
      muscleGroupId: isSupersetTab ? null : selectedMgId,
      muscleId: selectedMuscleId,
      equipment: selectedEquipment,
      search,
    }),
    [isSupersetTab, selectedMgId, selectedMuscleId, selectedEquipment, search]
  );

  const visible = useMemo(
    () => filterExercises(exercises, links, filter),
    [exercises, links, filter]
  );

  const selectMg = (id: string) => {
    setIsSupersetTab(false);
    setSelectedMgId(id);
    setSelectedMuscleId(null);
  };

  const selectSuperset = () => {
    setIsSupersetTab(true);
    setSelectedMuscleId(null);
  };

  const onCardTap = (ex: Exercise) => {
    if (isPickerMode) {
      // Safety net for race conditions (focus refresh mid-pick) — disabled
      // items are also ignored at the props level via `disabled={true}` on
      // the card Pressable, but if a tap somehow lands here we refuse it.
      if (disabledExerciseIds.has(ex.id)) return;
      setSelection((prev) => toggleSelection(prev, ex.id));
    } else {
      router.push(`/exercise/${ex.id}`);
    }
  };

  const onPickerDone = () => {
    submitPick({
      exerciseIds: [...selection],
      reusableSupersetIds: [...supersetSelection],
    });
    router.back();
  };

  const onPickerCancel = () => {
    setSelection(EMPTY_SELECTION);
    setSupersetSelection(EMPTY_SELECTION);
    router.back();
  };

  const onSupersetCardTap = (s: ReusableSupersetWithExercises) => {
    if (isPickerMode) {
      if (disabledSupersetIds.has(s.superset.id)) return;
      setSupersetSelection((prev) => toggleSelection(prev, s.superset.id));
    } else {
      router.push(`/superset/${s.superset.id}`);
    }
  };

  const pickerTotal = selection.length + supersetSelection.length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        {isPickerMode && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="取消"
            onPress={onPickerCancel}
            style={({ pressed }) => [styles.cancelBtn, pressed && styles.pressed]}>
            <Text style={styles.cancelBtnText}>✕</Text>
          </Pressable>
        )}
        <View style={styles.searchWrap}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            placeholder="輸入動作名字搜索"
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={search}
            onChangeText={setSearch}
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isSupersetTab ? '建立超級組' : '新增動作'}
          onPress={() =>
            router.push(isSupersetTab ? '/superset/new' : '/exercise/new')
          }
          style={({ pressed }) => [styles.addBtn, pressed && styles.pressed]}>
          <Text style={styles.addBtnText}>+</Text>
        </Pressable>
      </View>

      <View style={styles.body}>
        <Sidebar
          muscleGroups={muscleGroups}
          selectedMgId={isSupersetTab ? null : selectedMgId}
          isSupersetTab={isSupersetTab}
          subMuscles={subMuscles}
          selectedMuscleId={selectedMuscleId}
          onSelectMg={selectMg}
          onSelectSuperset={selectSuperset}
          onSelectMuscle={setSelectedMuscleId}
        />
        <View style={styles.content}>
          {isSupersetTab ? (
            <SupersetGrid
              supersets={supersets}
              cardWidth={cardWidth}
              cardHeight={cardHeight}
              onTap={onSupersetCardTap}
              selection={isPickerMode ? supersetSelection : null}
              disabledIds={disabledSupersetIds}
              onInfoPress={
                isPickerMode
                  ? (s) => router.push(`/superset/${s.superset.id}`)
                  : null
              }
            />
          ) : (
            <>
              <EquipmentChipRow
                value={selectedEquipment}
                onChange={setSelectedEquipment}
              />
              <ExerciseGrid
                exercises={visible}
                sessionCounts={sessionCounts}
                cardWidth={cardWidth}
                cardHeight={cardHeight}
                onTap={onCardTap}
                selection={isPickerMode ? selection : null}
                disabledIds={disabledExerciseIds}
                onInfoPress={
                  isPickerMode
                    ? (ex) => router.push(`/exercise/${ex.id}`)
                    : null
                }
              />
            </>
          )}
        </View>
      </View>
      {isPickerMode && (
        <View style={styles.pickerFooter}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="完成"
            onPress={onPickerDone}
            disabled={pickerTotal === 0}
            style={({ pressed }) => [
              styles.pickerDoneBtn,
              pickerTotal === 0 && styles.pickerDoneBtnDisabled,
              pressed && styles.pressed,
            ]}>
            <Text style={styles.pickerDoneBtnText}>
              完成{pickerTotal > 0 ? ` (${pickerTotal})` : ''}
            </Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

// ---------- Sidebar ----------

interface SidebarProps {
  muscleGroups: MuscleGroup[];
  selectedMgId: string | null;
  isSupersetTab: boolean;
  subMuscles: Muscle[];
  selectedMuscleId: string | null;
  onSelectMg: (id: string) => void;
  onSelectSuperset: () => void;
  onSelectMuscle: (id: string | null) => void;
}

function Sidebar(props: SidebarProps) {
  const {
    muscleGroups,
    selectedMgId,
    isSupersetTab,
    subMuscles,
    selectedMuscleId,
    onSelectMg,
    onSelectSuperset,
    onSelectMuscle,
  } = props;
  return (
    <View style={styles.sidebarWrap}>
    <ScrollView
      style={styles.sidebar}
      contentContainerStyle={styles.sidebarContent}
      showsVerticalScrollIndicator={false}>
      {muscleGroups.map((mg) => {
        const isActive = selectedMgId === mg.id;
        return (
          <View key={mg.id}>
            <Pressable
              accessibilityRole="button"
              onPress={() => onSelectMg(mg.id)}
              style={styles.sidebarRow}>
              {isActive && <View style={styles.sidebarActiveBar} />}
              <Text
                style={[
                  styles.sidebarText,
                  isActive && styles.sidebarTextActive,
                ]}>
                {mg.name}
              </Text>
            </Pressable>
            {isActive &&
              subMuscles.map((m) => (
                <Pressable
                  key={m.id}
                  accessibilityRole="button"
                  onPress={() =>
                    onSelectMuscle(selectedMuscleId === m.id ? null : m.id)
                  }
                  style={styles.sidebarSubRow}>
                  <Text
                    style={[
                      styles.sidebarSubText,
                      selectedMuscleId === m.id && styles.sidebarSubTextActive,
                    ]}>
                    {m.name}
                  </Text>
                </Pressable>
              ))}
          </View>
        );
      })}
      <Pressable
        accessibilityRole="button"
        onPress={onSelectSuperset}
        style={styles.sidebarRow}>
        {isSupersetTab && <View style={styles.sidebarActiveBar} />}
        <Text
          style={[
            styles.sidebarText,
            isSupersetTab && styles.sidebarTextActive,
          ]}>
          超級組
        </Text>
      </Pressable>
    </ScrollView>
    </View>
  );
}

// ---------- Equipment chip row ----------

function EquipmentChipRow({
  value,
  onChange,
}: {
  value: Equipment | null;
  onChange: (eq: Equipment | null) => void;
}) {
  return (
    <View style={styles.equipRowOuter}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.equipRow}>
        <EquipmentChip
          label="全部"
          active={value === null}
          onPress={() => onChange(null)}
        />
        {EQUIPMENT_VALUES.map((eq) => (
          <EquipmentChip
            key={eq}
            label={eq}
            active={value === eq}
            onPress={() => onChange(value === eq ? null : eq)}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function EquipmentChip({
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

// ---------- Exercise grid ----------

function ExerciseGrid({
  exercises,
  sessionCounts,
  cardWidth,
  cardHeight,
  onTap,
  selection,
  disabledIds,
  onInfoPress,
}: {
  exercises: Exercise[];
  sessionCounts: Map<string, number>;
  cardWidth: number;
  cardHeight: number;
  onTap: (ex: Exercise) => void;
  selection: readonly string[] | null;
  /** Slice 10c #20 — ids that are already in the in-progress session.
   *  Cards in this set render dim (opacity 0.4) with the main Pressable
   *  disabled, but the ⓘ button stays live for detail preview. Always
   *  pass an empty Set in browse mode. */
  disabledIds: Set<string>;
  /** When set, each card renders a small ⓘ button (bottom-right) that
   *  navigates to the exercise's detail page without affecting selection. */
  onInfoPress: ((ex: Exercise) => void) | null;
}) {
  if (exercises.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>沒有符合條件的動作</Text>
      </View>
    );
  }
  // Manual row-pair rendering with explicit pixel sizing — sidesteps
  // FlatList numColumns + aspectRatio + flex measurement quirks in
  // RN 0.74+ on iPhone 17 simulator.
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
          <ExerciseCard
            exercise={pair[0]}
            sessionCount={sessionCounts.get(pair[0].id) ?? 0}
            width={cardWidth}
            height={cardHeight}
            onPress={() => onTap(pair[0])}
            selected={selection ? isSelected(selection, pair[0].id) : false}
            rank={selection ? selectionRank(selection, pair[0].id) : -1}
            disabled={disabledIds.has(pair[0].id)}
            onInfoPress={onInfoPress ? () => onInfoPress(pair[0]) : null}
          />
          {pair[1] ? (
            <ExerciseCard
              exercise={pair[1]}
              sessionCount={sessionCounts.get(pair[1].id) ?? 0}
              width={cardWidth}
              height={cardHeight}
              onPress={() => onTap(pair[1])}
              selected={selection ? isSelected(selection, pair[1].id) : false}
              rank={selection ? selectionRank(selection, pair[1].id) : -1}
              disabled={disabledIds.has(pair[1].id)}
              onInfoPress={onInfoPress ? () => onInfoPress(pair[1]!) : null}
            />
          ) : (
            <View style={{ width: cardWidth, height: cardHeight }} />
          )}
        </View>
      ))}
    </ScrollView>
  );
}

function ExerciseCard({
  exercise,
  sessionCount,
  width,
  height,
  onPress,
  selected,
  rank,
  disabled,
  onInfoPress,
}: {
  exercise: Exercise;
  sessionCount: number;
  width: number;
  height: number;
  onPress: () => void;
  selected: boolean;
  rank: number;
  /** Slice 10c #20 — already in the in-progress session. Whole card dims;
   *  main Pressable disabled (no toggle); ⓘ stays live. */
  disabled: boolean;
  onInfoPress: (() => void) | null;
}) {
  const hasCues = exercise.cues_text != null && exercise.cues_text.length > 0;
  const thumbnail = exercise.media_path;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.card,
        { width, height },
        selected && styles.cardSelected,
        disabled && styles.cardDisabled,
        pressed && styles.pressed,
      ]}>
      {hasCues && (
        <View style={[styles.cuesPill, onInfoPress && styles.cuesPillWithInfo]}>
          <Text style={styles.cuesPillText}>講解</Text>
        </View>
      )}
      {sessionCount > 0 && (
        <Text style={styles.countBadge}>{sessionCount} 次</Text>
      )}
      {selected && rank >= 0 && (
        <View style={styles.selectedBadge}>
          <Text style={styles.selectedBadgeText}>{rank + 1}</Text>
        </View>
      )}
      <View style={styles.thumbWrap}>
        {thumbnail ? (
          <Image source={{ uri: thumbnail }} style={styles.thumbImage} />
        ) : (
          <PlaceholderThumb exercise={exercise} />
        )}
      </View>
      <Text style={styles.cardName} numberOfLines={2}>
        {exercise.name}
      </Text>
      {hasCues && <Text style={styles.cardCueLink}>查看動作要點</Text>}
      {onInfoPress && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="查看動作詳情"
          onPress={onInfoPress}
          hitSlop={8}
          style={({ pressed }) => [
            styles.infoBtn,
            pressed && styles.pressed,
          ]}>
          <Text style={styles.infoBtnText}>ⓘ</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

function PlaceholderThumb({ exercise }: { exercise: Exercise }) {
  // Hash-color circle with first character — ADR-0017 Q8 v1 placeholder.
  const bg = hashColor(exercise.name || exercise.id);
  const ch = exercise.name?.charAt(0) ?? '?';
  return (
    <View style={[styles.thumbPlaceholder, { backgroundColor: bg }]}>
      <Text style={styles.thumbInitial}>{ch}</Text>
    </View>
  );
}

// ---------- 超級組 grid ----------

function SupersetGrid({
  supersets,
  cardWidth,
  cardHeight,
  onTap,
  selection,
  disabledIds,
  onInfoPress,
}: {
  supersets: ReusableSupersetWithExercises[];
  cardWidth: number;
  cardHeight: number;
  onTap: (s: ReusableSupersetWithExercises) => void;
  /** Non-null = picker mode (toggle on tap, render badge); null = browse mode. */
  selection: readonly string[] | null;
  /** Slice 10c #20 — RS template ids already in the in-progress session. */
  disabledIds: Set<string>;
  /** Non-null = picker mode (render ⓘ for detail preview); null = browse mode. */
  onInfoPress: ((s: ReusableSupersetWithExercises) => void) | null;
}) {
  if (supersets.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>尚未建立超級組</Text>
        <Text style={styles.emptySubText}>點右上角「+」建立新的超級組</Text>
      </View>
    );
  }
  const rows: ReusableSupersetWithExercises[][] = [];
  for (let i = 0; i < supersets.length; i += 2) {
    rows.push(supersets.slice(i, i + 2));
  }
  const rankOf = (s: ReusableSupersetWithExercises): number =>
    selection ? selectionRank(selection, s.superset.id) : -1;
  return (
    <ScrollView
      style={styles.gridList}
      contentContainerStyle={styles.gridContent}
      showsVerticalScrollIndicator={false}>
      {rows.map((pair, i) => (
        <View key={i} style={styles.gridRow}>
          <SupersetCard
            item={pair[0]}
            width={cardWidth}
            height={cardHeight}
            onPress={() => onTap(pair[0])}
            selected={selection ? isSelected(selection, pair[0].superset.id) : false}
            rank={rankOf(pair[0])}
            disabled={disabledIds.has(pair[0].superset.id)}
            onInfoPress={onInfoPress ? () => onInfoPress(pair[0]) : null}
          />
          {pair[1] ? (
            <SupersetCard
              item={pair[1]}
              width={cardWidth}
              height={cardHeight}
              onPress={() => onTap(pair[1])}
              selected={selection ? isSelected(selection, pair[1].superset.id) : false}
              rank={rankOf(pair[1])}
              disabled={disabledIds.has(pair[1].superset.id)}
              onInfoPress={onInfoPress ? () => onInfoPress(pair[1]!) : null}
            />
          ) : (
            <View style={{ width: cardWidth, height: cardHeight }} />
          )}
        </View>
      ))}
    </ScrollView>
  );
}

function SupersetCard({
  item,
  width,
  height,
  onPress,
  selected,
  rank,
  disabled,
  onInfoPress,
}: {
  item: ReusableSupersetWithExercises;
  width: number;
  height: number;
  onPress: () => void;
  selected: boolean;
  rank: number;
  /** Slice 10c #20 — already in the in-progress session. Whole card dims;
   *  main Pressable disabled (no toggle); ⓘ stays live. */
  disabled: boolean;
  onInfoPress: (() => void) | null;
}) {
  const { superset, exercises } = item;
  const barColor = superset.color_hex ?? hashColor(superset.name);
  const exA = exercises[0];
  const exB = exercises[1];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.card,
        styles.supersetCard,
        { width, height },
        selected && styles.cardSelected,
        disabled && styles.cardDisabled,
        pressed && styles.pressed,
      ]}>
      <View style={[styles.supersetColorBar, { backgroundColor: barColor }]} />
      {superset.use_count > 0 && (
        <Text style={styles.countBadge}>{superset.use_count} 次</Text>
      )}
      {selected && rank >= 0 && (
        <View style={styles.selectedBadge}>
          <Text style={styles.selectedBadgeText}>{rank + 1}</Text>
        </View>
      )}
      <View style={styles.supersetThumbRow}>
        <SupersetMiniThumb exercise={exA} />
        <SupersetMiniThumb exercise={exB} />
      </View>
      <Text style={styles.cardName} numberOfLines={2}>
        {superset.name}
      </Text>
      {onInfoPress && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="查看超級組詳情"
          onPress={onInfoPress}
          hitSlop={8}
          style={({ pressed }) => [
            styles.infoBtn,
            pressed && styles.pressed,
          ]}>
          <Text style={styles.infoBtnText}>ⓘ</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

function SupersetMiniThumb({ exercise }: { exercise: Exercise | undefined }) {
  if (!exercise) {
    return <View style={[styles.supersetMiniThumb, styles.supersetMiniThumbEmpty]} />;
  }
  const thumbnail = exercise.media_path;
  if (thumbnail) {
    return (
      <View style={styles.supersetMiniThumb}>
        <Image source={{ uri: thumbnail }} style={styles.thumbImage} />
      </View>
    );
  }
  const bg = hashColor(exercise.name || exercise.id);
  const ch = exercise.name?.charAt(0) ?? '?';
  return (
    <View style={[styles.supersetMiniThumb, { backgroundColor: bg }]}>
      <Text style={styles.supersetMiniThumbInitial}>{ch}</Text>
    </View>
  );
}

// ---------- Styles ----------

const SIDEBAR_WIDTH = 92;
const CARD_GAP = 10;
const CONTENT_H_PADDING = 12;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(127,127,127,0.20)',
    borderRadius: 999,
    paddingHorizontal: 14,
    height: 40,
  },
  searchIcon: { fontSize: 14, marginRight: 6, color: 'rgba(255,255,255,0.6)' },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    padding: 0,
  },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#34C759',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: { color: '#fff', fontSize: 24, fontWeight: '600', lineHeight: 26 },
  cancelBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: { color: '#fff', fontSize: 20, fontWeight: '600', lineHeight: 22 },

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
    backgroundColor: '#34C759',
    borderRadius: 2,
  },
  sidebarText: { color: 'rgba(255,255,255,0.55)', fontSize: 17, fontWeight: '500' },
  sidebarTextActive: { color: '#fff', fontWeight: '700' },
  sidebarSubRow: {
    height: 36,
    paddingLeft: 24,
    justifyContent: 'center',
  },
  sidebarSubText: { color: 'rgba(255,255,255,0.45)', fontSize: 15 },
  sidebarSubTextActive: { color: '#34C759', fontWeight: '600' },

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
    backgroundColor: 'rgba(127,127,127,0.20)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  equipChipActive: { backgroundColor: 'rgba(52,199,89,0.18)' },
  equipText: { color: 'rgba(255,255,255,0.75)', fontSize: 14 },
  equipTextActive: { color: '#34C759', fontWeight: '600' },

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
    backgroundColor: 'rgba(127,127,127,0.15)',
    borderRadius: 14,
    padding: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  cardSelected: {
    borderColor: '#34C759',
    backgroundColor: 'rgba(52,199,89,0.15)',
  },
  /** Slice 10c #20 — exercise/RS already in the in-progress session. Dim
   *  the whole card so the user sees it but can't tap to add a duplicate.
   *  ⓘ button overlay is rendered separately (after this Pressable's child
   *  tree) and keeps its own opacity / hitSlop, so the detail-preview path
   *  remains usable even when the card body is dimmed. */
  cardDisabled: {
    opacity: 0.4,
  },
  selectedBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#34C759',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedBadgeText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  infoBtn: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  infoBtnText: { color: '#fff', fontSize: 18, lineHeight: 20 },
  cuesPill: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: '#34C759',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  /** Shift right when ⓘ button occupies top-left (picker mode). */
  cuesPillWithInfo: { left: 40 },
  cuesPillText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  countBadge: {
    position: 'absolute',
    top: 10,
    right: 12,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
  },
  thumbWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#fff',
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
  thumbInitial: { color: '#fff', fontSize: 36, fontWeight: '700' },
  cardName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  supersetCard: {
    // Override `card`'s justifyContent:'center' so paddingTop directly
    // controls the gap below the color bar — `justifyContent:'center'`
    // folds marginTop into the centering calculation and only shifts
    // content by half the margin (centered block grows, recentered).
    justifyContent: 'flex-start',
    paddingTop: 22,
  },
  supersetColorBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  supersetThumbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 10,
  },
  supersetMiniThumb: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  supersetMiniThumbEmpty: {
    backgroundColor: 'rgba(127,127,127,0.3)',
  },
  supersetMiniThumbInitial: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  cardCueLink: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    marginTop: 4,
  },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { color: 'rgba(255,255,255,0.55)', fontSize: 15 },
  emptySubText: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
  },

  pressed: { opacity: 0.7 },

  pickerFooter: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.15)',
  },
  pickerDoneBtn: {
    height: 48,
    borderRadius: 12,
    backgroundColor: '#34C759',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerDoneBtnDisabled: {
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  pickerDoneBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
