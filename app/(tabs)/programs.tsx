import { randomUUID } from 'expo-crypto';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker, {
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';

import { useDatabase } from '@/components/database-provider';
import {
  applyTagToRow,
  applyTemplateToColumn,
  countFilledCellsOutsideBounds,
  getActiveProgram,
  getProgram,
  listProgramSubTags,
  listPrograms,
  resizeProgram,
  setActiveProgram,
  swapProgramCells,
  updateProgramStartDate,
  upsertCell,
  type ProgramSummary,
} from '@/src/adapters/sqlite/programRepository';
import {
  createTemplate,
  listTemplateGroupsByName,
  listTemplates,
  type TemplateSummary,
} from '@/src/adapters/sqlite/templateRepository';
import type { ProgramCell, ProgramWithCells } from '@/src/domain/program/types';
import {
  buildCellMap,
  cellDate,
  distinctSubTagsInProgram,
  findNearestNonRestInRow,
  formatCellDateLabel,
} from '@/src/domain/program/programGridLayout';

/**
 * Programs tab — wave 15 (2026-05-21) full UX rewrite per user spec:
 *   1. Land on the active program's 計劃表 directly (no list-of-programs).
 *   2. Below title: program name.
 *   3. Top right: 「編輯」(toggle edit mode) + 「新建」(→ 6-step wizard).
 *   4. Edit mode: 3 dropdowns 計劃 / 循環天數 / 週期數 appear below the
 *      program name. 計劃 switches the active program; 循環天數 / 週期數
 *      resize the grid (with shrink-confirm Alert).
 *   5. Edit mode adds 套用 buttons: top row (per column, cycle_length 個)
 *      sets template-or-rest for that day_index; left column (per row,
 *      cycle_count 個) sets sub_tag for that cycle_index.
 *   6. Edit mode cell-level edits:
 *        - Tap template sub-cell → template picker (template_id update,
 *          preserves sub_tag).
 *        - Tap sub_tag sub-cell → sub_tag picker (preserves template_id).
 *        - Tap 休息 block → template picker with the nearest non-rest
 *          neighbour's template pre-highlighted; after pick, sub_tag is
 *          auto-set from same neighbour (Q5 (a) — same row nearest).
 *   7. Grid: cycle_count rows × cycle_length cols. Each cell has 3
 *      stacked sub-cells: 日期 / template name / 強度. Rest cells
 *      collapse the bottom 2 sub-cells into a merged 「休息」.
 *   8. Date is real (start_date + cycle_index * cycle_length + day_index
 *      days). `M/D` label inside the cell.
 *
 * Edge cases:
 *   - No programs at all → empty state with 「新建」 CTA.
 *   - Programs exist but none active → show the most-recently-updated as
 *     the "currently shown".
 */
const CYCLE_LENGTH_OPTIONS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const CYCLE_COUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10, 12];
const SUB_TAG_NONE_KEY = '__none__';
const SUB_TAG_NEW_KEY = '__new__';

type SimplePickerKind =
  | { kind: 'program' }
  | { kind: 'cycle_length' }
  | { kind: 'cycle_count' }
  | { kind: 'start_date' };

type TemplatePickerKind =
  | { kind: 'template_for_column'; day_index: number }
  | {
      kind: 'template_for_cell';
      cycle_index: number;
      day_index: number;
      /** Preserve when picking a non-rest template into an existing cell. */
      preset_sub_tag: string | null;
    };

type SubTagPickerKind =
  | { kind: 'sub_tag_for_row'; cycle_index: number }
  | {
      kind: 'sub_tag_for_cell';
      cycle_index: number;
      day_index: number;
      /** Need this so upsertCell preserves template_id. */
      current_template_id: string;
    };

type PickerState =
  | null
  | SimplePickerKind
  | TemplatePickerKind
  | SubTagPickerKind;

