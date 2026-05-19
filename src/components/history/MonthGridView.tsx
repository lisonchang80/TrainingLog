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
import { listSessions } from '@/src/adapters/sqlite/sessionRepository';
import { listSetsBySession } from '@/src/adapters/sqlite/setRepository';
import {
  getSessionLinkedTemplateTriple,
  getTemplateFull,
} from '@/src/adapters/sqlite/templateRepository';
import { computeSessionVolume } from '@/src/domain/session/sessionStats';
import type { Session } from '@/src/domain/session/types';
import {
  todayISO,
  formatISO,
  type CalendarDayCell,
} from '@/src/domain/calendar/monthGrid';
import { CalendarGrid } from './CalendarGrid';

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
  return '自由訓練';
}

const FREESTYLE_BG = '#D1D5DB';
const FREESTYLE_TEXT = '#374151';

export default function MonthGridView() {
  const db = useDatabase();
  const router = useRouter();

  const today = useMemo(() => {
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() + 1 };
  }, []);

  const [year, setYear] = useState(today.y);
  const [month, setMonth] = useState(today.m);
  const [byDate, setByDate] = useState<Map<string, DayBucket>>(new Map());

  const load = useCallback(async () => {
    const { start, end } = monthRangeMs(year, month);
    const all = await listSessions(db);
    const window = all.filter(
      (s: Session) => s.started_at >= start && s.started_at < end
    );

    const enriched: EnrichedSession[] = await Promise.all(
      window.map(async (s) => {
        const [sets, triple] = await Promise.all([
          listSetsBySession(db, s.id),
          getSessionLinkedTemplateTriple(db, s.id),
        ]);
        const capacity = computeSessionVolume(sets);
        let color = FREESTYLE_BG;
        if (triple) {
          const tpl = await getTemplateFull(db, triple.template_id);
          if (tpl && tpl.color_hex.length > 0) color = tpl.color_hex;
        }
        // session.title is a planned column (ADR-0014) but not yet
        // shipped in any v001-v020 migration on this branch. Until the
        // column lands we always treat title as empty — title fallback
        // resolves to template_name or 「自由訓練」per ADR-0015 spec.
        const title = '';

        return {
          id: s.id,
          date: localDateOf(s.started_at),
          started_at: s.started_at,
          title,
          capacity,
          template_id: triple?.template_id ?? null,
          template_name: triple?.template_name ?? null,
          color_hex: color,
          sub_tag: triple?.sub_tag ?? null,
          program_name: triple?.program_name ?? null,
        };
      })
    );

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
      router.push(`/session/${bucket.main.id}?sameDayIds=${allIds}` as any);
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
          onPress={() => {
            if (bucket) onTapDay(bucket);
          }}
        />
      );
    },
    [byDate, onTapDay]
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
  onPress,
}: {
  cell: CalendarDayCell;
  bucket: DayBucket | null;
  sessionCount: number;
  onPress: () => void;
}) {
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
          <Text style={styles.subtitle} numberOfLines={1}>
            {isFreestyle ? '' : subTag ?? '—'}
          </Text>
        </View>
      ) : (
        <View style={styles.chipStack} />
      )}
    </Pressable>
  );
}

const CELL_HEIGHT = 76;

const styles = StyleSheet.create({
  container: { flex: 1 },
  cell: {
    height: CELL_HEIGHT,
    padding: 2,
    borderColor: 'rgba(127,127,127,0.12)',
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
  dayNumToday: { backgroundColor: '#34C759' },
  dayNum: { fontSize: 12, fontWeight: '600', color: '#111827' },
  dayNumOut: { color: '#9CA3AF' },
  dayNumTodayText: { color: '#fff' },
  plusN: { fontSize: 9, color: '#9CA3AF', fontWeight: '600' },
  chipStack: { gap: 2, marginTop: 1 },
  chip: { borderRadius: 4, paddingHorizontal: 2, paddingVertical: 1 },
  chipCapacity: { backgroundColor: '#34C759' },
  chipCapacityText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '700',
    textAlign: 'center',
  },
  chipTitleText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '600',
    textAlign: 'center',
  },
  subtitle: { fontSize: 8, color: '#6B7280', textAlign: 'center' },
});

// Suppress lint warning for currently-unused todayISO import; reserved
// for future "今天" jump button.
void todayISO;
