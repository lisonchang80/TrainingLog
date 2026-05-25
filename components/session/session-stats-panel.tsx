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

/**
 * In-session 3-tile stats panel (ADR-0019 Q6, position P1 — between
 * SessionHeader and exercise list).
 *
 * Renders three equal-width tiles:
 *   - 訓練時間 — live wall-clock duration since started_at (1s tick) OR
 *     frozen ended_at - started_at when in detail-page edit-history mode.
 *   - 容量    — Σ weight × reps for is_logged=1, non-warmup
 *   - 動作數  — count of session_exercise rows
 *
 * The 5-tile Watch-tracked variant (HR + kcal) is deferred to slice 13
 * per ADR-0019 Q6 (b). When that lands, this component will accept an
 * optional HR/kcal slot and a `is_watch_tracked` flag.
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
}

export function SessionStatsPanel({
  sets,
  exercise_count,
  started_at_ms,
  ended_at_ms,
  onTapDuration,
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

  return (
    <View style={styles.container}>
      {onTapDuration ? (
        <Pressable
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
        <View style={styles.tile}>
          <Text style={styles.bigText}>{durationBig}</Text>
          <Text style={styles.labelText}>{t('status', 'sessionDuration')}</Text>
        </View>
      )}
      <Tile
        big={formatVolumeShort(stats.volume_kg)}
        label={t('domain', 'volume')}
        styles={styles}
      />
      <Tile
        big={String(stats.exercise_count)}
        label={t('status', 'exerciseCountLabel')}
        styles={styles}
      />
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function Tile({ big, label, styles }: { big: string; label: string; styles: Styles }) {
  return (
    <View style={styles.tile}>
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
