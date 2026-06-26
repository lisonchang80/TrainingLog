/**
 * 補訓練 (backfill) picker sheet — grill 2026-06-26 (v3 2026-06-26).
 *
 * Two entry points open this sheet (session detail header button + history
 * calendar empty-day box). It mirrors the Training tab idle 3-section choice
 * (計劃訓練 / 模板訓練 / 空白訓練), but the chosen path produces a BACK-DATED,
 * already-finished session instead of a live one.
 *
 *   計劃訓練 — AUTO: resolves the active program's scheduled template for the
 *             target day (resolveTodayPlan, same as the live 計劃訓練 row) and
 *             goes straight to edit. No picking. Rest day / no active program
 *             → alert.
 *   模板訓練 — pick a template → reuse StartTemplateSheet for (計劃, 強度).
 *   空白訓練 — blank session.
 *   極簡模式 — no 計劃 concept: 計劃訓練 hidden, 模板訓練 → 通用 直接建立.
 *
 * The (計劃, 強度) selection for 模板訓練 REUSES `StartTemplateSheet`. The sheet
 * hands the parent a resolved `template_id` (or 'blank'); the PARENT owns the
 * target day, the session creation, and the navigation — deferred to the
 * Modal's onDismiss (onClosed) so the native modal is gone before the push.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { randomUUID } from 'expo-crypto';

import { useDatabase } from '@/components/database-provider';
import {
  listTemplates,
  findTemplateByTriple,
  cloneTemplateWithSubTag,
  type TemplateSummary,
} from '@/src/adapters/sqlite/templateRepository';
import {
  listPrograms,
  getActiveProgram,
  type ProgramSummary,
} from '@/src/adapters/sqlite/programRepository';
import type { ProgramWithCells } from '@/src/domain/program/types';
import { resolveTodayPlan } from '@/src/domain/training/todayPlan';
import { ensureTemplateVariantReady } from '@/src/services/ensureTemplateVariant';
import { StartTemplateSheet } from '@/components/templates/start-template-sheet';
import { RESERVED_NONE_PROGRAM_ID } from '@/src/db/seed/v017ProgramNone';
import { useAppMode } from '@/src/app-mode';
import { t, useLocale } from '@/src/i18n';
import { useTheme, type ThemeTokens } from '@/src/theme';

export type BackfillPick =
  | { kind: 'blank' }
  | { kind: 'template'; template_id: string };

type BackfillSheetProps = {
  visible: boolean;
  /** Localized label of the target day, shown under the title. */
  dateLabel: string;
  /** Target day as local `YYYY-MM-DD` — drives 計劃訓練's scheduled-cell resolve. */
  targetDateISO: string;
  onPick: (pick: BackfillPick) => void;
  onCancel: () => void;
  /**
   * Fires once the picker Modal has FULLY dismissed (iOS onDismiss). The parent
   * defers navigation to here so the native modal is gone before the new screen
   * pushes — pushing while a Modal is still on screen freezes the page.
   */
  onClosed?: () => void;
};

type Step = 'root' | 'templates';

