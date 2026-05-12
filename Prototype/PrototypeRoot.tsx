import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CalendarMonthView } from './CalendarMonthView';
import { HistoryDetailView } from './HistoryDetailView';
import { TemplateEditorView } from './TemplateEditorView';
import {
  displaySessionTitle,
  formatCapacity,
  MockTrainingStoreProvider,
  useMockStore,
  type Session,
  type Template,
} from './MockTrainingStore';

type SubTab = 'history' | 'stats' | 'achievements';
type HistoryView = 'calendar' | 'list';
type Screen =
  | { kind: 'view'; view: HistoryView }
  | { kind: 'detail'; from: HistoryView; date: string; index: number }
  | { kind: 'templateList' }
  | { kind: 'templateEditor'; template_id: string };

const SUB_TABS: readonly { key: SubTab; label: string }[] = [
  { key: 'history', label: '歷史' },
  { key: 'stats', label: '統計' },
  { key: 'achievements', label: '獎章' },
];

const HISTORY_VIEWS: readonly { key: HistoryView; label: string }[] = [
  { key: 'calendar', label: '月曆' },
  { key: 'list', label: '表列' },
];

export default function PrototypeRoot() {
  return (
    <MockTrainingStoreProvider>
      <PrototypeShell />
    </MockTrainingStoreProvider>
  );
}

type CompactHeader = { title: string; date: string; color: string; isFreestyle: boolean };

