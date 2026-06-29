import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Fragment, forwardRef, useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  MgEquipmentPicker,
  type PickerCell,
} from '@/components/exercise/mg-equipment-picker';
import { hashColor } from '@/components/template-editor/palette';
import { resolveExerciseMedia } from '@/src/db/seed/exerciseMediaMap';
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
import {
  getReusableSupersetSessionCounts,
  listReusableSupersetsWithExercises,
} from '@/src/adapters/sqlite/supersetRepository';
import type { ReusableSupersetWithExercises } from '@/src/domain/superset/types';
import {
  clearNewlyCreatedSuperset,
  clearPick,
  consumeNewlyCreated,
  consumeNewlyCreatedSuperset,
  peekPickerExclusions,
  submitPick,
} from '@/src/domain/exercise/pickerBridge';
import {
  EMPTY_SELECTION,
  addSelection,
  isSelected,
  selectionRank,
  toggleSelection,
} from '@/src/domain/exercise/pickerSelection';
import { t, tEquipment, tExercise, tMuscleGroup, tNSessions, useLocale } from '@/src/i18n';
import { useTheme, type ThemeTokens } from '@/src/theme';

import {
  CoachMarkProvider,
  HelpButton,
  PageHelpHost,
  useCoachMarkTarget,
  usePageHelp,
} from '@/components/help';
import { libraryHelp } from '@/components/help/content/library';

/**
 * ADR-0025 — DRY helper for the 10 components in this file that all need
 * the same memoised style sheet. Each sub-component calls `useLibStyles()`
 * instead of repeating the useTheme + useMemo pair.
 */