export function BackfillSheet({
  visible,
  dateLabel,
  targetDateISO,
  onPick,
  onCancel,
  onClosed,
}: BackfillSheetProps) {
  // i18n live-switch — this sheet renders t() labels; opt out of memo + sub.
  'use no memo';
  useLocale();
  const db = useDatabase();
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  // ADR-0026 — 極簡模式：no 計劃/強度 concept (hide 計劃訓練 + skip StartTemplateSheet).
  const { isMinimal } = useAppMode();

  const [step, setStep] = useState<Step>('root');
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [programs, setPrograms] = useState<ProgramSummary[]>([]);
  const [activeProgram, setActiveProgram] = useState<ProgramWithCells | null>(
    null,
  );
  // When set, StartTemplateSheet is shown for this template's name to pick
  // (計劃, 強度) before resolving the variant. Null in 極簡 (skipped).
  const [metaTemplate, setMetaTemplate] = useState<TemplateSummary | null>(null);

  // Reset to root + (re)load picker data whenever the sheet opens, so it
  // reflects any template / program edits since last visit.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setStep('root');
    setMetaTemplate(null);
    Promise.all([listTemplates(db), listPrograms(db), getActiveProgram(db)])
      .then(([tpls, progs, active]) => {
        if (cancelled) return;
        setTemplates(tpls);
        setPrograms(progs);
        setActiveProgram(active);
      })
      .catch(() => {
        if (cancelled) return;
        setTemplates([]);
        setPrograms([]);
        setActiveProgram(null);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, db]);

  // 模板訓練 list — dedupe by name (listTemplates is updated_at DESC, so the
  // first occurrence per name is the latest-edited representative).
  const dedupedTemplates = useMemo(() => {
    const byName = new Map<string, TemplateSummary>();
    for (const tpl of templates) {
      if (!byName.has(tpl.name)) byName.set(tpl.name, tpl);
    }
    return [...byName.values()];
  }, [templates]);

  const templatesById = useMemo(() => {
    const map: Record<string, TemplateSummary> = {};
    for (const tpl of templates) map[tpl.id] = tpl;
    return map;
  }, [templates]);

  // Real (non-reserved) programs only — for StartTemplateSheet's 計劃 picker.
  const realPrograms = useMemo(
    () => programs.filter((p) => p.id !== RESERVED_NONE_PROGRAM_ID),
    [programs],
  );

  // 計劃訓練 — AUTO. Resolve the active program's scheduled cell for the target
  // day (same resolver as the live 計劃訓練 row) and hand a template straight to
  // the parent. Rest day / no active program → alert, no session created.
  const onPlannedTraining = async () => {
    const plan = resolveTodayPlan({
      active: activeProgram,
      today: targetDateISO,
      templatesById,
    });
    if (plan.kind === 'no-program') {
      Alert.alert(
        t('alert', 'cannotBackfillPlan'),
        t('alert', 'backfillNoActiveProgram'),
      );
      return;
    }
    if (plan.kind === 'rest') {
      Alert.alert(
        t('alert', 'cannotBackfillPlan'),
        t('alert', 'backfillRestDay'),
      );
      return;
    }
    // 'template' — the 強度 lives on `program_cell.sub_tag`, NOT on the assigned
    // template. The detail subtitle reads the LINKED template's (program,
    // sub_tag), so to surface 計劃·強度 we link the session to a variant
    // classified under (cell.program_id, cell.sub_tag). Find it if it already
    // exists; otherwise CLONE the cell's planned template into that triple so
    // the seeded sets are the planned ones (dedup → no proliferation on repeat
    // backfills).
    const { cell, template } = plan;
    try {
      const existing = await findTemplateByTriple(db, {
        name: template.name,
        program_id: cell.program_id,
        sub_tag: cell.sub_tag,
      });
      const variantId = existing
        ? existing.id
        : await cloneTemplateWithSubTag(db, {
            source_template_id: template.id,
            new_program_id: cell.program_id,
            new_sub_tag: cell.sub_tag,
            uuid: randomUUID,
          });
      onPick({ kind: 'template', template_id: variantId });
    } catch {
      onCancel();
    }
  };

  // 模板訓練 row tap. 極簡 → resolve 通用 (null, null) variant directly (mirror
  // onStartMinimalTemplate); 計劃模式 → open StartTemplateSheet for (計劃, 強度).
  const onTapTemplate = async (tpl: TemplateSummary) => {
    if (isMinimal) {
      try {
        const variantId = await ensureTemplateVariantReady(db, {
          name: tpl.name,
          program_id: null,
          sub_tag: null,
          uuid: randomUUID,
        });
        onPick({ kind: 'template', template_id: variantId });
      } catch {
        onCancel();
      }
      return;
    }
    setMetaTemplate(tpl);
  };

  // StartTemplateSheet 開始(=補訓練) — resolve the (計劃, 強度) variant exactly
  // like onSheetStart, then hand the resolved template_id to the parent.
  const onMetaStart = async (sel: {
    period_id: string;
    intensity_id: string | null;
  }) => {
    if (!metaTemplate) return;
    const program_id =
      sel.period_id === RESERVED_NONE_PROGRAM_ID ? null : sel.period_id;
    try {
      const variantId = await ensureTemplateVariantReady(db, {
        name: metaTemplate.name,
        program_id,
        sub_tag: sel.intensity_id,
        uuid: randomUUID,
      });
      // Do NOT clear metaTemplate here — the parent's onPick closes the whole
      // sheet (visible=false). The StartTemplateSheet onDismiss clears it AFTER
      // the modal is fully gone (avoids a present→dismiss race / reopen flash).
      onPick({ kind: 'template', template_id: variantId });
    } catch {
      setMetaTemplate(null);
      onCancel();
    }
  };

  const headerTitle =
    step === 'templates' ? t('page', 'templateTraining') : t('button', 'backfill');

  const onBack = () => {
    if (step === 'root') onCancel();
    else setStep('root');
  };

  return (
    <>
      <Modal
        visible={visible && metaTemplate == null}
        transparent
        animationType="slide"
        onRequestClose={onCancel}
        onDismiss={() => onClosed?.()}>
        <Pressable style={styles.backdrop} onPress={onCancel}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.topBar}>
              <Pressable onPress={onBack} hitSlop={8}>
                <Text style={styles.topBarBtnText}>
                  {t('common', 'backArrow')}
                </Text>
              </Pressable>
              <View style={styles.topBarTitleCol}>
                <Text style={styles.topBarTitle} numberOfLines={1}>
                  {headerTitle}
                </Text>
                <Text style={styles.topBarSubtitle} numberOfLines={1}>
                  {dateLabel}
                </Text>
              </View>
              <View style={{ width: 50 }} />
            </View>

            <ScrollView
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled">
              {step === 'root' ? (
                <View style={styles.rootBtns}>
                  {/* ADR-0026 — 計劃訓練 hidden in 極簡模式 (no 計劃 concept). */}
                  {isMinimal ? null : (
                    <RootButton
                      label={t('page', 'plannedTraining')}
                      onPress={() => void onPlannedTraining()}
                      styles={styles}
                    />
                  )}
                  <RootButton
                    label={t('page', 'templateTraining')}
                    onPress={() => setStep('templates')}
                    styles={styles}
                  />
                  <RootButton
                    label={t('page', 'freestyleTraining')}
                    onPress={() => onPick({ kind: 'blank' })}
                    styles={styles}
                  />
                </View>
              ) : null}

              {step === 'templates' ? (
                dedupedTemplates.length === 0 ? (
                  <Text style={styles.emptyText}>
                    {t('alert', 'noTemplatesYet')}
                  </Text>
                ) : (
                  dedupedTemplates.map((tpl) => (
                    <TemplateRow
                      key={tpl.id}
                      template={tpl}
                      showSubTag={!isMinimal}
                      onPress={() => onTapTemplate(tpl)}
                      styles={styles}
                    />
                  ))
                )
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 模板訓練 → (計劃, 強度) selection — reused live picker (A: 統一 UI). */}
      <StartTemplateSheet
        visible={visible && metaTemplate != null}
        templateName={metaTemplate?.name ?? ''}
        programs={realPrograms.map((p) => ({ id: p.id, name: p.name }))}
        lastUsedProgramId={metaTemplate?.program_id ?? null}
        lastUsedSubTag={metaTemplate?.sub_tag ?? null}
        hideEdit
        startLabel={t('button', 'backfill')}
        onEdit={() => {}}
        onStart={onMetaStart}
        onCancel={() => setMetaTemplate(null)}
        onDismiss={() => {
          // Clear metaTemplate AFTER the modal is gone (avoids a reopen flash),
          // then let the parent navigate now that the modal is fully dismissed.
          setMetaTemplate(null);
          onClosed?.();
        }}
      />
    </>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function RootButton({
  label,
  onPress,
  styles,
}: {
  label: string;
  onPress: () => void;
  styles: Styles;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.rootBtn, pressed && styles.rootBtnPressed]}>
      <Text style={styles.rootBtnText}>{label}</Text>
    </Pressable>
  );
}

