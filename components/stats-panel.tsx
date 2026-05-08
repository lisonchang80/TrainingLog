/**
 * Stats sub-tab — period selector + body heatmap + capacity histograms +
 * duration histogram.
 *
 * Slice 9 / ADR-0009 + smoke feedback #5/#6:
 *   - Period selector covers 年/月/月 (replaced 日/自選)
 *   - Body heatmap colours by per-Session frequency in the CURRENT period
 *   - Each MG renders its own 6-bar histogram (capacity over -5..0)
 *   - Duration is a 6-bar histogram with a horizontal average line
 *
 * Implementation: load a single wide range (-5..0 periods) once per period
 * change, then derive both the heatmap (current period only) and the
 * histograms (all 6 buckets) from the same record set.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';

import { useDatabase } from '@/components/database-provider';
import { BodyHeatmap, BodyHeatmapLegend, type Quintile } from '@/components/body-heatmap';
import { MiniBarChart } from '@/components/mini-bar-chart';
import { loadStatsSetRecords } from '@/src/adapters/sqlite/statsRepository';
import {
  bucketBoundaries,
  capacityHistogramByMg,
  durationHistogram,
  mgFrequencyOverPeriod,
  percentileBucketize,
} from '@/src/domain/stats/statsEngine';
import type {
  CapacityBucket,
  DurationBucket,
  PeriodScale,
  StatsSetRecord,
} from '@/src/domain/stats/types';
import { MUSCLE_GROUP_SEEDS } from '@/src/db/seed/v006ExerciseLibrary';

interface PeriodChoice {
  key: PeriodScale;
  label: string;
}

const PERIOD_CHOICES: readonly PeriodChoice[] = [
  { key: 'year', label: '年' },
  { key: 'month', label: '月' },
  { key: 'week', label: '週' },
];

function formatDurationShort(ms: number): string {
  if (ms <= 0) return '—';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h${m > 0 ? ` ${m}m` : ''}`;
}

function formatCapacityShort(n: number): string {
  if (n === 0) return '';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatAnchorLabel(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

export function StatsPanel() {
  const db = useDatabase();
  const [period, setPeriod] = useState<PeriodScale>('week');
  const [records, setRecords] = useState<StatsSetRecord[]>([]);
  // Anchor date drives the histogram X-axis. Default = today at 00:00 local.
  // -5..0 buckets are computed BACKWARD from this date in the selected scale.
  const [anchorDate, setAnchorDate] = useState<Date>(() => startOfDay(new Date()));
  const [showPicker, setShowPicker] = useState(false);

  const load = useCallback(async () => {
    const boundaries = bucketBoundaries(period, anchorDate);
    const wide = {
      start_ms: boundaries[0].start_ms,
      end_ms: boundaries[5].end_ms,
    };
    const recs = await loadStatsSetRecords(db, wide);
    setRecords(recs);
  }, [db, period, anchorDate]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const boundaries = useMemo(() => bucketBoundaries(period, anchorDate), [period, anchorDate]);
  const currentBucket = boundaries[5];
  const isAnchorToday = useMemo(() => isSameDay(anchorDate, new Date()), [anchorDate]);

  const onChangeDate = useCallback(
    (event: DateTimePickerEvent, selected?: Date) => {
      // iOS inline picker fires `set` on each tap; Android closes the dialog.
      if (event.type === 'dismissed') {
        setShowPicker(false);
        return;
      }
      if (selected) {
        setAnchorDate(startOfDay(selected));
      }
    },
    []
  );

  // ---- Heatmap (current period only) ----------------------------------------
  const currentBucketRecords = useMemo(
    () =>
      records.filter(
        (r) =>
          r.session_started_at >= currentBucket.start_ms &&
          r.session_started_at < currentBucket.end_ms
      ),
    [records, currentBucket]
  );
  const freqByMg = useMemo(
    () => mgFrequencyOverPeriod(currentBucketRecords),
    [currentBucketRecords]
  );
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
  const totalSessionsCurrent = useMemo(() => {
    const s = new Set<string>();
    for (const r of currentBucketRecords) s.add(r.session_id);
    return s.size;
  }, [currentBucketRecords]);

  // ---- Capacity histograms per MG (-5..0) ----------------------------------
  const capacityByMg = useMemo(
    () => capacityHistogramByMg(records, period, anchorDate),
    [records, period, anchorDate]
  );
  // Order MGs by total 6-period capacity desc, but ALWAYS show all 11 (zero
  // MGs render flat — user wants a visual catalogue of what's missing too).
  // Average is computed over BUCKETS WITH DATA only (smoke feedback: zero
  // buckets shouldn't drag the avg line down).
  const mgRows = useMemo(() => {
    return MUSCLE_GROUP_SEEDS.map((mg) => {
      const buckets =
        capacityByMg.get(mg.id) ??
        boundaries.map<CapacityBucket>((b) => ({
          offset: b.offset,
          label: b.label,
          capacity: 0,
        }));
      const total = buckets.reduce((s, b) => s + b.capacity, 0);
      const nonZeroCount = buckets.reduce((n, b) => n + (b.capacity > 0 ? 1 : 0), 0);
      const avg = nonZeroCount > 0 ? total / nonZeroCount : 0;
      return { mg_id: mg.id, mg_name: mg.name, buckets, total, avg };
    }).sort((a, b) => b.total - a.total);
  }, [capacityByMg, boundaries]);

  // ---- Duration histogram (-5..0) ------------------------------------------
  const durationBuckets: DurationBucket[] = useMemo(
    () => durationHistogram(records, period, anchorDate),
    [records, period, anchorDate]
  );
  // Average over BUCKETS WITH DATA only — smoke feedback: zero-period buckets
  // (e.g. user only trained in 3 of the last 6 weeks) shouldn't pull the avg
  // line toward zero.
  const durationAvgMs = useMemo(() => {
    const nonZero = durationBuckets.filter((b) => b.total_ms > 0);
    if (nonZero.length === 0) return 0;
    const total = nonZero.reduce((s, b) => s + b.total_ms, 0);
    return total / nonZero.length;
  }, [durationBuckets]);
  const durationTotalSessions = useMemo(
    () => durationBuckets.reduce((s, b) => s + b.session_count, 0),
    [durationBuckets]
  );

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

      {/* Anchor date row */}
      <View style={styles.anchorRow}>
        <Pressable
          style={styles.anchorBtn}
          onPress={() => setShowPicker((s) => !s)}>
          <Text style={styles.anchorBtnLabel}>錨點</Text>
          <Text style={styles.anchorBtnDate}>{formatAnchorLabel(anchorDate)}</Text>
          <Text style={styles.anchorBtnCaret}>{showPicker ? '▴' : '▾'}</Text>
        </Pressable>
        {!isAnchorToday ? (
          <Pressable
            style={styles.anchorTodayBtn}
            onPress={() => {
              setAnchorDate(startOfDay(new Date()));
              setShowPicker(false);
            }}>
            <Text style={styles.anchorTodayText}>今天</Text>
          </Pressable>
        ) : null}
      </View>
      {showPicker ? (
        <View style={styles.pickerWrap}>
          <DateTimePicker
            value={anchorDate}
            mode="date"
            display="inline"
            maximumDate={new Date()}
            onChange={onChangeDate}
          />
        </View>
      ) : null}

      {/* Body heatmap */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>訓練部位概況 · {currentBucket.label}</Text>
        <Text style={styles.cardSubtitle}>顏色 = per-Session 次數分位</Text>
        <BodyHeatmap mgQuintile={mgQuintile} mgCount={freqByMg} />
        <BodyHeatmapLegend />
        {totalSessionsCurrent === 0 ? (
          <Text style={styles.emptyText}>本期間尚無 Session</Text>
        ) : null}
      </View>

      {/* Per-MG capacity histograms */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>各部位容量 · 近 6 期</Text>
        <Text style={styles.cardSubtitle}>
          每格一個部位 · 紅虛線 = 6 期平均
        </Text>
        <View style={styles.mgGrid}>
          {mgRows.map((row) => (
            <View key={row.mg_id} style={styles.mgCell}>
              <View style={styles.mgCellHeader}>
                <Text style={styles.mgCellName}>{row.mg_name}</Text>
                <Text style={styles.mgCellTotal}>
                  {formatCapacityShort(row.total) || '—'}
                </Text>
              </View>
              <MiniBarChart
                data={row.buckets.map((b) => ({ label: b.label, value: b.capacity }))}
                avgLine={row.avg}
                width={150}
                height={70}
                barColor="#6366F1"
                formatAvg={formatCapacityShort}
              />
            </View>
          ))}
        </View>
      </View>

      {/* Duration histogram */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>運動時長 · 近 6 期</Text>
        <Text style={styles.cardSubtitle}>
          每根長條 = 該期累計時長 · 紅虛線 = 6 期平均
        </Text>
        <MiniBarChart
          data={durationBuckets.map((b) => ({ label: b.label, value: b.total_ms }))}
          avgLine={durationAvgMs}
          width={320}
          height={150}
          barColor="#10B981"
          formatAvg={formatDurationShort}
          formatBarValue={formatDurationShort}
          showBarValues
        />
        <Text style={styles.durationFootnote}>
          6 期共 {durationTotalSessions} 次已完成 Session
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
  anchorRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  anchorBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(127,127,127,0.12)',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  anchorBtnLabel: { fontSize: 13, color: '#6B7280' },
  anchorBtnDate: { flex: 1, fontSize: 14, fontWeight: '700', color: '#111827', fontVariant: ['tabular-nums'] },
  anchorBtnCaret: { fontSize: 14, color: '#6B7280' },
  anchorTodayBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#111827',
    borderRadius: 10,
  },
  anchorTodayText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  pickerWrap: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 4,
  },
  card: {
    backgroundColor: 'rgba(127,127,127,0.08)',
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  cardTitle: { fontSize: 15, fontWeight: '700' },
  cardSubtitle: { fontSize: 12, color: '#6B7280' },
  emptyText: { fontSize: 13, color: '#6B7280', textAlign: 'center', paddingVertical: 16 },
  mgGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 8,
  },
  mgCell: {
    width: '48%',
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 8,
    gap: 4,
  },
  mgCellHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  mgCellName: { fontSize: 13, fontWeight: '700' },
  mgCellTotal: { fontSize: 11, color: '#6B7280', fontVariant: ['tabular-nums'] },
  durationFootnote: {
    fontSize: 11,
    color: '#6B7280',
    textAlign: 'center',
    marginTop: 4,
  },
});
