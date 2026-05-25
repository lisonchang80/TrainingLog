/**
 * ClusterCard — in-session render of a 2-side cluster (ADR-0019 Q16 + Q8,
 * slice 10c Phase 7).
 *
 * Renders a single collapsible card per cluster:
 *
 *   ┌────────────────────────────────────────────┐
 *   │ ▾ ○  A名 + B名         1305/1970   ⚙️      │
 *   │ [▓▓│▓▓│░░]                                  │
 *   │ ─────                                        │
 *   │ A: 深蹲          │   B: 划船                 │
 *   │ ─────                                        │
 *   │ 1  80×5          │  60×8         ✓          │
 *   │ 2  85×5          │  60×8         ✓          │
 *   │ 3  85×5          │  60×8         ○          │
 *   │ 4  85×5          │   —           ○          │
 *   │ ─────                                        │
 *   │ [+ 新增一輪]      [動作歷史]                │
 *   └────────────────────────────────────────────┘
 *
 * Tap-✓ on the shared ✓ icon flips BOTH sides via the atomic
 * `markClusterCycleLogged` repo method. The ✓ icon is disabled for
 * asymmetric short-side cycles (one side missing — "—" placeholder per
 * ADR-0019 Q8 (d) AS1).
 *
 * Aggregated 容量 header shows numerator/denominator computed by
 * `computeClusterVolume` (Q15.5 ledger applied to cluster: warmup
 * excluded, is_logged=1 numerator over both A+B sides combined).
 *
 * Long-press cycle row → inline drag reorder (slice 10c overnight 第 5 點)
 * via `NestableDraggableFlatList`; on drop, `onConfirmReorderCycles` fires
 * with the new ordered cycle list and the caller commits per-side via
 * `reorderSessionSetsForExercise` ×2.
 *
 * Component is intentionally presentational; all DB writes flow back to
 * the parent (Today screen) via callbacks. Pure logic lives in
 * `src/domain/session/clusterCard.ts`.
 */

import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  NestableDraggableFlatList,
  type RenderItemParams,
} from 'react-native-draggable-flatlist';

import { SegmentedProgressBar } from '@/components/shared/segmented-progress-bar';
import {
  SetRowContent,
  type SetRowItem,
} from '@/components/shared/set-row-content';
import { SwipeableSetRow } from '@/components/shared/swipeable-set-row';
import {
  computeClusterCycleProgress,
  computeClusterCycles,
  computeClusterVolume,
  type ClusterCycle,
  type ClusterGroup,
} from '@/src/domain/session/clusterCard';
import {
  computeWorkingSetOrdinals,
  displaySetLabel,
} from '@/src/domain/set/workingSetOrdinal';
import type { SessionExerciseRowWithName } from '@/src/adapters/sqlite/sessionRepository';
import type { SessionSetWithExercise } from '@/src/adapters/sqlite/setRepository';
import { t, tExercise } from '@/src/i18n';
import { useTheme, type ThemeTokens } from '@/src/theme';

type ClusterCardGroup = ClusterGroup<
  SessionExerciseRowWithName,
  SessionSetWithExercise
>;

