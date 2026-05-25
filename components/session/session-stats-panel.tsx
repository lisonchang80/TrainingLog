import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  computeSessionStats,
  formatTrainingDuration,
  formatVolumeShort,
  type SessionStatsSetInput,
} from '@/src/domain/session/sessionStats';
import { t } from '@/src/i18n';
import { useTheme, type ThemeTokens } from '@/src/theme';

import {
  bottomRowCount,
  formatAvgHr,
  formatKcal,
  hrTileBorderColor,
  type StatsTileVariant,
} from './session-stats-panel.behavior';

/**
 * Session stats panel — three variants (ADR-0019 Q6 + Q10, expanded by
 * Slice 13 Phase A Amendment 2026-05-25):
 *
 *   - '3tile'        — in-session row (default; backward-compat). Tiles:
 *                       訓練時間 / 容量 / 動作數
 *   - '4tile'        — session detail page. Adds 大卡 (kcal) as 4th tile
 *                       in a 2 × 2 grid. NULL kcal renders '—' until
 *                       HealthKit lands in Phase B.
 *   - '5tile-watch'  — Watch-tracked session. 2 rows: row 1 of 3 = same as
 *                       3tile, row 2 of 2 = 心率 / 大卡. The 心率 tile gets
 *                       a Z-zone-colored border via `hrTileBorderColor`.
 *
 * Tiles per variant:
 *   - 訓練時間 — live wall-clock duration since started_at (1s tick) OR
 *     frozen ended_at - started_at when in detail-page edit-history mode.
 *   - 容量    — Σ weight × reps for is_logged=1, non-warmup
 *   - 動作數  — count of session_exercise rows
 *   - 大卡    — HealthKit activeEnergyBurned (Phase B); NULL Phase A → '—'
 *   - 心率    — avg BPM from HR samples (Phase B); NULL Phase A → '—'
 *
 * The 1-second tick lives in this component (not the parent) so the
 * Today screen re-render cost is bounded — only this panel paints when
 * the duration crosses a second boundary. The volume + exercise_count
 * tiles re-paint only when sets / plan change (props).
 *
 * Frozen-mode (2026-05-20 overnight #59 — ADR-0015 § history edit):
 *   When `ended_at_ms` is provided, the panel skips the 1-second interval
 *   entirely and renders `ended_at_ms - started_at_ms` directly. Used by
 *   the session detail page so a finished session shows its frozen
 *   training duration (not "since started_at to now"). When `onTapDuration`
 *   is also provided the 訓練時間 tile becomes a Pressable that opens the
 *   SessionTimeEditorSheet for editing started_at / ended_at.
 */
interface SessionStatsPanelProps {
  sets: SessionStatsSetInput[];
  exercise_count: number;
  started_at_ms: number;
  /**
   * When provided, panel renders frozen duration = ended_at_ms - started_at_ms
   * and skips the 1-second interval. Use case: session detail page in
   * edit-history mode (ADR-0015 § history edit).
   */
  ended_at_ms?: number | null;
  /**
   * When provided, the 訓練時間 tile becomes Pressable, calling this on tap.
   * Use case: session detail page → open SessionTimeEditorSheet to edit
   * started_at / ended_at.
   */
  onTapDuration?: () => void;
  /**
   * Tile layout variant (Slice 13a). Default '3tile' for backward compat
   * with existing in-session call sites (Today screen).
   */
  variant?: StatsTileVariant;
  /**
   * HealthKit kcal (Phase B). Phase A passes null → tile shows '—'. Only
   * rendered in '4tile' / '5tile-watch' variants.
   */
  kcal?: number | null;
  /**
   * Average BPM across the session (Phase B). Phase A passes null → tile
   * shows '—'. Only rendered in '5tile-watch'.
   */
  avgHr?: number | null;
  /**
   * User age for HRmax estimation. Drives the HR tile's Z-zone border
   * color in '5tile-watch'. Omitted / NULL → default tile border (no zone).
   */
  userAge?: number | null;
}