function TemplateRow({
  template,
  showSubTag,
  onPress,
  styles,
}: {
  template: TemplateSummary;
  showSubTag: boolean;
  onPress: () => void;
  styles: Styles;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <Text style={styles.rowTitle} numberOfLines={1}>
        {template.name}
      </Text>
      {showSubTag && template.sub_tag ? (
        <Text style={styles.rowSubTag} numberOfLines={1}>
          {template.sub_tag}
        </Text>
      ) : null}
    </Pressable>
  );
}

function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: tokens.bg.modal,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingBottom: 24,
      maxHeight: '85%',
    },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: tokens.border.subtle,
    },
    topBarTitleCol: { flex: 1, alignItems: 'center' },
    topBarTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: tokens.text.primary,
    },
    topBarSubtitle: {
      fontSize: 12,
      color: tokens.text.secondary,
      marginTop: 2,
    },
    topBarBtnText: {
      fontSize: 15,
      color: tokens.text.secondary,
      minWidth: 50,
    },
    body: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 16,
    },
    rootBtns: { gap: 12 },
    rootBtn: {
      paddingVertical: 18,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: tokens.action.primary,
    },
    rootBtnPressed: { opacity: 0.7 },
    rootBtnText: {
      fontSize: 16,
      fontWeight: '600',
      color: tokens.action.onPrimary,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 14,
      paddingHorizontal: 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: tokens.border.subtle,
    },
    rowPressed: { opacity: 0.6 },
    rowTitle: {
      flex: 1,
      fontSize: 15,
      color: tokens.text.primary,
    },
    rowSubTag: {
      fontSize: 13,
      color: tokens.text.secondary,
      marginLeft: 8,
    },
    emptyText: {
      fontSize: 14,
      color: tokens.text.secondary,
      textAlign: 'center',
      paddingVertical: 32,
    },
  });
}