type ClusterCardProps = {
  group: ClusterCardGroup;
  isExpanded: boolean;
  onToggleExpand: () => void;
  /**
   * RS accent color for the left vertical bar (per ADR-0019 Q8 (c) H1).
   * Threaded from `session_exercise.reusable_superset_id` → `superset.color_hex`
   * via `listSessionExercisesWithName`'s LEFT JOIN. NULL → fall back to the
   * neutral accent (`#b35900`) — applies to manual/ad-hoc clusters whose
   * source RS has no color, and to RS rows that were never colored.
   *
   * Slice 10c overnight 第 2 點 — cluster color threading.
   */
  colorHex?: string | null;
  /** Atomic "tap-✓ this cycle" — flips both sides via repo. */
  onToggleCycleLogged: (args: {
    a_set_id: string;
    b_set_id: string;
    /** Currently both is_logged=1 → caller will UNLOG. */
    currentlyLogged: boolean;
  }) => void;
  /** Append one new cycle row (atomic A+B insert via addClusterCycleAtEnd). */
  onAddCycle?: () => void;
  /** Delete one cycle row (atomic A+B delete via deleteClusterCycle). */
  onDeleteCycle?: (args: {
    a_set_id: string | null;
    b_set_id: string | null;
  }) => void;
  /** Clone one cycle row (atomic A+B insert with copied weight/reps via cloneClusterCycle). */
  onCloneCycle?: (args: {
    a_set_id: string | null;
    b_set_id: string | null;
  }) => void;
  /** Open the parent set's note editor (right-swipe 備註). */
  onShowCycleNote?: (parent_set_id: string) => void;
  /**
   * Slice 10c overnight 第 5 點 — inline drag reorder. On drop, this callback
   * fires with the new ordered cycle list (post-drag). Caller commits via
   * `reorderSessionSetsForExercise` ×2 (A side + B side), mapping the new
   * cycle order to per-side ordered set-id arrays. Asymmetric short-side
   * slots (a_set === null or b_set === null) are skipped on the empty side.
   */
  onConfirmReorderCycles?: (
    newOrder: ClusterCycle<SessionSetWithExercise>[],
  ) => Promise<void> | void;
  /** Open the per-RS history page. RS id is on the A side via reusable_superset_id. */
  onOpenHistory?: () => void;
  /** ⚙️ menu (delete cluster / rest_sec / notes). Falls back to a no-op. */
  onSettingsPress?: () => void;
  /** Inline edit weight / reps for any cluster set (matches solo card UX
   *  — user 「沒有可以改的格子和＃」). Threads through to updateSetFields. */
  onUpdateClusterSet?: (
    set_id: string,
    patch: { reps?: number; weight?: number },
  ) => void;
  /** Tap-to-edit reps / weight numeric keypad (per ADR-0019 Q6). */
  onTapClusterNumber?: (
    set_id: string,
    field: 'reps' | 'weight',
    current: number,
  ) => void;
  /** Tap label `# / 熱 / D{N}` to cycle set_kind. (Internal — kept for note
   *  sheet plumbing; per-row UI no longer exposes a per-side # button. The
   *  shared # button uses `onCycleClusterCycleSetKind` which fires for both
   *  A+B at once.) */
  onCycleClusterSetKind?: (set_id: string) => void;
  /** Shared `#` button per row — cycles set_kind for BOTH A and B atomically.
   *  Caller dispatches to onCycleSetKind for each side. */
  onCycleClusterCycleSetKind?: (args: {
    a_set_id: string | null;
    b_set_id: string | null;
  }) => void;
  /** Right-swipe 備註 also offered inline as 📝 indicator. */
  onShowClusterSetNote?: (set_id: string, current: string | null) => void;
};

