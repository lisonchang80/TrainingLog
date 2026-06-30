/**
 * Achievements sub-tab — tiered medal + progress-bar cards.
 *
 * ADR-0009 Slice 17 amendment. The old 255-flat-card grid is replaced by
 * COLLAPSED tier cards: each (mg × type) and (bucket × type) ladder becomes
 * ONE card showing the current tier, a tier-coloured border/accent, and a
 * progress bar with numerator/denominator (currentCount / nextThreshold).
 *
 * Filters:
 *   全部     → mg cards + bucket cards + milestone
 *   部位     → one card per touched (mg × weight) and (mg × volume)
 *   訓練目的 → one card per touched (bucket × weight) and (bucket × volume),
 *              with a level-0「入門」badge driven by first_combo
 *   里程碑   → the single, always-shown session_count milestone card
 *
 * Only "碰過" groups (≥1 working set) get cards; the milestone is global.
 *
 * Drop-in contract: rendered by app/(tabs)/history.tsx with NO props.
 * Colours flow from useTheme().tokens; the tier accent ramp lives in
 * tier-progress-card.tsx (semantic-accent constant, exempt from token rule).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { useDatabase } from '@/components/database-provider';
import { useCoachMarkTarget } from '@/components/help';
import { TierProgressCard } from '@/components/achievements/tier-progress-card';
import {
  loadAchievementPanelData,
  type AchievementPanelData,
} from '@/src/adapters/sqlite/achievementRepository';
import { listMuscleGroups } from '@/src/adapters/sqlite/exerciseLibraryRepository';
import {
  buildAchievementPanelCards,
  type PanelFilter,
} from '@/src/domain/achievement/achievementPanelModel';
import { bucketLabel } from '@/src/domain/pr/buckets';
import type { BucketKey } from '@/src/domain/pr/types';
import { t, tMuscleGroup, useLocale } from '@/src/i18n';
import { useTheme, type ThemeTokens } from '@/src/theme';

type FilterKey = PanelFilter;

function filterLabel(k: FilterKey): string {
  if (k === 'all') return t('common', 'all');
  if (k === 'mg') return t('status', 'filterMuscleGroup');
  if (k === 'bucket') return t('status', 'filterTrainingGoal');
  return t('status', 'filterMilestone');
}

const FILTERS: readonly { key: FilterKey }[] = [
  { key: 'all' },
  { key: 'mg' },
  { key: 'bucket' },
  { key: 'milestone' },
];

const EMPTY_DATA: AchievementPanelData = {
  defs: [],
  unlockedIds: new Set(),
  perMg: new Map(),
  perBucket: new Map(),
  touchedMgs: new Set(),
  touchedBuckets: new Set(),
  totalSessionCount: 0,
};

export function AchievementsPanel() {
  // React Compiler i18n gotcha: opt out of memoization + subscribe to locale so
  // inline t()/tMuscleGroup() (filter chips, empty hint, group labels) re-render
  // on language switch (this panel stays mounted under the History tab).
  'use no memo';
  const locale = useLocale();
  const db = useDatabase();
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  // ⓘ coach spotlight anchors (history ▸ 獎章). Content: components/help/content/history-achievements.ts.
  const filtersTarget = useCoachMarkTarget('ach.filters');
  const cardsTarget = useCoachMarkTarget('ach.cards');
  const [data, setData] = useState<AchievementPanelData>(EMPTY_DATA);
  const [mgNames, setMgNames] = useState<Map<string, string>>(new Map());
  const [filter, setFilter] = useState<FilterKey>('all');

  const load = useCallback(async () => {
    const [panel, mgs] = await Promise.all([
      loadAchievementPanelData(db),
      listMuscleGroups(db),
    ]);
    setData(panel);
    setMgNames(new Map(mgs.map((m) => [m.id, m.name])));
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const cards = useMemo(
    () => buildAchievementPanelCards(data, filter),
    [data, filter]
  );

  // Resolve a groupLabelKey (mg_id OR bucket key) to a localised label.
  const resolveGroupLabel = useCallback(
    (key: string): string => {
      const mgName = mgNames.get(key);
      if (mgName != null) return tMuscleGroup(mgName);
      // Otherwise it's a bucket key — bucketLabel handles unknowns gracefully.
      return bucketLabel(key as BucketKey);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tMuscleGroup/bucketLabel read the active locale; rebuild on switch
    [mgNames, locale]
  );

  return (
    <View style={styles.container}>
      <View style={styles.filterRow} ref={filtersTarget.ref} collapsable={false}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.key}
            style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
            onPress={() => setFilter(f.key)}>
            <Text
              style={[styles.filterChipText, filter === f.key && styles.filterChipTextActive]}>
              {filterLabel(f.key)}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.listWrap} ref={cardsTarget.ref} collapsable={false}>
        <FlatList
          data={cards}
          keyExtractor={(item) => item.key}
          contentContainerStyle={styles.listContainer}
          renderItem={({ item }) => (
            <TierProgressCard card={item} resolveGroupLabel={resolveGroupLabel} />
          )}
          ListEmptyComponent={
            <Text style={styles.empty}>{t('status', 'achievementNoTouched')}</Text>
          }
        />
      </View>
    </View>
  );
}

function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: tokens.bg.base },
    listWrap: { flex: 1 },
    filterRow: {
      flexDirection: 'row',
      gap: 6,
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 4,
    },
    filterChip: {
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 999,
      backgroundColor: tokens.bg.elevated,
    },
    filterChipActive: { backgroundColor: tokens.action.primary },
    filterChipText: { fontSize: 13, color: tokens.text.secondary, fontWeight: '500' },
    filterChipTextActive: { color: tokens.action.onPrimary, fontWeight: '700' },
    listContainer: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24, gap: 10 },
    empty: {
      fontSize: 13,
      color: tokens.text.secondary,
      paddingVertical: 32,
      paddingHorizontal: 8,
      textAlign: 'center',
      lineHeight: 20,
    },
  });
}
