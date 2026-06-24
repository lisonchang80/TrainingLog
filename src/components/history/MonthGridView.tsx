/**
 * MonthGridView — history-specific renderer for CalendarGrid (ADR-0015).
 *
 * Pulls sessions for the visible month, enriches each with its capacity
 * (Σ weight×reps), linked template triple, and per-template color, then
 * groups them by local date to populate the calendar cells. Tap on a day
 * with sessions navigates to the main session's detail page (highest
 * capacity, tie-break = latest started_at) and forwards `sameDayIds` so
 * Agent C's same-day session switcher inside the detail page can swap
 * between siblings without an extra DB round-trip.
 *
 * Cell layout (per ADR-0015 § Cell layout):
 *   - Top row: 日期數字 + 右上 +N (only if sessionCount > 1)
 *   - Row 1: 容量合計 (systemGreen chip, kg rounded to int)
 *   - Row 2: 主場 session.title (per-template color, freestyle = grey + ⚠️)
 *   - Row 3: 主場 強度 (sub_tag), grey caption; freestyle / no-subtag → 「—」
 *
 * Date grouping: we use the device's local-timezone YMD via Date getters,
 * not toISOString().slice(0,10) — UTC would shift evening sessions to the
 * next day and corrupt the per-day grouping for users in non-UTC zones.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { useDatabase } from '@/components/database-provider';
import { loadCalendarMonthRows } from '@/src/adapters/sqlite/sessionRepository';
import {
  todayISO,
  formatISO,
  type CalendarDayCell,
} from '@/src/domain/calendar/monthGrid';
import { CalendarGrid } from './CalendarGrid';
import { t, useLocale } from '@/src/i18n';
import { useAppMode } from '@/src/app-mode';
import { useTheme, type ThemeTokens } from '@/src/theme';

interface EnrichedSession {
  id: string;
  date: string; // local YYYY-MM-DD
  started_at: number;
  title: string; // session.title (empty allowed)
  capacity: number;
  template_id: string | null;
  template_name: string | null;
  color_hex: string;
  sub_tag: string | null;
  program_name: string | null;
}

interface DayBucket {
  /** All sessions for the local date, sorted by capacity DESC then started_at DESC. */
  sessions: EnrichedSession[];
  /** The main session for the day (sessions[0] post-sort). */
  main: EnrichedSession;
  /** Sum of capacity across all sessions in the bucket. */
  totalCapacity: number;
}

function localDateOf(epochMs: number): string {
  const d = new Date(epochMs);
  return formatISO(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function monthRangeMs(year: number, month: number): { start: number; end: number } {
  // month is 1-12. Start = first day 00:00 local; end = first day of NEXT month.
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0).getTime();
  const endDate = new Date(year, month, 1, 0, 0, 0, 0);
  return { start, end: endDate.getTime() };
}

function displaySessionTitle(s: EnrichedSession): string {
  if (s.title.length > 0) return s.title;
  if (s.template_name && s.template_name.length > 0) return s.template_name;
  return t('domain', 'freestyle');
}

// ADR-0025 — 「空白訓練」(no-template) semantic gray indicator. Kept as
// raw hex because the visual intent is specifically a neutral mid-gray
// chip (not a primary surface), and we want it to read the same in both
// themes — the contrast with FREESTYLE_TEXT below carries the meaning.
const FREESTYLE_BG = '#D1D5DB';
const FREESTYLE_TEXT = '#374151';

export default function MonthGridView() {
  // React Compiler i18n gotcha: opt out of memoization + subscribe to locale so
  // the freestyle-title fallback (t('domain','freestyle')) re-evaluates on
  // language switch (this view stays mounted under the History tab).
  'use no memo';
  useLocale();
  const db = useDatabase();
  const router = useRouter();
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  const today = useMemo(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() + 1 };
  }, []);

  const [year, setYear] = useState(today.y);
  const [month, setMonth] = useState(today.m);
  const [byDate, setByDate] = useState<Map<string, DayBucket>>(new Map());

  const load = useCallback(async () => {
    const { start, end } = monthRangeMs(year, month);
    // Month-scoped aggregate read (perf): one fixed set of queries scoped to
    // [start, end) replaces the old `listSessions` (ALL rows) + JS filter +
    // 1+3N per-session fan-out. Mirrors the History list's `loadHistoryListRows`.
    const rows = await loadCalendarMonthRows(db, { start, end });

    const enriched: EnrichedSession[] = rows.map((r) => ({
      id: r.id,
      date: localDateOf(r.started_at),
      started_at: r.started_at,
      // session.title is a planned column (ADR-0014) but not yet surfaced on
      // this calendar path — title fallback resolves to template_name or
      // 「空白訓練」per ADR-0015 spec (see displaySessionTitle).
      title: '',
      capacity: r.capacity,
      template_id: r.template_id,
      template_name: r.template_name,
      // Raw template color from the loader; apply the grey freestyle fallback
      // here (empty / freestyle → FREESTYLE_BG) — same rule as before.
      color_hex: r.color_hex.length > 0 ? r.color_hex : FREESTYLE_BG,
      sub_tag: r.sub_tag,
      program_name: r.program_name,
    }));

    // Group by date, sort within each bucket by capacity DESC, tie-break by
    // started_at DESC (latest wins among ties).
    const map = new Map<string, EnrichedSession[]>();
    for (const e of enriched) {
      const list = map.get(e.date) ?? [];
      list.push(e);
      map.set(e.date, list);
    }
    const out = new Map<string, DayBucket>();
    for (const [date, list] of map.entries()) {
      list.sort((a, b) => {
        if (b.capacity !== a.capacity) return b.capacity - a.capacity;
        return b.started_at - a.started_at;
      });
      const totalCapacity = list.reduce((sum, s) => sum + s.capacity, 0);
      out.set(date, { sessions: list, main: list[0], totalCapacity });
    }
    setByDate(out);
  }, [db, year, month]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onMonthChange = useCallback((y: number, m: number) => {
    setYear(y);
    setMonth(m);
  }, []);

  const onTapDay = useCallback(
    (bucket: DayBucket) => {
      const allIds = bucket.sessions.map((s) => s.id).join(',');
      router.push(`/session/${bucket.main.id}?sameDayIds=${allIds}`);
    },
    [router]
  );

  const renderCell = useCallback(
    (cell: CalendarDayCell) => {
      const bucket = byDate.get(cell.date);
      const sessionCount = bucket?.sessions.length ?? 0;
      return (
        <DayCellView
          cell={cell}
          bucket={bucket ?? null}
          sessionCount={sessionCount}
          styles={styles}
          onPress={() => {
            if (bucket) onTapDay(bucket);
          }}
        />
      );
    },
    [byDate, onTapDay, styles]
  );

  return (
    <View style={styles.container}>
      <CalendarGrid
        year={year}
        month={month}
        onMonthChange={onMonthChange}
        renderCell={renderCell}
      />
    </View>
  );
}

