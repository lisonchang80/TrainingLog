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

import { SwipeableSetRow } from '@/components/shared/swipeable-set-row';
import { useDatabase } from '@/components/database-provider';
import { StartTemplateSheet } from '@/components/templates/start-template-sheet';
import {
  t,
  tDeleteAllTemplateVariants,
  tDeletePrompt,
  tDeleteTemplateVariant,
} from '@/src/i18n';
import {
  cloneTemplateWithSubTag,
  createTemplate,
  deleteTemplate,
  findTemplateByTriple,
  listDistinctSubTags,
  listTemplateGroupsByName,
  listTemplateVariantsByName,
  type TemplateSummary,
} from '@/src/adapters/sqlite/templateRepository';
import {
  createProgram,
  listPrograms,
} from '@/src/adapters/sqlite/programRepository';
import { RESERVED_NONE_PROGRAM_ID } from '@/src/db/seed/v017ProgramNone';
import { utcMsToIsoDate } from '@/src/domain/program/programManager';
import { planResolveTarget } from '@/src/domain/template/resolveTargetTemplate';
import { formatTemplateTriple } from '@/src/domain/template/templateManager';
import { isTemplateDeletable } from '@/src/domain/template/templateOps';
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
    // Round 41 polish (Q1 = B): Templates tab list view dedupes by name —
    // 一個 name 一條 row，視覺不再被 4 個同名 (program, sub_tag) clone 霸占。
    // 用戶 tap row 進 start sheet 後再透過 (計劃, 強度) radio 選具體 identity，
    // onStart 的 lookup-or-spawn (round 38) 接住具體 sibling。
    const list = await listTemplateGroupsByName(db);
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
        t('alert', 'cannotCreateTemplate'),
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
        t('alert', 'cannotOpen'),
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setBusy(false);
    }
  };

  const closeSheet = () => setSheetTemplate(null);

  /**
   * Slice 10c overnight #54 — swipe-to-delete handler for the Templates tab
   * list. Because the list dedupes by name (`listTemplateGroupsByName` round
   * 41), one row stands in for an entire ADR-0003 三元組 sibling group. The
   * UX「左滑刪除一行」expects to nuke the whole group, not just the
   * representative — partial deletion would leave orphans visible only via
   * the start-sheet's lookup-or-spawn, surprising the user.
   *
   * Gate (mirrors #46 isTemplateDeletable rule): if ANY sibling in the group
   * is a 通用 variant (program_id IS NULL OR sub_tag IS NULL), the whole
   * group is non-deletable from this entry point — those variants are the
   * 3-tier prefill resolver's base fallback (slice 10c #35) and we don't
   * want them silently disappearing as collateral. The user can still drill
   * into the editor for a concrete sibling and use the editor menu path
   * (#44) which targets a single triple variant.
   *
   * Confirm Alert enumerates every variant's triple (mirror #44 editor
   * menu UX) so the user sees exactly what will be deleted. On confirm we
   * await each `deleteTemplate(db, id)` sequentially — each one already
   * runs its own transaction (template_set → template_exercise → template
   * + session_exercise.template_id NULL cleanup for ENDED sessions).
   */
  const onSwipeDeleteGroup = async (item: TemplateSummary) => {
    setBusy(true);
    let variants: Awaited<ReturnType<typeof listTemplateVariantsByName>> = [];
    let programOptions: ProgramOption[] = [];
    try {
      const [variantList, programSummaries] = await Promise.all([
        listTemplateVariantsByName(db, item.name),
        listPrograms(db),
      ]);
      variants = variantList;
      programOptions = programSummaries.map((p) => ({ id: p.id, name: p.name }));
    } catch (e) {
      setBusy(false);
      Alert.alert(
        t('alert', 'cannotReadTemplate'),
        e instanceof Error ? e.message : String(e),
      );
      return;
    } finally {
      setBusy(false);
    }

    if (variants.length === 0) {
      // Defensive: list row exists but DB query found nothing (race with
      // another delete). Just refresh the list so the row disappears.
      await load();
      return;
    }

    // Gate — any 通用 variant in the group blocks the swipe delete. We
    // already disabled the swipe at the row level, but double-check here
    // in case a sibling was added between list load and tap.
    const groupHasUniversal = variants.some(
      (v) => !isTemplateDeletable({ program_id: v.program_id, sub_tag: v.sub_tag })
    );
    if (groupHasUniversal) {
      Alert.alert(
        t('alert', 'cannotDelete'),
        t('alert', 'defaultVariantUndeletable'),
      );
      return;
    }

    const tripleLines = variants
      .map((v) => {
        const programName = v.program_id
          ? programOptions.find((p) => p.id === v.program_id)?.name ?? t('common', 'default')
          : null;
        return `  • ${formatTemplateTriple(programName, v.sub_tag)}`;
      })
      .join('\n');
    const body =
      variants.length === 1
        ? tDeleteTemplateVariant(item.name, tripleLines.trim().replace(/^•\s*/, ''))
        : tDeleteAllTemplateVariants(item.name, variants.length, tripleLines);

    Alert.alert(tDeletePrompt(item.name), body, [
      { text: t('common', 'cancel'), style: 'cancel' },
      {
        text: t('common', 'delete'),
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            for (const v of variants) {
              await deleteTemplate(db, v.id);
            }
            await load();
          } catch (e) {
            Alert.alert(
              t('alert', 'deleteFailed'),
              e instanceof Error ? e.message : String(e),
            );
            // Best-effort reload so partial successes are reflected.
            await load();
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

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
  ): Promise<void> => {
    if (!sheetTemplate) {
      throw new Error('NO_SHEET_TEMPLATE');
    }
    await cloneTemplateWithSubTag(db, {
      source_template_id: sheetTemplate.id,
      new_program_id: program_id,
      new_sub_tag: sub_tag,
      uuid: randomUUID,
    });
    // Refresh the templates list so the clone shows up in the tab. We don't
    // re-open the sheet — the sheet itself owns the active pointer now.
    await load();
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
   * Lookup-or-spawn rule shared by onStart + onEdit. Returns the template_id
   * of the sibling matching (sheetTpl.name, period_id, intensity_id). Caller
   * decides what to do with it (startSessionFromTemplate vs router.push).
   *
   * Branching delegated to the pure planner `planResolveTarget` (see
   * `src/domain/template/resolveTargetTemplate.ts`):
   *
   *   - matchesSelf → sheetTpl.id (no DB work)
   *   - findTemplateByTriple hit → sibling's id
   *   - miss (any case, 通用 or 非通用) → fallback to sheetTpl.id +
   *     Alert「尚未建立模板、啟用最新模板」(#50 simplification, was
   *     spawn-on-miss for 非通用 pre-#50)
   *   - spawn 新 variant 改由 sheet「+新增強度 / +新增計畫」inline
   *     「建立」明示觸發 (`handleCloneTemplateWithNewSubTag`)
   *
   * Why route picking an EXISTING sub_tag chip through lookup too: without
   * this, picking 「TEST-1」 from Smoke (program=A) would still target
   * Smoke's row, and downstream 「儲存模板」 would silently overwrite Smoke
   * — exactly the regression #37 left open. Round 42 makes onEdit symmetric:
   * the same drift bites the editor route too once list dedupes by name.
   *
   * **overnight #48 fix**: pre-#48 wantedProgramId === null short-circuited
   * to sheetTpl.id immediately (bypassed lookup). After list-dedupe-by-name
   * (#41), sheetTpl is the **representative** (e.g. (Smoke, TEST_id, TEST-4))
   * regardless of which sub_tag was selected, so selecting ●通用 always
   * opened the representative editor — not the (Smoke, NULL, *) sibling.
   * Fix: lookup runs unconditionally; only the 通用-miss branch falls back.
   */
  const resolveTargetTemplateId = useCallback(
    async (
      sheetTpl: TemplateSummary,
      selection: { period_id: string; intensity_id: string | null },
    ): Promise<{
      template_id: string;
      alert?: { title: string; body: string };
    }> => {
      const sourceProgramId = sheetTpl.program_id ?? null;
      const sourceSubTag = sheetTpl.sub_tag ?? null;
      const isNoneProgram = selection.period_id === RESERVED_NONE_PROGRAM_ID;
      const wantedProgramId = isNoneProgram ? null : selection.period_id;
      const wantedSubTag = selection.intensity_id;

      // #48 fix: matchesSelf path remains synchronous; everything else needs
      // an explicit lookup (including the 通用 case that pre-fix bypassed).
      const source = {
        id: sheetTpl.id,
        name: sheetTpl.name,
        program_id: sourceProgramId,
        sub_tag: sourceSubTag,
      };
      const sel = {
        wanted_program_id: wantedProgramId,
        wanted_sub_tag: wantedSubTag,
      };

      // Probe lookup even for 通用 case so #48 bug doesn't recur. matchesSelf
      // short-circuit is inside the planner — but we still need to skip the
      // DB roundtrip when we already know we're staying on the same row.
      const matchesSelf =
        sourceProgramId === wantedProgramId && sourceSubTag === wantedSubTag;
      const found = matchesSelf
        ? null
        : await findTemplateByTriple(db, {
            name: sheetTpl.name,
            program_id: wantedProgramId,
            sub_tag: wantedSubTag,
          });

      const plan = planResolveTarget(source, sel, found);

      switch (plan.kind) {
        case 'use_self':
        case 'use_sibling':
          return { template_id: plan.template_id };
        case 'fallback_with_alert':
          return { template_id: plan.template_id, alert: plan.alert };
      }
    },
    [db],
  );

  /**
   * [編輯模板] handler — round 42 polish: lookup-or-spawn rule, symmetric
   * with onStart. Without this, list dedupe (round 41) makes the sheet's
   * representative row stand in for every sibling, so tapping a row and
   * picking any (計劃, 強度) would always open the representative's editor
   * regardless of the selection.
   *
   * Race-resilient via shared `resolveTargetTemplateId`. We defer
   * `closeSheet()` until after the lookup so a thrown error keeps the sheet
   * open (no editor opens, no orphaned UI). `setBusy(true)` locks the UI
   * for the spawn duration, mirroring onStart.
   */
  const onEdit = async (selection: {
    period_id: string;
    intensity_id: string | null;
  }) => {
    if (!sheetTemplate) return;
    setBusy(true);
    try {
      await persistSticky(selection.period_id, selection.intensity_id);
      const resolved = await resolveTargetTemplateId(sheetTemplate, selection);
      closeSheet();
      // #50 — fallback 路徑（任 miss 都走 fallback to representative + Alert）。
      // 編輯器仍開啟、讓用戶在編輯器內按「另存」自行建立該變體。
      if (resolved.alert) {
        Alert.alert(resolved.alert.title, resolved.alert.body);
      }
      // #50 C1 — editor header 顯示用戶選的 (P, S) 而非 actual template 的 triple。
      // fallback 路徑下 editor 載入 representative 但 header 仍顯示用戶選擇，避免
      // 「我選通用、卻看到 representative 的 (Smoke, TEST-4)」的視覺錯位。
      // Sentinel `__none__` 區分「explicitly NULL」vs「no override」(undefined)；
      // RESERVED_NONE_PROGRAM_ID 已映射成 NULL，這裡再 encode 進 query。
      const dpidParam =
        selection.period_id === RESERVED_NONE_PROGRAM_ID
          ? '__none__'
          : encodeURIComponent(selection.period_id);
      const dstParam =
        selection.intensity_id === null
          ? '__none__'
          : encodeURIComponent(selection.intensity_id);
      router.push(
        `/template/${resolved.template_id}?dpid=${dpidParam}&dst=${dstParam}`,
      );
    } catch (e) {
      Alert.alert(
        t('alert', 'cannotOpenEditor'),
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setBusy(false);
    }
  };

  /**
   * [開始訓練] handler — round 38 polish: lookup-or-spawn rule (the final
   * piece replacing round 37's sheet-local `activeTemplateId`). Round 42
   * extracts the lookup-or-spawn body into `resolveTargetTemplateId` so
   * onEdit can share the same rule.
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
          t('alert', 'sessionAlreadyInProgress'),
          t('alert', 'endActiveSessionFirst'),
        );
        return;
      }
      await persistSticky(selection.period_id, selection.intensity_id);

      const resolved = await resolveTargetTemplateId(sheetTemplate, selection);

      // #48: onStart 對「通用變體尚未建立」case 不彈 Alert（spec「不動 onStart
      // logic」— 避免擴散 scope）。lookup-or-spawn 仍會自動套用、若 lookup hit
      // 該 sibling 會被使用、若 miss 才 fallback。
      // Round 35 — thread the (program, sub_tag) selection through so the
      // session's planned set rows can be prefilled from matching history
      // (priority tree: exact triple → P+通用 → P+any sub_tag → empty).
      await startSessionFromTemplate(db, {
        template_id: resolved.template_id,
        uuid: randomUUID,
        program_id: selection.period_id,
        sub_tag: selection.intensity_id,
      });
      closeSheet();
      router.replace('/');
    } catch (e) {
      Alert.alert(
        t('alert', 'cannotStartSession'),
        e instanceof Error ? e.message : String(e),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        {/* TODO(i18n): "Templates" plural page label — strings.page has no templates key yet */}
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
          {/* TODO(i18n): "+ New" header CTA — strings.button.newCta ('新建' / 'New') closest but lacks the "+" prefix */}
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
          // TODO(i18n): templates-tab empty hint — strings.alert.noTemplatesYet exists but copy differs.
          <Text style={styles.emptyText}>
            No templates yet — tap “+ New” to create your first one.
          </Text>
        }
        renderItem={({ item }) => (
          // overnight #54 — wrap each row in SwipeableSetRow (shared with
          // session set + cluster + template editor set, see ADR-0019 Q9).
          // Left swipe reveals 刪除; the handler enumerates variants + gates
          // 通用 groups + cascades via deleteTemplate. Representative-row gate
          // (item.program_id / item.sub_tag) is a cheap fast-path; the
          // handler re-verifies against the full sibling set so a sibling
          // added between load + tap can't sneak past.
          <SwipeableSetRow
            enabled={!busy}
            swipeLeftActions={[
              {
                key: 'delete',
                label: t('common', 'delete'),
                color: '#dc2626',
                onPress: () => onSwipeDeleteGroup(item),
              },
            ]}>
            <Pressable
              accessibilityRole="button"
              onPress={() => onRowPress(item)}
              disabled={busy}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
              <Text style={styles.rowName}>{item.name}</Text>
              {/* TODO(i18n): row meta — "{N} exercise{s} · edited {ts}" English-only, no helper yet */}
              <Text style={styles.rowDetails}>
                {item.exerciseCount} exercise{item.exerciseCount === 1 ? '' : 's'} ·{' '}
                edited {formatTimestamp(item.updated_at)}
              </Text>
            </Pressable>
          </SwipeableSetRow>
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