export function SessionStatsPanel({
  sets,
  exercise_count,
  started_at_ms,
  ended_at_ms,
  onTapDuration,
  variant = '3tile',
  kcal = null,
  avgHr = null,
  userAge = null,
}: SessionStatsPanelProps) {
  // Frozen mode skips the 1-second tick entirely. We still mount the hook
  // (rules of hooks), but bail out of setInterval when ended_at_ms is a
  // concrete number.
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const isFrozen = typeof ended_at_ms === 'number';
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (isFrozen) return;
    // 1-second cadence — drives the duration tile when live.
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isFrozen]);

  const effectiveNowMs = isFrozen ? (ended_at_ms as number) : nowMs;
  const stats = computeSessionStats({
    sets,
    exercise_count,
    started_at_ms,
    now_ms: effectiveNowMs,
  });

  const durationBig = formatTrainingDuration(
    Math.floor(stats.duration_ms / 1000),
  );

  // Duration tile is special (Pressable + onTapDuration wiring lives here,
  // not in the generic Tile component) — render once and pass into the row.
  const durationTile = onTapDuration ? (
    <Pressable
      key="duration"
      onPress={onTapDuration}
      accessibilityRole="button"
      accessibilityLabel={t('status', 'editTrainingTimeA11y')}
      style={({ pressed }) => [
        styles.tile,
        styles.tileTappable,
        pressed && styles.tilePressed,
      ]}
    >
      <Text style={styles.bigText}>{durationBig}</Text>
      <Text style={styles.labelText}>{t('status', 'sessionDuration')}</Text>
    </Pressable>
  ) : (
    <View key="duration" style={styles.tile}>
      <Text style={styles.bigText}>{durationBig}</Text>
      <Text style={styles.labelText}>{t('status', 'sessionDuration')}</Text>
    </View>
  );

  const volumeTile = (
    <Tile
      key="volume"
      big={formatVolumeShort(stats.volume_kg)}
      label={t('domain', 'volume')}
      styles={styles}
    />
  );

  const exerciseCountTile = (
    <Tile
      key="exerciseCount"
      big={String(stats.exercise_count)}
      label={t('status', 'exerciseCountLabel')}
      styles={styles}
    />
  );

  const kcalTile = (
    <Tile
      key="kcal"
      big={formatKcal(kcal)}
      label={t('domain', 'kcal')}
      styles={styles}
    />
  );

  const hrBorder = hrTileBorderColor(avgHr, userAge);
  const avgHrTile = (
    <Tile
      key="avgHr"
      big={formatAvgHr(avgHr)}
      label={t('domain', 'heartRate')}
      styles={styles}
      borderColor={hrBorder}
    />
  );

  // 3tile — single row (legacy / in-session).
  if (variant === '3tile') {
    return (
      <View style={styles.container}>
        {durationTile}
        {volumeTile}
        {exerciseCountTile}
      </View>
    );
  }

  // 4tile — 2 × 2 grid (session detail page).
  if (variant === '4tile') {
    return (
      <View style={styles.containerCol}>
        <View style={styles.row}>
          {durationTile}
          {volumeTile}
        </View>
        <View style={styles.row}>
          {exerciseCountTile}
          {kcalTile}
        </View>
      </View>
    );
  }

  // 5tile-watch — row 1 of 3 + row 2 of 2 (avg HR + kcal).
  // bottomRowCount(variant) confirms row 2 has 2 tiles; encoded explicitly
  // here for readability (the JSX shape itself is the canonical layout).
  void bottomRowCount;
  return (
    <View style={styles.containerCol}>
      <View style={styles.row}>
        {durationTile}
        {volumeTile}
        {exerciseCountTile}
      </View>
      <View style={styles.row}>
        {avgHrTile}
        {kcalTile}
      </View>
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function Tile({
  big,
  label,
  styles,
  borderColor,
}: {
  big: string;
  label: string;
  styles: Styles;
  /** Optional override (used by HR tile in 5-tile-watch for Z-zone color). */
  borderColor?: string | null;
}) {
  return (
    <View
      style={[
        styles.tile,
        borderColor != null && {
          borderWidth: 2,
          borderColor,
        },
      ]}
    >
      <Text style={styles.bigText}>{big}</Text>
      <Text style={styles.labelText}>{label}</Text>
    </View>
  );
}

/**
 * ADR-0025 — token-driven styles.
 */
function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    container: {
      flexDirection: 'row',
      gap: 8,
      marginVertical: 12,
    },
    containerCol: {
      flexDirection: 'column',
      gap: 8,
      marginVertical: 12,
    },
    row: {
      flexDirection: 'row',
      gap: 8,
    },
    tile: {
      flex: 1,
      backgroundColor: tokens.bg.elevated,
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 8,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 64,
    },
    // Subtle visual cue that the tile is tappable — slightly thicker border
    // mimics the 編輯訓練 affordance language used elsewhere in the app.
    tileTappable: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tokens.action.primary,
    },
    tilePressed: { opacity: 0.7 },
    bigText: {
      fontSize: 22,
      fontWeight: '700',
      color: tokens.text.primary,
      fontVariant: ['tabular-nums'],
    },
    labelText: {
      marginTop: 4,
      fontSize: 11,
      color: tokens.text.secondary,
      letterSpacing: 0.4,
    },
  });
}
