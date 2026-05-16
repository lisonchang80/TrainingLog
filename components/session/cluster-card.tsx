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
 * Long-press cycle row → reorder is DEFERRED — see the README at the
 * bottom of this file (matches Phase 2 commit 9 留尾 reasoning).
 *
 * Component is intentionally presentational; all DB writes flow back to
 * the parent (Today screen) via callbacks. Pure logic lives in
 * `src/domain/session/clusterCard.ts`.
 */

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
  computeClusterCycles,
  computeClusterVolume,
  type ClusterCycle,
  type ClusterGroup,
} from '@/src/domain/session/clusterCard';
import type { SessionExerciseRowWithName } from '@/src/adapters/sqlite/sessionRepository';
import type { SessionSetWithExercise } from '@/src/adapters/sqlite/setRepository';

export type ClusterCardGroup = ClusterGroup<
  SessionExerciseRowWithName,
  SessionSetWithExercise
>;

type ClusterCardProps = {
  group: ClusterCardGroup;
  isExpanded: boolean;
  onToggleExpand: () => void;
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
  /** Long-press cycle row — deferred (nested ScrollView gesture conflict).
   *  Slice 10c overnight 第 5 點 enabled inline drag via DraggableFlatList,
   *  so this prop is no longer used (kept for API compat). */
  onLongPressCycle?: () => void;
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
  onLongPressCycle,
  onOpenHistory,
  onSettingsPress,
  onUpdateClusterSet,
  onTapClusterNumber,
  onCycleClusterSetKind,
  onCycleClusterCycleSetKind,
  onShowClusterSetNote,
  onConfirmReorderCycles,
}: ClusterCardProps): React.ReactElement {
  const cycles = computeClusterCycles(group);
  const volume = computeClusterVolume(group);
  // "done" cycles = atomic both_logged. Non-warmup cycles count toward the
  // progress bar denominator (mirrors solo card's planned_sets semantic at
  // the cycle granularity — every cycle row, regardless of cycle's set_kind
  // composition, is one progress unit).
  const completedCycles = cycles.filter((c) => c.both_logged).length;
  const totalCycles = cycles.length;

  return (
    <View
      style={[styles.clusterCard, isExpanded && styles.clusterCardExpanded]}
    >
      <View style={styles.clusterCardHeader}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`超級組 ${group.a.exercise.exercise_name} 加 ${group.b.exercise.exercise_name}`}
          onPress={onToggleExpand}
          style={({ pressed }) => [
            styles.clusterCardHeaderMain,
            pressed && styles.btnPressed,
          ]}
        >
          <View style={styles.clusterText}>
            <View style={styles.clusterNameRow}>
              <Text style={styles.supersetTag}>[超]</Text>
              <Text style={styles.clusterName} numberOfLines={1}>
                {group.a.exercise.exercise_name}
                <Text style={styles.clusterPlus}> + </Text>
                {group.b.exercise.exercise_name}
              </Text>
              {totalCycles > 0 ? (
                <Text style={styles.clusterVolumeChip}>
                  {completedCycles}/{totalCycles}
                </Text>
              ) : null}
            </View>
            {totalCycles > 0 ? (
              <View style={styles.clusterProgressBar}>
                <SegmentedProgressBar
                  done={completedCycles}
                  total={totalCycles}
                />
              </View>
            ) : null}
            {volume.denominator > 0 ? (
              <Text style={styles.clusterVolume}>
                容量 {Math.round(volume.numerator)} /{' '}
                {Math.round(volume.denominator)} kg·reps
              </Text>
            ) : null}
          </View>
          <Text style={styles.clusterChevron}>{isExpanded ? '▼' : '▶'}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="超級組設定"
          onPress={onSettingsPress}
          style={({ pressed }) => [
            styles.clusterGear,
            pressed && styles.btnPressed,
          ]}
        >
          <Text style={styles.clusterGearText}>⚙️</Text>
        </Pressable>
      </View>

      {isExpanded ? (
        <View style={styles.clusterBody}>
          {/* Side labels row — columns align with cycle row:
              [sharedLabelBtn 28] [cycleSide A] [divider 1] [cycleSide B] [completeBtn 28]. */}
          <View style={styles.sideLabelRow}>
            <View style={styles.sideLabelLead} />
            <Text style={styles.sideLabel} numberOfLines={1}>
              A: {group.a.exercise.exercise_name}
            </Text>
            <View style={styles.sideLabelDivider} />
            <Text style={styles.sideLabel} numberOfLines={1}>
              B: {group.b.exercise.exercise_name}
            </Text>
            <View style={styles.sideLabelGap} />
          </View>

          {cycles.length === 0 ? (
            <Text style={styles.clusterEmpty}>
              還沒有組 — 按下方「+ 新增 1 組」開始記錄
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
                              label: '刪',
                              color: '#FF3B30',
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
                              color: '#28a745',
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
                              label: '備註',
                              color: '#007AFF',
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
                      const sharedLabel = refSet
                        ? setKindLabel(refSet.set_kind)
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
                          setLabel={setKindLabel(c.a_set.set_kind)}
                          isDropsetFollower={false}
                          isClusterLast={false}
                          minusDisabled={true}
                          hideNoteIndicator={false}
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
                          setLabel={setKindLabel(c.b_set.set_kind)}
                          isDropsetFollower={false}
                          isClusterLast={false}
                          minusDisabled={true}
                          hideNoteIndicator={false}
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
                        bothLogged ? '取消完成這組' : '標記這組完成'
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
              <Text style={styles.clusterFooterBtnTextPrimary}>新增 1 組</Text>
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
                動作歷史
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Format a set's primary cell — same shape as the solo card's set row
 * (weight × reps). Null defensives degrade gracefully:
 *   - null weight + reps → "—"
 *   - null weight, reps  → "× R"   (bodyweight-ish)
 *   - weight, null reps → "W kg"
 */
function formatSetCell(set: {
  weight_kg: number | null;
  reps: number | null;
}): string {
  const w = set.weight_kg;
  const r = set.reps;
  if (w == null && r == null) return '—';
  if (w == null) return `× ${r}`;
  if (r == null) return `${w} kg`;
  return `${w} × ${r}`;
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

/** Map set_kind → display label for SetRowContent's tap-cycle button. */
function setKindLabel(set_kind: string): string {
  if (set_kind === 'warmup') return '熱';
  if (set_kind === 'dropset') return 'D';
  return '#';
}

const styles = StyleSheet.create({
  clusterCard: {
    backgroundColor: 'rgba(127,127,127,0.10)',
    borderRadius: 10,
    overflow: 'hidden',
    borderLeftWidth: 4,
    // ADR-0019 Q8 (c) H1: left vertical bar in RS color. We don't have the
    // color threaded in here yet (would need a join through superset.color_hex);
    // use a neutral accent for v1.
    borderLeftColor: '#b35900',
  },
  clusterCardExpanded: {
    backgroundColor: 'rgba(127,127,127,0.14)',
  },
  clusterCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  clusterCardHeaderMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  clusterText: { flex: 1 },
  clusterNameRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  clusterName: { fontSize: 15, fontWeight: '600', flex: 1 },
  clusterChip: { fontSize: 13 },
  // [超] marker — text badge (per ADR-0019 Q8 amendment, 2026-05-17 overnight).
  // 取代舊版 `○`/`✓` + 「超級組」 chip 兩件：濃縮為一個文字 marker 在動作名旁。
  supersetTag: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0a7ea4',
    backgroundColor: 'rgba(10, 126, 164, 0.12)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  clusterPlus: { fontSize: 14, opacity: 0.5 },
  // Cycle fraction chip — mirrors solo card's `exerciseCardVolumeChip`.
  clusterVolumeChip: {
    fontSize: 13,
    fontWeight: '600',
    opacity: 0.7,
  },
  clusterChevron: {
    fontSize: 14,
    opacity: 0.5,
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
  clusterVolume: {
    fontSize: 11,
    opacity: 0.55,
    marginTop: 2,
  },
  clusterBody: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 6,
  },
  sideLabelRow: {
    flexDirection: 'row',
    paddingVertical: 4,
    gap: 8,
    alignItems: 'center',
  },
  sideLabel: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    textAlign: 'center',
  },
  // Leading spacer matching shared `#` btn column (point 7 alignment).
  sideLabelLead: { width: 28 },
  // Divider spacer matching cycleDivider column.
  sideLabelDivider: { width: StyleSheet.hairlineWidth + 4 },
  // Trailing spacer matching completeBtn column (28) + row gap (8).
  sideLabelGap: { width: 28 },
  clusterEmpty: {
    fontSize: 13,
    opacity: 0.55,
    fontStyle: 'italic',
    paddingVertical: 8,
  },
  cycleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  // Drag-active state — mirrors solo card's exerciseCardSetRowDragActive
  // (overnight 第 5 點, inline drag reorder).
  cycleRowDragActive: {
    backgroundColor: '#f3f4f6',
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
  sharedLabelBtn: {
    width: 28,
    height: 22,
    borderRadius: 5,
    backgroundColor: '#fafafa',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 2,
    borderTopColor: '#f3f4f6',
    borderLeftColor: '#d1d5db',
    borderRightColor: '#9ca3af',
    borderBottomColor: '#6b7280',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 1.5,
    elevation: 2,
  },
  sharedLabelBtnPressed: {
    backgroundColor: '#e5e7eb',
    borderTopWidth: 2,
    borderBottomWidth: 1,
    borderTopColor: '#6b7280',
    borderLeftColor: '#9ca3af',
    borderRightColor: '#d1d5db',
    borderBottomColor: '#f3f4f6',
    shadowOpacity: 0,
    elevation: 0,
    transform: [{ translateY: 1 }],
  },
  sharedLabelBtnDisabled: {
    opacity: 0.35,
  },
  sharedLabelText: { fontSize: 11, fontWeight: '600', color: '#374151' },
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
    backgroundColor: 'rgba(127,127,127,0.35)',
    marginHorizontal: 2,
  },
  cycleCell: {
    fontSize: 14,
  },
  cycleEmpty: {
    fontSize: 14,
    opacity: 0.4,
    flex: 1,
    textAlign: 'center',
  },
  completeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(127,127,127,0.18)',
  },
  completeBtnDone: {
    backgroundColor: '#28a745',
  },
  completeBtnDisabled: {
    opacity: 0.4,
  },
  completeBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#6b7280',
  },
  completeBtnTextDone: {
    color: 'white',
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
    backgroundColor: '#0a7ea4',
  },
  clusterFooterBtnSecondary: {
    backgroundColor: 'rgba(127,127,127,0.18)',
  },
  clusterFooterBtnTextPrimary: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  clusterFooterBtnTextSecondary: {
    color: '#0a7ea4',
    fontSize: 14,
    fontWeight: '600',
  },
  btnPressed: { opacity: 0.85 },
  btnDisabled: { opacity: 0.45 },
});
