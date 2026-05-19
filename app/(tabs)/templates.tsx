import { randomUUID } from 'expo-crypto';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabase } from '@/components/database-provider';
import { StartTemplateSheet } from '@/components/templates/start-template-sheet';
import {
  cloneTemplateWithSubTag,
  createTemplate,
  findTemplateByTriple,
  listDistinctSubTags,
  listTemplates,
  type TemplateSummary,
} from '@/src/adapters/sqlite/templateRepository';
import {
  createProgram,
  listPrograms,
} from '@/src/adapters/sqlite/programRepository';
import { RESERVED_NONE_PROGRAM_ID } from '@/src/db/seed/v017ProgramNone';
import { utcMsToIsoDate } from '@/src/domain/program/programManager';
import {
  getSetting,
  setSetting,
} from '@/src/adapters/sqlite/settingsRepository';
import { startSessionFromTemplate } from '@/src/adapters/sqlite/sessionFromTemplate';
import { getActiveSession } from '@/src/adapters/sqlite/sessionRepository';
import type { ProgramOption } from '@/src/domain/program/resolveProgramDefaults';

/**
 * Sticky-state keys for the start-template bottom sheet
 * (ADR-0019 §Q9.1a + Q9.2 FB1). Stored via the existing app_settings JSON
 * helper — no new schema column needed.
 */
const LAST_PROGRAM_KEY = 'start_dialog_last_program_id';
const LAST_SUB_TAG_KEY = 'start_dialog_last_sub_tag';

/**
 * Templates tab — list of saved Templates, newest-edited first.
 *
 * Tap a row → 週期/強度 bottom sheet (ADR-0019 §Q9.1a) → either
 *   [編輯模板]  → router.push('/template/{id}')                 (existing route)
 *   [開始訓練]  → startSessionFromTemplate(db, …) → router.replace('/')
 *
 * Tap "+ New" → create an empty template, then push the editor.
 */