export default function ProgramsScreen() {
  const db = useDatabase();
  const router = useRouter();
  const [shown, setShown] = useState<ProgramWithCells | null>(null);
  const [allPrograms, setAllPrograms] = useState<ProgramSummary[]>([]);
  const [allTemplates, setAllTemplates] = useState<TemplateSummary[]>([]);
  const [templatesById, setTemplatesById] = useState<
    Record<string, TemplateSummary>
  >({});
  const [editing, setEditing] = useState(false);
  const [picker, setPicker] = useState<PickerState>(null);
  // Round 15 polish — picker 的強度 chip 列同時讀「cells 用過的強度」+「this
  // program 下所有 templates 的 sub_tag」。原本只看 cells，建立並導入剛寫進
  // template.sub_tag 但還沒套到 cell 的強度就不會出現在 picker。
  const [templateSubTagsForProgram, setTemplateSubTagsForProgram] = useState<
    string[]
  >([]);

  // ── Wave 17 (2026-05-21) — long-press-drag swap state ──────────────
  // Edit mode only: long-press 300ms on any cell → enter drag mode →
  // floating preview follows finger → release on target cell → swap
  // (template_id, sub_tag) between source and target. Dates stay fixed.
  // Hit-test uses absolute screen coords from `e.absoluteX/Y` against each
  // cell's `measureInWindow` rect stored in `cellLayoutsRef`.
  const [draggedSrc, setDraggedSrc] = useState<{
    cycle: number;
    day: number;
  } | null>(null);
  const [dragFinger, setDragFinger] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [hoverTarget, setHoverTarget] = useState<{
    cycle: number;
    day: number;
  } | null>(null);
  const cellLayoutsRef = useRef<
    Map<string, { x: number; y: number; w: number; h: number }>
  >(new Map());

  const refresh = useCallback(async () => {
    // - `tsAll` (all variants) → templatesById map so cells with any
    //   template_id (including non-representative siblings) can resolve their
    //   display name.
    // - `tsGrouped` (dedupe-by-name representative) → picker list so users
    //   only see distinct template names (mirror Templates tab list pattern).
    const [activeOrNull, all, tsAll, tsGrouped] = await Promise.all([
      getActiveProgram(db),
      listPrograms(db),
      listTemplates(db),
      listTemplateGroupsByName(db),
    ]);
    const map: Record<string, TemplateSummary> = {};
    for (const t of tsAll) map[t.id] = t;
    setTemplatesById(map);
    setAllPrograms(all);
    setAllTemplates(tsGrouped);
    let resolvedShown: ProgramWithCells | null = null;
    if (activeOrNull) {
      resolvedShown = activeOrNull;
    } else if (all.length > 0) {
      resolvedShown = await getProgram(db, all[0].id);
    }
    setShown(resolvedShown);
    // Round 15 polish — load the persistent label dictionary for this
    // program (`program_sub_tag` table, v022). The picker shows every
    // 強度 ever registered, including ones no cell currently uses (so
    // user can swap back to a prior label without re-typing).
    if (resolvedShown) {
      const tags = await listProgramSubTags(db, resolvedShown.program.id);
      setTemplateSubTagsForProgram(tags);
    } else {
      setTemplateSubTagsForProgram([]);
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  /**
   * Import-from-template-editor consume (round 15 polish).
   *
   * After 「+ 建立新模板」 → editor → 「建立並導入」, the editor pushes us back
   * here with apply* params. We:
   *   1. Switch active program if applyProgram differs from current shown
   *      (modifies 「計劃」 dropdown — Q1a).
   *   2. Cell case: upsertCell at (cycle, day) with template_id + sub_tag.
   *      Column case: applyTemplateToColumn (preserves per-row sub_tag,
   *      mirrors the existing ▼ ▸ pick behaviour).
   *   3. Force edit mode on (user was editing when they triggered the
   *      import; user-quoted phrase 「回到編輯計劃」).
   *   4. Clear apply* params via router.setParams to prevent re-firing on
   *      re-render / re-focus.
   *
   * `appliedRef` guards against double-application — useFocusEffect refresh
   * runs separately and may re-render with the same params before clear
   * lands. We key the ref by the apply-tpl id; once consumed, ignore.
   */
  const applyParams = useLocalSearchParams<{
    applyTpl?: string;
    applyProgram?: string;
    applySubTag?: string;
    applyKind?: 'cell' | 'column';
    applyCycle?: string;
    applyDay?: string;
  }>();
  const appliedRef = useRef<string | null>(null);

  useEffect(() => {
    const applyTpl = applyParams.applyTpl
      ? decodeURIComponent(applyParams.applyTpl)
      : null;
    if (!applyTpl) return;
    // Wait for `shown` to load so we know the current program (to compare
    // against applyProgram for the program-switch step).
    if (!shown) return;
    if (appliedRef.current === applyTpl) return;

    const applyProgram = applyParams.applyProgram
      ? applyParams.applyProgram === '__none__'
        ? null
        : decodeURIComponent(applyParams.applyProgram)
      : null;
    const applySubTag = applyParams.applySubTag
      ? applyParams.applySubTag === '__none__'
        ? null
        : decodeURIComponent(applyParams.applySubTag)
      : null;
    const applyKind = applyParams.applyKind ?? null;
    const applyDay =
      applyParams.applyDay != null ? Number(applyParams.applyDay) : null;
    const applyCycle =
      applyParams.applyCycle != null ? Number(applyParams.applyCycle) : null;

    if (!applyKind || applyDay == null) {
      appliedRef.current = applyTpl;
      router.setParams({
        applyTpl: undefined,
        applyProgram: undefined,
        applySubTag: undefined,
        applyKind: undefined,
        applyCycle: undefined,
        applyDay: undefined,
      });
      return;
    }

    appliedRef.current = applyTpl;
    (async () => {
      try {
        // Step 1: program switch (if needed). Setting active + re-loading
        // shown brings the grid into the template's program.
        let workingProgramId = shown.program.id;
        if (applyProgram != null && applyProgram !== workingProgramId) {
          await setActiveProgram(db, { id: applyProgram });
          const switched = await getProgram(db, applyProgram);
          if (switched) {
            setShown(switched);
            workingProgramId = switched.program.id;
          }
        }
        // Step 2: bind. Clamp the day_index / cycle_index against the
        // (possibly switched) program's dimensions — out-of-bounds positions
        // would silently no-op otherwise.
        const target = await getProgram(db, workingProgramId);
        if (!target) return;
        const safeDay = Math.min(applyDay, target.program.cycle_length - 1);
        if (applyKind === 'cell' && applyCycle != null) {
          const safeCycle = Math.min(
            applyCycle,
            target.program.cycle_count - 1
          );
          await upsertCell(db, {
            program_id: workingProgramId,
            cycle_index: safeCycle,
            day_index: safeDay,
            template_id: applyTpl,
            sub_tag: applySubTag,
            uuid: randomUUID,
          });
        } else if (applyKind === 'column') {
          // Pass `sub_tag_override` (round 15 fix) so the new template's
          // sub_tag propagates to all rows in the column. Without this the
          // ▼-based "+建立新模板" path leaves every cell with sub_tag=null
          // even when the user explicitly picked a sub_tag in the sheet —
          // distinctSubTagsInProgram then returns [] and the row picker
          // shows no chips.
          await applyTemplateToColumn(db, {
            program_id: workingProgramId,
            day_index: safeDay,
            template_id: applyTpl,
            sub_tag_override: applySubTag,
            uuid: randomUUID,
          });
        }
        // Step 3: refresh to pick up the new cell binding + force edit mode
        // so user lands back where they were.
        await refresh();
        setEditing(true);
      } catch (e) {
        Alert.alert(
          '導入失敗',
          e instanceof Error ? e.message : String(e)
        );
      } finally {
        // Step 4: clear params so a focus re-render doesn't re-apply.
        router.setParams({
          applyTpl: undefined,
          applyProgram: undefined,
          applySubTag: undefined,
          applyKind: undefined,
          applyCycle: undefined,
          applyDay: undefined,
        });
      }
    })();
  }, [applyParams, shown, db, refresh, router]);

  const closePicker = () => setPicker(null);

  // ── Wave 17 — drag-swap handlers ───────────────────────────────────
  const registerCellLayout = useCallback(
    (
      c: number,
      d: number,
      rect: { x: number; y: number; w: number; h: number } | null,
    ) => {
      const key = `${c},${d}`;
      if (rect == null) cellLayoutsRef.current.delete(key);
      else cellLayoutsRef.current.set(key, rect);
    },
    [],
  );

  const hitTest = useCallback(
    (absX: number, absY: number): { cycle: number; day: number } | null => {
      for (const [key, layout] of cellLayoutsRef.current) {
        if (
          absX >= layout.x &&
          absX < layout.x + layout.w &&
          absY >= layout.y &&
          absY < layout.y + layout.h
        ) {
          const [cStr, dStr] = key.split(',');
          return { cycle: Number(cStr), day: Number(dStr) };
        }
      }
      return null;
    },
    [],
  );

  const onDragStart = useCallback((c: number, d: number) => {
    setDraggedSrc({ cycle: c, day: d });
  }, []);

  const onDragUpdate = useCallback(
    (absX: number, absY: number) => {
      setDragFinger({ x: absX, y: absY });
      setHoverTarget(hitTest(absX, absY));
    },
    [hitTest],
  );

  const onDragEnd = useCallback(
    async (absX: number, absY: number) => {
      const src = draggedSrc;
      const target = hitTest(absX, absY);
      // Always clear drag state first — Pan onFinalize may fire after onEnd
      // and re-enter this with stale src.
      setDraggedSrc(null);
      setDragFinger(null);
      setHoverTarget(null);
      if (!src || !shown) return;
      if (!target) return;
      if (target.cycle === src.cycle && target.day === src.day) return;
      try {
        await swapProgramCells(db, {
          program_id: shown.program.id,
          a: { cycle_index: src.cycle, day_index: src.day },
          b: { cycle_index: target.cycle, day_index: target.day },
          uuid: randomUUID,
        });
        await refresh();
      } catch (e) {
        Alert.alert(
          '無法交換',
          e instanceof Error ? e.message : String(e),
        );
      }
    },
    [db, shown, draggedSrc, hitTest, refresh],
  );

  const isDragging = draggedSrc != null;

  const onNew = () => router.push('/program-wizard/new');

  const onToggleEdit = () => {
    setEditing((v) => {
      if (v) setPicker(null);
      return !v;
    });
  };

  const onPickProgram = async (program_id: string) => {
    closePicker();
    if (!shown || program_id === shown.program.id) return;
    await setActiveProgram(db, { id: program_id });
    await refresh();
  };

  const onPickCycleLength = async (new_len: number) => {
    closePicker();
    if (!shown || new_len === shown.program.cycle_length) return;
    await applyResize({
      new_cycle_length: new_len,
      new_cycle_count: shown.program.cycle_count,
    });
  };

  const onPickCycleCount = async (new_count: number) => {
    closePicker();
    if (!shown || new_count === shown.program.cycle_count) return;
    await applyResize({
      new_cycle_length: shown.program.cycle_length,
      new_cycle_count: new_count,
    });
  };

  const onPickStartDate = async (new_iso: string) => {
    closePicker();
    if (!shown || new_iso === shown.program.start_date) return;
    await updateProgramStartDate(db, {
      program_id: shown.program.id,
      start_date: new_iso,
    });
    await refresh();
  };

  const applyResize = useCallback(
    async (args: { new_cycle_length: number; new_cycle_count: number }) => {
      if (!shown) return;
      const lost = await countFilledCellsOutsideBounds(db, {
        program_id: shown.program.id,
        new_cycle_length: args.new_cycle_length,
        new_cycle_count: args.new_cycle_count,
      });
      const doResize = async () => {
        await resizeProgram(db, {
          program_id: shown.program.id,
          new_cycle_length: args.new_cycle_length,
          new_cycle_count: args.new_cycle_count,
        });
        await refresh();
      };
      if (lost > 0) {
        Alert.alert(
          '縮小計畫表？',
          `將砍掉 ${lost} 格已填內容（template + 強度）。此動作無法復原。`,
          [
            { text: '取消', style: 'cancel' },
            { text: '砍掉並縮小', style: 'destructive', onPress: doResize },
          ]
        );
        return;
      }
      await doResize();
    },
    [db, shown, refresh]
  );

  // ── Apply handlers (Phase 3) ─────────────────────────────────────────
  const onPickTemplateForColumn = async (
    day_index: number,
    template_id: string | null
  ) => {
    closePicker();
    if (!shown) return;
    await applyTemplateToColumn(db, {
      program_id: shown.program.id,
      day_index,
      template_id,
      uuid: randomUUID,
    });
    await refresh();
  };

  const onPickSubTagForRow = async (
    cycle_index: number,
    sub_tag: string | null
  ) => {
    closePicker();
    if (!shown) return;
    // Defensive: applyTagToRow writes only to cells with template_id != NULL.
    // If the row is entirely 休息 (no row, or all cells.template_id IS NULL),
    // the UPDATE matches 0 rows → silent no-op → 「強度無法保存」 confusion.
    // Surface an Alert so the user knows to bind templates first.
    const hasFilledCell = shown.cells.some(
      (c) => c.cycle_index === cycle_index && c.template_id != null,
    );
    if (!hasFilledCell) {
      Alert.alert(
        '此 row 沒有 template',
        '先在格子點選 template，再回來套用強度。\n（強度只能掛在有 template 的格子上）',
      );
      return;
    }
    await applyTagToRow(db, {
      program_id: shown.program.id,
      cycle_index,
      sub_tag,
    });
    await refresh();
  };

  // ── Cell-level handlers (Phase 4) ───────────────────────────────────
  const onPickTemplateForCell = async (
    cycle_index: number,
    day_index: number,
    template_id: string | null,
    preset_sub_tag: string | null
  ) => {
    closePicker();
    if (!shown) return;
    // template_id=null on a single cell means user picked 「休息」 explicitly
    // — that clears both slots (rest is a 2-slot block).
    const sub_tag = template_id == null ? null : preset_sub_tag;
    await upsertCell(db, {
      program_id: shown.program.id,
      cycle_index,
      day_index,
      template_id,
      sub_tag,
      uuid: randomUUID,
    });
    await refresh();
  };

  const onPickSubTagForCell = async (
    cycle_index: number,
    day_index: number,
    current_template_id: string,
    sub_tag: string | null
  ) => {
    closePicker();
    if (!shown) return;
    await upsertCell(db, {
      program_id: shown.program.id,
      cycle_index,
      day_index,
      template_id: current_template_id,
      sub_tag,
      uuid: randomUUID,
    });
    await refresh();
  };

  // ── Cell tap routing (Phase 4) ──────────────────────────────────────
  const onTapCellTemplate = (cycle_index: number, day_index: number) => {
    if (!shown) return;
    const cell = shown.cells.find(
      (c) => c.cycle_index === cycle_index && c.day_index === day_index
    );
    setPicker({
      kind: 'template_for_cell',
      cycle_index,
      day_index,
      preset_sub_tag: cell?.sub_tag ?? null,
    });
  };

  const onTapCellSubTag = (
    cycle_index: number,
    day_index: number,
    current_template_id: string
  ) => {
    setPicker({
      kind: 'sub_tag_for_cell',
      cycle_index,
      day_index,
      current_template_id,
    });
  };

  const onTapRestCell = (cycle_index: number, day_index: number) => {
    if (!shown) return;
    // Q5 (a) — same row nearest non-rest neighbour. Open template picker
    // with neighbour's template as preset (highlighted). After pick, the
    // upsert uses neighbour's sub_tag too (handled by passing
    // preset_sub_tag through `template_for_cell`).
    const neighbour = findNearestNonRestInRow(
      shown.cells,
      cycle_index,
      day_index,
      shown.program.cycle_length
    );
    setPicker({
      kind: 'template_for_cell',
      cycle_index,
      day_index,
      preset_sub_tag: neighbour?.sub_tag ?? null,
    });
  };

  // ── Render ──────────────────────────────────────────────────────────
  if (allPrograms.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.heading}>計畫表</Text>
          <View style={styles.headerButtons}>
            <Pressable
              accessibilityRole="button"
              onPress={onNew}
              style={({ pressed }) => [
                styles.newBtn,
                pressed && styles.btnPressed,
              ]}>
              <Text style={styles.newBtnText}>新建</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.body}>
          <Text style={styles.empty}>
            還沒有計畫。按「新建」啟動 6 步建立精靈。
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!shown) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.empty}>載入中…</Text>
      </SafeAreaView>
    );
  }

  // Pre-compute neighbour preset for the active rest-cell picker (so the
  // PickerModal can highlight the neighbour's template).
  const restPreviewNeighbour: ProgramCell | null = (() => {
    if (
      picker &&
      picker.kind === 'template_for_cell' &&
      shown.cells.find(
        (c) =>
          c.cycle_index ===
            (picker as { cycle_index: number }).cycle_index &&
          c.day_index === (picker as { day_index: number }).day_index
      )?.template_id == null
    ) {
      return findNearestNonRestInRow(
        shown.cells,
        picker.cycle_index,
        picker.day_index,
        shown.program.cycle_length
      );
    }
    return null;
  })();

  // For the cell-template picker we highlight whatever's currently in
  // that cell (or the neighbour preset for rest cells).
  const cellTemplateActiveId: string | null = (() => {
    if (!picker || picker.kind !== 'template_for_cell') return null;
    const current = shown.cells.find(
      (c) =>
        c.cycle_index === picker.cycle_index &&
        c.day_index === picker.day_index
    );
    if (current?.template_id != null) return current.template_id;
    return restPreviewNeighbour?.template_id ?? null;
  })();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>計畫表</Text>
        <View style={styles.headerButtons}>
          <Pressable
            accessibilityRole="button"
            onPress={onToggleEdit}
            style={({ pressed }) => [
              styles.editBtn,
              editing && styles.editBtnActive,
              pressed && styles.btnPressed,
            ]}>
            <Text
              style={[
                styles.editBtnText,
                editing && styles.editBtnTextActive,
              ]}>
              {editing ? '完成' : '編輯'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={onNew}
            style={({ pressed }) => [
              styles.newBtn,
              pressed && styles.btnPressed,
            ]}>
            <Text style={styles.newBtnText}>新建</Text>
          </Pressable>
        </View>
      </View>
      <ScrollView
        contentContainerStyle={styles.body}
        scrollEnabled={!isDragging}>
        <Text style={styles.programName}>
          {shown.program.name}
          {shown.program.is_active === 1 ? null : (
            <Text style={styles.inactiveTag}>{` · 未啟用`}</Text>
          )}
        </Text>
        <Text style={styles.metaLine}>
          {shown.program.cycle_count} × {shown.program.cycle_length} days · 起始
          {' '}
          {shown.program.start_date}
        </Text>

        {editing ? (
          <View style={styles.editControls}>
            <DropdownButton
              label="計畫"
              value={shown.program.name}
              onPress={() => setPicker({ kind: 'program' })}
            />
            <DropdownButton
              label="循環天數"
              value={String(shown.program.cycle_length)}
              onPress={() => setPicker({ kind: 'cycle_length' })}
            />
            <DropdownButton
              label="週期數"
              value={String(shown.program.cycle_count)}
              onPress={() => setPicker({ kind: 'cycle_count' })}
            />
            <DropdownButton
              label="起始日"
              value={formatCellDateLabel(shown.program.start_date)}
              onPress={() => setPicker({ kind: 'start_date' })}
            />
          </View>
        ) : null}

        <ProgramGrid
          program={shown}
          templatesById={templatesById}
          editing={editing}
          isDragging={isDragging}
          draggedSrc={draggedSrc}
          hoverTarget={hoverTarget}
          registerCellLayout={registerCellLayout}
          onDragStart={onDragStart}
          onDragUpdate={onDragUpdate}
          onDragEnd={onDragEnd}
          onColumnApply={(d) =>
            setPicker({ kind: 'template_for_column', day_index: d })
          }
          onRowApply={(c) =>
            setPicker({ kind: 'sub_tag_for_row', cycle_index: c })
          }
          onTapCellTemplate={onTapCellTemplate}
          onTapCellSubTag={onTapCellSubTag}
          onTapRestCell={onTapRestCell}
        />
      </ScrollView>

      {/* Wave 17 — floating drag preview (above ScrollView so scrolling
          doesn't clip it). Rendered only while dragging. The preview
          mirrors the source cell's visible content (template name + 強度,
          or 「休息」) at the finger position so the user sees what's
          being moved. */}
      {isDragging && draggedSrc != null && dragFinger != null ? (() => {
        const srcCell = shown.cells.find(
          (cc) =>
            cc.cycle_index === draggedSrc.cycle &&
            cc.day_index === draggedSrc.day,
        );
        const isRest = srcCell == null || srcCell.template_id == null;
        const tpl =
          srcCell?.template_id != null
            ? templatesById[srcCell.template_id]
            : null;
        return (
          <View
            pointerEvents="none"
            style={[
              styles.dragPreview,
              {
                left: dragFinger.x - 36,
                top: dragFinger.y - 28,
              },
            ]}>
            {isRest ? (
              <Text style={styles.dragPreviewRest}>休息</Text>
            ) : (
              <>
                <Text
                  style={styles.dragPreviewTpl}
                  numberOfLines={1}>
                  {tpl?.name ?? '?'}
                </Text>
                <Text
                  style={styles.dragPreviewTag}
                  numberOfLines={1}>
                  {srcCell?.sub_tag ?? '—'}
                </Text>
              </>
            )}
          </View>
        );
      })() : null}

      {/* ── Simple pickers (program / cycle_length / cycle_count) ─── */}
      <PickerModal
        visible={picker?.kind === 'program'}
        title="選擇計畫"
        options={allPrograms.map((p) => ({
          key: p.id,
          label: p.name + (p.is_active === 1 ? ' · 進行中' : ''),
          active: p.id === shown.program.id,
        }))}
        onPick={(key) => onPickProgram(key)}
        onClose={closePicker}
      />
      <PickerModal
        visible={picker?.kind === 'cycle_length'}
        title="選擇循環天數"
        options={CYCLE_LENGTH_OPTIONS.map((n) => ({
          key: String(n),
          label: `${n} 天`,
          active: n === shown.program.cycle_length,
        }))}
        onPick={(key) => onPickCycleLength(Number(key))}
        onClose={closePicker}
      />
      <PickerModal
        visible={picker?.kind === 'cycle_count'}
        title="選擇週期數"
        options={CYCLE_COUNT_OPTIONS.map((n) => ({
          key: String(n),
          label: `${n} 週期`,
          active: n === shown.program.cycle_count,
        }))}
        onPick={(key) => onPickCycleCount(Number(key))}
        onClose={closePicker}
      />
      <StartDateModal
        visible={picker?.kind === 'start_date'}
        initialIso={shown.program.start_date}
        onPick={onPickStartDate}
        onClose={closePicker}
      />

      {/* ── Template picker (column apply OR cell-level convert) ──── */}
      <TemplatePicker
        visible={
          picker?.kind === 'template_for_column' ||
          picker?.kind === 'template_for_cell'
        }
        title={
          picker?.kind === 'template_for_column'
            ? '套用 template 到此 column'
            : picker?.kind === 'template_for_cell'
              ? '選擇 template'
              : ''
        }
        templates={allTemplates}
        activeTemplateId={cellTemplateActiveId}
        showRestOption={picker?.kind === 'template_for_column'}
        previewSubTag={
          picker?.kind === 'template_for_cell'
            ? (picker.preset_sub_tag ?? null)
            : null
        }
        onPick={(template_id) => {
          if (picker?.kind === 'template_for_column') {
            onPickTemplateForColumn(picker.day_index, template_id);
          } else if (picker?.kind === 'template_for_cell') {
            onPickTemplateForCell(
              picker.cycle_index,
              picker.day_index,
              template_id,
              picker.preset_sub_tag
            );
          }
        }}
        onCreateNew={async () => {
          // Spawn a blank template, then push the editor in "import mode" —
          // the editor's top-right action becomes 「建立並導入」 (Create &
          // Import). After save, the editor redirects back here with apply
          // params so the originating picker context (cell or column) gets
          // bound to the new template.
          //
          // Pre-fill the new template's program_id with the current shown
          // program (Q3a) so the new template auto-attaches to this program
          // unless the user picks a different one in the editor.
          //
          // URL params:
          //   fromProgram = current shown program_id (for pre-fill + return)
          //   fromKind    = 'cell' | 'column' (controls programs tab consume)
          //   fromDay     = day_index from picker (both kinds)
          //   fromCycle   = cycle_index (cell-tap only; column-apply omits)
          //   fromSubTag  = preset sub_tag (cell-tap rest-convert only)
          const pickerSnap = picker;
          const shownProgramId = shown?.program.id ?? null;
          closePicker();
          if (!shownProgramId || !pickerSnap) return;
          try {
            const id = randomUUID();
            await createTemplate(db, { id, name: 'New Template' });
            const params = new URLSearchParams();
            params.set('fromProgram', encodeURIComponent(shownProgramId));
            if (pickerSnap.kind === 'template_for_cell') {
              params.set('fromKind', 'cell');
              params.set('fromCycle', String(pickerSnap.cycle_index));
              params.set('fromDay', String(pickerSnap.day_index));
              if (pickerSnap.preset_sub_tag != null) {
                params.set('fromSubTag', encodeURIComponent(pickerSnap.preset_sub_tag));
              }
            } else if (pickerSnap.kind === 'template_for_column') {
              params.set('fromKind', 'column');
              params.set('fromDay', String(pickerSnap.day_index));
            }
            router.push(`/template/${id}?${params.toString()}`);
          } catch (e) {
            Alert.alert(
              '無法建立模板',
              e instanceof Error ? e.message : String(e)
            );
          }
        }}
        onClose={closePicker}
      />

      {/* ── Sub_tag picker (row apply OR cell-level sub_tag edit) ── */}
      <SubTagPicker
        visible={
          picker?.kind === 'sub_tag_for_row' ||
          picker?.kind === 'sub_tag_for_cell'
        }
        title={
          picker?.kind === 'sub_tag_for_row'
            ? '套用強度到此 row'
            : '選擇強度'
        }
        existingSubTags={(() => {
          // Union of (cells used a sub_tag) + (templates in this program have
          // a sub_tag). The union de-dups + sorts alphabetically so the chip
          // order is stable. Cell-derived ranking (frequency desc) is dropped
          // in favour of a stable merged sort — templates' sub_tags don't have
          // a frequency to weigh against.
          const cellTags = distinctSubTagsInProgram(shown.cells);
          const merged = Array.from(
            new Set([...cellTags, ...templateSubTagsForProgram]),
          );
          merged.sort((a, b) => a.localeCompare(b));
          return merged;
        })()}
        activeSubTag={(() => {
          if (picker?.kind === 'sub_tag_for_cell') {
            const cell = shown.cells.find(
              (c) =>
                c.cycle_index === picker.cycle_index &&
                c.day_index === picker.day_index
            );
            return cell?.sub_tag ?? null;
          }
          return null;
        })()}
        onPick={(sub_tag) => {
          if (picker?.kind === 'sub_tag_for_row') {
            onPickSubTagForRow(picker.cycle_index, sub_tag);
          } else if (picker?.kind === 'sub_tag_for_cell') {
            onPickSubTagForCell(
              picker.cycle_index,
              picker.day_index,
              picker.current_template_id,
              sub_tag
            );
          }
        }}
        onClose={closePicker}
      />
    </SafeAreaView>
  );
}

