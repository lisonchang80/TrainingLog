/**
 * Start-template bottom sheet — picks (計畫, 強度) for a tapped Template
 * before either editing it or starting a session (ADR-0019 §Q9.1a + Q9.2).
 *
 * Layout (per spec mockup):
 *
 *   ╔═══════════════════════════════╗
 *   ║  ‹ 返回         <template>     ║
 *   ║  選擇計畫                      ║
 *   ║  ○ 通用             (固定項)  ║
 *   ║  ◉ 5x5 強度週   (最後使用)    ║
 *   ║  [ + 新增計畫 ]                ║
 *   ║                                ║
 *   ║  選擇強度                      ║
 *   ║  ◉ 10-12RM       (最後使用)   ║
 *   ║  [ + 新增強度 ]                ║
 *   ║                                ║
 *   ║  [編輯模板]    [開始訓練]     ║
 *   ╚═══════════════════════════════╝
 *
 * Period picker = `program` entities (real Program rows). The reserved
 * 「通用」 row (RESERVED_NONE_PROGRAM_ID, seeded by v017) is prepended as a
 * fixed first option per Q9.2 N1 — it's never NULL on schema. Renamed from
 * 「無」 to 「通用」 in the start-template-sheet for naming consistency with
 * template-meta-sheet (round 35 polish).
 *
 * Intensity picker = distinct `template.sub_tag` values **scoped to the
 * currently-selected program** (per-program filter — round 35 polish, mirror
 * of template-meta-sheet round 30). Re-fetched via
 * `listDistinctSubTagsByProgram(db, periodId)` whenever the period selection
 * changes. Hidden entirely when 通用 is selected (per spec: 「無 Program」
 * 三元組無「強度」 概念). null = no selection.
 *
 * Sticky last-selected state is read from `app_settings` via
 * `getSetting<string>(db, 'start_dialog_last_program_id')` /
 * `getSetting<string>(db, 'start_dialog_last_sub_tag')` — see
 * `resolveProgramDefaults` for the fallback rules.
 *
 * Two action buttons:
 *   - [編輯模板]  → `onEdit()`            (close + router.push existing)
 *   - [開始訓練]  → `onStart(program_id, sub_tag)` (close + start session)
 *
 * 「+ 新增計畫 / + 新增強度」 inline CTAs let the user create a new program
 * row / append an in-session sub_tag respectively. New program lands in db
 * via `onCreateProgram`; new sub_tag stays in `localSubTags` until the
 * parent's onStart / onEdit persists sticky.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useDatabase } from '@/components/database-provider';
import { listDistinctSubTagsByProgram } from '@/src/adapters/sqlite/templateRepository';
import { listProgramSubTags } from '@/src/adapters/sqlite/programRepository';
import {
  resolveProgramDefaults,
  type ProgramOption,
} from '@/src/domain/program/resolveProgramDefaults';
import { RESERVED_NONE_PROGRAM_ID } from '@/src/db/seed/v017ProgramNone';
import { t } from '@/src/i18n';
import { useTheme, type ThemeTokens } from '@/src/theme';

type StartTemplateSheetProps = {
  visible: boolean;
  /** Tapped Template's name — shown in the top bar. */
  templateName: string;
  /** Programs from `listPrograms(db)` — caller filters; we prepend 「通用」 here. */
  programs: ProgramOption[];
  /** Sticky last-used program_id (from app_settings). */
  lastUsedProgramId: string | null;
  /** Sticky last-used sub_tag (from app_settings). */
  lastUsedSubTag: string | null;
  /**
   * [編輯模板] handler — caller resolves the (name, period, intensity) triple's
   * editor route. Round 38 polish: sheet no longer threads `template_id` —
   * caller performs lookup-or-spawn from its own `sheetTemplate` reference +
   * the user's (period, intensity) selection.
   */
  onEdit: (selection: {
    period_id: string;
    intensity_id: string | null;
  }) => void;
  /**
   * [開始訓練] handler — caller calls startSessionFromTemplate + persists
   * sticky. Round 38 polish: sheet no longer threads `template_id` — caller
   * performs lookup-or-spawn against its `sheetTemplate` reference + the
   * user's (period, intensity) selection.
   */
  onStart: (selection: {
    period_id: string;
    intensity_id: string | null;
  }) => void;
  onCancel: () => void;
  /**
   * 補訓練 reuse (2026-06-26) — hide the [編輯模板] secondary action so the
   * sheet is purely a (計劃, 強度) picker for a back-dated session. The primary
   * button goes full-width.
   */
  hideEdit?: boolean;
  /** Override the primary action label (default 「開始訓練」; backfill = 補訓練). */
  startLabel?: string;
  /**
   * 補訓練 計劃訓練 (2026-06-26) — the program is already chosen upstream, so
   * hide the 「選擇計畫」 section and keep it fixed to `lastUsedProgramId`;
   * only 「選擇強度」 is pickable.
   */
  lockProgram?: boolean;
  /**
   * 極簡模式 (ADR-0026, 2026-07-01) — 極簡沒有「計劃／強度」概念，所以 BOTH
   * pickers 隱藏，selection 永遠鎖在 (通用, null)。sheet 退化成純「編輯模板 vs
   * 開始訓練」二選一，保留頂欄模板名 + 兩顆動作按鈕。caller 端 onEdit/onStart
   * 需自行走通用-variant 解析（見 index.tsx onSheetEdit 的 isMinimal 分支）。
   */
  hidePickers?: boolean;
  /**
   * iOS — fires once the sheet's Modal has FULLY dismissed. Used by the
   * backfill flow to navigate ONLY after the modal is gone (avoids a stuck
   * modal over the pushed screen).
   */
  onDismiss?: () => void;
};

