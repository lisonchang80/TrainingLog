/**
 * `<TemplateListSection>` — shared component for the 模板訓練 region of the
 * 訓練 tab (ADR-0024 § 2.c) and the standalone Templates surface (slated for
 * deletion once 訓練 tab重構 lands).
 *
 * Behaviour:
 *   - reads templates via `listTemplates` on focus
 *   - dedupes by name with `listTemplateGroupsByName` (ADR-0024 § 2.c)
 *   - header row: heading + [+ 新建模板] btn → creates a blank template and
 *     navigates to the editor (`/template/[id]`)
 *   - tap a row → invokes `onPickTemplate` if supplied, otherwise falls back
 *     to the legacy "open editor" behaviour. The start-sheet wiring (which
 *     turns a tap into a `startSessionFromTemplate` call) is the parent's
 *     responsibility — Section just surfaces which template was picked.
 *   - left-swipe a row → "刪除同名" destructive action: previews every
 *     template instance sharing this row's name (including the default
 *     variant), confirms via Alert with the per-program impact summary
 *     (which schedule cells will revert to rest-day), then commits the
 *     batch deletion via `executeDeleteTemplatesByName`.
 *   - empty state: "沒有模板，點 [+ 新建] 開始建立" + [+ 新建模板] btn still
 *     visible (parent never needs to hide it)
 *
 * The component keeps its own list state but is otherwise stateless from the
 * parent's POV — drop it into the 訓練 tab idle scroll once or into the
 * legacy Templates tab once, no shared store needed.
 */

import { randomUUID } from 'expo-crypto';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useDatabase } from '@/components/database-provider';
import { useAppMode } from '@/src/app-mode';
import { SwipeableSetRow } from '@/components/shared/swipeable-set-row';
import {
  createTemplate,
  executeDeleteTemplatesByName,
  findNextAvailableTemplateName,
  listTemplates,
  previewTemplateDeletionByName,
  type AffectedProgramCell,
  type TemplateDeletionRow,
  type TemplateSummary,
} from '@/src/adapters/sqlite/templateRepository';
import { listTemplateGroupsByName } from '@/src/domain/training/templateListGroups';
import { getLocale, t as tt, tTemplateRowSubtitle, tUseTemplate } from '@/src/i18n';
import { useTheme, type ThemeTokens } from '@/src/theme';

interface Props {
  /**
   * Called when a template row is tapped. If omitted, the row push the
   * editor route (`/template/[id]`) — matches the legacy Templates-tab
   * behaviour. When supplied (e.g. from the 訓練 tab) the parent should
   * open the start-template flow.
   */
  onPickTemplate?: (template: TemplateSummary) => void;
  /** Optional override for the heading text (defaults to "模板訓練"). */
  heading?: string;
}