/**
 * Pure-render grid component. In edit mode, hosts column/row apply
 * buttons and routes per-cell taps back to the parent via callbacks.
 */
function ProgramGrid({
  program,
  templatesById,
  editing,
  isDragging,
  draggedSrc,
  hoverTarget,
  registerCellLayout,
  onDragStart,
  onDragUpdate,
  onDragEnd,
  onColumnApply,
  onRowApply,
  onTapCellTemplate,
  onTapCellSubTag,
  onTapRestCell,
}: {
  program: ProgramWithCells;
  templatesById: Record<string, TemplateSummary>;
  editing: boolean;
  isDragging: boolean;
  draggedSrc: { cycle: number; day: number } | null;
  hoverTarget: { cycle: number; day: number } | null;
  registerCellLayout: (
    c: number,
    d: number,
    rect: { x: number; y: number; w: number; h: number } | null,
  ) => void;
  onDragStart: (c: number, d: number) => void;
  onDragUpdate: (absX: number, absY: number) => void;
  onDragEnd: (absX: number, absY: number) => void;
  onColumnApply: (day_index: number) => void;
  onRowApply: (cycle_index: number) => void;
  onTapCellTemplate: (cycle_index: number, day_index: number) => void;
  onTapCellSubTag: (
    cycle_index: number,
    day_index: number,
    current_template_id: string
  ) => void;
  onTapRestCell: (cycle_index: number, day_index: number) => void;
}) {
  const cellMap = useMemo(() => buildCellMap(program.cells), [program.cells]);
  const { cycle_count, cycle_length, start_date } = program.program;

  return (
    <View style={styles.grid}>
      {/* Top column-apply row (edit mode only). Wave 15 polish — using
          arrow-only buttons (▼) instead of「套用」text to free vertical
          space; user feedback: text label was visually heavy on the grid. */}
      {editing ? (
        <View style={styles.gridRow}>
          <View style={styles.rowLabel} />
          {Array.from({ length: cycle_length }).map((_, d) => (
            <Pressable
              key={d}
              accessibilityRole="button"
              accessibilityLabel={`套用 template 到第 ${d + 1} 天`}
              onPress={() => onColumnApply(d)}
              style={({ pressed }) => [
                styles.applyBtnTop,
                pressed && styles.btnPressed,
              ]}>
              <Text style={styles.applyBtnText}>▼</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Body rows */}
      {Array.from({ length: cycle_count }).map((_, c) => (
        <View key={c} style={styles.gridRow}>
          {editing ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`套用強度到第 ${c + 1} 週期`}
              onPress={() => onRowApply(c)}
              style={({ pressed }) => [
                styles.applyBtnLeft,
                pressed && styles.btnPressed,
              ]}>
              <Text style={styles.applyBtnText}>▶</Text>
            </Pressable>
          ) : (
            <View style={styles.rowLabel}>
              <Text style={styles.rowLabelText}>C{c + 1}</Text>
            </View>
          )}
          {Array.from({ length: cycle_length }).map((_, d) => {
            const cell = cellMap.get(`${c},${d}`);
            const dateIso = cellDate(start_date, c, d, cycle_length);
            const dateLabel = formatCellDateLabel(dateIso);
            const isRest = cell == null || cell.template_id == null;
            const tpl =
              cell?.template_id != null
                ? templatesById[cell.template_id]
                : null;
            const isDraggedHere =
              draggedSrc?.cycle === c && draggedSrc?.day === d;
            const isHoverHere =
              hoverTarget?.cycle === c &&
              hoverTarget?.day === d &&
              !isDraggedHere;
            // Inner Pressables are disabled while ANY cell is dragging so a
            // long-press → release-without-move doesn't double-fire onPress
            // (Pressable's touch-up handler is independent of the gesture).
            const tapsEnabled = editing && !isDragging;
            return (
              <CellWrapper
                key={d}
                c={c}
                d={d}
                enabled={editing}
                isDragged={isDraggedHere}
                isHover={isHoverHere}
                registerLayout={registerCellLayout}
                onDragStart={onDragStart}
                onDragUpdate={onDragUpdate}
                onDragEnd={onDragEnd}>
                <View style={styles.cellDate}>
                  <Text style={styles.cellDateText}>{dateLabel}</Text>
                </View>
                {isRest ? (
                  <Pressable
                    onPress={tapsEnabled ? () => onTapRestCell(c, d) : undefined}
                    disabled={!tapsEnabled}
                    style={({ pressed }) => [
                      styles.cellRest,
                      tapsEnabled && pressed && styles.cellPressed,
                    ]}>
                    <Text style={styles.cellRestText}>休息</Text>
                  </Pressable>
                ) : (
                  <>
                    <Pressable
                      onPress={
                        tapsEnabled ? () => onTapCellTemplate(c, d) : undefined
                      }
                      disabled={!tapsEnabled}
                      style={({ pressed }) => [
                        styles.cellTemplate,
                        tapsEnabled && pressed && styles.cellPressed,
                      ]}>
                      <Text style={styles.cellTemplateText} numberOfLines={1}>
                        {tpl?.name ?? '?'}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={
                        tapsEnabled && cell?.template_id != null
                          ? () =>
                              onTapCellSubTag(c, d, cell.template_id as string)
                          : undefined
                      }
                      disabled={!tapsEnabled || cell?.template_id == null}
                      style={({ pressed }) => [
                        styles.cellTag,
                        tapsEnabled && pressed && styles.cellPressed,
                      ]}>
                      <Text style={styles.cellTagText} numberOfLines={1}>
                        {cell?.sub_tag ?? '—'}
                      </Text>
                    </Pressable>
                  </>
                )}
              </CellWrapper>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/**
 * Wave 17 (2026-05-21) — single cell wrapper used by ProgramGrid. Owns the
 * long-press-drag-swap gesture for one grid cell.
 *
 * Responsibilities:
 *   1. Measure self via `measureInWindow` (absolute screen coords) on every
 *      layout, register into the parent's `cellLayoutsRef` so hit-test can
 *      resolve any finger position back to (cycle, day).
 *   2. Wrap children in `GestureDetector` with a Pan gesture that activates
 *      after 300ms long-press. `runOnJS(true)` means callbacks run on the
 *      JS thread → direct setState in parent handlers.
 *   3. Apply visual feedback styles (dragged source = opacity 0.3, hover
 *      target = highlighted border).
 *
 * Cleanup: on unmount, deregister the layout entry so stale rects don't
 * survive a program switch / grid resize.
 *
 * `enabled=false` skips the GestureDetector entirely (read mode + the
 * 「無」 placeholder render).
 */
function CellWrapper({
  c,
  d,
  enabled,
  isDragged,
  isHover,
  registerLayout,
  onDragStart,
  onDragUpdate,
  onDragEnd,
  children,
}: {
  c: number;
  d: number;
  enabled: boolean;
  isDragged: boolean;
  isHover: boolean;
  registerLayout: (
    c: number,
    d: number,
    rect: { x: number; y: number; w: number; h: number } | null,
  ) => void;
  onDragStart: (c: number, d: number) => void;
  onDragUpdate: (absX: number, absY: number) => void;
  onDragEnd: (absX: number, absY: number) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<View>(null);
  const measure = useCallback(() => {
    if (!ref.current) return;
    ref.current.measureInWindow((x, y, w, h) => {
      // Guard against NaN that can sneak in on first layout pass.
      if (
        Number.isFinite(x) &&
        Number.isFinite(y) &&
        Number.isFinite(w) &&
        Number.isFinite(h)
      ) {
        registerLayout(c, d, { x, y, w, h });
      }
    });
  }, [c, d, registerLayout]);

  useEffect(() => {
    return () => {
      registerLayout(c, d, null);
    };
  }, [c, d, registerLayout]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(300)
        .runOnJS(true)
        .onStart(() => {
          onDragStart(c, d);
        })
        .onUpdate((e) => {
          onDragUpdate(e.absoluteX, e.absoluteY);
        })
        .onEnd((e) => {
          onDragEnd(e.absoluteX, e.absoluteY);
        })
        .onFinalize((e, success) => {
          // If onEnd didn't fire (gesture cancelled / failed) still reset.
          if (!success) onDragEnd(e.absoluteX, e.absoluteY);
        }),
    [c, d, onDragStart, onDragUpdate, onDragEnd],
  );

  const cellStyle = [
    styles.cell,
    isDragged && styles.cellDragged,
    isHover && styles.cellHover,
  ];

  if (!enabled) {
    return (
      <View ref={ref} onLayout={measure} style={cellStyle}>
        {children}
      </View>
    );
  }

  return (
    <GestureDetector gesture={pan}>
      <View ref={ref} onLayout={measure} style={cellStyle}>
        {children}
      </View>
    </GestureDetector>
  );
}

function DropdownButton({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.dropdown,
        pressed && styles.btnPressed,
      ]}>
      <Text style={styles.dropdownLabel}>{label}</Text>
      <Text style={styles.dropdownValue} numberOfLines={1}>
        {value} ▾
      </Text>
    </Pressable>
  );
}

interface PickerOption {
  key: string;
  label: string;
  active: boolean;
}

function PickerModal({
  visible,
  title,
  options,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: PickerOption[];
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{title}</Text>
          <ScrollView style={styles.modalList}>
            {options.length === 0 ? (
              <Text style={styles.empty}>沒有可選項目。</Text>
            ) : (
              options.map((opt) => (
                <Pressable
                  key={opt.key}
                  style={({ pressed }) => [
                    styles.modalRow,
                    pressed && styles.btnPressed,
                  ]}
                  onPress={() => onPick(opt.key)}>
                  <Text
                    style={[
                      styles.modalRowText,
                      opt.active && styles.modalRowTextActive,
                    ]}>
                    {opt.label}
                  </Text>
                </Pressable>
              ))
            )}
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}

/**
 * Template picker — column-apply variant adds a 「休息」 option at top.
 * Cell-level convert shows a small preview line "強度將設為 X" if a
 * sub_tag preset (from neighbour) is provided.
 */
function TemplatePicker({
  visible,
  title,
  templates,
  activeTemplateId,
  showRestOption,
  previewSubTag,
  onPick,
  onCreateNew,
  onClose,
}: {
  visible: boolean;
  title: string;
  templates: TemplateSummary[];
  activeTemplateId: string | null;
  showRestOption: boolean;
  previewSubTag: string | null;
  onPick: (template_id: string | null) => void;
  onCreateNew: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>{title}</Text>
          {previewSubTag != null ? (
            <Text style={styles.modalSubtitle}>
              強度將設為「{previewSubTag}」（旁邊就近 cell）
            </Text>
          ) : null}
          <ScrollView style={styles.modalList}>
            {showRestOption ? (
              <Pressable
                style={({ pressed }) => [
                  styles.modalRow,
                  styles.modalRowRest,
                  pressed && styles.btnPressed,
                ]}
                onPress={() => onPick(null)}>
                <Text style={styles.modalRowText}>休息（清空此列）</Text>
              </Pressable>
            ) : null}
            {/* + 建立新模板 — creates a blank template and jumps to the editor.
                The picker is closed by the parent (onCreateNew handler) so the
                user lands directly on /template/[id]. They can come back to
                programs tab later and re-open the picker to bind the cell. */}
            <Pressable
              style={({ pressed }) => [
                styles.modalRow,
                pressed && styles.btnPressed,
              ]}
              onPress={onCreateNew}>
              <Text style={styles.modalRowTextAdd}>+ 建立新模板</Text>
            </Pressable>
            {templates.length === 0 ? (
              <Text style={styles.empty}>沒有 template。先建一個再回來。</Text>
            ) : (
              templates.map((t) => (
                <Pressable
                  key={t.id}
                  style={({ pressed }) => [
                    styles.modalRow,
                    pressed && styles.btnPressed,
                  ]}
                  onPress={() => onPick(t.id)}>
                  <Text
                    style={[
                      styles.modalRowText,
                      activeTemplateId === t.id && styles.modalRowTextActive,
                    ]}>
                    {t.name}
                  </Text>
                </Pressable>
              ))
            )}
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}

/**
 * Sub_tag picker — list of existing sub_tags in this program, plus
 * 「無」 and 「+ 新增強度」 inline (mirror template-meta-sheet pattern).
 */
function SubTagPicker({
  visible,
  title,
  existingSubTags,
  activeSubTag,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  existingSubTags: string[];
  activeSubTag: string | null;
  onPick: (sub_tag: string | null) => void;
  onClose: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [input, setInput] = useState('');

  // Reset add-mode when modal opens/closes
  const onCloseLocal = () => {
    setAdding(false);
    setInput('');
    onClose();
  };
  const onPickLocal = (v: string | null) => {
    setAdding(false);
    setInput('');
    onPick(v);
  };
  const onConfirmNew = () => {
    const trimmed = input.trim();
    if (trimmed.length === 0) return;
    onPickLocal(trimmed);
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onCloseLocal}>
      <Pressable style={styles.modalOverlay} onPress={onCloseLocal}>
        <Pressable
          style={styles.modalCard}
          onPress={(e) => e.stopPropagation?.()}>
          <Text style={styles.modalTitle}>{title}</Text>
          <ScrollView style={styles.modalList}>
            <Pressable
              style={({ pressed }) => [
                styles.modalRow,
                pressed && styles.btnPressed,
              ]}
              onPress={() => onPickLocal(null)}>
              <Text
                style={[
                  styles.modalRowText,
                  activeSubTag == null && styles.modalRowTextActive,
                ]}>
                無
              </Text>
            </Pressable>
            {existingSubTags.map((tag) => (
              <Pressable
                key={`tag-${tag}`}
                style={({ pressed }) => [
                  styles.modalRow,
                  pressed && styles.btnPressed,
                ]}
                onPress={() => onPickLocal(tag)}>
                <Text
                  style={[
                    styles.modalRowText,
                    tag === activeSubTag && styles.modalRowTextActive,
                  ]}>
                  {tag}
                </Text>
              </Pressable>
            ))}
            {adding ? (
              <View style={styles.modalAddRow}>
                <TextInput
                  value={input}
                  onChangeText={setInput}
                  placeholder="新強度名稱"
                  style={styles.modalInput}
                  autoFocus
                  onSubmitEditing={onConfirmNew}
                />
                <Pressable
                  style={({ pressed }) => [
                    styles.modalAddBtn,
                    pressed && styles.btnPressed,
                  ]}
                  onPress={onConfirmNew}>
                  <Text style={styles.modalAddBtnText}>建立</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable
                style={({ pressed }) => [
                  styles.modalRow,
                  styles.modalRowAdd,
                  pressed && styles.btnPressed,
                ]}
                onPress={() => setAdding(true)}>
                <Text style={styles.modalRowTextAdd}>+ 新增強度</Text>
              </Pressable>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * Wave 17 (2026-05-21) — 起始日 picker modal (Q1c). iOS spinner-style
 * DateTimePicker inline; confirm / cancel pattern lets the user scroll
 * through dates without each tick firing a DB write.
 *
 * `start_date` is stored as `YYYY-MM-DD` ISO with no timezone. We parse it
 * into a local-time Date so the spinner shows the same calendar date the
 * user typed, and format back using local getters so timezone doesn't
 * silently shift the chosen day across midnight.
 */
function parseIsoToLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  if (
    !Number.isFinite(y) ||
    !Number.isFinite(m) ||
    !Number.isFinite(d)
  ) {
    return new Date();
  }
  return new Date(y, m - 1, d);
}

function formatLocalDateToIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function StartDateModal({
  visible,
  initialIso,
  onPick,
  onClose,
}: {
  visible: boolean;
  initialIso: string;
  onPick: (iso: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Date>(() => parseIsoToLocalDate(initialIso));

  // Reset draft every time the sheet opens so cancel-then-reopen shows the
  // current prop value instead of a stale spin.
  useEffect(() => {
    if (visible) {
      setDraft(parseIsoToLocalDate(initialIso));
    }
  }, [visible, initialIso]);

  const onChange = (_e: DateTimePickerEvent, picked?: Date) => {
    if (picked) setDraft(picked);
  };

  const onConfirm = () => {
    onPick(formatLocalDateToIso(draft));
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}>
      <Pressable style={styles.modalOverlay} onPress={onClose}>
        <Pressable
          style={styles.modalCard}
          onPress={(e) => e.stopPropagation?.()}>
          <Text style={styles.modalTitle}>選擇起始日</Text>
          <View style={styles.startDatePickerWrap}>
            <DateTimePicker
              value={draft}
              mode="date"
              display="spinner"
              themeVariant="light"
              onChange={onChange}
            />
          </View>
          <View style={styles.startDateButtons}>
            <Pressable
              style={({ pressed }) => [
                styles.startDateBtnCancel,
                pressed && styles.btnPressed,
              ]}
              onPress={onClose}>
              <Text style={styles.startDateBtnCancelText}>取消</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.startDateBtnConfirm,
                pressed && styles.btnPressed,
              ]}
              onPress={onConfirm}>
              <Text style={styles.startDateBtnConfirmText}>確認</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// Unused legacy keys — keep exported as constants for potential future
// migration logic if we add a dedicated 「none」 sentinel row.
void SUB_TAG_NONE_KEY;
void SUB_TAG_NEW_KEY;

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { padding: 16, gap: 8, paddingBottom: 36 },
  heading: { fontSize: 28, fontWeight: '700' },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  headerButtons: { flexDirection: 'row', gap: 8 },
  newBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: '#0a7ea4',
  },
  newBtnText: { color: 'white', fontWeight: '600' },
  editBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(10,126,164,0.18)',
  },
  editBtnActive: { backgroundColor: '#0a7ea4' },
  editBtnText: { color: '#0a7ea4', fontWeight: '600' },
  editBtnTextActive: { color: 'white' },
  empty: {
    fontSize: 14,
    opacity: 0.6,
    fontStyle: 'italic',
    padding: 24,
  },
  programName: { fontSize: 20, fontWeight: '600' },
  inactiveTag: { fontSize: 13, opacity: 0.6, fontWeight: '400' },
  metaLine: { fontSize: 12, opacity: 0.7, marginBottom: 8 },
  // ── Edit controls (3 dropdowns) ─────────────────────────────────────
  editControls: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 6,
  },
  dropdown: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(10,126,164,0.4)',
    backgroundColor: 'rgba(10,126,164,0.06)',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 2,
  },
  dropdownLabel: { fontSize: 10, fontWeight: '700', opacity: 0.55 },
  dropdownValue: { fontSize: 13, fontWeight: '600' },
  // ── Picker modal ────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    gap: 4,
    maxHeight: '70%',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  modalSubtitle: {
    fontSize: 12,
    opacity: 0.65,
    marginBottom: 4,
  },
  modalList: { maxHeight: 400 },
  modalRow: {
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  modalRowRest: { backgroundColor: 'rgba(127,127,127,0.06)' },
  modalRowAdd: { backgroundColor: 'rgba(10,126,164,0.04)' },
  modalRowText: { fontSize: 15 },
  modalRowTextActive: { color: '#0a7ea4', fontWeight: '700' },
  modalRowTextAdd: { fontSize: 15, color: '#0a7ea4', fontWeight: '600' },
  modalRowSubtle: { fontSize: 12, opacity: 0.55, fontWeight: '400' },
  modalAddRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.1)',
    alignItems: 'center',
  },
  modalInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.2)',
    borderRadius: 6,
  },
  modalAddBtn: {
    backgroundColor: '#0a7ea4',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
  },
  modalAddBtnText: { color: 'white', fontWeight: '600' },
  // ── Grid ────────────────────────────────────────────────────────────
  grid: { gap: 4 },
  gridRow: { flexDirection: 'row', gap: 4 },
  rowLabel: {
    width: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabelText: { fontSize: 10, fontWeight: '700', opacity: 0.65 },
  // Apply buttons (edit mode only) — wave 15 user feedback: arrow-only
  // (▼/▶) icons instead of「套用」text. Tighter padding so the apply row
  // doesn't claim a full cell height; left column shares row-label width
  // so cells don't shrink in edit mode.
  applyBtnTop: {
    flex: 1,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(10,126,164,0.12)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(10,126,164,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyBtnLeft: {
    width: 18,
    paddingVertical: 4,
    paddingHorizontal: 0,
    borderRadius: 4,
    backgroundColor: 'rgba(10,126,164,0.12)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(10,126,164,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyBtnText: { fontSize: 12, fontWeight: '700', color: '#0a7ea4' },
  // ── Cell (column stack of 3 sub-cells: date / template / sub_tag) ──
  cell: {
    flex: 1,
    borderRadius: 6,
    backgroundColor: 'rgba(127,127,127,0.10)',
    overflow: 'hidden',
    minHeight: 64,
  },
  cellPressed: { opacity: 0.55 },
  cellDate: {
    paddingVertical: 3,
    alignItems: 'center',
    backgroundColor: 'rgba(127,127,127,0.08)',
  },
  cellDateText: { fontSize: 10, fontWeight: '700', opacity: 0.75 },
  cellTemplate: {
    flex: 1,
    paddingVertical: 4,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellTemplateText: {
    fontSize: 9,
    fontWeight: '600',
    textAlign: 'center',
  },
  cellTag: {
    paddingVertical: 3,
    paddingHorizontal: 4,
    alignItems: 'center',
    backgroundColor: 'rgba(127,127,127,0.05)',
  },
  cellTagText: { fontSize: 8, opacity: 0.7, textAlign: 'center' },
  cellRest: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(127,127,127,0.04)',
  },
  cellRestText: {
    fontSize: 11,
    fontStyle: 'italic',
    opacity: 0.5,
  },
  // ── Wave 17 — drag-swap visual feedback ────────────────────────────
  cellDragged: {
    opacity: 0.3,
  },
  cellHover: {
    borderWidth: 2,
    borderColor: '#0a7ea4',
    backgroundColor: 'rgba(10,126,164,0.15)',
  },
  dragPreview: {
    position: 'absolute',
    width: 72,
    height: 56,
    borderRadius: 6,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#0a7ea4',
    paddingVertical: 4,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
    // Slight scale by margins (avoid transform: scale to keep coords simple).
  },
  dragPreviewRest: {
    fontSize: 12,
    fontStyle: 'italic',
    opacity: 0.5,
  },
  dragPreviewTpl: {
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
  },
  dragPreviewTag: {
    fontSize: 9,
    opacity: 0.7,
    textAlign: 'center',
    marginTop: 2,
  },
  // ── Wave 17 — start date picker modal ──────────────────────────────
  startDatePickerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  startDateButtons: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  startDateBtnCancel: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 6,
    backgroundColor: 'rgba(127,127,127,0.10)',
    alignItems: 'center',
  },
  startDateBtnCancelText: { fontSize: 14, fontWeight: '600', opacity: 0.7 },
  startDateBtnConfirm: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 6,
    backgroundColor: '#0a7ea4',
    alignItems: 'center',
  },
  startDateBtnConfirmText: { fontSize: 14, fontWeight: '700', color: 'white' },
  btnPressed: { opacity: 0.85 },
});
