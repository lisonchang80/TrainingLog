import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StatsPanel } from '@/components/stats-panel';
import { AchievementsPanel } from '@/components/achievements-panel';
import MonthGridView from '@/src/components/history/MonthGridView';
import ListView from '@/src/components/history/ListView';
import { useAchievementsEnabled } from '@/src/achievements-enabled';
import { t, useLocale } from '@/src/i18n';
import { useTheme, type ThemeTokens } from '@/src/theme';

import {
  CoachMarkProvider,
  HelpButton,
  PageHelpHost,
  useCoachMarkTarget,
  usePageHelp,
} from '@/components/help';
import { historyHelp, historyHelpMinimal } from '@/components/help/content/history';
import { statsHelp } from '@/components/help/content/history-stats';
import { achievementsHelp } from '@/components/help/content/history-achievements';
import { useAppMode } from '@/src/app-mode';

type SubTab = 'history' | 'stats' | 'achievements';
type HistoryMode = 'calendar' | 'list';

const SUB_TABS: readonly { key: SubTab; labelKey: 'history' | 'stats' | 'achievements' }[] = [
  { key: 'history', labelKey: 'history' },
  { key: 'stats', labelKey: 'stats' },
  { key: 'achievements', labelKey: 'achievements' },
];

const HISTORY_MODES: readonly { key: HistoryMode; labelKey: 'calendar' | 'listView' }[] = [
  { key: 'calendar', labelKey: 'calendar' },
  { key: 'list', labelKey: 'listView' },
];

function subTabLabel(k: SubTab): string {
  if (k === 'history') return t('domain', 'history');
  if (k === 'stats') return t('domain', 'stats');
  return t('domain', 'achievements');
}

function historyModeLabel(m: HistoryMode): string {
  if (m === 'calendar') return t('domain', 'calendar');
  return t('button', 'listView');
}

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
function HistoryScreen() {
  // `'use no memo'` + `useLocale()`: opt out of React Compiler memoization and
  // subscribe to language changes so the heading + the inline subTabLabel() /
  // historyModeLabel() t() calls re-evaluate fresh on a `setLocale()` while the
  // tab stays mounted. Cf. project_traininglog_react_compiler_i18n_gotcha.
  'use no memo';
  useLocale();
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  // ADR-0026 — 極簡模式月曆 cell 藏第 3 行（強度），所以 history ⓘ 也換成不含
  // 「放大看一天」截圖卡的 minimal 變體。同 pageId（同畫面微差）。
  const { isMinimal } = useAppMode();
  // Each sub-tab has its OWN help (stable pageId per tab). The single header ⓘ
  // opens whichever matches the active tab — see `help` below (after
  // effectiveTab). Only the default 歷史 tab auto-shows once; 統計 / 獎章 are
  // manual-ⓘ only — their usePageHelp effect runs on mount while you're still on
  // 歷史, so an autoShowOnce there would be consumed unseen (the host renders the
  // active handle only). statsHelp / achievementsHelp are mode-agnostic.
  const historyHelpH = usePageHelp('history', isMinimal ? historyHelpMinimal : historyHelp, {
    autoShowOnce: true,
  });
  const statsHelpH = usePageHelp('history-stats', statsHelp);
  const achievementsHelpH = usePageHelp('history-achievements', achievementsHelp);
  const subTabsTarget = useCoachMarkTarget('history.subtabs');
  const modeTarget = useCoachMarkTarget('history.mode');
  const calendarTarget = useCoachMarkTarget('history.calendar');
  const [tab, setTab] = useState<SubTab>('history');
  const [mode, setMode] = useState<HistoryMode>('calendar');

  // Slice 17 / ADR-0009 amendment — UI-only gate. When the achievement system
  // is OFF, hide the 獎章 sub-tab button entirely.
  const { enabled: achievementsEnabled } = useAchievementsEnabled();
  const visibleTabs = useMemo(
    () => (achievementsEnabled ? SUB_TABS : SUB_TABS.filter((s) => s.key !== 'achievements')),
    [achievementsEnabled],
  );
  // Robust fallback: if the toggle flips OFF while the user is parked on the
  // (now-hidden) achievements tab, derive a still-visible tab for rendering so
  // the hidden panel never shows. Derived rather than effect-driven so it stays
  // correct on the same render the toggle changes.
  const effectiveTab: SubTab = tab === 'achievements' && !achievementsEnabled ? 'history' : tab;

  // The header ⓘ opens the active sub-tab's help.
  const help =
    effectiveTab === 'stats'
      ? statsHelpH
      : effectiveTab === 'achievements'
        ? achievementsHelpH
        : historyHelpH;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
          <Text style={styles.heading}>{t('page', 'history')}</Text>
          <HelpButton onPress={help.open} />
        </View>
        <View
          style={styles.subTabRow}
          ref={subTabsTarget.ref}
          collapsable={false}>
          {visibleTabs.map((sub) => (
            <Pressable
              key={sub.key}
              style={[styles.subTabBtn, effectiveTab === sub.key && styles.subTabBtnActive]}
              onPress={() => setTab(sub.key)}>
              <Text
                style={[
                  styles.subTabBtnText,
                  effectiveTab === sub.key && styles.subTabBtnTextActive,
                ]}>
                {subTabLabel(sub.key)}
              </Text>
            </Pressable>
          ))}
        </View>
        {effectiveTab === 'history' ? (
          <View style={styles.modeRow} ref={modeTarget.ref} collapsable={false}>
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
                  {historyModeLabel(m.key)}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
      {effectiveTab === 'history' ? (
        mode === 'calendar' ? (
          <View ref={calendarTarget.ref} collapsable={false} style={{ flex: 1 }}>
            <MonthGridView />
          </View>
        ) : (
          <ListView />
        )
      ) : null}
      {effectiveTab === 'stats' ? <StatsPanel /> : null}
      {effectiveTab === 'achievements' ? <AchievementsPanel /> : null}
      <PageHelpHost help={help} />
    </SafeAreaView>
  );
}

/**
 * Wrap from OUTSIDE in CoachMarkProvider so HistoryScreen's useCoachMarkTarget
 * anchors (subtabs / mode / calendar) register against the provider.
 */
export default function HistoryScreenWithHelp() {
  return (
    <CoachMarkProvider>
      <HistoryScreen />
    </CoachMarkProvider>
  );
}

/**
 * ADR-0025 — segmented control surfaces use `bg.elevated` for the track and
 * `bg.surface` for the active pill (small contrast bump), with action.primary
 * text on active. Matches iOS segmented control feel in both light + dark.
 */
function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: tokens.bg.base },
    header: { paddingTop: 24, paddingHorizontal: 24, paddingBottom: 8, gap: 12 },
    heading: { fontSize: 28, fontWeight: '700', color: tokens.text.primary },
    subTabRow: {
      flexDirection: 'row',
      backgroundColor: tokens.bg.elevated,
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
    subTabBtnActive: { backgroundColor: tokens.bg.surface },
    subTabBtnText: {
      fontSize: 14,
      fontWeight: '500',
      color: tokens.text.secondary,
    },
    subTabBtnTextActive: { color: tokens.text.primary, fontWeight: '700' },
    modeRow: {
      flexDirection: 'row',
      alignSelf: 'flex-start',
      backgroundColor: tokens.bg.elevated,
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
    modeBtnActive: { backgroundColor: tokens.bg.surface },
    modeBtnText: {
      fontSize: 13,
      fontWeight: '500',
      color: tokens.text.secondary,
    },
    modeBtnTextActive: { color: tokens.text.primary, fontWeight: '700' },
  });
}