function useLibStyles() {
  const { tokens } = useTheme();
  return useMemo(() => makeStyles(tokens), [tokens]);
}

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
function LibraryScreen() {
  // `'use no memo'`: opt this screen out of React Compiler memoization so that
  // on a language switch its INLINE `t()` calls (search placeholder, the「全部」
  // equipment chip label, the「超級組」sidebar entry, section headers) re-evaluate
  // fresh. Without it the compiler reuses the cached strings even though the
  // `useLocale()` below forces a re-render. Memoized child components still need
  // their own opt-out (see EquipmentFilter / ExerciseCard / SupersetCard).
  'use no memo';
  const db = useDatabase();
  // Live language switch: tab screens stay mounted, so a `setLocale()` while
  // this tab was already visited never re-rendered it (the root
  // `<Stack key={locale}>` in app/_layout.tsx does NOT remount mounted
  // expo-router screens — the navigator state lives above it). Subscribing here
  // re-renders this screen on every `setLocale()`, refreshing all INLINE text
  // (the muscle-group sidebar, section headers, search placeholder). The
  // React-Compiler-memoized leaf cards (ExerciseCard/SupersetCard/…) need their
  // OWN `useLocale()` subscription on top of this — see their headers. Cf.
  // `project_traininglog_react_compiler_i18n_gotcha`.
  useLocale();
  const router = useRouter();
  // ADR-0025 — pull tokens here so we can use the raw value for
  // `placeholderTextColor` (inline prop, not in StyleSheet).
  const { tokens } = useTheme();
  const styles = useLibStyles();
  const help = usePageHelp('library', libraryHelp, { autoShowOnce: true });
  const sidebarTarget = useCoachMarkTarget('library.sidebar');
  const equipmentTarget = useCoachMarkTarget('library.equipment');
  const gridTarget = useCoachMarkTarget('library.grid');
  const params = useLocalSearchParams<{ mode?: string; sessionId?: string }>();
  const isPickerMode = params.mode === 'picker';
  // 2026-05-20 edit-parity audit: when picker is opened from session detail
  // edit mode, the URL carries `?sessionId=<id>` so the dim layer can target
  // THAT session (possibly an ended one) instead of falling back to
  // `getActiveSession`. Empty / missing param keeps original Today-screen
  // behaviour (active session lookup).
  const pickerSessionIdParam =
    typeof params.sessionId === 'string' && params.sessionId.length > 0
      ? params.sessionId
      : null;
  const { width: windowWidth } = useWindowDimensions();
  const cardWidth = Math.floor(
    (windowWidth - SIDEBAR_WIDTH - CONTENT_H_PADDING * 2 - CARD_GAP) / 2
  );
  // Card height hugs its content: 16:9 photo + a 2-line name + paddings. The
  // old `cardWidth / 0.92` magic ratio was tuned for the legacy circle-thumb
  // layout and left a large empty gap under the top-aligned 16:9 photo cards.
  // Derive from the photo's real height (thumbWrap width = cardWidth − 2×10
  // padding) plus a fixed block for the name + vertical paddings.
  const cardHeight = Math.ceil((cardWidth - 20) * (9 / 16)) + 68;

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
  // Slice 10c #24 — dynamic RS "N 次" badge: real session count keyed on
  // `session_exercise.reusable_superset_id`, NOT `superset.use_count` (which
  // is only bumped on Template explode and so under-counts actual usage).
  const [supersetCounts, setSupersetCounts] = useState<Map<string, number>>(
    new Map()
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
    const [{ exercises, links }, mgs, ms, counts, ss, sCounts] = await Promise.all([
      listExercisesWithLinks(db),
      listMuscleGroups(db),
      listMuscles(db),
      getExerciseSessionCounts(db),
      listReusableSupersetsWithExercises(db),
      getReusableSupersetSessionCounts(db),
    ]);
    setExercises(exercises);
    setLinks(links);
    setMuscleGroups(mgs);
    setMuscles(ms);
    setSessionCounts(counts);
    setSupersets(ss);
    setSupersetCounts(sCounts);
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
      //
      // 2026-05-20 edit-parity audit: prefer explicit `?sessionId=<id>` URL
      // param (session detail edit mode) over `getActiveSession` so the dim
      // layer reflects the SESSION BEING EDITED rather than whatever is
      // currently active. Falls back to active session when no param —
      // preserves the Today-screen picker flow.
      if (isPickerMode) {
        // Template-editor path (#2): caller pre-set the already-added ids in
        // pickerBridge (no session exists for a template). Peek — not consume —
        // so re-focus within this picker session (e.g. after /exercise/new)
        // keeps dimming. Takes precedence over the session lookup so an
        // unrelated active session never bleeds into a template pick.
        const exclusions = peekPickerExclusions();
        if (exclusions) {
          setDisabledExerciseIds(new Set(exclusions.exerciseIds));
          setDisabledSupersetIds(new Set(exclusions.reusableSupersetIds));
        } else {
          void (async () => {
            let targetSessionId: string | null = pickerSessionIdParam;
            if (!targetSessionId) {
              const active = await getActiveSession(db);
              targetSessionId = active?.id ?? null;
            }
            if (!targetSessionId) {
              setDisabledExerciseIds(new Set());
              setDisabledSupersetIds(new Set());
              return;
            }
            const used = await listSessionUsedExercises(db, targetSessionId);
            setDisabledExerciseIds(used.solo_exercise_ids);
            setDisabledSupersetIds(used.rs_template_ids);
          })();
        }
      } else {
        setDisabledExerciseIds(new Set());
        setDisabledSupersetIds(new Set());
      }
    }, [refresh, isPickerMode, db, pickerSessionIdParam])
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
      // Match the LOCALIZED display name too — many rows store an English
      // canonical name (v028 import) but render as 中文 via tExercise, so a
      // Chinese search must compare against tExercise(name), not just name.
      localize: tExercise,
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
            accessibilityLabel={t('common', 'cancel')}
            onPress={onPickerCancel}
            style={({ pressed }) => [styles.cancelBtn, pressed && styles.pressed]}>
            <Text style={styles.cancelBtnText}>✕</Text>
          </Pressable>
        )}
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isSupersetTab ? t('button', 'createSuperset') : t('button', 'addExercisePlain')}
          onPress={() =>
            router.push(isSupersetTab ? '/superset/new' : '/exercise/new')
          }
          style={({ pressed }) => [styles.addBtn, pressed && styles.pressed]}>
          <Text style={styles.addBtnText}>+</Text>
        </Pressable>
        <HelpButton onPress={help.open} />
      </View>

      <View style={styles.body}>
        {/* The coach ref is forwarded onto Sidebar's OWN root view — do NOT wrap
            it in a bare <View>. The sidebar relies on being a direct child of
            this row (align-items:stretch) to fill the full height so its inner
            flex:1 ScrollView has height; an unstyled wrapper collapses that
            chain and the sidebar vanishes (2026-06-29 regression). */}
        <Sidebar
          ref={sidebarTarget.ref}
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
              counts={supersetCounts}
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
              <View ref={equipmentTarget.ref} collapsable={false}>
                <EquipmentFilterDropdown
                  value={selectedEquipment}
                  onChange={setSelectedEquipment}
                />
              </View>
              <View
                ref={gridTarget.ref}
                collapsable={false}
                style={{ flex: 1 }}>
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
              </View>
            </>
          )}
        </View>
      </View>
      {isPickerMode && (
        <View style={styles.pickerFooter}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common', 'done')}
            onPress={onPickerDone}
            disabled={pickerTotal === 0}
            style={({ pressed }) => [
              styles.pickerDoneBtn,
              pickerTotal === 0 && styles.pickerDoneBtnDisabled,
              pressed && styles.pressed,
            ]}>
            <Text style={styles.pickerDoneBtnText}>
              {t('common', 'done')}{pickerTotal > 0 ? ` (${pickerTotal})` : ''}
            </Text>
          </Pressable>
        </View>
      )}
      <PageHelpHost help={help} />
    </SafeAreaView>
  );
}

