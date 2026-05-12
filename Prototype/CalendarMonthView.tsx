import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  displaySessionTitle,
  formatCapacity,
  TODAY,
  useMockStore,
  type Session,
} from './MockTrainingStore';

type CalendarMonthViewProps = {
  onOpenDay: (date: string) => void;
};

type DayCell = {
  date: string;
  dayNum: number;
  inMonth: boolean;
  isToday: boolean;
};

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

function parseISO(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map((s) => Number(s));
  return { y, m, d };
}

function formatISO(y: number, m: number, d: number): string {
  const mm = m.toString().padStart(2, '0');
  const dd = d.toString().padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

function buildMonthGrid(y: number, m: number, today: string): DayCell[] {
  const firstWeekday = new Date(y, m - 1, 1).getDay();
  const totalDays = daysInMonth(y, m);

  const prevMonthY = m === 1 ? y - 1 : y;
  const prevMonthM = m === 1 ? 12 : m - 1;
  const prevMonthDays = daysInMonth(prevMonthY, prevMonthM);

  const nextMonthY = m === 12 ? y + 1 : y;
  const nextMonthM = m === 12 ? 1 : m + 1;

  const cells: DayCell[] = [];

  for (let i = firstWeekday - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    const date = formatISO(prevMonthY, prevMonthM, d);
    cells.push({ date, dayNum: d, inMonth: false, isToday: date === today });
  }

  for (let d = 1; d <= totalDays; d++) {
    const date = formatISO(y, m, d);
    cells.push({ date, dayNum: d, inMonth: true, isToday: date === today });
  }

  while (cells.length % 7 !== 0) {
    const trailingIdx = cells.length - firstWeekday - totalDays + 1;
    const date = formatISO(nextMonthY, nextMonthM, trailingIdx);
    cells.push({ date, dayNum: trailingIdx, inMonth: false, isToday: date === today });
  }

  while (cells.length < 42) {
    const last = cells[cells.length - 1];
    const parsed = parseISO(last.date);
    const nextDay = parsed.d + 1;
    const nm = nextMonthY === parsed.y && nextMonthM === parsed.m ? nextMonthM : parsed.m;
    const date = formatISO(parsed.y, nm, nextDay);
    cells.push({ date, dayNum: nextDay, inMonth: false, isToday: date === today });
  }

  return cells;
}

export function CalendarMonthView({ onOpenDay }: CalendarMonthViewProps) {
  const store = useMockStore();
  const todayParsed = parseISO(TODAY);

  const [year, setYear] = useState(todayParsed.y);
  const [month, setMonth] = useState(todayParsed.m);

  const cells = useMemo(() => buildMonthGrid(year, month, TODAY), [year, month]);

  const canGoNext = !(year === todayParsed.y && month === todayParsed.m);

  const onPrev = () => {
    if (month === 1) {
      setYear(year - 1);
      setMonth(12);
    } else {
      setMonth(month - 1);
    }
  };

  const onNext = () => {
    if (!canGoNext) return;
    if (month === 12) {
      setYear(year + 1);
      setMonth(1);
    } else {
      setMonth(month + 1);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={onPrev} style={styles.navBtn}>
          <Text style={styles.navBtnText}>‹</Text>
        </Pressable>
        <Text style={styles.headerTitle}>
          {year}年{month}月
        </Text>
        <Pressable
          onPress={onNext}
          style={[styles.navBtn, !canGoNext && styles.navBtnDisabled]}
          disabled={!canGoNext}>
          <Text style={[styles.navBtnText, !canGoNext && styles.navBtnTextDisabled]}>›</Text>
        </Pressable>
      </View>

      <View style={styles.weekdayRow}>
        {WEEKDAY_LABELS.map((w) => (
          <Text key={w} style={styles.weekdayLabel}>
            {w}
          </Text>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.gridContainer}>
        <View style={styles.grid}>
          {cells.map((cell) => (
            <DayCellView
              key={cell.date}
              cell={cell}
              session={store.mainSessionByDate(cell.date)}
              sessionCount={store.sessionsByDate(cell.date).length}
              onPress={() => {
                if (store.sessionsByDate(cell.date).length > 0) {
                  onOpenDay(cell.date);
                }
              }}
            />
          ))}
        </View>
      </ScrollView>

      <View style={styles.legend}>
        <Text style={styles.legendText}>
          tap 任一有訓練的日格進入詳情頁；多場同日進主場（容量最高）
        </Text>
      </View>
    </View>
  );
}

function DayCellView({
  cell,
  session,
  sessionCount,
  onPress,
}: {
  cell: DayCell;
  session: Session | null;
  sessionCount: number;
  onPress: () => void;
}) {
  const store = useMockStore();
  const title = session ? displaySessionTitle(session, store.state.templates) : '';
  const isFreestyle = session != null && session.template_id == null;

  let chipColor = '#E5E7EB';
  if (session != null && !isFreestyle) {
    const tpl = store.templateById(session.template_id);
    if (tpl) chipColor = tpl.color_hex;
  }

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.cell,
        !cell.inMonth && styles.cellOutMonth,
        pressed && session && styles.cellPressed,
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

      {session != null ? (
        <View style={styles.chipStack}>
          <View style={[styles.chip, styles.chipCapacity]}>
            <Text style={styles.chipCapacityText} numberOfLines={1}>
              {formatCapacity(
                store
                  .sessionsByDate(cell.date)
                  .reduce((sum, s) => sum + s.capacity, 0),
              )}
            </Text>
          </View>
          <View
            style={[
              styles.chip,
              { backgroundColor: chipColor },
              isFreestyle && styles.chipFreestyle,
            ]}>
            <Text
              style={[styles.chipTitleText, isFreestyle && styles.chipFreestyleText]}
              numberOfLines={1}>
              {isFreestyle ? `⚠️ ${title}` : title}
            </Text>
          </View>
          <Text style={styles.subtitle} numberOfLines={1}>
            {isFreestyle ? '—' : session.program_subtitle ?? '—'}
          </Text>
        </View>
      ) : (
        <View style={styles.chipStack} />
      )}
    </Pressable>
  );
}

const CELL_HEIGHT = 72;

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  navBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(127,127,127,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBtnDisabled: { opacity: 0.3 },
  navBtnText: { fontSize: 20, fontWeight: '600', color: '#111827' },
  navBtnTextDisabled: { color: '#9CA3AF' },
  weekdayRow: {
    flexDirection: 'row',
    paddingHorizontal: 4,
  },
  weekdayLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
    color: '#6B7280',
    paddingVertical: 3,
  },
  gridContainer: { paddingHorizontal: 4, paddingBottom: 4 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: `${100 / 7}%`,
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
  plusN: { fontSize: 9, color: '#9CA3AF', fontWeight: '500' },
  chipStack: { gap: 2, marginTop: 1 },
  chip: {
    borderRadius: 4,
    paddingHorizontal: 1,
    paddingVertical: 1,
  },
  chipCapacity: { backgroundColor: '#34C759' },
  chipCapacityText: { color: '#fff', fontSize: 8, fontWeight: '700', textAlign: 'center' },
  chipTitleText: { color: '#fff', fontSize: 8, fontWeight: '600', textAlign: 'center' },
  chipFreestyle: { backgroundColor: '#D1D5DB' },
  chipFreestyleText: { color: '#374151' },
  subtitle: {
    fontSize: 8,
    color: '#6B7280',
    textAlign: 'center',
  },
  legend: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(127,127,127,0.2)',
  },
  legendText: { fontSize: 10, color: '#6B7280', textAlign: 'center' },
});