export function TemplateListSection({
  onPickTemplate,
  heading = tt('page', 'templateTraining'),
}: Props): React.ReactElement {
  const db = useDatabase();
  const router = useRouter();
  // ADR-0026 D1 — 極簡模式：刪除同名 alert 省略 (計劃·強度) 變體預覽（計劃概念
  // 在 UI 全消失，歷史/刪除預覽也藏）。刪除行為本身不變。
  const { isMinimal } = useAppMode();
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const [rows, setRows] = useState<TemplateSummary[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const list = await listTemplates(db);
    setRows(listTemplateGroupsByName(list));
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onCreate = async () => {
    setBusy(true);
    try {
      const id = randomUUID();
      const uniqueName = await findNextAvailableTemplateName(
        db,
        'New Template',
      );
      await createTemplate(db, { id, name: uniqueName });
      // fresh=1 → the editor pre-created this blank template; if the user
      // leaves WITHOUT saving, the editor's unmount-cleanup deletes it
      // (else empty「新模板」orphans pile up). Editing an existing row
      // (onRowPress below) does NOT pass fresh, so it's never auto-deleted.
      router.push(`/template/${id}?fresh=1`);
    } catch (e) {
      Alert.alert(tt('alert', 'cannotCreateTemplate'), e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onRowPress = (row: TemplateSummary) => {
    if (onPickTemplate) {
      onPickTemplate(row);
      return;
    }
    router.push(`/template/${row.id}`);
  };

  const onDeleteAllSameName = useCallback(
    async (row: TemplateSummary) => {
      if (busy) return;
      setBusy(true);
      let preview;
      try {
        preview = await previewTemplateDeletionByName(db, row.name);
      } catch (e) {
        setBusy(false);
        Alert.alert(
          tt('alert', 'deleteFailed'),
          e instanceof Error ? e.message : String(e),
        );
        return;
      }
      setBusy(false);
      if (preview.templates.length === 0) {
        // Shouldn't happen — the row was visible — but guard anyway.
        return;
      }
      Alert.alert(
        tt('alert', 'deleteAllSameNameTemplatesQ'),
        tBatchDeleteBody(
          row.name,
          preview.templates,
          preview.affectedCells,
          isMinimal,
        ),
        [
          { text: tt('common', 'cancel'), style: 'cancel' },
          {
            text: tt('common', 'delete'),
            style: 'destructive',
            onPress: async () => {
              setBusy(true);
              try {
                await executeDeleteTemplatesByName(db, row.name);
                await load();
              } catch (e) {
                Alert.alert(
                  tt('alert', 'deleteFailed'),
                  e instanceof Error ? e.message : String(e),
                );
              } finally {
                setBusy(false);
              }
            },
          },
        ],
      );
    },
    [busy, db, load, isMinimal],
  );

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.heading}>{heading}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tt('button', 'newTemplateFull')}
          onPress={onCreate}
          disabled={busy}
          style={({ pressed }) => [
            styles.newBtn,
            busy && styles.btnDisabled,
            pressed && styles.btnPressed,
          ]}>
          <Text style={styles.newBtnText}>{tt('button', 'newTemplate')}</Text>
        </Pressable>
      </View>
      {rows.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>
            {tt('page', 'noTemplatesEmpty')}
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {rows.map((row) => (
            <View key={row.id} style={styles.rowFrame}>
              <SwipeableSetRow
                swipeLeftActions={[
                  {
                    key: 'delete-all-same-name',
                    label: tt('button', 'deleteAllSameName'),
                    color: tokens.action.destructive,
                    onPress: () => onDeleteAllSameName(row),
                  },
                ]}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={tUseTemplate(row.name)}
                  onPress={() => onRowPress(row)}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
                  <Text style={styles.rowName}>{row.name}</Text>
                  <Text style={styles.rowDetails}>
                    {tTemplateRowSubtitle(row.exerciseCount, formatTimestamp(row.updated_at))}
                  </Text>
                </Pressable>
              </SwipeableSetRow>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

/**
 * Alert body for the batch "delete all same-name" flow. Lists every
 * (program · sub_tag) variant about to disappear, then — if any
 * program_cell currently schedules one of them — adds the rest-day
 * impact summary aggregated by program name.
 *
 * ADR-0026 D1 — when `minimal` is set, the (program · sub_tag) variant preview
 * and the program-cell rest-day blurb are both omitted (計劃概念在 UI 全消失).
 * The body collapses to a plain count + irreversible warning. Both extras are
 * 計劃-only surfaces, so a 通用-only user never schedules cells nor sees variants.
 */
function tBatchDeleteBody(
  name: string,
  templates: TemplateDeletionRow[],
  affectedCells: AffectedProgramCell[],
  minimal: boolean,
): string {
  const en = getLocale() === 'en';
  if (minimal) {
    return en
      ? `${templates.length} template${templates.length > 1 ? 's' : ''} named "${name}" will be permanently deleted. This cannot be undone.`
      : `將永久刪除 ${templates.length} 個名為「${name}」的模板。此操作無法復原。`;
  }
  const tripleLines = templates
    .map((t) => formatTripleLine(t, en))
    .join('\n');
  const header = en
    ? `${templates.length} template${templates.length > 1 ? 's' : ''} named "${name}" will be permanently deleted. This cannot be undone.\n\nVariants:\n${tripleLines}`
    : `將永久刪除 ${templates.length} 個名為「${name}」的模板。此操作無法復原。\n\n變體：\n${tripleLines}`;
  if (affectedCells.length === 0) {
    return header;
  }
  return `${header}\n\n${formatCellsBlurb(affectedCells, en)}`;
}

function formatTripleLine(t: TemplateDeletionRow, en: boolean): string {
  const programLabel = t.program_name ?? (en ? 'default' : '通用');
  const intensityLabel = t.sub_tag ?? (en ? '(no intensity)' : '無強度');
  return en
    ? `• ${programLabel} · ${intensityLabel}`
    : `• ${programLabel}（${intensityLabel}）`;
}

function formatCellsBlurb(cells: AffectedProgramCell[], en: boolean): string {
  const byProgram = cells.reduce<Record<string, number>>((acc, c) => {
    acc[c.program_name] = (acc[c.program_name] ?? 0) + 1;
    return acc;
  }, {});
  const lines = Object.entries(byProgram)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, n]) =>
      en ? `• ${name} (${n} cell${n > 1 ? 's' : ''})` : `• ${name}（${n} 個格子）`,
    )
    .join('\n');
  const total = cells.length;
  return en
    ? `⚠ ${total} program-schedule cell${total > 1 ? 's' : ''} will revert to a rest day:\n${lines}`
    : `⚠ ${total} 個程式課表格子將變為休息日：\n${lines}`;
}

function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    section: { gap: 8 },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    heading: { fontSize: 18, fontWeight: '700', color: tokens.text.primary },
    newBtn: {
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: 999,
      backgroundColor: tokens.action.primary,
    },
    newBtnText: {
      color: tokens.action.onPrimary,
      fontSize: 14,
      fontWeight: '600',
    },
    list: { gap: 8 },
    rowFrame: {
      borderRadius: 10,
      overflow: 'hidden',
    },
    emptyBox: {
      padding: 16,
      borderRadius: 10,
      backgroundColor: tokens.bg.elevated,
      alignItems: 'center',
    },
    emptyText: {
      fontSize: 14,
      color: tokens.text.secondary,
      textAlign: 'center',
    },
    row: {
      paddingVertical: 14,
      paddingHorizontal: 16,
      backgroundColor: tokens.bg.elevated,
      gap: 4,
    },
    rowPressed: { opacity: 0.85 },
    rowName: { fontSize: 16, fontWeight: '600', color: tokens.text.primary },
    rowDetails: { fontSize: 13, color: tokens.text.secondary },
    btnDisabled: { opacity: 0.5 },
    btnPressed: { opacity: 0.85 },
  });
}