function DayCellView({
  cell,
  bucket,
  sessionCount,
  styles,
  onPress,
}: {
  cell: CalendarDayCell;
  bucket: DayBucket | null;
  sessionCount: number;
  styles: ReturnType<typeof makeStyles>;
  onPress: () => void;
}) {
  // React Compiler i18n gotcha: this cell calls displaySessionTitle (→ t())
  // at render time, so it needs its own locale subscription + memo opt-out to
  // refresh the freestyle label on language switch.
  'use no memo';
  useLocale();
  // ADR-0026 — 極簡模式：cell 第 3 行（強度 sub_tag）整段隱藏（無強度概念）。
  const { isMinimal } = useAppMode();
  const main = bucket?.main ?? null;
  const isFreestyle = main != null && main.template_id == null;
  const title = main ? displaySessionTitle(main) : '';
  const subTag = main && !isFreestyle ? main.sub_tag ?? null : null;

  return (
    <Pressable
      onPress={onPress}
      disabled={!bucket}
      style={({ pressed }) => [
        styles.cell,
        !cell.inMonth && styles.cellOutMonth,
        pressed && bucket && styles.cellPressed,
      ]}>
      <View style={styles.cellTopRow}>
        <View style={[styles.dayNumWrap, cell.isToday && styles.dayNumToday]}>
          <Text
            style={[
              styles.dayNum,
              !cell.inMonth && styles.dayNumOut,
              cell.isToday && styles.dayNumTodayText,
            ]}>
            {cell.dayNum}
          </Text>
        </View>
        {sessionCount > 1 ? (
          <Text style={styles.plusN}>+{sessionCount - 1}</Text>
        ) : (
          <Text style={styles.plusN}> </Text>
        )}
      </View>

      {bucket != null ? (
        <View style={styles.chipStack}>
          <View style={[styles.chip, styles.chipCapacity]}>
            <Text style={styles.chipCapacityText} numberOfLines={1}>
              {Math.round(bucket.totalCapacity)}
            </Text>
          </View>
          <View
            style={[
              styles.chip,
              { backgroundColor: isFreestyle ? FREESTYLE_BG : main!.color_hex },
            ]}>
            <Text
              style={[
                styles.chipTitleText,
                isFreestyle && { color: FREESTYLE_TEXT },
              ]}
              numberOfLines={1}>
              {isFreestyle ? `⚠️ ${title}` : title}
            </Text>
          </View>
          {isMinimal ? null : (
            <Text style={styles.subtitle} numberOfLines={1}>
              {isFreestyle ? '' : subTag ?? '—'}
            </Text>
          )}
        </View>
      ) : (
        <View style={styles.chipStack} />
      )}
    </Pressable>
  );
}

const CELL_HEIGHT = 76;

/**
 * ADR-0025 — calendar cell chrome flows from tokens. The session chip BG
 * uses per-template color_hex (data-driven), so we don't tokenize that —
 * the surrounding cell borders / day-number / subtitle DO use tokens so
 * dark mode is legible.
 */
function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    container: { flex: 1 },
    cell: {
      height: CELL_HEIGHT,
      padding: 2,
      borderColor: tokens.border.subtle,
      borderWidth: StyleSheet.hairlineWidth,
    },
    cellOutMonth: { opacity: 0.4 },
    cellPressed: { opacity: 0.7 },
    cellTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    dayNumWrap: {
      width: 18,
      height: 18,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dayNumToday: { backgroundColor: tokens.action.success },
    dayNum: { fontSize: 12, fontWeight: '600', color: tokens.text.primary },
    dayNumOut: { color: tokens.text.tertiary },
    dayNumTodayText: { color: tokens.action.onPrimary },
    plusN: {
      fontSize: 9,
      color: tokens.text.tertiary,
      fontWeight: '600',
    },
    chipStack: { gap: 2, marginTop: 1 },
    chip: { borderRadius: 4, paddingHorizontal: 2, paddingVertical: 1 },
    chipCapacity: { backgroundColor: tokens.action.success },
    chipCapacityText: {
      color: tokens.action.onPrimary,
      fontSize: 8,
      fontWeight: '700',
      textAlign: 'center',
    },
    chipTitleText: {
      color: tokens.action.onPrimary,
      fontSize: 8,
      fontWeight: '600',
      textAlign: 'center',
    },
    subtitle: {
      fontSize: 8,
      color: tokens.text.secondary,
      textAlign: 'center',
    },
  });
}

// Suppress lint warning for currently-unused todayISO import; reserved
// for future "今天" jump button.
void todayISO;
