/**
 * Start-template bottom sheet — picks (週期, 強度) for a tapped Template
 * before either editing it or starting a session (ADR-0019 §Q9.1a + Q9.2).
 *
 * Layout (per spec mockup):
 *
 *   ╔═══════════════════════════════╗
 *   ║  ‹ 返回         <template>     ║
 *   ║  選擇週期                      ║
 *   ║  ○ 無               (固定項)  ║
 *   ║  ◉ 5x5 強度週   (最後使用)    ║
 *   ║  [ + 新增週期 ]                ║   ← deferred to next slice
 *   ║                                ║
 *   ║  選擇強度                      ║
 *   ║  ◉ 10-12RM       (最後使用)   ║
 *   ║  [ + 新增強度 ]                ║   ← deferred to next slice
 *   ║                                ║
 *   ║  [編輯模板]    [開始訓練]     ║
 *   ╚═══════════════════════════════╝
 *
 * Period picker = `program` entities (real Program rows). The reserved
 * 「無」 row (RESERVED_NONE_PROGRAM_ID, seeded by v017) is prepended as a
 * fixed first option per Q9.2 N1 — it's never NULL on schema.
 *
 * Intensity picker = distinct `template.sub_tag` values across all templates.
 * Hidden entirely when 無 is selected (per spec: 「無 Program」 三元組無
 * 「強度」 概念). null = no selection.
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
 * Picker `[+ 新增週期 / 強度]` actions are tracked but deferred — Q9.2 P1
 * specifies the modal-push behaviour but slice 10c ships read-only picker
 * (next slice extends to create-and-auto-select).
 */

import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  resolveProgramDefaults,
  type ProgramOption,
} from '@/src/domain/program/resolveProgramDefaults';
import { RESERVED_NONE_PROGRAM_ID } from '@/src/db/seed/v017ProgramNone';

type StartTemplateSheetProps = {
  visible: boolean;
  /** Tapped Template's name — shown in the top bar. */
  templateName: string;
  /** Programs from `listPrograms(db)` — caller filters; we prepend 「無」 here. */
  programs: ProgramOption[];
  /** Distinct sub_tag strings from `listDistinctSubTags(db)`. */
  subTags: string[];
  /** Sticky last-used program_id (from app_settings). */
  lastUsedProgramId: string | null;
  /** Sticky last-used sub_tag (from app_settings). */
  lastUsedSubTag: string | null;
  /** [編輯模板] handler — caller resolves the (name, period, intensity) triple's editor route. */
  onEdit: (selection: { period_id: string; intensity_id: string | null }) => void;
  /** [開始訓練] handler — caller calls startSessionFromTemplate + persists sticky. */
  onStart: (selection: { period_id: string; intensity_id: string | null }) => void;
  onCancel: () => void;
};

const NONE_OPTION: ProgramOption = {
  id: RESERVED_NONE_PROGRAM_ID,
  name: '無',
};

