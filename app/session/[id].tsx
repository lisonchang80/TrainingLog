import { randomUUID } from 'expo-crypto';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabase } from '@/components/database-provider';
import { TemplateMetaSheet } from '@/components/session/template-meta-sheet';
import {
  listPrograms,
  type ProgramSummary,
} from '@/src/adapters/sqlite/programRepository';
import {
  discardSession,
  getSession,
  listSessionExercisesWithName,
  type SessionExerciseRowWithName,
} from '@/src/adapters/sqlite/sessionRepository';
import {
  listSetsBySession,
  updateSetFields,
  type SessionSetWithExercise,
} from '@/src/adapters/sqlite/setRepository';
import { getReusableSupersetWithExercises } from '@/src/adapters/sqlite/supersetRepository';
import { convertSessionToTemplate } from '@/src/adapters/sqlite/templateRepository';
import type { ReusableSupersetWithExercises } from '@/src/domain/superset/types';
import type { Session } from '@/src/domain/session/types';
import {
  computeDetailPageStats,
  formatDurationHHMM,
} from '@/src/domain/session/sessionStats';
import { computeHistorySetLabels } from '@/src/domain/set/historySetLabel';

/**
 * Session detail page — ADR-0019 Q10 final layout (slice 10c session detail).
 *
 * Mirrors the Template editor's chrome pattern (header + scroll body +
 * sticky bottom action bar) but in read-mode by default. Reached from:
 *   - Today screen on End Session (router.push immediately after closing)
 *   - History tab on row tap (already-ended sessions, identical view)
 *
 * Layout (ADR-0019 Q10):
 *   - Header: title (session name or date fallback) + back button
 *   - 4-tile stats in Chinese: 訓練時間 / 容量 / 動作數 / 大卡
 *   - 動作清單: exercises + sets, read-only display by default; an
 *     [編輯訓練] toggle flips weight/reps into TextInputs and persists via
 *     updateSetFields on commit (blur).
 *   - 4-button sticky action bar:
 *       [編輯訓練] toggle edit mode
 *       [儲存模板] convertSessionToTemplate(mode='update') — overwrites
 *           the session's linked template if any, else creates + links.
 *       [另存模板] convertSessionToTemplate(mode='create') — always new
 *           template; doesn't touch any existing links.
 *       [刪除] confirm Alert → discardSession → router.back()
 *
 * Both 儲存模板 and 另存模板 prompt the user for a name via Alert.prompt
 * (iOS-only — on Android falls back to a default name based on date).
 *
 * Cluster rendering preserved from the prior implementation
 * (ADR-0018 v014 / buildClusters helper at bottom of file).
 */