export function ClusterCard({
  group,
  isExpanded,
  onToggleExpand,
  onToggleCycleLogged,
  onAddCycle,
  onDeleteCycle,
  onCloneCycle,
  onShowCycleNote,
  onOpenHistory,
  onSettingsPress,
  onUpdateClusterSet,
  onTapClusterNumber,
  onCycleClusterSetKind,
  onCycleClusterCycleSetKind,
  onShowClusterSetNote,
  onConfirmReorderCycles,
  colorHex,
}: ClusterCardProps): React.ReactElement {
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const cycles = computeClusterCycles(group);
  const volume = computeClusterVolume(group);
  // Working-set ordinal per side (slice 10c overnight #7 第 1 點).
  // Each side computes its own map because asymmetric clusters may have
  // a different working-row composition per side. The shared `#` button
  // prefers the A side (parent priority); B-side fallback covers the
  // asymmetric short-side case where only B has a row in this cycle.
  //
  // Slice 10c overnight #7 第 3 點 — legacy dropset 顯示驗證:
  // `displaySetLabel` 仍保留 dropset → 'D' 分支. cluster siblings 不應該
  // 從 UI 產生 dropset state (見第 2 點: cluster shared `#` button cycle
  // 跳過 D), 但 legacy data 可能有 — display 層必須照常 render 'D' 讓使用者
  // 可以辨識、然後按 # 走 cycleSessionSetKindClusterAware 的 defensive
  // fallback 轉回 working. (見 tests/domain/cycleSessionSetKind.test.ts
  // 「legacy dropset → working → warmup → working round-trip」.)
  const aOrdinalMap = computeWorkingSetOrdinals(group.a.sets);
  const bOrdinalMap = computeWorkingSetOrdinals(group.b.sets);
  // Progress bar count — overnight #46 第 3 點: mirror solo card 只算 working
  // cycle (任一側 set_kind === 'working' 即算)。熱身 / dropset cycle 排除於
  // numerator 與 denominator (solo 用 `sets.filter(s => s.set_kind === 'working')
  // .length`)。原本 `cycles.length` 會把熱身 cycle 也算入 denominator —
  // 用戶反映 cluster card 進度條「denominator 包熱身組虛胖」。
  const progress = computeClusterCycleProgress(cycles);
  const completedCycles = progress.done;
  const totalCycles = progress.total;

  // ADR-0019 Q8 (c) H1 — left vertical bar in RS color. Threaded prop
  // overrides the neutral fallback baked into styles.clusterCard.
  const borderLeftColor = colorHex ?? undefined;

  return (
    <View
      style={[
        styles.clusterCard,
        isExpanded && styles.clusterCardExpanded,
        borderLeftColor ? { borderLeftColor } : null,
      ]}
    >
      <View style={styles.clusterCardHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('domain', 'superset')} ${tExercise(group.a.exercise.exercise_name)} + ${tExercise(group.b.exercise.exercise_name)}`}
          onPress={onToggleExpand}
          style={({ pressed }) => [
            styles.clusterCardHeaderMain,
            pressed && styles.btnPressed,
          ]}
        >
          <View style={styles.clusterText}>
            {/*
              Row 1: tag only (chevron + gear 在 outer header row 右側).
              overnight #5 第 5 點: 標題分行 — tag 一行、title 獨佔下一行.
            */}
            <View style={styles.clusterTagRow}>
              <Text style={styles.supersetTag}>{t('domain', 'supersetChip')}</Text>
            </View>
            {/* Row 2: title 獨佔全寬, 不再 ... truncate. */}
            <Text style={styles.clusterName}>
              {tExercise(group.a.exercise.exercise_name)}
              <Text style={styles.clusterPlus}> + </Text>
              {tExercise(group.b.exercise.exercise_name)}
            </Text>
            {/*
              Row 3: progress bar + 容量 chip 同 row (overnight #5 第 1 點).
              chip 在 bar 右側、與齒輪 column 對齊.
            */}
            {totalCycles > 0 ? (
              <View style={styles.clusterProgressRow}>
                <View style={styles.clusterProgressBarFill}>
                  <SegmentedProgressBar
                    done={completedCycles}
                    total={totalCycles}
                  />
                </View>
                {volume.denominator > 0 ? (
                  <Text style={styles.clusterVolumeChip}>
                    {Math.round(volume.numerator)}/
                    {Math.round(volume.denominator)}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
          <Text style={styles.clusterChevron}>{isExpanded ? '▼' : '▶'}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('button', 'a11yClusterSettings')}
          onPress={onSettingsPress}
          style={({ pressed }) => [
            styles.clusterGear,
            pressed && styles.btnPressed,
          ]}
        >
          <Text style={styles.clusterGearText}>⚙️</Text>
        </Pressable>
      </View>
      {/*
        容量 row 砍除（overnight #3 第 2 點）— header chip 已表達 done/total
        kg·reps，第二行重複資訊；solo card 第二行是 PR row（重量/容量 PR），
        cluster 沒有 RS-level PR 概念所以直接不渲染第二行。cycle 進度由
        progress bar 表達。
      */}

      {isExpanded ? (
        <View style={styles.clusterBody}>
          {/* Side labels row — columns align with cycle row:
              [sharedLabelBtn 28] [cycleSide A] [divider 1] [cycleSide B] [completeBtn 28]. */}
          <View style={styles.sideLabelRow}>
            <View style={styles.sideLabelLead} />
            <Text style={styles.sideLabel} numberOfLines={1}>
              {tExercise(group.a.exercise.exercise_name)}
            </Text>
            <View style={styles.sideLabelDivider} />
            <Text style={styles.sideLabel} numberOfLines={1}>
              {tExercise(group.b.exercise.exercise_name)}
            </Text>
            <View style={styles.sideLabelGap} />
          </View>

          {cycles.length === 0 ? (
            <Text style={styles.clusterEmpty}>
              {t('status', 'clusterEmptyHint')}
            </Text>
          ) : (
            <NestableDraggableFlatList
              data={cycles}
              keyExtractor={(c) =>
                // Stable key per cycle: prefer a_set id, fallback b_set id.
                // Both null cycles are impossible (would imply empty row).
                c.a_set?.id ?? c.b_set?.id ?? `cycle-${c.cycle_idx}`
              }
              activationDistance={20}
              onDragEnd={async ({ data }) => {
                // Only commit if order actually changed.
                const newKeys = data.map(
                  (c) => c.a_set?.id ?? c.b_set?.id ?? '',
                );
                const oldKeys = cycles.map(
                  (c) => c.a_set?.id ?? c.b_set?.id ?? '',
                );
                const changed = newKeys.some(
                  (k, idx) => k !== oldKeys[idx],
                );
                if (changed && onConfirmReorderCycles) {
                  await onConfirmReorderCycles(data);
                }
              }}
              renderItem={({
                item: c,
                drag,
                isActive,
              }: RenderItemParams<ClusterCycle<SessionSetWithExercise>>) => {
                const bothLogged = c.both_logged;
                const canTap = c.a_set !== null && c.b_set !== null;
                // Right-swipe note target = parent (A side) set, if present.
                const noteTarget = c.a_set?.id ?? c.b_set?.id ?? null;
                return (
                  <SwipeableSetRow
                    swipeLeftActions={
                      onDeleteCycle
                        ? [
                            {
                              key: 'del-cluster-cycle',
                              label: t('button', 'swipeDelete'),
                              color: tokens.action.destructive,
                              onPress: () =>
                                onDeleteCycle({
                                  a_set_id: c.a_set?.id ?? null,
                                  b_set_id: c.b_set?.id ?? null,
                                }),
                            },
                          ]
                        : []
                    }
                    swipeRightActions={[
                      ...(onCloneCycle
                        ? [
                            {
                              key: 'clone-cluster-cycle',
                              label: '+1',
                              color: tokens.action.success,
                              onPress: () =>
                                onCloneCycle({
                                  a_set_id: c.a_set?.id ?? null,
                                  b_set_id: c.b_set?.id ?? null,
                                }),
                            },
                          ]
                        : []),
                      ...(onShowCycleNote && noteTarget
                        ? [
                            {
                              key: 'note-cluster-cycle',
                              label: t('domain', 'note'),
                              color: tokens.action.primary,
                              onPress: () => onShowCycleNote(noteTarget),
                            },
                          ]
                        : []),
                    ]}
                    onLongPress={drag}
                  >
                    <View
                      style={[
                        styles.cycleRow,
                        isActive && styles.cycleRowDragActive,
                      ]}
                    >
                    {/*
                      Shared # button — single tap cycles set_kind on BOTH A
                      and B atomically (per overnight 第 3 點). Mirrors solo
                      card's leftmost label button position.
                    */}
                    {(() => {
                      const refSet = c.a_set ?? c.b_set;
                      // A-side first (parent priority per ADR-0019 Q8 (d));
                      // fall back to B's ordinal map for asymmetric cycles
                      // where only the B side has a set in this slot.
                      const refMap = c.a_set ? aOrdinalMap : bOrdinalMap;
                      const sharedLabel = refSet
                        ? displaySetLabel(refSet, refMap)
                        : '#';
                      const disabled =
                        c.a_set === null && c.b_set === null;
                      return (
                        <Pressable
                          onPress={() => {
                            if (disabled) return;
                            onCycleClusterCycleSetKind?.({
                              a_set_id: c.a_set?.id ?? null,
                              b_set_id: c.b_set?.id ?? null,
                            });
                          }}
                          disabled={disabled}
                          hitSlop={6}
                          style={({ pressed }) => [
                            styles.sharedLabelBtn,
                            pressed && !disabled && styles.sharedLabelBtnPressed,
                            disabled && styles.sharedLabelBtnDisabled,
                          ]}
                        >
                          <Text style={styles.sharedLabelText}>
                            {sharedLabel}
                          </Text>
                        </Pressable>
                      );
                    })()}
                    <View style={styles.cycleSide}>
                      {c.a_set ? (
                        <SetRowContent
                          compact
                          hideLabel
                          set={toSetRowItem(c.a_set)}
                          setLabel={displaySetLabel(c.a_set, aOrdinalMap)}
                          isDropsetFollower={false}
                          isClusterLast={false}
                          minusDisabled={true}
                          hideNoteIndicator={true}
                          onUpdateSet={(set_id, patch) =>
                            onUpdateClusterSet?.(set_id, patch)
                          }
                          onTapNumber={(s, field, current) =>
                            onTapClusterNumber?.(s.id, field, current)
                          }
                          onCycleLabel={(s) =>
                            onCycleClusterSetKind?.(s.id)
                          }
                          onShowSetNote={(s) =>
                            onShowClusterSetNote?.(s.id, s.notes)
                          }
                          onRemoveDropsetRow={() => {}}
                          onAddDropsetRow={() => {}}
                        />
                      ) : (
                        <Text style={styles.cycleEmpty}>—</Text>
                      )}
                    </View>
                    {/* Vertical divider between A and B (point 4) */}
                    <View style={styles.cycleDivider} />
                    <View style={styles.cycleSide}>
                      {c.b_set ? (
                        <SetRowContent
                          compact
                          hideLabel
                          set={toSetRowItem(c.b_set)}
                          setLabel={displaySetLabel(c.b_set, bOrdinalMap)}
                          isDropsetFollower={false}
                          isClusterLast={false}
                          minusDisabled={true}
                          hideNoteIndicator={true}
                          onUpdateSet={(set_id, patch) =>
                            onUpdateClusterSet?.(set_id, patch)
                          }
                          onTapNumber={(s, field, current) =>
                            onTapClusterNumber?.(s.id, field, current)
                          }
                          onCycleLabel={(s) =>
                            onCycleClusterSetKind?.(s.id)
                          }
                          onShowSetNote={(s) =>
                            onShowClusterSetNote?.(s.id, s.notes)
                          }
                          onRemoveDropsetRow={() => {}}
                          onAddDropsetRow={() => {}}
                        />
                      ) : (
                        <Text style={styles.cycleEmpty}>—</Text>
                      )}
                    </View>
                    {/*
                      Shared 📝 note indicator — slot just left of ✓ (per
                      overnight #3 第 4 點). Visible if EITHER side has a note;
                      tapping opens A side's note editor first (parent priority,
                      falls back to B if A is null/empty). Per-side SetRowContent
                      suppresses its own 📝 via `hideNoteIndicator={true}` so the
                      row width is reserved for this single shared indicator.
                      overnight #5 第 4 點: slot 永遠 render (沒備註留 placeholder)
                      避免欄位 shift, ✓ 永遠在固定 column 位置.
                    */}
                    {(() => {
                      const aHasNote =
                        !!(c.a_set?.notes && c.a_set.notes.trim().length > 0);
                      const bHasNote =
                        !!(c.b_set?.notes && c.b_set.notes.trim().length > 0);
                      if (!aHasNote && !bHasNote) {
                        return <View style={styles.cycleNoteBtnPlaceholder} />;
                      }
                      const target = aHasNote ? c.a_set! : c.b_set!;
                      return (
                        <Pressable
                          onPress={() =>
                            onShowClusterSetNote?.(target.id, target.notes)
                          }
                          hitSlop={6}
                          style={styles.cycleNoteBtn}
                          accessibilityRole="button"
                          accessibilityLabel={t('button', 'a11yOpenNote')}
                        >
                          <Text style={styles.cycleNoteBtnText}>📝</Text>
                        </Pressable>
                      );
                    })()}
                    <Pressable
                      onPress={() => {
                        if (!canTap || !c.a_set || !c.b_set) return;
                        onToggleCycleLogged({
                          a_set_id: c.a_set.id,
                          b_set_id: c.b_set.id,
                          currentlyLogged: bothLogged,
                        });
                      }}
                      disabled={!canTap}
                      accessibilityRole="button"
                      accessibilityLabel={
                        bothLogged
                          ? t('button', 'a11yUncheckSetDone')
                          : t('button', 'a11yMarkSetDone')
                      }
                      accessibilityState={{ disabled: !canTap }}
                      hitSlop={6}
                      style={({ pressed }) => [
                        styles.completeBtn,
                        bothLogged && styles.completeBtnDone,
                        !canTap && styles.completeBtnDisabled,
                        pressed && canTap && styles.btnPressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.completeBtnText,
                          bothLogged && styles.completeBtnTextDone,
                        ]}
                      >
                        {bothLogged ? '✓' : '○'}
                      </Text>
                    </Pressable>
                  </View>
                </SwipeableSetRow>
                );
              }}
            />
          )}

          <View style={styles.clusterFooter}>
            <Pressable
              accessibilityRole="button"
              onPress={onAddCycle}
              disabled={onAddCycle === undefined}
              style={({ pressed }) => [
                styles.clusterFooterBtn,
                styles.clusterFooterBtnPrimary,
                onAddCycle === undefined && styles.btnDisabled,
                pressed && styles.btnPressed,
              ]}
            >
              <Text style={styles.clusterFooterBtnTextPrimary}>{t('button', 'addOneSet')}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={onOpenHistory}
              disabled={onOpenHistory === undefined}
              style={({ pressed }) => [
                styles.clusterFooterBtn,
                styles.clusterFooterBtnSecondary,
                onOpenHistory === undefined && styles.btnDisabled,
                pressed && styles.btnPressed,
              ]}
            >
              <Text style={styles.clusterFooterBtnTextSecondary}>
                {t('page', 'exerciseHistory')}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** Adapt SessionSet → SetRowItem shape (SetRowContent needs non-null fields). */
function toSetRowItem(s: SessionSetWithExercise): SetRowItem {
  return {
    id: s.id,
    reps: s.reps ?? 0,
    weight: s.weight_kg ?? 0,
    notes: s.notes,
  };
}

// Slice 10c overnight #7 第 1 點: 砍掉舊 `setKindLabel` (working → '#')，
// 改用 `displaySetLabel` + `computeWorkingSetOrdinals` 顯示 working ordinal。
// 'warmup' → '熱' / 'dropset' → 'D' 的分支由 `displaySetLabel` 保留 (第 3 點
// — legacy dropset 顯示驗證).

/**
 * ADR-0025 — token-driven styles. Most rgba(127,127,127,*) sit-on-anything
 * neutrals already work in both modes (gray with alpha), but we route them
 * through tokens to keep the audit clean. The «超» supersetTag purple
 * (#5856D6) is an iOS-system indigo brand accent kept raw to mirror
 * template-editor's identical badge palette.
 */
function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    clusterCard: {
      backgroundColor: tokens.bg.elevated,
      borderRadius: 10,
      overflow: 'hidden',
      // Slice 10c overnight #6: 砍掉左側 RS 彩色 border，與 solo card 一致。
      // colorHex prop 暫保留（無視覺效果，留待未來再用）。
    },
    clusterCardExpanded: {
      backgroundColor: tokens.bg.surface,
    },
    clusterCardHeader: {
      flexDirection: 'row',
      // overnight #5 第 5 點: 控制鈕 (chevron + gear) align row 1 (tag row)
      // 而不是 vertical center, 配合 3-row 標題 layout (tag / title / bar+chip)
      alignItems: 'flex-start',
    },
    clusterCardHeaderMain: {
      flex: 1,
      flexDirection: 'row',
      // 同上: chevron align row 1 (tag), 不要垂直中心
      alignItems: 'flex-start',
      gap: 12,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    clusterText: { flex: 1, gap: 4 },
    // Row 1: tag only (chevron + gear 在 outer header right column).
    // overnight #5 第 5 點: 標題分行.
    clusterTagRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    // Row 3: progress bar + 容量 chip 同 row (overnight #5 第 1 點).
    clusterProgressRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      width: '100%',
    },
    clusterProgressBarFill: {
      flex: 1,
    },
    // Title 獨佔 row 2, 不再 ... truncate (overnight #3 第 5 點 + #5 第 5 點).
    clusterName: {
      fontSize: 15,
      fontWeight: '600',
      lineHeight: 20,
      color: tokens.text.primary,
    },
    clusterChip: { fontSize: 13, color: tokens.text.secondary },
    // 「超」 marker — solid purple badge (per overnight #3 第 1 點, 2026-05-17).
    // 砍中括號 + 改純底色紫色 pill — mirror template-editor's `supersetTag` palette
    // (`#5856D6` iOS system indigo/purple, white text, 4px corners). 視覺更穩、
    // 在動作名旁的閱讀節奏比 [...] 包文字更乾淨。
    // ADR-0025 — purple/white kept raw: brand accent intentionally identical
    // across light + dark to match template-editor's badge (visual consistency
    // with the «超» chip on the template page).
    supersetTag: {
      fontSize: 11,
      fontWeight: '700',
      color: '#fff',
      backgroundColor: '#5856D6',
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      overflow: 'hidden',
      alignSelf: 'flex-start',
    },
    clusterPlus: { fontSize: 14, color: tokens.text.tertiary },
    // Cycle fraction chip — mirrors solo card's `exerciseCardVolumeChip`.
    // overnight #5 第 1 點 + 第 2 點: 純數字、無 prefix；minWidth 鎖避免 jitter；
    // 字體 fit `9999/9999` (9 chars). fontSize 12 (原 13) — 在 ~76px 寬內可容.
    clusterVolumeChip: {
      fontSize: 12,
      fontWeight: '600',
      color: tokens.text.secondary,
      minWidth: 76,
      textAlign: 'right',
    },
    clusterChevron: {
      fontSize: 14,
      color: tokens.text.tertiary,
      width: 18,
      textAlign: 'right',
    },
    clusterGear: {
      paddingVertical: 10,
      paddingHorizontal: 12,
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    clusterGearText: { fontSize: 18 },
    clusterProgressBar: {
      marginTop: 4,
      width: '100%',
    },
    clusterBody: {
      paddingHorizontal: 12,
      paddingBottom: 12,
      gap: 6,
    },
    sideLabelRow: {
      flexDirection: 'row',
      paddingVertical: 4,
      gap: 4,
      alignItems: 'center',
    },
    sideLabel: {
      flex: 1,
      fontSize: 12,
      fontWeight: '600',
      color: tokens.text.secondary,
      textAlign: 'center',
    },
    // Leading spacer matching shared `#` btn column (point 7 alignment).
    // overnight #52 follow-up — sharedLabelBtn 32→28 (cluster row 撐爆 fine-tune)
    sideLabelLead: { width: 28 },
    // Divider spacer matching cycleDivider column.
    sideLabelDivider: { width: StyleSheet.hairlineWidth + 4 },
    // Trailing spacer matching note slot (20) + completeBtn (28) + row gap.
    // overnight #5 第 4 點: 加 20 容納 note placeholder column.
    sideLabelGap: { width: 52 },
    clusterEmpty: {
      fontSize: 13,
      color: tokens.text.tertiary,
      fontStyle: 'italic',
      paddingVertical: 8,
    },
    cycleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      // overnight #52 follow-up — 規格 B (cluster): gap 8→6 (撐爆 fine-tune)、paddingVertical 8
      gap: 6,
      paddingVertical: 8,
    },
    // Shared note indicator slot — sits between B-side cell and ✓ button
    // (per overnight #3 第 4 點). Compact width to keep cluster row inside
    // available space; tap opens A side's note editor (parent priority).
    cycleNoteBtn: {
      width: 20,
      paddingHorizontal: 2,
      paddingVertical: 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cycleNoteBtnText: { fontSize: 14 },
    // overnight #5 第 4 點: 沒備註留 placeholder 同寬, ✓ column 固定
    cycleNoteBtnPlaceholder: {
      width: 20,
    },
    // Drag-active state — mirrors solo card's exerciseCardSetRowDragActive
    // (overnight 第 5 點, inline drag reorder).
    cycleRowDragActive: {
      backgroundColor: tokens.bg.surface,
      elevation: 6,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.18,
      shadowRadius: 6,
      borderRadius: 8,
    },
    // Shared `#` button at row start — replaces per-side label buttons.
    // Visual style matches `setLabelBtnCompact` in set-row-content so the
    // affordance reads as "cluster row's set_kind toggle".
    // overnight #52 follow-up — 規格 B: 28×22 fs:11 (cluster row 撐爆 fine-tune)
    sharedLabelBtn: {
      width: 28,
      height: 22,
      borderRadius: 4,
      backgroundColor: tokens.bg.surface,
      borderTopWidth: 1,
      borderLeftWidth: 1,
      borderRightWidth: 1,
      borderBottomWidth: 2,
      borderTopColor: tokens.border.subtle,
      borderLeftColor: tokens.border.default,
      borderRightColor: tokens.border.default,
      borderBottomColor: tokens.text.tertiary,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.18,
      shadowRadius: 1.5,
      elevation: 2,
    },
    sharedLabelBtnPressed: {
      backgroundColor: tokens.bg.elevated,
      borderTopWidth: 2,
      borderBottomWidth: 1,
      borderTopColor: tokens.text.tertiary,
      borderLeftColor: tokens.border.default,
      borderRightColor: tokens.border.default,
      borderBottomColor: tokens.border.subtle,
      shadowOpacity: 0,
      elevation: 0,
      transform: [{ translateY: 1 }],
    },
    sharedLabelBtnDisabled: {
      opacity: 0.35,
    },
    sharedLabelText: {
      fontSize: 11,
      fontWeight: '600',
      color: tokens.text.primary,
    },
    cycleSide: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Vertical divider between A and B sides (point 4) — light hairline to
    // mirror solo card's row-internal visual rhythm without adding heaviness.
    cycleDivider: {
      width: StyleSheet.hairlineWidth,
      alignSelf: 'stretch',
      backgroundColor: tokens.border.default,
      marginHorizontal: 2,
    },
    cycleCell: {
      fontSize: 14,
    },
    cycleEmpty: {
      fontSize: 14,
      color: tokens.text.tertiary,
      flex: 1,
      textAlign: 'center',
    },
    completeBtn: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: tokens.bg.elevated,
    },
    completeBtnDone: {
      backgroundColor: tokens.action.success,
    },
    completeBtnDisabled: {
      opacity: 0.4,
    },
    completeBtnText: {
      fontSize: 14,
      fontWeight: '700',
      color: tokens.text.secondary,
    },
    completeBtnTextDone: {
      color: tokens.action.onPrimary,
    },
    clusterFooter: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 8,
    },
    clusterFooterBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 8,
      alignItems: 'center',
    },
    clusterFooterBtnPrimary: {
      backgroundColor: tokens.action.primary,
    },
    clusterFooterBtnSecondary: {
      backgroundColor: tokens.bg.elevated,
    },
    clusterFooterBtnTextPrimary: {
      color: tokens.action.onPrimary,
      fontSize: 14,
      fontWeight: '600',
    },
    clusterFooterBtnTextSecondary: {
      color: tokens.action.primary,
      fontSize: 14,
      fontWeight: '600',
    },
    btnPressed: { opacity: 0.85 },
    btnDisabled: { opacity: 0.45 },
  });
}