export function StartTemplateSheet({
  visible,
  templateName,
  programs,
  subTags,
  lastUsedProgramId,
  lastUsedSubTag,
  onEdit,
  onStart,
  onCancel,
}: StartTemplateSheetProps) {
  // Prepend the reserved 「無」 to the picker list, dedupe if listPrograms
  // somehow returned it (shouldn't — programRepository filters it out, but
  // defending against future regressions).
  const periodOptions: ProgramOption[] = [
    NONE_OPTION,
    ...programs.filter((p) => p.id !== RESERVED_NONE_PROGRAM_ID),
  ];

  const [periodId, setPeriodId] = useState<string>(RESERVED_NONE_PROGRAM_ID);
  const [intensityId, setIntensityId] = useState<string | null>(null);

  // Re-resolve defaults each time the sheet opens — sticky state may have
  // changed since last open (e.g. another tab confirmed a session).
  useEffect(() => {
    if (!visible) return;
    const defaults = resolveProgramDefaults({
      programs: periodOptions,
      subTags,
      lastUsedProgramId,
      lastUsedSubTag,
    });
    setPeriodId(defaults.period_id);
    setIntensityId(defaults.intensity_id);
    // periodOptions is recomputed on every render; we intentionally omit it
    // from deps to avoid resetting selection mid-edit. Identity is `visible`
    // + the underlying sticky values + raw inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, lastUsedProgramId, lastUsedSubTag, subTags.join('|'), programs.length]);

  const isNoneSelected = periodId === RESERVED_NONE_PROGRAM_ID;
  // When 無 is selected, force intensity to null on confirm (hidden picker).
  const effectiveIntensity = isNoneSelected ? null : intensityId;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.topBar}>
            <Pressable onPress={onCancel} hitSlop={8}>
              <Text style={styles.topBarBtnText}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.topBarTitle} numberOfLines={1}>
              {templateName}
            </Text>
            <View style={{ width: 50 }} />
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            <Text style={styles.sectionLabel}>選擇週期</Text>
            <View style={styles.divider} />
            {periodOptions.map((opt) => {
              const isSelected = opt.id === periodId;
              const isFixedNone = opt.id === RESERVED_NONE_PROGRAM_ID;
              const isLastUsed = !isFixedNone && opt.id === lastUsedProgramId;
              return (
                <Pressable
                  key={opt.id}
                  onPress={() => setPeriodId(opt.id)}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && styles.rowPressed,
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                >
                  <Text style={styles.radio}>{isSelected ? '◉' : '○'}</Text>
                  <Text style={styles.rowName}>{opt.name}</Text>
                  {isFixedNone && <Text style={styles.rowHint}>(固定項)</Text>}
                  {isLastUsed && <Text style={styles.rowHint}>(最後使用)</Text>}
                </Pressable>
              );
            })}

            {!isNoneSelected && (
              <>
                <View style={{ height: 16 }} />
                <Text style={styles.sectionLabel}>選擇強度</Text>
                <View style={styles.divider} />
                {subTags.length === 0 ? (
                  <Text style={styles.emptyText}>
                    （還沒有強度標籤；下一個 slice 提供「+ 新增強度」）
                  </Text>
                ) : (
                  subTags.map((tag) => {
                    const isSelected = tag === intensityId;
                    const isLastUsed = tag === lastUsedSubTag;
                    return (
                      <Pressable
                        key={tag}
                        onPress={() => setIntensityId(tag)}
                        style={({ pressed }) => [
                          styles.row,
                          pressed && styles.rowPressed,
                        ]}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: isSelected }}
                      >
                        <Text style={styles.radio}>{isSelected ? '◉' : '○'}</Text>
                        <Text style={styles.rowName}>{tag}</Text>
                        {isLastUsed && (
                          <Text style={styles.rowHint}>(最後使用)</Text>
                        )}
                      </Pressable>
                    );
                  })
                )}
              </>
            )}
          </ScrollView>

          <View style={styles.actionRow}>
            <Pressable
              onPress={() =>
                onEdit({ period_id: periodId, intensity_id: effectiveIntensity })
              }
              style={({ pressed }) => [
                styles.actionBtn,
                styles.actionBtnSecondary,
                pressed && styles.actionBtnPressed,
              ]}
              accessibilityRole="button"
            >
              <Text style={styles.actionBtnTextSecondary}>編輯模板</Text>
            </Pressable>
            <Pressable
              onPress={() =>
                onStart({ period_id: periodId, intensity_id: effectiveIntensity })
              }
              style={({ pressed }) => [
                styles.actionBtn,
                styles.actionBtnPrimary,
                pressed && styles.actionBtnPressed,
              ]}
              accessibilityRole="button"
            >
              <Text style={styles.actionBtnTextPrimary}>開始訓練</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
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
    borderBottomColor: '#e5e7eb',
  },
  topBarTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    flex: 1,
    textAlign: 'center',
  },
  topBarBtnText: {
    fontSize: 15,
    color: '#6b7280',
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
    color: '#374151',
    marginBottom: 6,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#e5e7eb',
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    gap: 10,
  },
  rowPressed: { opacity: 0.6 },
  radio: {
    fontSize: 18,
    color: '#111827',
    width: 22,
    textAlign: 'center',
  },
  rowName: {
    fontSize: 15,
    color: '#111827',
    flexShrink: 1,
  },
  rowHint: {
    fontSize: 13,
    color: '#6b7280',
    marginLeft: 'auto',
  },
  emptyText: {
    fontSize: 13,
    color: '#9ca3af',
    fontStyle: 'italic',
    paddingVertical: 8,
    paddingHorizontal: 4,
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
    backgroundColor: '#f3f4f6',
  },
  actionBtnPrimary: {
    backgroundColor: '#0a7ea4',
  },
  actionBtnTextSecondary: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
  },
  actionBtnTextPrimary: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
});
