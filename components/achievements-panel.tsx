/**
 * Achievements sub-tab — grid of 255 system-seeded badges.
 *
 * Slice 9 / ADR-0009. Each cell shows the display_name + tier; unlocked cells
 * show the unlock date and a coloured ring; locked cells render greyed out
 * with a "未解鎖" placeholder.
 *
 * Top filter chips switch between [全部] / [部位] / [訓練目的] / [里程碑]:
 *   - 部位     → first_combo + pr_per_mg
 *   - 訓練目的 → pr_per_bucket
 *   - 里程碑   → session_count
 *
 * ADR-0025 — all colors flow from useTheme().tokens. Unlocked cell uses
 * action.warning (amber/gold trophy feel); locked cell uses bg.elevated.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { useDatabase } from '@/components/database-provider';
import {
  listAchievementDefinitions,
  listUnlocks,
  type AchievementUnlockRow,
} from '@/src/adapters/sqlite/achievementRepository';
import type { AchievementDefinitionRow } from '@/src/domain/achievement/types';
import { getLocale, t } from '@/src/i18n';
import { useTheme, type ThemeTokens } from '@/src/theme';

type FilterKey = 'all' | 'mg' | 'bucket' | 'milestone';

/**
 * Inline dynamic helper — "N / M 已解鎖" / "N / M unlocked".
 * Kept local rather than in `src/i18n/dynamic.ts` (panel-only usage).
 */
function tUnlockedRatio(unlocked: number, total: number): string {
  return getLocale() === 'en'
    ? `${unlocked} / ${total} unlocked`
    : `${unlocked} / ${total} 已解鎖`;
}

/**
 * Filter chip labels. `all` round-trips via `common.all`; the other three
 * (部位 / 訓練目的 / 里程碑) have no exact i18n key — left inline with
 * TODO markers per Phase 4D spec. Achievement definitions themselves
 * (item.display_name / item.description) come from DB rows seeded in
 * v008Achievements.ts and are intentionally untranslated (Phase 2 user
 * decision: schema migration required).
 */
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

const CATEGORY_FOR_FILTER: Record<FilterKey, AchievementDefinitionRow['category'][] | null> = {
  all: null,
  mg: ['first_combo', 'pr_per_mg'],
  bucket: ['pr_per_bucket'],
  milestone: ['session_count'],
};

function formatUnlockDate(ms: number): string {
  return new Date(ms).toLocaleDateString();
}

export function AchievementsPanel() {
  const db = useDatabase();
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const [defs, setDefs] = useState<AchievementDefinitionRow[]>([]);
  const [unlocks, setUnlocks] = useState<AchievementUnlockRow[]>([]);
  const [filter, setFilter] = useState<FilterKey>('all');

  const load = useCallback(async () => {
    const [d, u] = await Promise.all([
      listAchievementDefinitions(db),
      listUnlocks(db),
    ]);
    setDefs(d);
    setUnlocks(u);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const unlockByDefId = useMemo(() => {
    const m = new Map<number, AchievementUnlockRow>();
    for (const u of unlocks) m.set(u.achievement_definition_id, u);
    return m;
  }, [unlocks]);

  const filtered = useMemo(() => {
    const allow = CATEGORY_FOR_FILTER[filter];
    return allow == null ? defs : defs.filter((d) => allow.includes(d.category));
  }, [defs, filter]);

  const unlockedCount = useMemo(() => filtered.filter((d) => unlockByDefId.has(d.id)).length, [filtered, unlockByDefId]);

  return (
    <View style={styles.container}>
      <View style={styles.filterRow}>
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

      <Text style={styles.summary}>
        {tUnlockedRatio(unlockedCount, filtered.length)}
      </Text>

      <FlatList
        data={filtered}
        keyExtractor={(item) => `def-${item.id}`}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.gridContainer}
        renderItem={({ item }) => {
          const unlock = unlockByDefId.get(item.id);
          return (
            <View style={[styles.cell, unlock ? styles.cellUnlocked : styles.cellLocked]}>
              <Text
                style={[styles.cellName, !unlock && styles.cellNameLocked]}
                numberOfLines={2}>
                {item.display_name}
              </Text>
              {item.description ? (
                <Text style={styles.cellDesc} numberOfLines={2}>
                  {item.description}
                </Text>
              ) : null}
              <Text style={[styles.cellStatus, unlock ? styles.cellStatusUnlocked : null]}>
                {unlock
                  ? `✓ ${formatUnlockDate(unlock.unlocked_at)}`
                  : t('status', 'achievementLocked')}
              </Text>
            </View>
          );
        }}
      />
    </View>
  );
}

function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: tokens.bg.base },
    filterRow: {
      flexDirection: 'row',
      gap: 6,
      paddingHorizontal: 16,
      paddingTop: 12,
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
    summary: {
      fontSize: 12,
      color: tokens.text.secondary,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    gridContainer: { paddingHorizontal: 12, paddingBottom: 24, gap: 8 },
    gridRow: { gap: 8 },
    cell: {
      flex: 1,
      padding: 12,
      borderRadius: 10,
      minHeight: 92,
      gap: 4,
    },
    cellUnlocked: {
      // Subtle amber tint over elevated bg — works in both modes (the
      // border carries the warning hue, fill is just a soft tint).
      backgroundColor: tokens.bg.elevated,
      borderWidth: 1,
      borderColor: tokens.action.warning,
    },
    cellLocked: {
      backgroundColor: tokens.bg.elevated,
    },
    cellName: { fontSize: 13, fontWeight: '700', color: tokens.text.primary },
    cellNameLocked: { color: tokens.text.tertiary },
    cellDesc: { fontSize: 11, color: tokens.text.secondary },
    cellStatus: { fontSize: 11, marginTop: 'auto', color: tokens.text.tertiary },
    cellStatusUnlocked: { color: tokens.action.warning, fontWeight: '700' },
  });
}
