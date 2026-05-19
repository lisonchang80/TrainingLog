import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StatsPanel } from '@/components/stats-panel';
import { AchievementsPanel } from '@/components/achievements-panel';
import MonthGridView from '@/src/components/history/MonthGridView';
import ListView from '@/src/components/history/ListView';

type SubTab = 'history' | 'stats' | 'achievements';
type HistoryMode = 'calendar' | 'list';

const SUB_TABS: readonly { key: SubTab; label: string }[] = [
  { key: 'history', label: '歷史' },
  { key: 'stats', label: '統計' },
  { key: 'achievements', label: '獎章' },
];

const HISTORY_MODES: readonly { key: HistoryMode; label: string }[] = [
  { key: 'calendar', label: '月曆' },
  { key: 'list', label: '表列' },
];

/**
 * History tab — three-level structure (slice 9 / ADR-0009 / ADR-0015).
 *   歷史 (default):  inner segmented [月曆 | 表列]
 *     - 月曆 (default): traditional calendar-month grid with per-template
 *       color and +N indicator (ADR-0015).
 *     - 表列 (escape hatch): denser list view (ADR-0015 § Sub-tab toggle).
 *   統計:   per-period heatmap + capacity bars + duration metrics
 *   獎章:   255 system-seeded achievement grid (locked / unlocked)
 *
 * The previous flat list (`HistoryListPanel`) is gone — Agent B's
 * `ListView` carries the dense escape-hatch table now.
 */
export default function HistoryScreen() {
  const [tab, setTab] = useState<SubTab>('history');
  const [mode, setMode] = useState<HistoryMode>('calendar');

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.heading}>History</Text>
        <View style={styles.subTabRow}>
          {SUB_TABS.map((t) => (
            <Pressable
              key={t.key}
              style={[styles.subTabBtn, tab === t.key && styles.subTabBtnActive]}
              onPress={() => setTab(t.key)}>
              <Text
                style={[
                  styles.subTabBtnText,
                  tab === t.key && styles.subTabBtnTextActive,
                ]}>
                {t.label}
              </Text>
            </Pressable>
          ))}
        </View>
        {tab === 'history' ? (
          <View style={styles.modeRow}>
            {HISTORY_MODES.map((m) => (
              <Pressable
                key={m.key}
                style={[styles.modeBtn, mode === m.key && styles.modeBtnActive]}
                onPress={() => setMode(m.key)}>
                <Text
                  style={[
                    styles.modeBtnText,
                    mode === m.key && styles.modeBtnTextActive,
                  ]}>
                  {m.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
      {tab === 'history' ? (
        mode === 'calendar' ? <MonthGridView /> : <ListView />
      ) : null}
      {tab === 'stats' ? <StatsPanel /> : null}
      {tab === 'achievements' ? <AchievementsPanel /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingTop: 24, paddingHorizontal: 24, paddingBottom: 8, gap: 12 },
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
  modeRow: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(127,127,127,0.12)',
    borderRadius: 8,
    padding: 3,
    gap: 4,
  },
  modeBtn: {
    paddingVertical: 6,
    paddingHorizontal: 18,
    borderRadius: 6,
    alignItems: 'center',
  },
  modeBtnActive: { backgroundColor: '#fff' },
  modeBtnText: { fontSize: 13, fontWeight: '500', color: '#6B7280' },
  modeBtnTextActive: { color: '#111827', fontWeight: '700' },
});