function PrototypeShell() {
  const store = useMockStore();
  const [subTab, setSubTab] = useState<SubTab>('history');
  const [screen, setScreen] = useState<Screen>({ kind: 'view', view: 'calendar' });
  const [compactHeader, setCompactHeader] = useState<CompactHeader | null>(null);

  useEffect(() => {
    if (screen.kind !== 'detail') setCompactHeader(null);
  }, [screen.kind]);

  const onReset = () => {
    Alert.alert('重置 mock data？', '所有 prototype 修改會被還原。', [
      { text: '取消', style: 'cancel' },
      {
        text: '重置',
        style: 'destructive',
        onPress: () => {
          store.reset();
          setScreen({ kind: 'view', view: 'calendar' });
        },
      },
    ]);
  };

  const currentView: HistoryView =
    screen.kind === 'view'
      ? screen.view
      : screen.kind === 'detail'
        ? screen.from
        : 'calendar';

  const switchView = (next: HistoryView) => {
    setScreen({ kind: 'view', view: next });
  };

  const openDetail = (from: HistoryView, date: string) =>
    setScreen({ kind: 'detail', from, date, index: 0 });

  if (screen.kind === 'templateEditor') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <TemplateEditorView
          template_id={screen.template_id}
          onExit={() => setScreen({ kind: 'templateList' })}
        />
      </SafeAreaView>
    );
  }

  if (screen.kind === 'templateList') {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <TemplateListScreen
          onBack={() => setScreen({ kind: 'view', view: 'calendar' })}
          onOpen={(id) => setScreen({ kind: 'templateEditor', template_id: id })}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.heading}>History</Text>
          <View style={styles.headerRightBtns}>
            <Pressable
              style={styles.tplBtn}
              onPress={() => setScreen({ kind: 'templateList' })}>
              <Text style={styles.tplBtnText}>模版</Text>
            </Pressable>
            <Pressable style={styles.resetBtn} onPress={onReset}>
              <Text style={styles.resetBtnText}>↺</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.subTabRow}>
          {SUB_TABS.map((t) => (
            <Pressable
              key={t.key}
              onPress={() => setSubTab(t.key)}
              style={[styles.subTabBtn, subTab === t.key && styles.subTabBtnActive]}>
              <Text
                style={[
                  styles.subTabBtnText,
                  subTab === t.key && styles.subTabBtnTextActive,
                ]}>
                {t.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {subTab === 'history' ? (
        <View style={styles.body}>
          <View style={styles.viewToggleWrap}>
            <View style={styles.viewToggleHorz}>
              <View style={styles.viewToggleRow}>
                {HISTORY_VIEWS.map((v) => (
                  <Pressable
                    key={v.key}
                    onPress={() => switchView(v.key)}
                    style={[
                      styles.viewToggleBtn,
                      currentView === v.key && styles.viewToggleBtnActive,
                    ]}>
                    <Text
                      style={[
                        styles.viewToggleBtnText,
                        currentView === v.key && styles.viewToggleBtnTextActive,
                      ]}>
                      {v.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {compactHeader != null ? (
                <View style={styles.compactHeader}>
                  <View
                    style={[
                      styles.compactTitleChip,
                      { backgroundColor: compactHeader.color },
                      compactHeader.isFreestyle && styles.compactChipFreestyle,
                    ]}>
                    <Text
                      style={[
                        styles.compactTitle,
                        compactHeader.isFreestyle && styles.compactTitleFreestyle,
                      ]}
                      numberOfLines={1}>
                      {compactHeader.isFreestyle
                        ? `⚠️ ${compactHeader.title}`
                        : compactHeader.title}
                    </Text>
                  </View>
                  <Text style={styles.compactDate} numberOfLines={1}>
                    {compactHeader.date}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          {screen.kind === 'view' && screen.view === 'calendar' ? (
            <CalendarMonthView onOpenDay={(d) => openDetail('calendar', d)} />
          ) : null}
          {screen.kind === 'view' && screen.view === 'list' ? (
            <HistoryListView onOpenDay={(d) => openDetail('list', d)} />
          ) : null}
          {screen.kind === 'detail' ? (
            <HistoryDetailView
              date={screen.date}
              sessionIndex={screen.index}
              onBack={() => setScreen({ kind: 'view', view: screen.from })}
              onIndexChange={(idx) =>
                setScreen({
                  kind: 'detail',
                  from: screen.from,
                  date: screen.date,
                  index: idx,
                })
              }
              onCompactHeaderChange={setCompactHeader}
            />
          ) : null}
        </View>
      ) : (
        <View style={styles.stubBody}>
          <Text style={styles.stubTitle}>
            {subTab === 'stats' ? '統計' : '獎章'}
          </Text>
          <Text style={styles.stubHint}>
            此 sub-tab 不在原型範圍內{'\n'}（production 已實作 · ADR-0009）
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

function HistoryListView({ onOpenDay }: { onOpenDay: (date: string) => void }) {
  const store = useMockStore();

  const rows = useMemo(() => {
    const grouped = new Map<string, Session[]>();
    for (const s of store.state.sessions) {
      const arr = grouped.get(s.date) ?? [];
      arr.push(s);
      grouped.set(s.date, arr);
    }
    const dates = Array.from(grouped.keys()).sort().reverse();
    return dates.map((date) => {
      const list = (grouped.get(date) ?? []).slice().sort((a, b) => b.capacity - a.capacity);
      return { date, main: list[0], extra: list.length - 1, total: list.reduce((a, s) => a + s.capacity, 0) };
    });
  }, [store.state.sessions]);

  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => r.date}
      contentContainerStyle={styles.listContent}
      ItemSeparatorComponent={() => <View style={styles.listSep} />}
      renderItem={({ item }) => {
        const isFreestyle = item.main.template_id == null;
        const title = displaySessionTitle(item.main, store.state.templates);
        const color = isFreestyle
          ? '#D1D5DB'
          : store.templateById(item.main.template_id)?.color_hex ?? '#9CA3AF';
        const programLine =
          item.main.program_main != null
            ? `${item.main.program_main}${item.main.program_subtitle != null ? ` · ${item.main.program_subtitle}` : ''}`
            : item.main.program_subtitle ?? '—';
        return (
          <Pressable style={styles.listRow} onPress={() => onOpenDay(item.date)}>
            <View style={styles.listDateCol}>
              <Text style={styles.listDate}>{item.date.slice(5)}</Text>
              <Text style={styles.listYear}>{item.date.slice(0, 4)}</Text>
            </View>
            <View style={[styles.listColorBar, { backgroundColor: color }]} />
            <View style={styles.listMid}>
              <Text style={styles.listTitle} numberOfLines={1}>
                {isFreestyle ? `⚠️ ${title}` : title}
                {item.extra > 0 ? <Text style={styles.listExtra}>　+{item.extra}</Text> : null}
              </Text>
              <Text style={styles.listSub} numberOfLines={1}>
                {programLine}
              </Text>
              <Text style={styles.listMeta} numberOfLines={1}>
                {item.main.exercise_count} 動作 · {Math.round(item.main.duration_seconds / 60)} 分鐘
                {item.main.watch_tracked ? ' · ⌚' : ''}
              </Text>
            </View>
            <View style={styles.listCapWrap}>
              <Text style={styles.listCap}>{formatCapacity(item.total)}</Text>
              <Text style={styles.listCapLabel}>kg</Text>
            </View>
          </Pressable>
        );
      }}
    />
  );
}

function TemplateListScreen({
  onBack,
  onOpen,
}: {
  onBack: () => void;
  onOpen: (id: string) => void;
}) {
  const store = useMockStore();
  const templates: Template[] = store.state.templates;
  return (
    <View style={styles.tplWrap}>
      <View style={styles.tplHeader}>
        <Pressable onPress={onBack} style={styles.tplBack} hitSlop={8}>
          <Text style={styles.tplBackText}>‹ 返回</Text>
        </Pressable>
        <Text style={styles.tplHeaderTitle}>模版</Text>
        <View style={styles.tplBack} />
      </View>
      <FlatList
        data={templates}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.tplListContent}
        ItemSeparatorComponent={() => <View style={styles.listSep} />}
        renderItem={({ item }) => {
          const exCount = item.exercises.length;
          const setCount = item.exercises.reduce((a, e) => a + e.sets.length, 0);
          return (
            <Pressable style={styles.tplRow} onPress={() => onOpen(item.id)}>
              <View style={[styles.tplColorBar, { backgroundColor: item.color_hex }]} />
              <View style={styles.tplRowMid}>
                <Text style={styles.tplRowName} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.tplRowSub} numberOfLines={1}>
                  {exCount} 動作 · {setCount} 組
                </Text>
              </View>
              <Text style={styles.tplChevron}>›</Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { paddingTop: 24, paddingHorizontal: 24, paddingBottom: 8, gap: 12 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerRightBtns: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tplBtn: {
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,122,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tplBtnText: { fontSize: 13, fontWeight: '600', color: '#007AFF' },
  heading: { fontSize: 28, fontWeight: '700' },
  subTabRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(127,127,127,0.12)',
    borderRadius: 10,
    padding: 4,
    gap: 4,
  },
  subTabBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  subTabBtnActive: { backgroundColor: '#fff' },
  subTabBtnText: { fontSize: 14, fontWeight: '500', color: '#6B7280' },
  subTabBtnTextActive: { color: '#111827', fontWeight: '700' },
  resetBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(127,127,127,0.12)',
  },
  resetBtnText: { fontSize: 18, fontWeight: '600' },
  body: { flex: 1 },
  viewToggleWrap: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 4 },
  viewToggleHorz: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  viewToggleRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(127,127,127,0.10)',
    borderRadius: 8,
    padding: 3,
    gap: 3,
  },
  compactHeader: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minWidth: 0,
  },
  compactTitleChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    flexShrink: 1,
    minWidth: 0,
  },
  compactChipFreestyle: { backgroundColor: '#D1D5DB' },
  compactTitle: { fontSize: 15, fontWeight: '700', color: '#fff' },
  compactTitleFreestyle: { color: '#374151' },
  compactDate: { fontSize: 13, color: '#6B7280', fontWeight: '500' },
  viewToggleBtn: {
    paddingVertical: 5,
    paddingHorizontal: 14,
    borderRadius: 6,
  },
  viewToggleBtnActive: { backgroundColor: '#fff' },
  viewToggleBtnText: { fontSize: 12, fontWeight: '500', color: '#6B7280' },
  viewToggleBtnTextActive: { color: '#111827', fontWeight: '700' },
  stubBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 8,
  },
  stubTitle: { fontSize: 20, fontWeight: '600', color: '#374151' },
  stubHint: { fontSize: 13, color: '#9CA3AF', textAlign: 'center', lineHeight: 20 },
  listContent: { paddingHorizontal: 24, paddingBottom: 24 },
  listSep: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(127,127,127,0.2)' },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
  },
  listDateCol: { width: 48, alignItems: 'flex-start' },
  listDate: { fontSize: 15, fontWeight: '700', color: '#111827' },
  listYear: { fontSize: 10, color: '#9CA3AF', marginTop: 1 },
  listColorBar: { width: 4, height: 32, borderRadius: 2 },
  listMid: { flex: 1, gap: 2 },
  listTitle: { fontSize: 14, fontWeight: '600', color: '#111827' },
  listExtra: { fontSize: 12, color: '#6B7280', fontWeight: '500' },
  listSub: { fontSize: 11, color: '#6B7280' },
  listMeta: { fontSize: 10, color: '#9CA3AF' },
  listCapWrap: { alignItems: 'flex-end' },
  listCap: { fontSize: 15, fontWeight: '700', color: '#34C759' },
  listCapLabel: { fontSize: 9, color: '#9CA3AF', marginTop: -2 },
  tplWrap: { flex: 1 },
  tplHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 24,
    paddingBottom: 12,
    paddingHorizontal: 24,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(127,127,127,0.2)',
  },
  tplBack: { minWidth: 64 },
  tplBackText: { fontSize: 15, color: '#007AFF', fontWeight: '500' },
  tplHeaderTitle: { fontSize: 17, fontWeight: '700' },
  tplListContent: { paddingHorizontal: 24, paddingBottom: 24 },
  tplRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  tplColorBar: { width: 4, height: 36, borderRadius: 2 },
  tplRowMid: { flex: 1, gap: 3 },
  tplRowName: { fontSize: 15, fontWeight: '600', color: '#111827' },
  tplRowSub: { fontSize: 12, color: '#6B7280' },
  tplChevron: { fontSize: 22, color: '#C7C7CC', fontWeight: '300' },
});
