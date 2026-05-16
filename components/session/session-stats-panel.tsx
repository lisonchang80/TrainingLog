import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  computeSessionStats,
  formatSessionDuration,
  formatVolumeShort,
  type SessionStatsSetInput,
} from '@/src/domain/session/sessionStats';

/**
 * In-session 3-tile stats panel (ADR-0019 Q6, position P1 — between
 * SessionHeader and exercise list).
 *
 * Renders three equal-width tiles:
 *   - 訓練時間 — live wall-clock duration since started_at (1s tick)
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
 */
export interface SessionStatsPanelProps {
  sets: SessionStatsSetInput[];
  exercise_count: number;
  started_at_ms: number;
}

export function SessionStatsPanel({
  sets,
  exercise_count,
  started_at_ms,
}: SessionStatsPanelProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    // 1-second cadence — drives the duration tile.
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const stats = computeSessionStats({
    sets,
    exercise_count,
    started_at_ms,
    now_ms: nowMs,
  });

  return (
    <View style={styles.container}>
      <Tile
        big={formatSessionDuration(stats.duration_ms)}
        label="訓練時間"
      />
      <Tile big={formatVolumeShort(stats.volume_kg)} label="容量" />
      <Tile big={String(stats.exercise_count)} label="動作數" />
    </View>
  );
}

function Tile({ big, label }: { big: string; label: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.bigText}>{big}</Text>
      <Text style={styles.labelText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 12,
  },
  tile: {
    flex: 1,
    backgroundColor: '#F4F4F7',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 64,
  },
  bigText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1A1A1A',
    fontVariant: ['tabular-nums'],
  },
  labelText: {
    marginTop: 4,
    fontSize: 11,
    color: '#666',
    letterSpacing: 0.4,
  },
});