/**
 * The reserved「無 Program」row, surfaced in the picker as「通用 / Default」
 * (round 35 polish — naming consistency with template-meta-sheet's 通用 chip).
 * The underlying DB row still stores `name = '無'` per v017 seed; we only
 * remap the display label locally — changing the seed would ripple through
 * other sheets that read the program's name directly.
 *
 * Phase 4.5 final: `name` is now resolved at render time via `t('common',
 * 'default')` so locale switches re-render the label correctly.
 */
function makeNoneOption(): ProgramOption {
  return {
    id: RESERVED_NONE_PROGRAM_ID,
    name: t('common', 'default'),
  };
}

export function StartTemplateSheet({
  visible,
  templateName,
  programs,
  lastUsedProgramId,
  lastUsedSubTag,
  onEdit,
  onStart,
  onCancel,
  hideEdit = false,
  startLabel,
  lockProgram = false,
  hidePickers = false,
  onDismiss,
}: StartTemplateSheetProps) {
  const db = useDatabase();
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  // Prepend the reserved 「通用」 to the picker list, dedupe if listPrograms
  // somehow returned it (shouldn't — programRepository filters it out, but
  // defending against future regressions).
  const periodOptions: ProgramOption[] = [
    makeNoneOption(),
    ...programs.filter((p) => p.id !== RESERVED_NONE_PROGRAM_ID),
  ];

  const [periodId, setPeriodId] = useState<string>(RESERVED_NONE_PROGRAM_ID);
  const [intensityId, setIntensityId] = useState<string | null>(null);

  /**
   * Per-program distinct sub_tags (round 35 polish — mirror of
   * template-meta-sheet round 30). Re-fetched whenever the period selection
   * changes. Empty list when periodId === RESERVED_NONE_PROGRAM_ID since the
   * intensity section is hidden in that case. On initial open the list is
   * empty until the per-program-union effect fires (cross-program fallback
   * was removed in round 38+ — the union effect now owns sticky resolution
   * too).
   */
  const [programSubTags, setProgramSubTags] = useState<string[]>([]);

  // Re-resolve defaults each time the sheet opens — sticky state may have
  // changed since last open (e.g. another tab confirmed a session).
  //
  // Round 38+ refactor: we only resolve `period_id` here (against the
  // currently-available `programs`). The intensity sticky is resolved later
  // in the per-program-union useEffect below, against the merged
  // (templates × dictionary) sub_tag list for the resolved period — so the
  // cross-program `subTags` fallback is no longer needed. Pass an empty
  // array to keep the pure-logic contract; the returned `intensity_id` is
  // immediately overwritten by the union effect.
  useEffect(() => {
    if (!visible) return;
    // 極簡模式：無計劃/強度，鎖在 (通用, null)，跳過 sticky 解析。
    if (hidePickers) {
      setPeriodId(RESERVED_NONE_PROGRAM_ID);
      setIntensityId(null);
      setProgramSubTags([]);
      return;
    }
    const defaults = resolveProgramDefaults({
      programs: periodOptions,
      subTags: [],
      lastUsedProgramId,
      lastUsedSubTag,
    });
    setPeriodId(defaults.period_id);
    setIntensityId(null);
    setProgramSubTags([]);
    // periodOptions is recomputed on every render; we intentionally omit it
    // from deps to avoid resetting selection mid-edit. Identity is `visible`
    // + the underlying sticky values + the programs identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, lastUsedProgramId, lastUsedSubTag, programs.length, hidePickers]);

  /**
   * Re-fetch per-program sub_tags whenever the user changes period selection
   * (round 35 polish — mirror template-meta-sheet pattern). When 通用 (=
   * RESERVED_NONE_PROGRAM_ID) is selected we don't fetch — the intensity
   * section is hidden in that case anyway.
   */
  useEffect(() => {
    let cancelled = false;
    if (!visible) return;
    if (periodId === RESERVED_NONE_PROGRAM_ID) {
      setProgramSubTags([]);
      return;
    }
    // Round 15 polish — union of (templates classified under this program)
    // + (program_sub_tag persistent dictionary, v022). The latter remembers
    // any sub_tag the user ever introduced for this program, even if no
    // current template/cell references it. So 「II-2」 typed once via row
    // apply ▶ still shows as a chip option here for re-use.
    Promise.all([
      listDistinctSubTagsByProgram(db, periodId),
      listProgramSubTags(db, periodId),
    ])
      .then(([templateTags, dictionaryTags]) => {
        if (cancelled) return;
        const merged = Array.from(
          new Set([...templateTags, ...dictionaryTags]),
        );
        merged.sort((a, b) => a.localeCompare(b));
        setProgramSubTags(merged);
        // Round 38+ — restore sticky intensity from the per-program union.
        // Previously this only collapsed a stale intensityId; now it also
        // owns the initial sticky-resolution (the open-effect no longer
        // pre-fills intensity from the cross-program `subTags` prop). When
        // the user has switched periods mid-sheet the `prev` value already
        // reflects their explicit choice — keep it if it's still valid,
        // otherwise fall back to the sticky last-used tag if that one is
        // in this program's union, otherwise null.
        setIntensityId((prev) => {
          if (prev != null) return merged.includes(prev) ? prev : null;
          return lastUsedSubTag != null && merged.includes(lastUsedSubTag)
            ? lastUsedSubTag
            : null;
        });
      })
      .catch(() => {
        if (!cancelled) setProgramSubTags([]);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, periodId, db, lastUsedSubTag]);

  const isNoneSelected = periodId === RESERVED_NONE_PROGRAM_ID;
  // When 無 is selected, force intensity to null on confirm (hidden picker).
  const effectiveIntensity = isNoneSelected ? null : intensityId;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
      onDismiss={onDismiss}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.avoider}
      >
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.topBar}>
            <Pressable onPress={onCancel} hitSlop={8}>
              <Text style={styles.topBarBtnText}>{t('common', 'backArrow')}</Text>
            </Pressable>
            <Text style={styles.topBarTitle} numberOfLines={1}>
              {templateName}
            </Text>
            <View style={{ width: 50 }} />
          </View>

          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            {/* 2026-06-04 redesign — 開啟已儲存模板 = 純選擇（不能新增），
                外觀比照 session 詳情頁另存模板的 chip 樣式（grill #1）。新變體
                改由編輯器「另存模板 / 另存強度」建立。sticky last-used 仍會被
                預選（resolveProgramDefaults + per-program union effect），只是
                拿掉了 hint label 以對齊外觀。 */}
            {/* 極簡模式 (hidePickers) — 無計劃/強度，body 只放一行說明，
                動作全靠底部兩顆按鈕。 */}
            {hidePickers && (
              <Text style={styles.minimalHint}>
                {t('page', 'minimalTemplateHint')}
              </Text>
            )}
            {/* 計劃訓練 backfill (lockProgram) — program already chosen
                upstream, so the 「選擇計畫」 picker is hidden; only 強度 shows. */}
            {!lockProgram && !hidePickers && (
              <>
                <Text style={styles.sectionLabel}>
                  {t('page', 'selectProgramAlt')}
                </Text>
                <View style={styles.divider} />
                <View style={styles.chipRow}>
                  {periodOptions.map((opt) => {
                    const isFixedNone = opt.id === RESERVED_NONE_PROGRAM_ID;
                    // Defensive local rename: display「通用」for the reserved row
                    // even if listPrograms ever surfaced the legacy「無」name.
                    const displayName = isFixedNone
                      ? t('common', 'default')
                      : opt.name;
                    return (
                      <Chip
                        key={opt.id}
                        label={displayName}
                        active={opt.id === periodId}
                        onPress={() => setPeriodId(opt.id)}
                        styles={styles}
                      />
                    );
                  })}
                </View>
              </>
            )}

            {!isNoneSelected && (
              <>
                <View style={{ height: 16 }} />
                <Text style={styles.sectionLabel}>{t('page', 'selectIntensity')}</Text>
                <View style={styles.divider} />
                <View style={styles.chipRow}>
                  <Chip
                    label={t('common', 'default')}
                    active={intensityId === null}
                    onPress={() => setIntensityId(null)}
                    styles={styles}
                  />
                  {programSubTags.map((tag) => (
                    <Chip
                      key={tag}
                      label={tag}
                      active={tag === intensityId}
                      onPress={() => setIntensityId(tag)}
                      styles={styles}
                    />
                  ))}
                </View>
              </>
            )}
          </ScrollView>

          <View style={styles.actionRow}>
            {!hideEdit && (
              <Pressable
                onPress={() =>
                  onEdit({
                    period_id: periodId,
                    intensity_id: effectiveIntensity,
                  })
                }
                style={({ pressed }) => [
                  styles.actionBtn,
                  styles.actionBtnSecondary,
                  pressed && styles.actionBtnPressed,
                ]}
                accessibilityRole="button"
              >
                <Text style={styles.actionBtnTextSecondary}>{t('button', 'editTemplate')}</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() =>
                onStart({
                  period_id: periodId,
                  intensity_id: effectiveIntensity,
                })
              }
              style={({ pressed }) => [
                styles.actionBtn,
                styles.actionBtnPrimary,
                pressed && styles.actionBtnPressed,
              ]}
              accessibilityRole="button"
            >
              <Text style={styles.actionBtnTextPrimary}>
                {startLabel ?? t('button', 'startSession')}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

type Styles = ReturnType<typeof makeStyles>;

/**
 * Selectable chip — mirrors components/session/template-meta-sheet.tsx's Chip
 * so the StartTemplateSheet picker matches the session-detail 另存模板 look
 * (2026-06-04 redesign).
 */
function Chip({
  label,
  active,
  onPress,
  styles,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  styles: Styles;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      // HIG-standard modal scrim — mode-agnostic.
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'flex-end',
    },
    avoider: {
      flex: 1,
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
    topBarTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: tokens.text.primary,
      flex: 1,
      textAlign: 'center',
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
    sectionLabel: {
      fontSize: 14,
      fontWeight: '600',
      color: tokens.text.primary,
      marginBottom: 6,
    },
    // 極簡模式 body 的單行說明（無計劃/強度時取代兩個 picker 區）。
    minimalHint: {
      fontSize: 14,
      color: tokens.text.secondary,
      textAlign: 'center',
      paddingVertical: 8,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: tokens.border.subtle,
      marginBottom: 4,
    },
    /**
     * 2026-06-04 redesign — chip picker (mirror of
     * components/session/template-meta-sheet.tsx) so 開啟已儲存模板 looks the
     * same as session-detail 另存模板. Select-only — no inline-add CTA.
     */
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 4,
    },
    chip: {
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 999,
      backgroundColor: tokens.bg.elevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tokens.border.subtle,
    },
    chipActive: {
      backgroundColor: tokens.action.primary,
      borderColor: tokens.action.primary,
    },
    chipText: {
      fontSize: 13,
      color: tokens.action.primary,
    },
    chipTextActive: {
      color: tokens.action.onPrimary,
      fontWeight: '600',
    },
    actionRow: {
      flexDirection: 'row',
      paddingHorizontal: 16,
      paddingTop: 8,
      gap: 12,
    },
    actionBtn: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionBtnPressed: { opacity: 0.7 },
    actionBtnSecondary: {
      backgroundColor: tokens.bg.elevated,
    },
    actionBtnPrimary: {
      backgroundColor: tokens.action.primary,
    },
    actionBtnTextSecondary: {
      fontSize: 15,
      fontWeight: '600',
      color: tokens.text.primary,
    },
    actionBtnTextPrimary: {
      fontSize: 15,
      fontWeight: '600',
      color: tokens.action.onPrimary,
    },
  });
}
