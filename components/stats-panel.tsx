/**
 * Stats sub-tab — period selector + body heatmap + capacity bars + duration.
 *
 * Slice 9 / ADR-0009. v1 period selector covers 年/月/日; 自選 falls back to
 * all-time (date-range picker is a v1.5+ polish item).
 *
 * Heatmap colour: per-Session frequency mapped to 5 quintile colour stops
 * (zero stays grey). Capacity bars: per-MG total volume, sorted desc, bar
 * width proportional to the period's max capacity.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useDatabase } from '@/components/database-provider';
import { BodyHeatmap, BodyHeatmapLegend, type Quintile } from '@/components/body-heatmap';
import { loadStatsSetRecords } from '@/src/adapters/sqlite/statsRepository';
import {
  durationStatsOverPeriod,
  mgCapacityOverPeriod,
  mgFrequencyOverPeriod,
  percentileBucketize,
} from '@/src/domain/stats/statsEngine';
import type { StatsSetRecord } from '@/src/domain/stats/types';
import { MUSCLE_GROUP_SEEDS } from '@/src/db/seed/v006ExerciseLibrary';

type PeriodKey = 'year' | 'month' | 'day' | 'all';

interface PeriodChoice {
  key: PeriodKey;
  label: string;
}

const PERIOD_CHOICES: readonly PeriodChoice[] = [
  { key: 'year', label: '年' },
  { key: 'month', label: '月' },
  { key: 'day', label: '日' },
  { key: 'all', label: '自選' },
];

function rangeFor(period: PeriodKey, now = new Date()): { start_ms: number; end_ms: number } {
  if (period === 'year') {
    const start = new Date(now.getFullYear(), 0, 1).getTime();
    const end = new Date(now.getFullYear() + 1, 0, 1).getTime();
    return { start_ms: start, end_ms: end };
  }
  if (period === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
    return { start_ms: start, end_ms: end };
  }
  if (period === 'day') {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    const start = d.getTime();
    const end = start + 24 * 60 * 60 * 1000;
    return { start_ms: start, end_ms: end };
  }
  // 'all' — wide enough to cover any data the user has
  return { start_ms: 0, end_ms: now.getTime() + 24 * 60 * 60 * 1000 };
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '—';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h === 0) return `${m} 分`;
  return `${h} 時 ${m} 分`;
}

export function StatsPanel() {
  const db = useDatabase();
  const [period, setPeriod] = useState<PeriodKey>('month');
  const [records, setRecords] = useState<StatsSetRecord[]>([]);

  const load = useCallback(async () => {
    const range = rangeFor(period);
    const recs = await loadStatsSetRecords(db, range);
    setRecords(recs);
  }, [db, period]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Derived stats
  const freqByMg = useMemo(() => mgFrequencyOverPeriod(records), [records]);
  const capacityByMg = useMemo(() => mgCapacityOverPeriod(records), [records]);
  const duration = useMemo(() => durationStatsOverPeriod(records), [records]);

  // Heatmap quintiles. 0-frequency MGs stay zero (grey); non-zero values are
  // bucketed into 5 quintiles.
  const mgQuintile = useMemo(() => {
    const out = new Map<string, Quintile>();
    const nonZeroMgs: { mg: string; count: number }[] = [];
    for (const mg of MUSCLE_GROUP_SEEDS) {
      const c = freqByMg.get(mg.id) ?? 0;
      if (c > 0) nonZeroMgs.push({ mg: mg.id, count: c });
    }
    if (nonZeroMgs.length === 0) return out;
    const buckets = percentileBucketize(nonZeroMgs.map((x) => x.count));
    nonZeroMgs.forEach((x, i) => out.set(x.mg, buckets[i] as Quintile));
    return out;
  }, [freqByMg]);

  const maxCapacity = useMemo(() => {
    let max = 0;
    for (const v of capacityByMg.values()) if (v > max) max = v;
    return max;
  }, [capacityByMg]);

  const sortedCapacity = useMemo(() => {
    return MUSCLE_GROUP_SEEDS.map((mg) => ({
      id: mg.id,
      name: mg.name,
      capacity: capacityByMg.get(mg.id) ?? 0,
    }))
      .filter((x) => x.capacity > 0)
      .sort((a, b) => b.capacity - a.capacity);
  }, [capacityByMg]);

  const totalSessions = useMemo(() => {
    const seen = new Set<string>();
    for (const r of records) seen.add(r.session_id);
    return seen.size;
  }, [records]);

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      {/* Period selector */}
      <View style={styles.periodRow}>
        {PERIOD_CHOICES.map((p) => (
          <Pressable
            key={p.key}
            style={[styles.periodBtn, period === p.key && styles.periodBtnActive]}
            onPress={() => setPeriod(p.key)}>
            <Text
              style={[
                styles.periodBtnText,
                period === p.key && styles.periodBtnTextActive,
              ]}>
              {p.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Body heatmap */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>訓練部位概況</Text>
        <Text style={styles.cardSubtitle}>顏色 = per-Session 次數分位</Text>
        <BodyHeatmap mgQuintile={mgQuintile} />
        <BodyHeatmapLegend />
        {totalSessions === 0 ? (
          <Text style={styles.emptyText}>本期間尚無 Session</Text>
        ) : null}
      </View>

      {/* Capacity bars */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>各部位容量</Text>
        {sortedCapacity.length === 0 ? (
          <Text style={styles.emptyText}>—</Text>
        ) : (
          sortedCapacity.map((row) => {
            const widthPct = maxCapacity > 0 ? (row.capacity / maxCapacity) * 100 : 0;
            return (
              <View key={row.id} style={styles.capacityRow}>
                <Text style={styles.capacityName}>{row.name}</Text>
                <View style={styles.capacityBarTrack}>
                  <View style={[styles.capacityBarFill, { width: `${widthPct}%` }]} />
                </View>
                <Text style={styles.capacityValue}>
                  {row.capacity.toLocaleString('en-US')}
                </Text>
              </View>
            );
          })
        )}
      </View>

      {/* Duration */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>運動時長</Text>
        <View style={styles.durationRow}>
          <View style={styles.durationCell}>
            <Text style={styles.durationLabel}>總時長</Text>
            <Text style={styles.durationValue}>{formatDuration(duration.total_ms)}</Text>
          </View>
          <View style={styles.durationCell}>
            <Text style={styles.durationLabel}>平均</Text>
            <Text style={styles.durationValue}>{formatDuration(duration.avg_ms)}</Text>
          </View>
          <View style={styles.durationCell}>
            <Text style={styles.durationLabel}>最長</Text>
            <Text style={styles.durationValue}>{formatDuration(duration.longest_ms)}</Text>
          </View>
        </View>
        <Text style={styles.durationFootnote}>
          {duration.session_count} 次已完成 Session
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, gap: 12 },
  periodRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(127,127,127,0.12)',
    borderRadius: 10,
    padding: 4,
    gap: 4,
  },
  periodBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  periodBtnActive: { backgroundColor: '#fff' },
  periodBtnText: { fontSize: 14, fontWeight: '500', color: '#6B7280' },
  periodBtnTextActive: { color: '#111827', fontWeight: '700' },
  card: {
    backgroundColor: 'rgba(127,127,127,0.08)',
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  cardTitle: { fontSize: 15, fontWeight: '700' },
  cardSubtitle: { fontSize: 12, color: '#6B7280' },
  emptyText: { fontSize: 13, color: '#6B7280', textAlign: 'center', paddingVertical: 16 },
  capacityRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  capacityName: { width: 56, fontSize: 13, fontWeight: '500' },
  capacityBarTrack: {
    flex: 1,
    height: 10,
    backgroundColor: 'rgba(127,127,127,0.18)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  capacityBarFill: { height: '100%', backgroundColor: '#6366F1' },
  capacityValue: { width: 64, textAlign: 'right', fontSize: 12, fontVariant: ['tabular-nums'] },
  durationRow: { flexDirection: 'row', gap: 12 },
  durationCell: { flex: 1, alignItems: 'center', gap: 4 },
  durationLabel: { fontSize: 12, color: '#6B7280' },
  durationValue: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  durationFootnote: { fontSize: 11, color: '#6B7280', textAlign: 'center', marginTop: 4 },
});
