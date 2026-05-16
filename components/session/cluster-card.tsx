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

import { SegmentedProgressBar } from '@/components/shared/segmented-progress-bar';
import {
  computeClusterCycles,
  computeClusterVolume,
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
  /** Append one new cycle row (parent set + follower set inserted in same txn).
   *  Wired by the parent — implementation needs both `insertSessionSet` calls
   *  + a ✓ row-pair-id alignment. Phase 7 emits the callback but defers the
   *  parent-side handler to follow-up if not present. */
  onAddCycle?: () => void;
  /** Open the per-RS history page. RS id is on the A side via reusable_superset_id. */
  onOpenHistory?: () => void;
  /** ⚙️ menu (delete cluster / rest_sec / notes). Falls back to a no-op. */
  onSettingsPress?: () => void;
};

export function ClusterCard({
  group,
  isExpanded,
  onToggleExpand,
  onToggleCycleLogged,
  onAddCycle,
  onOpenHistory,
  onSettingsPress,
}: ClusterCardProps): React.ReactElement {
  const cycles = computeClusterCycles(group);
  const volume = computeClusterVolume(group);
  // "done" cycles = atomic both_logged. Non-warmup cycles count toward the
  // progress bar denominator (mirrors solo card's planned_sets semantic at
  // the cycle granularity — every cycle row, regardless of cycle's set_kind
  // composition, is one progress unit).
  const completedCycles = cycles.filter((c) => c.both_logged).length;
  const totalCycles = cycles.length;
  const allComplete = totalCycles > 0 && completedCycles === totalCycles;

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
          <Text style={styles.clusterMark}>{allComplete ? '✓' : '○'}</Text>
          <View style={styles.clusterText}>
            <Text style={styles.clusterName} numberOfLines={1}>
              <Text style={styles.clusterChip}>⚓ </Text>
              {group.a.exercise.exercise_name}
              <Text style={styles.clusterPlus}> + </Text>
              {group.b.exercise.exercise_name}
            </Text>
            <Text style={styles.clusterDetails}>
              {completedCycles}/{totalCycles} cycles
            </Text>
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
          <Text style={styles.clusterChevron}>{isExpanded ? '▾' : '▸'}</Text>
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
          {/* Side labels row */}
          <View style={styles.sideLabelRow}>
            <Text style={styles.sideLabel} numberOfLines={1}>
              A: {group.a.exercise.exercise_name}
            </Text>
            <Text style={styles.sideLabel} numberOfLines={1}>
              B: {group.b.exercise.exercise_name}
            </Text>
            <View style={styles.sideLabelGap} />
          </View>

          {cycles.length === 0 ? (
            <Text style={styles.clusterEmpty}>
              還沒有 cycle — 按下方「+ 新增一輪」開始記錄
            </Text>
          ) : (
            cycles.map((c) => {
              const bothLogged = c.both_logged;
              const canTap = c.a_set !== null && c.b_set !== null;
              return (
                <View key={c.cycle_idx} style={styles.cycleRow}>
                  <Text style={styles.cycleIdx}>{c.cycle_idx}</Text>
                  <View style={styles.cycleSide}>
                    {c.a_set ? (
                      <Text style={styles.cycleCell}>
                        {formatSetCell(c.a_set)}
                      </Text>
                    ) : (
                      <Text style={styles.cycleEmpty}>—</Text>
                    )}
                  </View>
                  <View style={styles.cycleSide}>
                    {c.b_set ? (
                      <Text style={styles.cycleCell}>
                        {formatSetCell(c.b_set)}
                      </Text>
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
                      bothLogged ? '取消完成 cycle' : '標記 cycle 完成'
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
              );
            })
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
              <Text style={styles.clusterFooterBtnTextPrimary}>+ 新增一輪</Text>
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
                📖 動作歷史
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
  clusterMark: { fontSize: 18, width: 22, textAlign: 'center' },
  clusterText: { flex: 1 },
  clusterName: { fontSize: 15, fontWeight: '600' },
  clusterChip: { fontSize: 13 },
  clusterPlus: { fontSize: 14, opacity: 0.5 },
  clusterDetails: { fontSize: 12, opacity: 0.7 },
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
  },
  sideLabel: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
  },
  sideLabelGap: { width: 36 },
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
  cycleIdx: {
    width: 22,
    textAlign: 'center',
    fontSize: 13,
    opacity: 0.6,
  },
  cycleSide: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  cycleCell: {
    fontSize: 14,
  },
  cycleEmpty: {
    fontSize: 14,
    opacity: 0.4,
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
