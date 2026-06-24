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
  mFrequencyOverPeriod,
  mgFrequencyOverPeriod,
  percentileBucketize,
} from '@/src/domain/stats/statsEngine';
import type {
  CapacityBucket,
  DurationBucket,
  PeriodScale,
  StatsSetRecord,
} from '@/src/domain/stats/types';
import { MUSCLE_GROUP_SEEDS, MUSCLE_SEEDS } from '@/src/db/seed/v006ExerciseLibrary';
import { t, tDurationBucketFootnote, tMuscleGroup, useLocale } from '@/src/i18n';
import { useTheme, type ThemeTokens } from '@/src/theme';

/**
 * Period selector labels. Backed by `domain.year/month/week` keys in
 * `strings.ts`. Year/Month added 2026-05-24 (Phase 4.5 audit sweep);
 * `domain.week` predates them.
 */
function periodLabel(p: PeriodScale): string {
  if (p === 'year') return t('domain', 'year');
  if (p === 'month') return t('domain', 'month');
  return t('domain', 'week');
}

interface PeriodChoice {
  key: PeriodScale;
}

const PERIOD_CHOICES: readonly PeriodChoice[] = [
  { key: 'year' },
  { key: 'month' },
  { key: 'week' },
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
  // React Compiler i18n gotcha: opt out of memoization + subscribe to locale so
  // inline t()/tMuscleGroup()/tDurationBucketFootnote() re-evaluate on language
  // switch (this panel stays mounted under the History tab).
  'use no memo';
  useLocale();
  const db = useDatabase();
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
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
  // M-level (細部位) heatmap derivation — mirrors the MG-level logic above
  // but iterates the M-layer (19 anatomical muscles per ADR-0010) instead of
  // the 11 muscle groups. `StatsSetRecord.m_ids` is the primary-role muscle
  // list per set, populated by the stats repository via the `exercise_muscle`
  // m:n table.
  const freqByM = useMemo(
    () => mFrequencyOverPeriod(currentBucketRecords),
    [currentBucketRecords]
  );
  const mQuintile = useMemo(() => {
    const out = new Map<string, Quintile>();
    const nonZeroMs: { m: string; count: number }[] = [];
    for (const m of MUSCLE_SEEDS) {
      const c = freqByM.get(m.id) ?? 0;
      if (c > 0) nonZeroMs.push({ m: m.id, count: c });
    }
    if (nonZeroMs.length === 0) return out;
    const buckets = percentileBucketize(nonZeroMs.map((x) => x.count));
    nonZeroMs.forEach((x, i) => out.set(x.m, buckets[i] as Quintile));
    return out;
  }, [freqByM]);
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
  // Order MGs by total 6-period capacity desc; hide MGs with no training in
  // the 6-period window so the grid focuses on what the user actually trained.
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
    })
      .filter((row) => row.total > 0)
      .sort((a, b) => b.total - a.total);
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
              {periodLabel(p.key)}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Anchor date row */}
      <View style={styles.anchorRow}>
        <Pressable
          style={styles.anchorBtn}
          onPress={() => setShowPicker((s) => !s)}>
          <Text style={styles.anchorBtnLabel}>{t('status', 'anchor')}</Text>
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
            <Text style={styles.anchorTodayText}>{t('status', 'today')}</Text>
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
        <Text style={styles.cardTitle}>{t('page', 'bodyOverview')} · {currentBucket.label}</Text>
        <Text style={styles.cardSubtitle}>{t('status', 'heatmapSubtitle')}</Text>
        {/* P1 (overnight 5/23 anatomy M-level): BodyHeatmap props rename
            mgQuintile→mQuintile + mgCount→mCount. Real M-level frequency
            wiring lands in P2 (extends StatsSetRecord with m_ids[] +
            mFrequencyOverPeriod). For now we pass empty maps so the heatmap
            renders the anatomical M-level silhouette in zero-grey. */}
        <BodyHeatmap mQuintile={mQuintile} mCount={freqByM} />
        <BodyHeatmapLegend />
        {totalSessionsCurrent === 0 ? (
          <Text style={styles.emptyText}>{t('status', 'noTrainingThisPeriod')}</Text>
        ) : null}
      </View>

      {/* Per-MG capacity histograms */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('page', 'capacityByMg')}</Text>
        <Text style={styles.cardSubtitle}>
          {t('status', 'capacityMgSubtitle')}
        </Text>
        {mgRows.length === 0 ? (
          <Text style={styles.emptyText}>{t('status', 'noCapacityRecent')}</Text>
        ) : (
          <View style={styles.mgGrid}>
            {mgRows.map((row) => (
              <View key={row.mg_id} style={styles.mgCell}>
                <View style={styles.mgCellHeader}>
                  {/* Round-trip mg_id through tMuscleGroup so EN locale shows
                      Chest/Back/etc. Falls back to row.mg_name (zh literal)
                      when the mg_id has no dictionary entry. */}
                  <Text style={styles.mgCellName}>{tMuscleGroup(row.mg_id) !== row.mg_id ? tMuscleGroup(row.mg_id) : row.mg_name}</Text>
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
        )}
      </View>

      {/* Duration histogram */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('page', 'durationOverPeriod')}</Text>
        <Text style={styles.cardSubtitle}>
          {t('status', 'durationSubtitle')}
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
          {tDurationBucketFootnote(durationTotalSessions)}
        </Text>
      </View>
    </ScrollView>
  );
}

/**
 * ADR-0025 — all chrome colors flow from tokens. Histogram bar colors
 * (#6366F1 indigo for capacity, #10B981 emerald for duration) stay
 * literal because they're data-viz palette per-MG / per-metric.
 */
function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    scroll: { padding: 16, gap: 12 },
    periodRow: {
      flexDirection: 'row',
      backgroundColor: tokens.bg.elevated,
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
    periodBtnActive: { backgroundColor: tokens.bg.surface },
    periodBtnText: { fontSize: 14, fontWeight: '500', color: tokens.text.secondary },
    periodBtnTextActive: { color: tokens.text.primary, fontWeight: '700' },
    anchorRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    anchorBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: tokens.bg.elevated,
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 14,
    },
    anchorBtnLabel: { fontSize: 13, color: tokens.text.secondary },
    anchorBtnDate: {
      flex: 1,
      fontSize: 14,
      fontWeight: '700',
      color: tokens.text.primary,
      fontVariant: ['tabular-nums'],
    },
    anchorBtnCaret: { fontSize: 14, color: tokens.text.secondary },
    anchorTodayBtn: {
      paddingVertical: 10,
      paddingHorizontal: 14,
      backgroundColor: tokens.action.primary,
      borderRadius: 10,
    },
    anchorTodayText: { color: tokens.action.onPrimary, fontSize: 13, fontWeight: '700' },
    pickerWrap: {
      backgroundColor: tokens.bg.surface,
      borderRadius: 12,
      paddingVertical: 4,
    },
    card: {
      backgroundColor: tokens.bg.elevated,
      borderRadius: 12,
      padding: 14,
      gap: 8,
    },
    cardTitle: { fontSize: 15, fontWeight: '700', color: tokens.text.primary },
    cardSubtitle: { fontSize: 12, color: tokens.text.secondary },
    emptyText: {
      fontSize: 13,
      color: tokens.text.secondary,
      textAlign: 'center',
      paddingVertical: 16,
    },
    mgGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      gap: 8,
    },
    mgCell: {
      width: '48%',
      backgroundColor: tokens.bg.surface,
      borderRadius: 8,
      padding: 8,
      gap: 4,
    },
    mgCellHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
    mgCellName: { fontSize: 13, fontWeight: '700', color: tokens.text.primary },
    mgCellTotal: {
      fontSize: 11,
      color: tokens.text.secondary,
      fontVariant: ['tabular-nums'],
    },
    durationFootnote: {
      fontSize: 11,
      color: tokens.text.secondary,
      textAlign: 'center',
      marginTop: 4,
    },
  });
}
