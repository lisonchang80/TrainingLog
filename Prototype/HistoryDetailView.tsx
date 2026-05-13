import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Line, Text as SvgText } from 'react-native-svg';

import {
  displaySessionTitle,
  formatCapacity,
  formatDuration,
  useMockStore,
  type Session,
} from './MockTrainingStore';

type HistoryDetailViewProps = {
  date: string;
  sessionIndex: number;
  onBack: () => void;
  onIndexChange: (idx: number) => void;
  onCompactHeaderChange?: (
    info: { title: string; date: string; color: string; isFreestyle: boolean } | null,
  ) => void;
};

export function HistoryDetailView({
  date,
  sessionIndex,
  onBack,
  onIndexChange,
  onCompactHeaderChange,
}: HistoryDetailViewProps) {
  const store = useMockStore();
  const daySessions = useMemo(() => store.sessionsByDate(date), [store, date]);

  const safeIdx = Math.min(sessionIndex, Math.max(0, daySessions.length - 1));
  const session: Session | null = daySessions[safeIdx] ?? null;

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleBottomRef = useRef(0);
  const compactShownRef = useRef(false);

  useEffect(() => {
    setEditingTitle(false);
    compactShownRef.current = false;
    onCompactHeaderChange?.(null);
  }, [session?.id, onCompactHeaderChange]);

  useEffect(() => {
    return () => onCompactHeaderChange?.(null);
  }, [onCompactHeaderChange]);

  if (!session) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>本日已無 session（可能已被刪除）</Text>
        <Pressable style={styles.backBtn} onPress={onBack}>
          <Text style={styles.backBtnText}>‹ 返回</Text>
        </Pressable>
      </View>
    );
  }

  const tpl = store.templateById(session.template_id);
  const isFreestyle = session.template_id == null;
  const chipColor = tpl?.color_hex ?? '#D1D5DB';
  const displayedTitle = displaySessionTitle(session, store.state.templates);

  const onPrevSession = () => {
    if (safeIdx > 0) onIndexChange(safeIdx - 1);
  };
  const onNextSession = () => {
    if (safeIdx < daySessions.length - 1) onIndexChange(safeIdx + 1);
  };

  const commitTitle = () => {
    store.renameSessionTitle(session.id, titleDraft.trim());
    setEditingTitle(false);
  };

  const beginEditTitle = () => {
    setTitleDraft(session.title);
    setEditingTitle(true);
  };

  const onSaveBackTemplate = () => {
    if (isFreestyle && session.title.length === 0) {
      Alert.alert(
        '先填 session 名稱',
        '此為 freestyle session，請先在 header 點擊命名才能儲存為模板。',
      );
      return;
    }
    if (isFreestyle) {
      Alert.alert(
        '儲存模板（freestyle 升級）',
        `引導選要覆蓋的三元組 (Program, 副標籤) → 改 sets + rename group。\n\n[prototype: 不實際寫入]`,
      );
      return;
    }
    Alert.alert(
      '儲存模板？',
      `將本場內容寫回 Template「${tpl?.name ?? ''}」。\n若 session.title 與 Template name 不同，會連動 sibling rename。`,
      [
        { text: '取消', style: 'cancel' },
        { text: '確定', onPress: () => Alert.alert('已儲存（prototype 不寫入）') },
      ],
    );
  };

  const onSaveAsTemplate = () => {
    Alert.alert(
      '另存模板',
      `補齊三元組 (Program, 副標籤) → 新建 Template entity，name = "${displayedTitle}"。\n\n衝突偵測：若 (name, Program, 副標) 命中既有 → hard block + escape。\n\n[prototype: 不實際寫入]`,
    );
  };

  const onDeleteSession = () => {
    Alert.alert(
      '確定刪除？',
      '此操作無法復原。會連動撤掉本場的 PR / 容量 / 月曆標記。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '刪除',
          style: 'destructive',
          onPress: () => {
            store.deleteSession(session.id);
            onBack();
          },
        },
      ],
    );
  };

  const onEditSession = () => {
    Alert.alert(
      '編輯訓練',
      '進入逐組編輯模式：修改重量/次數/動作清單，僅影響本場（不寫回 Template）。\n\n[prototype: 不實際進入編輯態]',
    );
  };

  const tplExercises = tpl?.exercises ?? [];

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        scrollEventThrottle={16}
        onScroll={(e) => {
          const y = e.nativeEvent.contentOffset.y;
          const shouldShow = titleBottomRef.current > 0 && y > titleBottomRef.current;
          if (shouldShow !== compactShownRef.current) {
            compactShownRef.current = shouldShow;
            onCompactHeaderChange?.(
              shouldShow
                ? {
                    title: displayedTitle,
                    date,
                    color: chipColor,
                    isFreestyle,
                  }
                : null,
            );
          }
        }}>
      <View style={styles.headerBar}>
        <Pressable style={styles.backBtn} onPress={onBack}>
          <Text style={styles.backBtnText}>‹ 返回</Text>
        </Pressable>
        <View style={styles.swipeRow}>
          <Pressable
            onPress={onPrevSession}
            disabled={safeIdx === 0}
            style={[styles.swipeBtn, safeIdx === 0 && styles.swipeBtnDisabled]}>
            <Text style={styles.swipeBtnText}>‹</Text>
          </Pressable>
          {daySessions.length > 1 ? (
            <Text style={styles.swipePos}>
              {safeIdx + 1}/{daySessions.length}
            </Text>
          ) : null}
          <Pressable
            onPress={onNextSession}
            disabled={safeIdx >= daySessions.length - 1}
            style={[
              styles.swipeBtn,
              safeIdx >= daySessions.length - 1 && styles.swipeBtnDisabled,
            ]}>
            <Text style={styles.swipeBtnText}>›</Text>
          </Pressable>
        </View>
      </View>

      <View
        style={styles.titleRow}
        onLayout={(e) => {
          titleBottomRef.current = e.nativeEvent.layout.y + e.nativeEvent.layout.height;
        }}>
        <Text style={styles.dateLabel}>{date}</Text>
        {editingTitle ? (
          <TextInput
            style={[styles.titleInput, { backgroundColor: chipColor }]}
            value={titleDraft}
            onChangeText={setTitleDraft}
            autoFocus
            placeholder="session.title"
            placeholderTextColor="rgba(255,255,255,0.7)"
            onSubmitEditing={commitTitle}
            onBlur={commitTitle}
          />
        ) : (
          <Pressable onPress={beginEditTitle}>
            <View
              style={[
                styles.titleChip,
                { backgroundColor: chipColor },
                isFreestyle && styles.titleChipFreestyle,
              ]}>
              <Text
                style={[styles.titleChipText, isFreestyle && styles.titleChipFreestyleText]}>
                {isFreestyle ? `⚠️ ${displayedTitle}` : displayedTitle}
              </Text>
            </View>
          </Pressable>
        )}
        {session.program_main != null ? (
          <Text style={styles.programMain}>
            {session.program_main}
            {session.program_subtitle != null ? ` · ${session.program_subtitle}` : ''}
          </Text>
        ) : null}
      </View>

      <View style={styles.statsRow}>
        <StatTile
          big={formatDuration(session.duration_seconds)}
          small={`${session.started_at}~${session.ended_at}`}
        />
        <StatTile big={formatCapacity(session.capacity)} small="容量 (kg)" />
        <StatTile big={session.exercise_count.toString()} small="動作數" />
        {session.watch_tracked && session.calories_kcal != null ? (
          <StatTile big={session.calories_kcal.toString()} small="大卡" />
        ) : null}
      </View>

      {session.watch_tracked && session.hr_samples != null && session.hr_avg != null ? (
        <View style={styles.hrBox}>
          <View style={styles.hrHeader}>
            <Text style={styles.hrTitle}>心率訓練區間</Text>
            <Text style={styles.hrRange}>
              {session.hr_min}–{session.hr_max} BPM · 平均 {session.hr_avg}
            </Text>
          </View>
          <HRLineChart
            samples={session.hr_samples}
            durationSec={session.duration_seconds}
            avg={session.hr_avg}
          />
          <View style={styles.hrLegendRow}>
            {HR_ZONE_COLORS.map((c, i) => (
              <HRLegendItem
                key={c}
                color={c}
                label={`Z${i + 1} ${HR_ZONE_LABELS[i]}`}
              />
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.body}>
        {tplExercises.length === 0 ? (
          <Text style={styles.placeholder}>
            {isFreestyle
              ? '（freestyle session — 此 prototype 不展開實打 sets，僅示意身份維度三按鈕入口）'
              : '（template 未定義動作）'}
          </Text>
        ) : (
          tplExercises
            .filter((e) => e.parent_id == null)
            .map((parent) => {
              const children = tplExercises.filter((c) => c.parent_id === parent.id);
              const isSuper = children.length > 0;
              const allNames = isSuper
                ? [parent.name, ...children.map((c) => c.name)].join(' + ')
                : parent.name;
              return (
                <View key={parent.id} style={styles.exCard}>
                  {isSuper ? (
                    <View style={styles.supersetHeaderRow}>
                      <Text style={styles.supersetTag}>超級組</Text>
                      <Text style={styles.supersetNames} numberOfLines={1}>
                        {allNames}
                      </Text>
                    </View>
                  ) : null}
                  {isSuper ? (
                    <View style={styles.exSuperRow}>
                      <View style={styles.exSuperCol}>
                        <Text style={styles.supersetColName} numberOfLines={1}>
                          {parent.name}
                        </Text>
                        <ExerciseBlock ex={parent} hideHeader />
                      </View>
                      {children.map((child) => (
                        <Fragment key={child.id}>
                          <View style={styles.exSuperDivider} />
                          <View style={[styles.exSuperCol, styles.exSuperColWithLeftPad]}>
                            <Text style={styles.supersetColName} numberOfLines={1}>
                              {child.name}
                            </Text>
                            <ExerciseBlock ex={child} hideHeader />
                          </View>
                        </Fragment>
                      ))}
                    </View>
                  ) : (
                    <ExerciseBlock ex={parent} />
                  )}
                </View>
              );
            })
        )}
      </View>
      </ScrollView>

      <View style={styles.actionBar}>
        <Pressable style={styles.actionBtn} onPress={onEditSession}>
          <Text style={styles.actionBtnText}>編輯訓練</Text>
        </Pressable>
        <Pressable style={styles.actionBtn} onPress={onSaveBackTemplate}>
          <Text style={styles.actionBtnText}>儲存模板</Text>
        </Pressable>
        <Pressable style={styles.actionBtn} onPress={onSaveAsTemplate}>
          <Text style={styles.actionBtnText}>另存模板</Text>
        </Pressable>
        <Pressable
          style={[styles.actionBtn, styles.actionBtnDanger]}
          onPress={onDeleteSession}>
          <Text style={[styles.actionBtnText, styles.actionBtnDangerText]}>刪除訓練</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ExerciseBlock({
  ex,
  hideHeader,
}: {
  ex: NonNullable<ReturnType<typeof useMockStore>['state']['templates'][number]['exercises'][number]>;
  hideHeader?: boolean;
}) {
  let workIdx = 0;
  let clusterIdx = 0;
  const setLabels = ex.sets.map((s) => {
    if (s.kind === 'warmup') return '熱';
    if (s.kind === 'dropset') {
      if ((s.parent_set_id ?? null) === null) {
        clusterIdx += 1;
        return `D${clusterIdx}`;
      }
      return '';
    }
    workIdx += 1;
    return String(workIdx);
  });
  return (
    <View>
      {!hideHeader ? (
        <>
          <Text style={styles.exName}>{ex.name}</Text>
          <Text style={styles.exMeta}>
            {ex.section} · {ex.sets.length} 組
          </Text>
        </>
      ) : null}
      {ex.sets.map((s, i) => (
        <View key={s.id} style={styles.setRow}>
          <Text style={styles.setLabel}>{setLabels[i]}</Text>
          <Text style={styles.setVal}>{s.reps} reps</Text>
          <Text style={styles.setVal}>{s.weight} kg</Text>
        </View>
      ))}
    </View>
  );
}

function StatTile({ big, small }: { big: string; small: string }) {
  return (
    <View style={styles.statTile}>
      <Text
        style={styles.statValue}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.4}>
        {big}
      </Text>
      <Text style={styles.statLabel} numberOfLines={1}>
        {small}
      </Text>
    </View>
  );
}

const HR_ZONE_THRESHOLDS = [140, 152, 162, 173];
// Apple Watch 官方 5 區段心率區間配色 (Z1-Z5 對應 <60% / 70% / 80% / 90% / 100% 最大心率)。
// 後續 Watch slice 共用同一 palette 維持 cross-device 視覺一致。
const HR_ZONE_COLORS = ['#1AA3FF', '#1ED6C5', '#A1EE00', '#FF8A1A', '#FF2D8F'];
const HR_ZONE_LABELS = ['<140', '141–151', '152–161', '162–172', '173+'];

function zoneColor(bpm: number): string {
  for (let i = 0; i < HR_ZONE_THRESHOLDS.length; i++) {
    if (bpm < HR_ZONE_THRESHOLDS[i]) return HR_ZONE_COLORS[i];
  }
  return HR_ZONE_COLORS[HR_ZONE_COLORS.length - 1];
}

function formatRelTime(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h === 0) return `${m}:${s.toString().padStart(2, '0')}`;
  return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

const SCREEN_W = Dimensions.get('window').width;
const HR_CHART_W = Math.max(280, SCREEN_W - 56);
const HR_CHART_H = 130;
const HR_PAD_L = 30;
const HR_PAD_R = 8;
const HR_PAD_T = 8;
const HR_PAD_B = 18;

function HRLineChart({
  samples,
  durationSec,
  avg,
}: {
  samples: number[];
  durationSec: number;
  avg: number;
}) {
  const chartW = HR_CHART_W - HR_PAD_L - HR_PAD_R;
  const chartH = HR_CHART_H - HR_PAD_T - HR_PAD_B;
  const yMin = Math.min(...samples) - 5;
  const yMax = Math.max(...samples) + 5;
  const yRange = Math.max(1, yMax - yMin);
  const yOf = (bpm: number) => HR_PAD_T + chartH - ((bpm - yMin) / yRange) * chartH;
  const xStep = samples.length > 1 ? chartW / (samples.length - 1) : 0;
  const xOf = (i: number) => HR_PAD_L + xStep * i;

  const yTicks = [Math.round(yMax), avg, Math.round(yMin)];
  const xTickCount = 5;
  const xTicks = Array.from({ length: xTickCount }, (_, i) => {
    const ratio = i / (xTickCount - 1);
    return { x: HR_PAD_L + chartW * ratio, label: formatRelTime(durationSec * ratio) };
  });

  return (
    <Svg width={HR_CHART_W} height={HR_CHART_H}>
      {yTicks.map((t, i) => (
        <SvgText
          key={`yt-${i}`}
          x={HR_PAD_L - 4}
          y={yOf(t) + 3}
          fontSize={9}
          fill="#9CA3AF"
          textAnchor="end">
          {t}
        </SvgText>
      ))}
      <Line
        x1={HR_PAD_L}
        y1={yOf(avg)}
        x2={HR_CHART_W - HR_PAD_R}
        y2={yOf(avg)}
        stroke="#EF4444"
        strokeWidth={1}
        strokeDasharray="4,3"
        opacity={0.4}
      />
      {samples.slice(0, -1).map((bpm, i) => {
        const next = samples[i + 1];
        const c = zoneColor((bpm + next) / 2);
        return (
          <Line
            key={`seg-${i}`}
            x1={xOf(i)}
            y1={yOf(bpm)}
            x2={xOf(i + 1)}
            y2={yOf(next)}
            stroke={c}
            strokeWidth={2}
            strokeLinecap="round"
          />
        );
      })}
      {xTicks.map((t, i) => {
        const anchor =
          i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle';
        return (
          <SvgText
            key={`xt-${i}`}
            x={t.x}
            y={HR_CHART_H - 4}
            fontSize={8}
            fill="#9CA3AF"
            textAnchor={anchor}>
            {t.label}
          </SvgText>
        );
      })}
    </Svg>
  );
}

function HRLegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.hrLegendItem}>
      <View style={[styles.hrLegendSwatch, { backgroundColor: color }]} />
      <Text style={styles.hrLegendText} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  emptyText: { fontSize: 15, color: '#6B7280' },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  backBtn: { paddingVertical: 6, paddingHorizontal: 10 },
  backBtnText: { fontSize: 15, color: '#007AFF', fontWeight: '500' },
  swipeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  swipeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(127,127,127,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swipeBtnDisabled: { opacity: 0.3 },
  swipeBtnText: { fontSize: 18, fontWeight: '600' },
  swipePos: { fontSize: 13, fontWeight: '600', color: '#374151' },
  titleRow: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6,
  },
  dateLabel: { fontSize: 13, color: '#6B7280' },
  titleChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  titleChipFreestyle: { backgroundColor: '#D1D5DB' },
  titleChipText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  titleChipFreestyleText: { color: '#374151' },
  titleInput: {
    alignSelf: 'flex-start',
    minWidth: 200,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  subtitleText: { fontSize: 13, color: '#6B7280' },
  programMain: { fontSize: 12, color: '#6B7280', fontWeight: '500' },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  statTile: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(127,127,127,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minHeight: 56,
  },
  statValue: { fontSize: 16, fontWeight: '700', color: '#111827', textAlign: 'center' },
  statLabel: { fontSize: 10, color: '#6B7280', textAlign: 'center' },
  hrBox: {
    marginHorizontal: 16,
    marginVertical: 4,
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255,180,180,0.18)',
    gap: 6,
  },
  hrHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  hrTitle: { fontSize: 13, fontWeight: '700', color: '#374151' },
  hrRange: { fontSize: 12, color: '#6B7280', fontWeight: '500' },
  hrLegendRow: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    justifyContent: 'space-between',
    paddingTop: 4,
  },
  hrLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 },
  hrLegendSwatch: { width: 7, height: 7, borderRadius: 2 },
  hrLegendText: { fontSize: 8, color: '#6B7280' },
  scrollContent: { paddingBottom: 8 },
  body: { padding: 16, gap: 12 },
  placeholder: { fontSize: 13, color: '#6B7280', fontStyle: 'italic' },
  exCard: {
    borderRadius: 10,
    backgroundColor: 'rgba(127,127,127,0.08)',
    padding: 12,
    gap: 4,
  },
  supersetBadge: {
    alignSelf: 'flex-start',
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
    backgroundColor: '#5856D6',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 2,
  },
  supersetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  supersetTag: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
    backgroundColor: '#5856D6',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  supersetNames: { flex: 1, fontSize: 15, fontWeight: '600' },
  supersetColName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
    paddingHorizontal: 4,
    paddingTop: 4,
    paddingBottom: 2,
  },
  exChild: {
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(127,127,127,0.25)',
  },
  exSuperRow: {
    flexDirection: 'row',
    gap: 0,
    alignItems: 'stretch',
  },
  exSuperColWithLeftPad: { paddingLeft: 10 },
  exSuperCol: { flex: 1, minWidth: 0 },
  exSuperDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: 'rgba(127,127,127,0.35)',
  },
  exName: { fontSize: 15, fontWeight: '600' },
  exMeta: { fontSize: 12, color: '#6B7280', marginBottom: 4 },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
    gap: 8,
  },
  setLabel: { width: 20, fontSize: 13, fontWeight: '600', color: '#374151' },
  setVal: { fontSize: 13, color: '#111827', flexShrink: 1 },
  actionBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(127,127,127,0.2)',
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(0,122,255,0.12)',
    alignItems: 'center',
  },
  actionBtnText: { fontSize: 14, fontWeight: '600', color: '#007AFF' },
  actionBtnDanger: { backgroundColor: 'rgba(255,59,48,0.12)' },
  actionBtnDangerText: { color: '#FF3B30' },
});