export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useDatabase();
  const router = useRouter();
  const [session, setSession] = useState<SessionWithHK | null>(null);
  const [sets, setSets] = useState<SessionSetWithExercise[]>([]);
  const [sessionExercises, setSessionExercises] = useState<
    SessionExerciseRowWithName[]
  >([]);
  const [rsById, setRsById] = useState<
    Map<string, ReusableSupersetWithExercises>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);

  // 另存模板 bottom sheet state (2026-05-18). Sheet 在開啟時取一次 programs
  // 給 picker 用；sub_tags 由 sheet 內依選擇 program 動態查 (5/18 polish round 30).
  const [templateMetaSheetOpen, setTemplateMetaSheetOpen] = useState(false);
  const [programs, setPrograms] = useState<ProgramSummary[]>([]);
  const [templateMetaBusy, setTemplateMetaBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [s, ss, ses, hk] = await Promise.all([
        getSession(db, id),
        listSetsBySession(db, id),
        listSessionExercisesWithName(db, id),
        loadHealthkitColumns(db, id),
      ]);
      if (!s) {
        setError('Session not found.');
        setLoading(false);
        return;
      }
      setSession({ ...s, kcal: hk.kcal, avg_hr_bpm: hk.avg_hr_bpm });
      setSets(ss);
      setSessionExercises(ses);

      // Hydrate RS rows for any cluster that carries an rs_id (I6).
      const rsIds = new Set<string>();
      for (const e of ses) {
        if (e.reusable_superset_id) rsIds.add(e.reusable_superset_id);
      }
      if (rsIds.size > 0) {
        const entries: [string, ReusableSupersetWithExercises][] = [];
        for (const rsId of rsIds) {
          const rs = await getReusableSupersetWithExercises(db, rsId);
          if (rs) entries.push([rsId, rs]);
        }
        setRsById(new Map(entries));
      } else {
        setRsById(new Map());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [db, id]);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => {
    if (!session) return null;
    return computeDetailPageStats({
      session: {
        started_at: session.started_at,
        ended_at: session.ended_at,
        kcal: session.kcal,
      },
      exerciseCount: sessionExercises.length,
      sets: sets.map((s) => ({
        set_kind: s.set_kind,
        is_logged: s.is_logged,
        weight_kg: s.weight_kg,
        reps: s.reps,
      })),
    });
  }, [session, sessionExercises, sets]);

  const clusters = useMemo(
    () => buildClusters(sessionExercises, sets),
    [sessionExercises, sets]
  );

  // Build a unified ordered list of "items" for the 動作清單 section: each
  // item is either a solo session_exercise or a cluster block. Cluster
  // followers (parent_id NOT NULL) are absorbed into their parent's block
  // so we don't render them twice.
  const orderedItems = useMemo(
    () => buildOrderedItems(sessionExercises, clusters, sets),
    [sessionExercises, clusters, sets]
  );

  // Freestyle session = no row carries a template_id. session_exercise.
  // template_id 是 nullable string; null = Freestyle. 「儲存模板」(update mode)
  // 對 Freestyle 沒意義 → dim + disabled。「另存模板」(create mode) 永遠 enabled。
  const isFreestyle = useMemo(
    () => sessionExercises.every((se) => se.template_id == null),
    [sessionExercises]
  );

  const handleSetFieldChange = useCallback(
    async (set_id: string, patch: { weight_kg?: number; reps?: number }) => {
      try {
        await updateSetFields(db, set_id, patch);
        // Re-read sets to reflect the change.
        const refreshed = await listSetsBySession(db, id!);
        setSets(refreshed);
      } catch (e) {
        Alert.alert('更新失敗', e instanceof Error ? e.message : String(e));
      }
    },
    [db, id]
  );

  const handleSaveTemplate = useCallback(
    async (mode: 'update' | 'create') => {
      if (!session) return;
      const dateLabel = formatDateLabel(session.started_at);
      const defaultName = `Session ${dateLabel}`;

      // 2026-05-18: create mode (另存模板) → TemplateMetaSheet 引導 3 元組
      // (name + program_id + sub_tag)。update mode (儲存模板) 維持原本
      // Alert.prompt 改名流程 — update 不需要 3 元組，inherit linked
      // template 既有的 program/sub_tag。
      if (mode === 'create') {
        try {
          const progs = await listPrograms(db);
          setPrograms(progs);
        } catch (e) {
          Alert.alert('載入失敗', e instanceof Error ? e.message : String(e));
          return;
        }
        setTemplateMetaSheetOpen(true);
        return;
      }

      // mode === 'update' — 原本 Alert.prompt 流程不變。
      // Alert.prompt is iOS-only; on Android we fall back to the default name.
      if (typeof Alert.prompt === 'function') {
        Alert.prompt(
          '儲存模板',
          '將本場訓練結構覆寫到連結的模板（無連結則新建並綁定）',
          [
            { text: '取消', style: 'cancel' },
            {
              text: '儲存',
              onPress: async (name?: string) => {
                const trimmed = (name ?? '').trim() || defaultName;
                try {
                  await convertSessionToTemplate(db, {
                    session_id: id!,
                    template_name: trimmed,
                    mode,
                    uuid: randomUUID,
                  });
                  Alert.alert('已儲存', `模板「${trimmed}」已更新。`);
                } catch (e) {
                  Alert.alert(
                    '失敗',
                    e instanceof Error ? e.message : String(e)
                  );
                }
              },
            },
          ],
          'plain-text',
          defaultName
        );
      } else {
        // Android: skip prompt, use default name (UI lib could add a Modal
        // later; keep scope minimal for v1).
        Alert.alert(
          '儲存模板',
          `將以預設名稱「${defaultName}」儲存？`,
          [
            { text: '取消', style: 'cancel' },
            {
              text: '確定',
              onPress: async () => {
                try {
                  await convertSessionToTemplate(db, {
                    session_id: id!,
                    template_name: defaultName,
                    mode,
                    uuid: randomUUID,
                  });
                  Alert.alert('已儲存', `模板「${defaultName}」已更新。`);
                } catch (e) {
                  Alert.alert(
                    '失敗',
                    e instanceof Error ? e.message : String(e)
                  );
                }
              },
            },
          ]
        );
      }
    },
    [db, id, session]
  );

  const handleTemplateMetaConfirm = useCallback(
    async (args: {
      name: string;
      program_id: string | null;
      sub_tag: string | null;
    }) => {
      if (!session) return;
      const dateLabel = formatDateLabel(session.started_at);
      const defaultName = `Session ${dateLabel}`;
      const finalName = args.name.trim() || defaultName;
      setTemplateMetaBusy(true);
      try {
        await convertSessionToTemplate(db, {
          session_id: id!,
          template_name: finalName,
          mode: 'create',
          program_id: args.program_id,
          sub_tag: args.sub_tag,
          uuid: randomUUID,
        });
        setTemplateMetaSheetOpen(false);
        Alert.alert('已另存', `模板「${finalName}」已建立。`);
      } catch (e) {
        Alert.alert('失敗', e instanceof Error ? e.message : String(e));
      } finally {
        setTemplateMetaBusy(false);
      }
    },
    [db, id, session]
  );

  const handleDelete = useCallback(() => {
    Alert.alert(
      '刪除本訓練',
      '已記錄的 set 將全部刪除，無法復原。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '刪除',
          style: 'destructive',
          onPress: async () => {
            try {
              await discardSession(db, id!);
              router.back();
            } catch (e) {
              Alert.alert('刪除失敗', e instanceof Error ? e.message : String(e));
            }
          },
        },
      ]
    );
  }, [db, id, router]);

  const titleText = useMemo(() => {
    if (!session) return 'Session';
    return formatDateLabel(session.started_at);
  }, [session]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header — back btn + title */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.headerBackBtn}>
          <Text style={styles.headerBackText}>‹ 返回</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{titleText}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {loading ? (
          <Text style={styles.muted}>Loading…</Text>
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : !session || !stats ? (
          <Text style={styles.muted}>No data.</Text>
        ) : (
          <>
            <Text style={styles.timestamp}>
              {formatTimestamp(session.started_at)}
              {session.ended_at != null
                ? ` ~ ${formatTimestamp(session.ended_at)}`
                : ''}
            </Text>

            {/* 4-tile stats row */}
            <View style={styles.statsRow}>
              <Stat
                label="訓練時間"
                value={formatDurationHHMM(stats.durationMs)}
              />
              <Stat label="容量" value={formatVolume(stats.volume)} />
              <Stat label="動作數" value={String(stats.exerciseCount)} />
              <Stat
                label="大卡"
                value={stats.kcal == null ? '—' : String(Math.round(stats.kcal))}
              />
            </View>

            <Text style={styles.section}>動作清單</Text>
            {orderedItems.length === 0 ? (
              <Text style={styles.muted}>No exercises.</Text>
            ) : (
              orderedItems.map((item) => {
                if (item.kind === 'cluster') {
                  return (
                    <ClusterBlock
                      key={item.cluster.parent.id}
                      cluster={item.cluster}
                      rs={
                        item.cluster.parent.reusable_superset_id
                          ? rsById.get(
                              item.cluster.parent.reusable_superset_id
                            ) ?? null
                          : null
                      }
                    />
                  );
                }
                return (
                  <SoloExerciseBlock
                    key={item.exercise.id}
                    exercise={item.exercise}
                    sets={item.sets}
                    editMode={editMode}
                    onSetFieldChange={handleSetFieldChange}
                  />
                );
              })
            )}
          </>
        )}
      </ScrollView>

      {/* Bottom sticky 4-button action bar */}
      <View style={styles.actionBar}>
        <Pressable
          style={[styles.actionBtn, editMode && styles.actionBtnActive]}
          onPress={() => setEditMode((v) => !v)}>
          <Text
            style={[
              styles.actionBtnText,
              editMode && styles.actionBtnTextActive,
            ]}>
            {editMode ? '完成編輯' : '編輯訓練'}
          </Text>
        </Pressable>
        <Pressable
          style={[styles.actionBtn, isFreestyle && styles.actionBtnDisabled]}
          disabled={isFreestyle}
          onPress={() => handleSaveTemplate('update')}>
          <Text style={styles.actionBtnText}>儲存模板</Text>
        </Pressable>
        <Pressable
          style={styles.actionBtn}
          onPress={() => handleSaveTemplate('create')}>
          <Text style={styles.actionBtnText}>另存模板</Text>
        </Pressable>
        <Pressable
          style={styles.actionBtn}
          onPress={handleDelete}>
          <Text style={[styles.actionBtnText, styles.actionBtnTextDestructive]}>
            刪除
          </Text>
        </Pressable>
      </View>

      {/* 另存模板 bottom sheet (2026-05-18) */}
      <TemplateMetaSheet
        visible={templateMetaSheetOpen}
        defaultName={
          session ? `Session ${formatDateLabel(session.started_at)}` : 'Session'
        }
        programs={programs}
        onCancel={() => setTemplateMetaSheetOpen(false)}
        onConfirm={handleTemplateMetaConfirm}
        busy={templateMetaBusy}
      />
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Types & helpers
// ─────────────────────────────────────────────────────────────────────────

interface SessionWithHK extends Session {
  /** v016 column — null until HealthKit writes from slice 13 onwards. */
  kcal: number | null;
  /** v016 column — null until HealthKit writes from slice 13 onwards. */
  avg_hr_bpm: number | null;
}

async function loadHealthkitColumns(
  db: ReturnType<typeof useDatabase>,
  id: string
): Promise<{ kcal: number | null; avg_hr_bpm: number | null }> {
  // Separate query because the Session domain type doesn't yet model v016
  // columns. Defensive: if the columns don't exist (test DB migrating to a
  // lower version), the catch falls back to nulls.
  try {
    const row = await db.getFirstAsync<{
      kcal: number | null;
      avg_hr_bpm: number | null;
    }>(
      `SELECT kcal, avg_hr_bpm FROM session WHERE id = ?`,
      id
    );
    return {
      kcal: row?.kcal ?? null,
      avg_hr_bpm: row?.avg_hr_bpm ?? null,
    };
  } catch {
    return { kcal: null, avg_hr_bpm: null };
  }
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

function formatDateLabel(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

function formatVolume(volume: number): string {
  // Round to int; if > 9999 show k-style (e.g. 12.4k).
  if (volume >= 10000) {
    return `${(volume / 1000).toFixed(1)}k`;
  }
  return String(Math.round(volume));
}

// ─────────────────────────────────────────────────────────────────────────
// Solo exercise block (read-only / edit-mode)
// ─────────────────────────────────────────────────────────────────────────

function SoloExerciseBlock({
  exercise,
  sets,
  editMode,
  onSetFieldChange,
}: {
  exercise: SessionExerciseRowWithName;
  sets: SessionSetWithExercise[];
  editMode: boolean;
  onSetFieldChange: (
    set_id: string,
    patch: { weight_kg?: number; reps?: number }
  ) => void;
}) {
  // overnight #47 第 1 點: reuse history page's label helper so
  // warmup→「熱」、working→「1/2/3」、dropset→「D1/D2」 — and drop the
  // leading `#` from the rendered ordering column.
  const labelMap = useMemo(
    () =>
      computeHistorySetLabels(
        sets.map((s) => ({
          id: s.id,
          set_kind: s.set_kind,
          ordering: s.ordering,
        }))
      ),
    [sets]
  );
  return (
    <View style={styles.exCard}>
      <View style={styles.exHeader}>
        <Text style={styles.exName}>{exercise.exercise_name}</Text>
      </View>
      {sets.length === 0 ? (
        <Text style={styles.muted}>No sets recorded.</Text>
      ) : (
        <View style={styles.setsBox}>
          {sets.map((s) => (
            <SetRow
              key={s.id}
              label={labelMap.get(s.id) ?? ''}
              setRow={s}
              loadType={exercise.exercise_load_type}
              editMode={editMode}
              onSetFieldChange={onSetFieldChange}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function SetRow({
  label,
  setRow,
  loadType,
  editMode,
  onSetFieldChange,
}: {
  label: string;
  setRow: SessionSetWithExercise;
  loadType: 'loaded' | 'bodyweight' | 'assisted';
  editMode: boolean;
  onSetFieldChange: (
    set_id: string,
    patch: { weight_kg?: number; reps?: number }
  ) => void;
}) {
  const [weightDraft, setWeightDraft] = useState<string>(
    setRow.weight_kg == null ? '' : String(setRow.weight_kg)
  );
  const [repsDraft, setRepsDraft] = useState<string>(
    setRow.reps == null ? '' : String(setRow.reps)
  );

  // Sync local draft state when the row changes underneath us (e.g. after a
  // commit re-reads from DB).
  useEffect(() => {
    setWeightDraft(setRow.weight_kg == null ? '' : String(setRow.weight_kg));
    setRepsDraft(setRow.reps == null ? '' : String(setRow.reps));
  }, [setRow.weight_kg, setRow.reps]);

  const commitWeight = useCallback(() => {
    const n = Number(weightDraft);
    if (Number.isFinite(n) && n !== setRow.weight_kg) {
      onSetFieldChange(setRow.id, { weight_kg: n });
    }
  }, [weightDraft, setRow.weight_kg, setRow.id, onSetFieldChange]);

  const commitReps = useCallback(() => {
    const n = Number(repsDraft);
    if (Number.isFinite(n) && Number.isInteger(n) && n !== setRow.reps) {
      onSetFieldChange(setRow.id, { reps: n });
    }
  }, [repsDraft, setRow.reps, setRow.id, onSetFieldChange]);

  if (editMode) {
    return (
      <View style={styles.setRow}>
        <Text style={styles.setOrdering}>{label}</Text>
        <View style={styles.setEditFields}>
          {loadType !== 'bodyweight' && (
            <>
              <TextInput
                value={weightDraft}
                onChangeText={setWeightDraft}
                onBlur={commitWeight}
                keyboardType="numeric"
                style={styles.setInput}
              />
              <Text style={styles.setUnit}>kg</Text>
            </>
          )}
          <TextInput
            value={repsDraft}
            onChangeText={setRepsDraft}
            onBlur={commitReps}
            keyboardType="numeric"
            style={styles.setInput}
          />
          <Text style={styles.setUnit}>reps</Text>
        </View>
        {setRow.is_logged === 1 && <Text style={styles.setCheck}>✓</Text>}
      </View>
    );
  }

  return (
    <View style={styles.setRow}>
      <Text style={styles.setOrdering}>{label}</Text>
      <Text style={styles.setText}>
        {formatSetCell(setRow, loadType)}
      </Text>
      {setRow.is_logged === 1 && <Text style={styles.setCheck}>✓</Text>}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Cluster grouping (ADR-0018 v014) — preserved from prior implementation
// ─────────────────────────────────────────────────────────────────────────

interface ClusterRow {
  parent: SessionExerciseRowWithName;
  child: SessionExerciseRowWithName;
  /** Sets belonging to the parent (A side), ordered by ordering ASC. */
  setsA: SessionSetWithExercise[];
  /** Sets belonging to the child (B side), ordered by ordering ASC. */
  setsB: SessionSetWithExercise[];
}

function buildClusters(
  sessionExercises: SessionExerciseRowWithName[],
  sets: SessionSetWithExercise[]
): ClusterRow[] {
  const parentIds = new Set<string>();
  for (const e of sessionExercises) {
    if (e.parent_id !== null) parentIds.add(e.parent_id);
  }
  const out: ClusterRow[] = [];
  for (const parent of sessionExercises) {
    if (!parentIds.has(parent.id)) continue;
    const child = sessionExercises.find((e) => e.parent_id === parent.id);
    if (!child) continue;
    // v019 isolation (slice 10c #17): scope per cluster card via
    // session_exercise_id when present; fall back to legacy exercise_id
    // for pre-v019 untagged rows.
    const setsA = sets
      .filter((s) =>
        s.session_exercise_id === parent.id ||
        (s.session_exercise_id == null && s.exercise_id === parent.exercise_id),
      )
      .sort((a, b) => a.ordering - b.ordering);
    const setsB = sets
      .filter((s) =>
        s.session_exercise_id === child.id ||
        (s.session_exercise_id == null && s.exercise_id === child.exercise_id),
      )
      .sort((a, b) => a.ordering - b.ordering);
    out.push({ parent, child, setsA, setsB });
  }
  return out;
}

type OrderedItem =
  | { kind: 'solo'; exercise: SessionExerciseRowWithName; sets: SessionSetWithExercise[] }
  | { kind: 'cluster'; cluster: ClusterRow };

function buildOrderedItems(
  sessionExercises: SessionExerciseRowWithName[],
  clusters: ClusterRow[],
  sets: SessionSetWithExercise[]
): OrderedItem[] {
  const clusterChildIds = new Set<string>();
  const clusterByParentId = new Map<string, ClusterRow>();
  for (const c of clusters) {
    clusterChildIds.add(c.child.id);
    clusterByParentId.set(c.parent.id, c);
  }
  const out: OrderedItem[] = [];
  for (const ex of sessionExercises) {
    // Skip cluster followers — they're rendered as part of their parent block.
    if (clusterChildIds.has(ex.id)) continue;
    const cluster = clusterByParentId.get(ex.id);
    if (cluster) {
      out.push({ kind: 'cluster', cluster });
      continue;
    }
    // Solo exercise.
    // v019 isolation (slice 10c #17): scope per card via session_exercise_id
    // so two cards sharing an exercise_id don't mirror each other's rows.
    const exSets = sets
      .filter((s) =>
        s.session_exercise_id === ex.id ||
        (s.session_exercise_id == null && s.exercise_id === ex.exercise_id),
      )
      .sort((a, b) => a.ordering - b.ordering);
    out.push({ kind: 'solo', exercise: ex, sets: exSets });
  }
  return out;
}

function ClusterBlock({
  cluster,
  rs,
}: {
  cluster: ClusterRow;
  rs: ReusableSupersetWithExercises | null;
}) {
  const color = rs?.superset.color_hex ?? '#9aa0a6';
  const rowCount = Math.max(cluster.setsA.length, cluster.setsB.length);
  const rows = Array.from({ length: rowCount }).map((_, i) => ({
    a: cluster.setsA[i] ?? null,
    b: cluster.setsB[i] ?? null,
  }));
  return (
    <View
      style={[
        styles.clusterCard,
        { borderColor: color, backgroundColor: hexAlpha(color, 0.08) },
      ]}>
      <View style={styles.clusterHeader}>
        <View style={[styles.clusterDot, { backgroundColor: color }]} />
        <Text style={styles.clusterLabel}>
          {cluster.parent.exercise_name} · {cluster.child.exercise_name}
        </Text>
      </View>
      {rows.length === 0 ? (
        <Text style={styles.muted}>No sets recorded.</Text>
      ) : (
        rows.map((r, i) => (
          <View key={i} style={styles.clusterPairRow}>
            <Text style={styles.clusterCycle}>{i + 1}</Text>
            <View style={styles.clusterCell}>
              {r.a ? (
                <Text style={styles.clusterCellText}>
                  A: {formatSetCell(r.a, cluster.parent.exercise_load_type)}
                </Text>
              ) : (
                <Text style={styles.clusterCellEmpty}>A: —</Text>
              )}
            </View>
            <View style={styles.clusterCell}>
              {r.b ? (
                <Text style={styles.clusterCellText}>
                  B: {formatSetCell(r.b, cluster.child.exercise_load_type)}
                </Text>
              ) : (
                <Text style={styles.clusterCellEmpty}>B: —</Text>
              )}
            </View>
            {(r.a?.is_logged === 1 || r.b?.is_logged === 1) && (
              <Text style={styles.setCheck}>✓</Text>
            )}
          </View>
        ))
      )}
    </View>
  );
}

function formatSetCell(
  s: SessionSetWithExercise,
  load_type: 'loaded' | 'bodyweight' | 'assisted'
): string {
  if (load_type === 'bodyweight') return `BW × ${s.reps}`;
  if (load_type === 'assisted') return `-${s.weight_kg} kg × ${s.reps}`;
  return `${s.weight_kg} kg × ${s.reps}`;
}

function hexAlpha(hex: string, alpha: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  const a = Math.max(0, Math.min(255, Math.round(alpha * 255)))
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

// ─────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(127,127,127,0.2)',
    gap: 8,
  },
  headerBackBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  headerBackText: { fontSize: 15, color: '#007AFF' },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  headerSpacer: { width: 60 },
  body: { padding: 16, gap: 12, paddingBottom: 100 },
  timestamp: { fontSize: 13, opacity: 0.65 },

  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 8,
  },
  stat: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(127,127,127,0.10)',
    alignItems: 'center',
  },
  statValue: { fontSize: 18, fontWeight: '700' },
  statLabel: { fontSize: 11, opacity: 0.65, marginTop: 4 },
  section: { fontSize: 14, fontWeight: '600', marginTop: 12, color: '#6B7280' },

  exCard: {
    // overnight #47 第 2 點: 細灰 border + 白底，mirror cluster card 外框
    // style 對齊。原本淺灰底 0.08 alpha → 純白 + hairline border。
    borderRadius: 10,
    backgroundColor: '#fff',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(127,127,127,0.3)',
    overflow: 'hidden',
    marginTop: 8,
  },
  exHeader: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  exName: { fontSize: 15, fontWeight: '600' },
  setsBox: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(127,127,127,0.15)',
    paddingTop: 8,
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  setOrdering: { fontSize: 13, opacity: 0.6, width: 28 },
  setText: { flex: 1, fontSize: 14 },
  setEditFields: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  setInput: {
    minWidth: 50,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(127,127,127,0.4)',
    fontSize: 14,
  },
  setUnit: { fontSize: 12, opacity: 0.6 },
  setCheck: { fontSize: 16, color: '#34C759', fontWeight: '600' },

  // Cluster block (preserved from prior I1/I6 visual decisions)
  clusterCard: {
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  clusterHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  clusterDot: { width: 10, height: 10, borderRadius: 5 },
  clusterLabel: { fontSize: 14, fontWeight: '600' },
  clusterPairRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  clusterCycle: { fontSize: 12, opacity: 0.6, width: 24 },
  clusterCell: { flex: 1 },
  clusterCellText: { fontSize: 13 },
  clusterCellEmpty: { fontSize: 13, opacity: 0.3 },

  // Bottom sticky 4-button action bar (mirrors template-editor pattern)
  actionBar: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 10,
    gap: 6,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(127,127,127,0.2)',
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(0,122,255,0.10)',
    alignItems: 'center',
  },
  actionBtnActive: { backgroundColor: 'rgba(0,122,255,0.25)' },
  actionBtnDisabled: { opacity: 0.4 },
  actionBtnText: { fontSize: 13, fontWeight: '600', color: '#007AFF' },
  actionBtnTextActive: { color: '#0050B3' },
  actionBtnTextDestructive: { color: '#FF3B30' },

  muted: { fontSize: 14, opacity: 0.6 },
  error: { fontSize: 14, color: '#dc3545' },
});
