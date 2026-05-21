import { randomUUID } from 'expo-crypto';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabase } from '@/components/database-provider';
import {
  applyTagToRow,
  applyTemplateToColumn,
  countFilledCellsOutsideBounds,
  getActiveProgram,
  getProgram,
  listPrograms,
  resizeProgram,
  setActiveProgram,
  upsertCell,
  type ProgramSummary,
} from '@/src/adapters/sqlite/programRepository';
import {
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
  | { kind: 'cycle_count' };

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

  const refresh = useCallback(async () => {
    const [activeOrNull, all, ts] = await Promise.all([
      getActiveProgram(db),
      listPrograms(db),
      listTemplates(db),
    ]);
    const map: Record<string, TemplateSummary> = {};
    for (const t of ts) map[t.id] = t;
    setTemplatesById(map);
    setAllPrograms(all);
    setAllTemplates(ts);
    if (activeOrNull) {
      setShown(activeOrNull);
      return;
    }
    if (all.length > 0) {
      const fallback = await getProgram(db, all[0].id);
      setShown(fallback);
    } else {
      setShown(null);
    }
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const closePicker = () => setPicker(null);

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
          '縮小計劃表？',
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
          <Text style={styles.heading}>計劃表</Text>
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
            還沒有計劃。按「新建」啟動 6 步建立精靈。
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
        <Text style={styles.heading}>計劃表</Text>
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
      <ScrollView contentContainerStyle={styles.body}>
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
              label="計劃"
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
          </View>
        ) : null}

        <ProgramGrid
          program={shown}
          templatesById={templatesById}
          editing={editing}
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

      {/* ── Simple pickers (program / cycle_length / cycle_count) ─── */}
      <PickerModal
        visible={picker?.kind === 'program'}
        title="選擇計劃"
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
        existingSubTags={distinctSubTagsInProgram(shown.cells)}
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
  onColumnApply,
  onRowApply,
  onTapCellTemplate,
  onTapCellSubTag,
  onTapRestCell,
}: {
  program: ProgramWithCells;
  templatesById: Record<string, TemplateSummary>;
  editing: boolean;
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
            return (
              <View key={d} style={styles.cell}>
                <View style={styles.cellDate}>
                  <Text style={styles.cellDateText}>{dateLabel}</Text>
                </View>
                {isRest ? (
                  <Pressable
                    onPress={editing ? () => onTapRestCell(c, d) : undefined}
                    disabled={!editing}
                    style={({ pressed }) => [
                      styles.cellRest,
                      editing && pressed && styles.cellPressed,
                    ]}>
                    <Text style={styles.cellRestText}>休息</Text>
                  </Pressable>
                ) : (
                  <>
                    <Pressable
                      onPress={
                        editing ? () => onTapCellTemplate(c, d) : undefined
                      }
                      disabled={!editing}
                      style={({ pressed }) => [
                        styles.cellTemplate,
                        editing && pressed && styles.cellPressed,
                      ]}>
                      <Text style={styles.cellTemplateText} numberOfLines={1}>
                        {tpl?.name ?? '?'}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={
                        editing && cell?.template_id != null
                          ? () =>
                              onTapCellSubTag(c, d, cell.template_id as string)
                          : undefined
                      }
                      disabled={!editing}
                      style={({ pressed }) => [
                        styles.cellTag,
                        editing && pressed && styles.cellPressed,
                      ]}>
                      <Text style={styles.cellTagText} numberOfLines={1}>
                        {cell?.sub_tag ?? '—'}
                      </Text>
                    </Pressable>
                  </>
                )}
              </View>
            );
          })}
        </View>
      ))}
    </View>
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
  onClose,
}: {
  visible: boolean;
  title: string;
  templates: TemplateSummary[];
  activeTemplateId: string | null;
  showRestOption: boolean;
  previewSubTag: string | null;
  onPick: (template_id: string | null) => void;
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
                    {t.sub_tag ? (
                      <Text style={styles.modalRowSubtle}>
                        {` · ${t.sub_tag}`}
                      </Text>
                    ) : null}
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
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  cellTag: {
    paddingVertical: 3,
    paddingHorizontal: 4,
    alignItems: 'center',
    backgroundColor: 'rgba(127,127,127,0.05)',
  },
  cellTagText: { fontSize: 10, opacity: 0.7, textAlign: 'center' },
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
  btnPressed: { opacity: 0.85 },
});