/**
 * Wrap from OUTSIDE in CoachMarkProvider so LibraryScreen's useCoachMarkTarget
 * anchors (sidebar / equipment / grid) register against the provider.
 */
export default function LibraryScreenWithHelp() {
  return (
    <CoachMarkProvider>
      <LibraryScreen />
    </CoachMarkProvider>
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

const Sidebar = forwardRef<View, SidebarProps>(function Sidebar(props, ref) {
  const styles = useLibStyles();
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
    // `ref` is the coach-mark target; it must sit on this root so measureInWindow
    // sees the full-height sidebar. `collapsable={false}` keeps the node real.
    <View ref={ref} collapsable={false} style={styles.sidebarWrap}>
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
                {tMuscleGroup(mg.name)}
              </Text>
            </Pressable>
            {isActive &&
              subMuscles.length > 1 &&
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
                    {tMuscleGroup(m.name)}
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
          {t('domain', 'superset')}
        </Text>
      </Pressable>
    </ScrollView>
    </View>
  );
});

// ---------- Equipment filter dropdown ----------

// Sentinel cell id for the "全部 / All" option inside the picker grid. Picker
// cells are keyed by string id, so we use a reserved key that can never collide
// with an Equipment enum value and map it back to `null` on select.
const EQUIP_ALL_ID = '__all__';

/**
 * Equipment filter as a single dropdown button (replaces the old horizontal
 * chip row, which overflowed + truncated labels like "Smith M…" on narrow
 * iPhones). Tapping the button opens the shared MgEquipmentPicker bottom sheet
 * (same即選即commit idiom used by the custom-exercise MG/用具 pickers). All
 * existing filter values + behaviour are preserved: 全部 + the 8 EQUIPMENT_VALUES,
 * single-select, null === no filter.
 */
function EquipmentFilterDropdown({
  value,
  onChange,
}: {
  value: Equipment | null;
  onChange: (eq: Equipment | null) => void;
}) {
  // Memoized leaf — re-evaluate its t('common','all')「全部」label + equipment
  // names on a language switch. See ExerciseCard note above.
  'use no memo';
  const locale = useLocale();
  const styles = useLibStyles();
  const { tokens } = useTheme();
  const [open, setOpen] = useState(false);
  const cells: PickerCell[] = useMemo(
    () => [
      { id: EQUIP_ALL_ID, label: t('common', 'all') },
      ...EQUIPMENT_VALUES.map((eq) => ({ id: eq, label: tEquipment(eq) })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `locale` is the
    // intentional dep: recompute the t()/tEquipment() labels on a language switch.
    [locale]
  );
  const buttonLabel = value === null ? t('common', 'all') : tEquipment(value);
  return (
    <View style={styles.equipRowOuter}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('page', 'selectEquipment')}
        accessibilityValue={{ text: buttonLabel }}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.equipDropdownBtn,
          value !== null && styles.equipDropdownBtnActive,
          pressed && styles.pressed,
        ]}>
        <Text
          numberOfLines={1}
          style={[
            styles.equipDropdownText,
            value !== null && styles.equipDropdownTextActive,
          ]}>
          {buttonLabel}
        </Text>
        <Text
          style={[
            styles.equipDropdownChevron,
            { color: value !== null ? tokens.action.primary : tokens.text.secondary },
          ]}>
          ▾
        </Text>
      </Pressable>
      <MgEquipmentPicker
        visible={open}
        title={t('page', 'selectEquipment')}
        cells={cells}
        selectedId={value ?? EQUIP_ALL_ID}
        onSelect={(id) => onChange(id === EQUIP_ALL_ID ? null : (id as Equipment))}
        onClose={() => setOpen(false)}
      />
    </View>
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
  const styles = useLibStyles();
  if (exercises.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{t('status', 'noExercisesMatch')}</Text>
      </View>
    );
  }
  // Group by equipment in canonical EQUIPMENT_VALUES order, with a small
  // section header per group (user request — cards bucket under「槓鈴 / 啞鈴 /
  // …」). Defensive trailing bucket catches any row whose equipment isn't a
  // known enum value so nothing silently disappears (EQUIPMENT_VALUES already
  // has '其他', so this normally stays empty).
  const groups: { equipment: Equipment; items: Exercise[] }[] = [];
  for (const eq of EQUIPMENT_VALUES) {
    const items = exercises.filter((e) => e.equipment === eq);
    if (items.length > 0) groups.push({ equipment: eq, items });
  }
  const orphans = exercises.filter(
    (e) => !EQUIPMENT_VALUES.includes(e.equipment)
  );
  if (orphans.length > 0) {
    groups.push({ equipment: '其他' as Equipment, items: orphans });
  }

  // Manual row-pair rendering with explicit pixel sizing — sidesteps
  // FlatList numColumns + aspectRatio + flex measurement quirks in
  // RN 0.74+ on iPhone 17 simulator.
  const renderPair = (pair: Exercise[], key: string) => (
    <View key={key} style={styles.gridRow}>
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
  );

  return (
    <ScrollView
      style={styles.gridList}
      contentContainerStyle={styles.gridContent}
      showsVerticalScrollIndicator={false}>
      {groups.map((g) => {
        const rows: Exercise[][] = [];
        for (let i = 0; i < g.items.length; i += 2) {
          rows.push(g.items.slice(i, i + 2));
        }
        return (
          <Fragment key={g.equipment}>
            <Text style={styles.equipSectionHeader}>
              {tEquipment(g.equipment)}
            </Text>
            {rows.map((pair, i) => renderPair(pair, `${g.equipment}-${i}`))}
          </Fragment>
        );
      })}
    </ScrollView>
  );
}

// U+2060 WORD JOINER — a zero-width "no line break here" glue. Built via
// fromCharCode so the source stays free of an invisible literal.
const WORD_JOINER = String.fromCharCode(0x2060);

/** Glue every「（…）」run internally so a parenthetical never splits across
 *  lines (e.g.「…（上 / 胸）」). */
function glueParens(s: string): string {
  return s.replace(/（[^）]*）/g, (run) => run.split('').join(WORD_JOINER));
}

/**
 * Soft-wrap a 2-line card name so it breaks at a natural word boundary instead
 * of mid-word. Two things are kept unbreakable via WORD_JOINER:
 *
 *  1. Any「（…）」parenthetical — never splits as「…（上 / 胸）」.
 *  2. The trailing 2-CJK-char movement noun (划船 / 飛鳥 / 推胸 …) PLUS any
 *     trailing「（…）」— so a long name wraps BEFORE the noun
 *     (機械單側高位 / 划船) instead of THROUGH it (機械單側高位划 / 船).
 *
 * Greedy line-fill does the rest: the glued tail is one blob, so it drops to
 * line 2 whole once the head fills line 1. Short / English names are a no-op
 * (the blob still fits on one line, or English keeps wrapping on its spaces).
 */
function softWrapName(name: string): string {
  // Peel off a trailing「（…）」so it stays attached to the movement noun.
  const parenMatch = name.match(/（[^）]*）$/);
  const paren = parenMatch ? parenMatch[0] : '';
  const base = paren ? name.slice(0, name.length - paren.length) : name;

  // Movement noun = the last 2 CJK characters of the base.
  const m = base.match(/^(.*?)([一-鿿]{2})$/);
  if (!m || m[1].length === 0) {
    // No splittable head (English / short / non-CJK tail) — fall back to the
    // paren-only glue so a「（…）」still never splits mid-parenthetical.
    return glueParens(name);
  }
  const head = m[1];
  const tail = m[2];
  const gluedTail = (tail + paren).split('').join(WORD_JOINER);
  return glueParens(head) + gluedTail;
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
  // Live language switch. This card is React-Compiler-memoized on its (stable)
  // `exercise` prop, so when the user flips zh⇄en mid-session the parent reuses
  // the cached element and the `tExercise(exercise.name)` below would keep the
  // boot-language name. `useLocale()` force-re-renders this card on every
  // `setLocale()`; `'use no memo'` makes that re-render re-evaluate `tExercise`
  // fresh instead of returning the compiler-cached string. (Screen-level
  // `useLocale()` only refreshes the screen's INLINE text — memoized leaves like
  // this need their own subscription. Cf. project_traininglog_react_compiler_i18n_gotcha.)
  'use no memo';
  useLocale();
  const styles = useLibStyles();
  const hasCues = exercise.cues_text != null && exercise.cues_text.length > 0;
  // media_path stores a require-map key; resolve to [startFrame, endFrame].
  // Grid shows the static start frame (poster) — the 2-frame crossfade lives on
  // the detail page only, so we don't run 167 timers across the library grid.
  const media = resolveExerciseMedia(exercise.media_path);
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
      <View style={styles.thumbWrap}>
        {media ? (
          <Image source={media[0]} style={styles.thumbImage} />
        ) : (
          <PlaceholderThumb exercise={exercise} />
        )}
        {sessionCount > 0 && (
          <View style={styles.photoSessionBadge}>
            <Text style={styles.photoSessionBadgeText}>
              {tNSessions(sessionCount)}
            </Text>
          </View>
        )}
      </View>
      <Text style={styles.cardName} numberOfLines={2}>
        {softWrapName(tExercise(exercise.name))}
      </Text>
      {hasCues && <Text style={styles.cardCueLink}>{t('button', 'viewCues')}</Text>}
      {/* Overlays rendered AFTER the photo + name so they paint on the TOP
          layer. RN paints later siblings on top; when these sat before
          <thumbWrap> the photo covered the selection badge (half-hidden /
          clipped — worse on 2-line-name cards where center-justify pushed the
          photo up under the badge). The session count moved INTO <thumbWrap>
          (photo bottom-left) so the top-right selection badge never overlaps
          it. */}
      {hasCues && (
        <View style={[styles.cuesPill, onInfoPress && styles.cuesPillWithInfo]}>
          <Text style={styles.cuesPillText}>{t('button', 'cues')}</Text>
        </View>
      )}
      {selected && rank >= 0 && (
        <View style={styles.selectedBadge}>
          <Text style={styles.selectedBadgeText}>{rank + 1}</Text>
        </View>
      )}
      {onInfoPress && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('button', 'viewExerciseDetails')}
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
  // Memoized leaf — re-evaluate the tExercise() initial on a language switch.
  'use no memo';
  useLocale();
  const styles = useLibStyles();
  // Hash-color circle with first character — ADR-0017 Q8 v1 placeholder.
  // hash uses raw DB name so the color is stable across locales;
  // displayed initial uses tExercise() so zh seeds show the zh first char.
  const bg = hashColor(exercise.name || exercise.id);
  const ch = tExercise(exercise.name ?? '')?.charAt(0) || '?';
  return (
    <View style={[styles.thumbPlaceholder, { backgroundColor: bg }]}>
      <Text style={styles.thumbInitial}>{ch}</Text>
    </View>
  );
}

// ---------- 超級組 grid ----------

function SupersetGrid({
  supersets,
  counts,
  cardWidth,
  cardHeight,
  onTap,
  selection,
  disabledIds,
  onInfoPress,
}: {
  supersets: ReusableSupersetWithExercises[];
  /** Slice 10c #24 — dynamic per-RS session count (`session_exercise.reusable_superset_id`-keyed). */
  counts: Map<string, number>;
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
  const styles = useLibStyles();
  if (supersets.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{t('status', 'noSupersetsYet')}</Text>
        <Text style={styles.emptySubText}>{t('status', 'noSupersetsHint')}</Text>
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
            count={counts.get(pair[0].superset.id) ?? 0}
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
              count={counts.get(pair[1].superset.id) ?? 0}
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
  count,
  width,
  height,
  onPress,
  selected,
  rank,
  disabled,
  onInfoPress,
}: {
  item: ReusableSupersetWithExercises;
  /** Slice 10c #24 — dynamic session count (ended sessions with at least one
   *  logged set against this RS template). Replaces `superset.use_count`. */
  count: number;
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
  // Memoized leaf — re-render + re-evaluate its t()/tExercise() (cue link,
  // mini-thumb initials) on a language switch. See ExerciseCard note above.
  'use no memo';
  useLocale();
  const styles = useLibStyles();
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
      {count > 0 && (
        <Text style={styles.countBadge}>{tNSessions(count)}</Text>
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
        {softWrapName(superset.name)}
      </Text>
      {onInfoPress && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('button', 'viewSupersetDetails')}
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
  // Memoized leaf — re-evaluate its tExercise() initial on a language switch.
  'use no memo';
  useLocale();
  const styles = useLibStyles();
  if (!exercise) {
    return <View style={[styles.supersetMiniThumb, styles.supersetMiniThumbEmpty]} />;
  }
  const media = resolveExerciseMedia(exercise.media_path);
  if (media) {
    return (
      <View style={styles.supersetMiniThumb}>
        <Image source={media[0]} style={styles.thumbImage} />
      </View>
    );
  }
  const bg = hashColor(exercise.name || exercise.id);
  const ch = tExercise(exercise.name ?? '')?.charAt(0) || '?';
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

/**
 * ADR-0025 — library.tsx was originally built dark-only (#fff text + #000 bg
 * + green #34C759 accent everywhere). Every color now flows from tokens.
 * 2026-06-28: the library's "selected / active" accent (sidebar active rail,
 * sub-muscle active, equipment-filter active, picker selection badge/border,
 * selected-card tint) maps to `action.primary` (iOS blue #007AFF) so it
 * matches the app's blue brand + the rest of the app's selected states. It is
 * deliberately NOT `action.success` (green) — green stays reserved for genuine
 * success semantics (completed set ✓, PR badge) elsewhere in the app, which
 * this change does NOT touch (library-only per user scope).
 *
 * The two `#fff` circle backgrounds (thumb + miniThumb) map to bg.surface
 * — in dark mode that becomes a slightly elevated dark circle that hosts
 * either an Image (fits) or a hash-colored letter overlay (overrides).
 */
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
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: tokens.action.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: {
    color: tokens.action.onPrimary,
    fontSize: 24,
    fontWeight: '600',
    lineHeight: 26,
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
    backgroundColor: tokens.action.primary,
    borderRadius: 2,
  },
  sidebarText: {
    color: tokens.text.tertiary,
    fontSize: 17,
    fontWeight: '500',
  },
  sidebarTextActive: { color: tokens.text.primary, fontWeight: '700' },
  sidebarSubRow: {
    height: 36,
    paddingLeft: 24,
    justifyContent: 'center',
  },
  sidebarSubText: { color: tokens.text.tertiary, fontSize: 15 },
  sidebarSubTextActive: { color: tokens.action.primary, fontWeight: '600' },

  content: { flex: 1, flexDirection: 'column', minWidth: 0 },
  equipRowOuter: {
    height: 56,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  // Single dropdown trigger button (replaced the overflowing chip ScrollView).
  // Sits inline at the top of the content column; alignSelf:flex-start keeps it
  // compact instead of stretching across the full content width.
  equipDropdownBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingLeft: 14,
    paddingRight: 10,
    height: 34,
    borderRadius: 17,
    backgroundColor: tokens.bg.elevated,
  },
  // Semitransparent success tint (success token at 18% alpha) so an active
  // filter reads as "selected" against the page base in both themes — mirrors
  // the old active-chip treatment.
  equipDropdownBtnActive: { backgroundColor: 'rgba(0,122,255,0.18)' },
  equipDropdownText: {
    color: tokens.text.secondary,
    fontSize: 14,
    fontWeight: '500',
    maxWidth: 180,
  },
  equipDropdownTextActive: { color: tokens.action.primary, fontWeight: '600' },
  equipDropdownChevron: { fontSize: 11, lineHeight: 14 },

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
  // Equipment bucket header inside the card grid (槓鈴 / 啞鈴 / …). marginTop
  // adds breathing room above each group on top of the gridContent gap.
  equipSectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: tokens.text.secondary,
    marginTop: 8,
    marginLeft: 2,
    letterSpacing: 0.3,
  },
  card: {
    flexShrink: 0,
    backgroundColor: tokens.bg.elevated,
    borderRadius: 14,
    padding: 10,
    alignItems: 'center',
    // flex-start (not center) so the 16:9 photo always sits at the card top,
    // uniform across 1-line vs 2-line names in the same row (center-justify
    // left paired photos vertically misaligned).
    justifyContent: 'flex-start',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  // Same rationale as equipChipActive — semitransparent success accent for
  // a clear "selected" affordance independent of theme.
  cardSelected: {
    borderColor: tokens.action.primary,
    backgroundColor: 'rgba(0,122,255,0.15)',
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
    backgroundColor: tokens.action.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedBadgeText: {
    color: tokens.action.onPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  infoBtn: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tokens.bg.surface,
  },
  infoBtnText: { color: tokens.text.primary, fontSize: 18, lineHeight: 20 },
  cuesPill: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: tokens.action.primary,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  /** Shift right when ⓘ button occupies top-left (picker mode). */
  cuesPillWithInfo: { left: 40 },
  cuesPillText: {
    color: tokens.action.onPrimary,
    fontSize: 11,
    fontWeight: '600',
  },
  countBadge: {
    position: 'absolute',
    top: 10,
    right: 12,
    color: tokens.text.secondary,
    fontSize: 13,
  },
  // Session-count overlay for the 16:9 photo cards. Lives INSIDE <thumbWrap>
  // (clipped to the photo) at the bottom-left, with a translucent dark pill so
  // the count reads on any photo and never collides with the top-right
  // selection badge or the top-left ⓘ. (SupersetCard keeps `countBadge` — it
  // has no photo, only a centered mini-thumb row.)
  photoSessionBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  photoSessionBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  thumbWrap: {
    // ADR-0017 Q8: 16:9 landscape card thumbnail (replaced the 96×96 circle).
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 10,
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
  // Letter inside hash-colored placeholder. Kept white because the
  // hashColor() palette is dark/saturated so white-on-color reads either
  // way (the parent View overrides backgroundColor with `bg`).
  thumbInitial: { color: '#fff', fontSize: 36, fontWeight: '700' },
  cardName: {
    color: tokens.text.primary,
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
    backgroundColor: tokens.bg.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  supersetMiniThumbEmpty: {
    backgroundColor: tokens.bg.elevated,
  },
  // See thumbInitial comment — white letter sits on hash-colored bg.
  supersetMiniThumbInitial: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  cardCueLink: {
    color: tokens.text.tertiary,
    fontSize: 12,
    marginTop: 4,
  },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { color: tokens.text.tertiary, fontSize: 15 },
  emptySubText: {
    color: tokens.text.disabled,
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
  },

  pressed: { opacity: 0.7 },

  pickerFooter: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: tokens.border.subtle,
  },
  pickerDoneBtn: {
    height: 48,
    borderRadius: 12,
    backgroundColor: tokens.action.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerDoneBtnDisabled: {
    backgroundColor: tokens.bg.elevated,
  },
  pickerDoneBtnText: {
    color: tokens.action.onPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  });
}
