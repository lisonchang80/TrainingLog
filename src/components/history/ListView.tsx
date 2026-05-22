/**
 * History List View — ADR-0015 「表列 escape hatch」.
 *
 * Per-row layout (ADR-0015 § Sub-tab toggle, lines 27-33):
 *   ┌─────┬─────────────────────────────────────┬──────────┐
 *   │ ▌▌  │ M-DD  推日 A (重訓加強) +1          │   3458   │
 *   │ ▌▌  │ 2026 強日 · 10-12RM · 7動 · 64'    │     kg   │
 *   └─────┴─────────────────────────────────────┴──────────┘
 *
 *   - 12 色 side bar (per-template `color_hex`; freestyle / empty → #D1D5DB)
 *   - 日期: M-DD primary, YYYY secondary
 *   - session.title row (freestyle adds ⚠️, multi-session day appends inline +N)
 *   - 週期 + 強度 · 動作數 · 訓練時間 (inline subtitle)
 *   - 容量 (right-aligned), `kg` label below
 *
 * Watch ⌚ column is NOT shown — HealthKit lands in slice 13 (per task spec).
 *
 * Tap row → /session/[id]?sameDayIds=<csv of every session id on that date>.
 * Even single-session days pass the one-element list — Agent C's switcher
 * hides chrome when total = 1.
 *
 * v020 caveat: `template.color_hex` defaults to '' before Agent A's backfill
 * runs. We treat empty-or-missing as the grey fallback so the view degrades
 * gracefully when integrated into the pre-v020 base; post-integration the
 * backfill populates real palette values.
 */

import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useDatabase } from '@/components/database-provider';
import { listSessions } from '@/src/adapters/sqlite/sessionRepository';
import { listSetsBySession } from '@/src/adapters/sqlite/setRepository';
import {
  getSessionLinkedTemplateTriple,
  getTemplateFull,
} from '@/src/adapters/sqlite/templateRepository';
import { countUniqueExercises } from '@/src/domain/session/countUniqueExercises';
import {
  computeSessionVolume,
  formatTrainingDuration,
} from '@/src/domain/session/sessionStats';
import type { Session } from '@/src/domain/session/types';

import {
  buildSameDayIdMap,
  groupSessionsByDate,
} from './historyListHelpers';
import { t } from '@/src/i18n';
import { tNExerciseCount } from '@/src/i18n/dynamic';

const FREESTYLE_COLOR = '#D1D5DB';

interface SessionLinkedTriple {
  template_id: string;
  template_name: string;
  program_id: string | null;
  program_name: string | null;
  sub_tag: string | null;
}

interface RowVM {
  session: Session;
  sets: Awaited<ReturnType<typeof listSetsBySession>>;
  triple: SessionLinkedTriple | null;
  tplColor: string;
  sameDayIds: string[];
  /** Count of OTHER sessions on the same date (sameDayIds.length - 1). */
  extraSameDay: number;
}

/**
 * Truncate `formatTrainingDuration` output to the minute label only
 * (e.g. `64'` from `64' 23"`, `1 hr 2' 05"` → `1 hr 2'`). Matches the
 * compact subtitle slot in ADR-0015 lines 31-32 — we don't have room for
 * the seconds suffix alongside 動作數 / 週期 / 強度.
 */
function formatDurationMinuteOnly(seconds: number): string {
  const full = formatTrainingDuration(seconds);
  // formatTrainingDuration produces: `M' SS"` or `H hr M' SS"`. Drop SS".
  return full.replace(/ \d{2}"$/, '');
}

/** Session title fallback per ADR-0014 + task spec. */
function deriveTitleParts(
  session: Session,
  triple: SessionLinkedTriple | null
): { text: string; isFreestyle: boolean } {
  // `session.title` (ADR-0014) is not yet in the schema as of this branch —
  // read defensively (via `unknown` cast) so the view works pre-and-post
  // migration without requiring a Session type widen.
  const maybeTitle = (session as unknown as { title?: unknown }).title;
  const rawTitle = typeof maybeTitle === 'string' ? maybeTitle.trim() : '';
  const isFreestyle = triple == null;
  if (isFreestyle) {
    return { text: rawTitle.length > 0 ? rawTitle : t('domain', 'freestyle'), isFreestyle: true };
  }
  // Template-based: prefer session.title; fallback to linked template name.
  return {
    text: rawTitle.length > 0 ? rawTitle : triple.template_name,
    isFreestyle: false,
  };
}

function formatDateParts(ms: number): { primary: string; year: string } {
  const d = new Date(ms);
  const m = d.getMonth() + 1;
  const day = String(d.getDate()).padStart(2, '0');
  return { primary: `${m}-${day}`, year: String(d.getFullYear()) };
}

export default function ListView() {
  const db = useDatabase();
  const router = useRouter();
  const [rows, setRows] = useState<RowVM[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const fresh = await loadInto(db);
        if (!cancelled) setRows(fresh);
      })();
      return () => {
        cancelled = true;
      };
    }, [db])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const fresh = await loadInto(db);
      setRows(fresh);
    } finally {
      setRefreshing(false);
    }
  }, [db]);

  const onRowPress = useCallback(
    (item: RowVM) => {
      const csv = item.sameDayIds.join(',');
      router.push(`/session/${item.session.id}?sameDayIds=${csv}`);
    },
    [router]
  );

  return (
    <FlatList
      data={rows}
      keyExtractor={(item) => item.session.id}
      contentContainerStyle={
        rows.length === 0 ? styles.emptyContent : styles.listContent
      }
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListEmptyComponent={
        <Text style={styles.emptyText}>{t('status', 'noSessionsYetHint')}</Text>
      }
      renderItem={({ item }) => <Row vm={item} onPress={onRowPress} />}
    />
  );
}