export default function TemplatesScreen() {
  const db = useDatabase();
  const router = useRouter();
  const [rows, setRows] = useState<TemplateSummary[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  // Bottom sheet state — the tapped template + the picker option lists.
  const [sheetTemplate, setSheetTemplate] = useState<TemplateSummary | null>(
    null,
  );
  const [programs, setPrograms] = useState<ProgramOption[]>([]);
  const [subTags, setSubTags] = useState<string[]>([]);
  const [lastUsedProgramId, setLastUsedProgramId] = useState<string | null>(
    null,
  );
  const [lastUsedSubTag, setLastUsedSubTag] = useState<string | null>(null);

  const load = useCallback(async () => {
    const list = await listTemplates(db);
    setRows(list);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const onCreate = async () => {
    setBusy(true);
    try {
      const id = randomUUID();
      await createTemplate(db, { id, name: 'New Template' });
      router.push(`/template/${id}`);
    } catch (e) {
      Alert.alert(
        'Could not create template',
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setBusy(false);
    }
  };

  /**
   * Tap row → load picker data + open sheet. Loading happens inline (not on
   * mount) so the lists reflect any program / template edits the user made
   * between visits.
   */
  const onRowPress = async (item: TemplateSummary) => {
    setBusy(true);
    try {
      const [programSummaries, distinctSubTags, lastProgram, lastTag] =
        await Promise.all([
          listPrograms(db),
          listDistinctSubTags(db),
          getSetting<string>(db, LAST_PROGRAM_KEY),
          getSetting<string>(db, LAST_SUB_TAG_KEY),
        ]);
      setPrograms(
        programSummaries.map((p) => ({ id: p.id, name: p.name })),
      );
      setSubTags(distinctSubTags);
      setLastUsedProgramId(lastProgram);
      setLastUsedSubTag(lastTag);
      setSheetTemplate(item);
    } catch (e) {
      Alert.alert(
        '無法開啟',
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setBusy(false);
    }
  };

  const closeSheet = () => setSheetTemplate(null);

  /**
   * Inline「新增計畫」handler — creates a minimal Program (name + ADR-0004
   * minimum defaults), refreshes the parent's `programs` state so the new
   * option shows up in the picker, and returns {id, name} so the sheet can
   * auto-select it. User can edit the full cycle structure later from the
   * Program editor page. Mirrors template-meta-sheet round 30 minimal-defaults
   * pattern.
   */
  const handleCreateProgram = async (
    name: string,
  ): Promise<{ id: string; name: string }> => {
    const id = randomUUID();
    const today = utcMsToIsoDate(Date.now());
    await createProgram(db, {
      program: {
        id,
        name,
        main_tag: null,
        cycle_length: 3,
        cycle_count: 1,
        start_date: today,
        is_active: 0,
      },
    });
    setPrograms((prev) => [...prev, { id, name }]);
    return { id, name };
  };

  /**
   * Round 37 — spawn-on-create handler for the sheet's「新增強度」inline CTA.
   * Clones the currently-tapped template under (program_id, new sub_tag) and
   * returns the new id. The sheet then re-aims its `activeTemplateId` at the
   * clone so [編輯模板] / [開始訓練] hits the new row.
   *
   * Why clone-on-create rather than rename-on-finish: round 35 surfaced a
   * subtle bug where overwriting a session's linked template ignored the
   * user's mid-session sub_tag change and silently overwrote the original
   * (e.g. 「通用」). Spawning at sub_tag-add time aligns the linked-template
   * pointer with the user's intent up front.
   *
   * After spawning we refetch the templates list so the new row appears in
   * the Templates tab right away.
   */
  const handleCloneTemplateWithNewSubTag = async (
    sub_tag: string,
    program_id: string,
  ): Promise<{ template_id: string }> => {
    if (!sheetTemplate) {
      throw new Error('NO_SHEET_TEMPLATE');
    }
    const newId = await cloneTemplateWithSubTag(db, {
      source_template_id: sheetTemplate.id,
      new_program_id: program_id,
      new_sub_tag: sub_tag,
      uuid: randomUUID,
    });
    // Refresh the templates list so the clone shows up in the tab. We don't
    // re-open the sheet — the sheet itself owns the active pointer now.
    await load();
    return { template_id: newId };
  };

  const persistSticky = async (
    program_id: string,
    sub_tag: string | null,
  ): Promise<void> => {
    await setSetting<string>(db, LAST_PROGRAM_KEY, program_id);
    if (sub_tag != null) {
      await setSetting<string>(db, LAST_SUB_TAG_KEY, sub_tag);
    }
  };

  /**
   * [編輯模板] handler — closes sheet, persists sticky selection, then opens
   * the editor on the sheet's source template. Round 38 polish: edit still
   * targets the source row (no lookup-or-spawn) — editing under a different
   * (program, sub_tag) doesn't make sense without first deciding whether
   * the user intends to edit the source or a sibling; we route to source by
   * default and rely on the user to navigate from there.
   */
  const onEdit = async (selection: {
    period_id: string;
    intensity_id: string | null;
  }) => {
    if (!sheetTemplate) return;
    closeSheet();
    try {
      await persistSticky(selection.period_id, selection.intensity_id);
    } catch {
      // Sticky persistence is best-effort — don't block the edit flow.
    }
    router.push(`/template/${sheetTemplate.id}`);
  };

  /**
   * [開始訓練] handler — round 38 polish: lookup-or-spawn rule (the final
   * piece replacing round 37's sheet-local `activeTemplateId`).
   *
   * Rule, given (sheetTemplate, period_id, intensity_id):
   *   - If (period_id, intensity_id) matches the sheet template's own triple
   *     → start session from `sheetTemplate.id` (no spawn, no lookup).
   *   - Else if period_id === RESERVED_NONE_PROGRAM_ID (通用 program) →
   *     start from `sheetTemplate.id` (no spawn — we don't proliferate 通用
   *     variants; the triple-uniqueness boundary stays inside real programs).
   *   - Else probe `findTemplateByTriple(name, program_id, sub_tag)`:
   *       - hit  → start from the sibling's id (e.g. the clone spawned via
   *               「+ 新增強度」 inline earlier in this sheet open, or any
   *               pre-existing sibling under the same triple)
   *       - miss → `cloneTemplateWithSubTag` to spawn a fresh sibling, then
   *               refresh the templates list, then start from the new id.
   *
   * Why route picking an EXISTING sub_tag chip through lookup too: without
   * this, picking 「TEST-1」 from Smoke (program=A) would still send the
   * session at Smoke's row, and the later 「儲存模板」 would silently
   * overwrite Smoke — exactly the regression #37 left open.
   *
   * Race-resilient: if findTemplateByTriple misses but cloneTemplateWithSubTag
   * throws DUPLICATE_TEMPLATE_TRIPLE (concurrent insert), we re-probe once
   * before bubbling — the second probe almost always hits.
   *
   * Refuses if a session is already in progress (mirrors template editor's
   * onStartSession guard).
   */
  const onStart = async (selection: {
    period_id: string;
    intensity_id: string | null;
  }) => {
    if (!sheetTemplate) return;
    setBusy(true);
    try {
      const active = await getActiveSession(db);
      if (active) {
        Alert.alert(
          '已有進行中的訓練',
          '請先在「今日」分頁結束目前的訓練再開始新的。',
        );
        return;
      }
      await persistSticky(selection.period_id, selection.intensity_id);

      // Lookup-or-spawn the target template.
      let targetTemplateId = sheetTemplate.id;
      const sourceProgramId = sheetTemplate.program_id ?? null;
      const sourceSubTag = sheetTemplate.sub_tag ?? null;
      const isNoneProgram = selection.period_id === RESERVED_NONE_PROGRAM_ID;
      const wantedProgramId = isNoneProgram ? null : selection.period_id;
      const wantedSubTag = selection.intensity_id;

      const matchesSelf =
        sourceProgramId === wantedProgramId && sourceSubTag === wantedSubTag;

      if (!matchesSelf && !isNoneProgram && wantedProgramId !== null) {
        const found = await findTemplateByTriple(db, {
          name: sheetTemplate.name,
          program_id: wantedProgramId,
          sub_tag: wantedSubTag,
        });
        if (found) {
          targetTemplateId = found.id;
        } else {
          try {
            targetTemplateId = await cloneTemplateWithSubTag(db, {
              source_template_id: sheetTemplate.id,
              new_program_id: wantedProgramId,
              new_sub_tag: wantedSubTag,
              uuid: randomUUID,
            });
            // Refresh the templates list so the new clone shows up under
            // the Templates tab right after the session starts.
            await load();
          } catch (cloneErr) {
            // Race: findTemplateByTriple just missed but the dup guard
            // fired anyway (concurrent insert). Re-probe once before
            // bubbling so the user isn't blocked on a transient collision.
            const message =
              cloneErr instanceof Error
                ? cloneErr.message
                : String(cloneErr);
            if (message === 'DUPLICATE_TEMPLATE_TRIPLE') {
              const retry = await findTemplateByTriple(db, {
                name: sheetTemplate.name,
                program_id: wantedProgramId,
                sub_tag: wantedSubTag,
              });
              if (retry) {
                targetTemplateId = retry.id;
              } else {
                throw cloneErr;
              }
            } else {
              throw cloneErr;
            }
          }
        }
      }

      // Round 35 — thread the (program, sub_tag) selection through so the
      // session's planned set rows can be prefilled from matching history
      // (priority tree: exact triple → P+通用 → P+any sub_tag → empty).
      await startSessionFromTemplate(db, {
        template_id: targetTemplateId,
        uuid: randomUUID,
        program_id: selection.period_id,
        sub_tag: selection.intensity_id,
      });
      closeSheet();
      router.replace('/');
    } catch (e) {
      Alert.alert(
        '無法開始訓練',
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.heading}>Templates</Text>
        <Pressable
          accessibilityRole="button"
          onPress={onCreate}
          disabled={busy}
          style={({ pressed }) => [
            styles.newBtn,
            busy && styles.btnDisabled,
            pressed && styles.btnPressed,
          ]}>
          <Text style={styles.newBtnText}>+ New</Text>
        </Pressable>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerStyle={
          rows.length === 0 ? styles.emptyContent : styles.listContent
        }
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            No templates yet — tap “+ New” to create your first one.
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => onRowPress(item)}
            disabled={busy}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
            <Text style={styles.rowName}>{item.name}</Text>
            <Text style={styles.rowDetails}>
              {item.exerciseCount} exercise{item.exerciseCount === 1 ? '' : 's'} ·{' '}
              edited {formatTimestamp(item.updated_at)}
            </Text>
          </Pressable>
        )}
      />
      <StartTemplateSheet
        visible={sheetTemplate != null}
        templateName={sheetTemplate?.name ?? ''}
        programs={programs}
        subTags={subTags}
        lastUsedProgramId={lastUsedProgramId}
        lastUsedSubTag={lastUsedSubTag}
        onEdit={onEdit}
        onStart={onStart}
        onCreateProgram={handleCreateProgram}
        onCloneTemplateWithNewSubTag={handleCloneTemplateWithNewSubTag}
        onCancel={closeSheet}
      />
    </SafeAreaView>
  );
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    padding: 24,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heading: { fontSize: 28, fontWeight: '700' },
  newBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: '#0a7ea4',
  },
  newBtnText: { color: 'white', fontSize: 14, fontWeight: '600' },
  listContent: { paddingHorizontal: 24, paddingBottom: 24, gap: 8 },
  emptyContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyText: { fontSize: 15, opacity: 0.6, textAlign: 'center' },
  row: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: 'rgba(127,127,127,0.12)',
    gap: 4,
  },
  rowPressed: { opacity: 0.85 },
  rowName: { fontSize: 16, fontWeight: '600' },
  rowDetails: { fontSize: 13, opacity: 0.7 },
  btnDisabled: { opacity: 0.5 },
  btnPressed: { opacity: 0.85 },
});