// Extracted as a free fn so both useFocusEffect (with cancel-flag) and
// pull-to-refresh share the same query path without closure-identity churn.
async function loadInto(
  db: ReturnType<typeof useDatabase>
): Promise<RowVM[]> {
  const sessions = await listSessions(db);
  const enriched = await Promise.all(
    sessions.map(async (session) => {
      const sets = await listSetsBySession(db, session.id);
      const triple = await getSessionLinkedTemplateTriple(db, session.id);
      let tplColor = FREESTYLE_COLOR;
      if (triple) {
        const tpl = await getTemplateFull(db, triple.template_id);
        if (tpl && tpl.color_hex && tpl.color_hex.length > 0) {
          tplColor = tpl.color_hex;
        }
      }
      return { session, sets, triple, tplColor };
    })
  );

  const grouped = groupSessionsByDate(sessions);
  const sameDayMap = buildSameDayIdMap(grouped);

  return enriched.map((e) => {
    const sameDayIds = sameDayMap.get(e.session.id) ?? [e.session.id];
    return {
      ...e,
      sameDayIds,
      extraSameDay: Math.max(0, sameDayIds.length - 1),
    };
  });
}

interface RowProps {
  vm: RowVM;
  onPress: (vm: RowVM) => void;
}

function Row({ vm, onPress }: RowProps) {
  const { session, sets, triple, tplColor, extraSameDay } = vm;
  const { primary: dateMD, year: dateYear } = formatDateParts(session.started_at);

  const titleParts = deriveTitleParts(session, triple);
  const titleSuffix = extraSameDay > 0 ? ` +${extraSameDay}` : '';

  const program = triple?.program_name ?? t('common', 'default');
  const subTag = triple?.sub_tag ?? t('common', 'default');

  // For 動作數: prefer unique exercise_id over raw set count (mirrors detail
  // page #47 fix). When sets is empty (in-progress / discarded plan), still
  // shows 0 — that's the correct semantic.
  const exerciseCount = countUniqueExercises(sets);

  // 訓練時間: ended sessions use the recorded duration; in-progress falls
  // back to "now - started_at" so the row stays meaningful while the user is
  // mid-training. listSessions includes both ended + in-progress so we have
  // to handle the null gracefully.
  const endTs = session.ended_at ?? Date.now();
  const durationSec = Math.max(0, Math.floor((endTs - session.started_at) / 1000));
  const durationLabel = formatDurationMinuteOnly(durationSec);

  const volumeKg = computeSessionVolume(
    sets.map((s) => ({
      set_kind: s.set_kind,
      is_logged: s.is_logged,
      weight_kg: s.weight_kg,
      reps: s.reps,
    }))
  );
  const volumeRounded = Math.round(volumeKg);

  const titleStyles = [
    styles.title,
    titleParts.isFreestyle && styles.titleFreestyle,
  ];

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onPress(vm)}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      {/* Color side bar */}
      <View style={[styles.sideBar, { backgroundColor: tplColor }]} />

      {/* Date column */}
      <View style={styles.dateCol}>
        <Text style={styles.dateMD}>{dateMD}</Text>
        <Text style={styles.dateYear}>{dateYear}</Text>
      </View>

      {/* Main column: title + subtitle */}
      <View style={styles.mainCol}>
        <Text style={titleStyles} numberOfLines={1}>
          {titleParts.isFreestyle ? '⚠️ ' : ''}
          {titleParts.text}
          {titleSuffix}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {program} · {subTag} · {tNExerciseCount(exerciseCount)} · {durationLabel}
        </Text>
      </View>

      {/* Right column: volume kg */}
      <View style={styles.volCol}>
        <Text style={styles.volNumber}>{volumeRounded}</Text>
        <Text style={styles.volUnit}>kg</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 8,
  },
  emptyContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyText: { fontSize: 15, opacity: 0.6, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    backgroundColor: 'rgba(127,127,127,0.08)',
    borderRadius: 10,
    overflow: 'hidden',
    minHeight: 64,
    alignItems: 'stretch',
  },
  rowPressed: { opacity: 0.85 },
  sideBar: {
    width: 6,
    alignSelf: 'stretch',
  },
  dateCol: {
    width: 56,
    paddingVertical: 10,
    paddingLeft: 10,
    paddingRight: 4,
    justifyContent: 'center',
  },
  dateMD: { fontSize: 16, fontWeight: '700', color: '#111827' },
  dateYear: { fontSize: 11, color: '#6B7280', marginTop: 1 },
  mainCol: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    justifyContent: 'center',
    gap: 2,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  titleFreestyle: { color: '#6B7280' },
  subtitle: {
    fontSize: 12,
    color: '#6B7280',
  },
  volCol: {
    minWidth: 72,
    paddingVertical: 10,
    paddingRight: 14,
    paddingLeft: 4,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  volNumber: { fontSize: 17, fontWeight: '700', color: '#111827' },
  volUnit: { fontSize: 11, color: '#6B7280', marginTop: 1 },
});
