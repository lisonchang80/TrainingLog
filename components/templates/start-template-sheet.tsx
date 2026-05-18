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

import { useEffect, useState } from 'react';
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

import { useDatabase } from '@/components/database-provider';
import { listDistinctSubTagsByProgram } from '@/src/adapters/sqlite/templateRepository';
import {
  resolveProgramDefaults,
  type ProgramOption,
} from '@/src/domain/program/resolveProgramDefaults';
import { RESERVED_NONE_PROGRAM_ID } from '@/src/db/seed/v017ProgramNone';

type StartTemplateSheetProps = {
  visible: boolean;
  /** Tapped Template's name — shown in the top bar. */
  templateName: string;
  /** Programs from `listPrograms(db)` — caller filters; we prepend 「通用」 here. */
  programs: ProgramOption[];
  /**
   * @deprecated Round 35 polish — intensity radios now fetch per-program via
   * `listDistinctSubTagsByProgram(db, programId)` on each period selection.
   * The prop is kept (and still accepted) only as an initial-render fallback
   * before the first useEffect fires + for the `resolveProgramDefaults`
   * sticky-resolution input. Parent should keep passing it for now.
   */
  subTags: string[];
  /** Sticky last-used program_id (from app_settings). */
  lastUsedProgramId: string | null;
  /** Sticky last-used sub_tag (from app_settings). */
  lastUsedSubTag: string | null;
  /** [編輯模板] handler — caller resolves the (name, period, intensity) triple's editor route. */
  onEdit: (selection: { period_id: string; intensity_id: string | null }) => void;
  /** [開始訓練] handler — caller calls startSessionFromTemplate + persists sticky. */
  onStart: (selection: { period_id: string; intensity_id: string | null }) => void;
  /**
   * Create a brand-new Program from the inline「新增計畫」CTA. Caller persists
   * the row + refreshes its own `programs` state, then returns the new
   * `{ id, name }` so the sheet auto-selects it. Throws → silent retry (we
   * keep the inline input visible so user can edit + retry).
   */
  onCreateProgram: (name: string) => Promise<{ id: string; name: string }>;
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
  onCreateProgram,
  onCancel,
}: StartTemplateSheetProps) {
  const db = useDatabase();
  // Prepend the reserved 「通用」 to the picker list, dedupe if listPrograms
  // somehow returned it (shouldn't — programRepository filters it out, but
  // defending against future regressions).
  const periodOptions: ProgramOption[] = [
    NONE_OPTION,
    ...programs.filter((p) => p.id !== RESERVED_NONE_PROGRAM_ID),
  ];

  const [periodId, setPeriodId] = useState<string>(RESERVED_NONE_PROGRAM_ID);
  const [intensityId, setIntensityId] = useState<string | null>(null);

  /**
   * Inline「新增計畫」TextInput state — mirror template-meta-sheet's
   * customProgramMode pattern (round 32 ledger). When `customProgramMode` is
   * true we render an inline TextInput + 建立 button under the period radio
   * list. On success the new program's id is auto-selected and the parent
   * re-fetches `programs` so it shows up in the radio list next render.
   */
  const [customProgramMode, setCustomProgramMode] = useState(false);
  const [customProgramName, setCustomProgramName] = useState('');
  const [creatingProgram, setCreatingProgram] = useState(false);

  /**
   * Inline「新增強度」TextInput state — mirror the new-program pattern. New
   * sub_tag values land in `localSubTags` (in-session only, not persisted —
   * sub_tag is a free-form string column, the new value will reach db when
   * the parent persists sticky in `onStart` / `onEdit`).
   *
   * Dedupe: if user types a name that already exists in `subTags` (from db)
   * or `localSubTags` (in-session), we don't append a duplicate radio row —
   * just activate the existing one.
   */
  const [customSubTagMode, setCustomSubTagMode] = useState(false);
  const [customSubTag, setCustomSubTag] = useState('');
  const [localSubTags, setLocalSubTags] = useState<string[]>([]);

  /**
   * Per-program distinct sub_tags (round 35 polish — mirror of
   * template-meta-sheet round 30). Re-fetched whenever the period selection
   * changes. Empty list when periodId === RESERVED_NONE_PROGRAM_ID since the
   * intensity section is hidden in that case. Initial render before the
   * first useEffect fires falls back to the legacy cross-program `subTags`
   * prop to avoid a flash of empty list on open.
   */
  const [programSubTags, setProgramSubTags] = useState<string[]>([]);

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
    // Reset inline-add state so they don't persist across opens.
    setCustomProgramMode(false);
    setCustomProgramName('');
    setCreatingProgram(false);
    setCustomSubTagMode(false);
    setCustomSubTag('');
    setLocalSubTags([]);
    setProgramSubTags([]);
    // periodOptions is recomputed on every render; we intentionally omit it
    // from deps to avoid resetting selection mid-edit. Identity is `visible`
    // + the underlying sticky values + raw inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, lastUsedProgramId, lastUsedSubTag, subTags.join('|'), programs.length]);

  /**
   * Re-fetch per-program sub_tags whenever the user changes period selection
   * (round 35 polish — mirror template-meta-sheet pattern). When 通用 (=
   * RESERVED_NONE_PROGRAM_ID) is selected we don't fetch — the intensity
   * section is hidden in that case anyway. Switching periods also clears the
   * in-session `localSubTags` so user-added tags from a previous program
   * don't bleed across.
   */
  useEffect(() => {
    let cancelled = false;
    if (!visible) return;
    if (periodId === RESERVED_NONE_PROGRAM_ID) {
      setProgramSubTags([]);
      setLocalSubTags([]);
      return;
    }
    setLocalSubTags([]);
    listDistinctSubTagsByProgram(db, periodId)
      .then((tags) => {
        if (cancelled) return;
        setProgramSubTags(tags);
        // If the previously-resolved intensityId is no longer present in this
        // program's sub_tags (e.g. user switched programs and the prior tag
        // doesn't apply), collapse to null = 通用 so the radio doesn't show
        // a phantom selection.
        setIntensityId((prev) =>
          prev != null && !tags.includes(prev) ? null : prev
        );
      })
      .catch(() => {
        if (!cancelled) setProgramSubTags([]);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, periodId, db]);

  const isNoneSelected = periodId === RESERVED_NONE_PROGRAM_ID;
  // When 無 is selected, force intensity to null on confirm (hidden picker).
  const effectiveIntensity = isNoneSelected ? null : intensityId;

  /**
   * Confirm an in-session new sub_tag from the inline TextInput. Pure local
   * state — no db write.
   *
   * Dup guard (case-insensitive): collide against db-loaded `subTags` +
   * in-session `localSubTags` → Alert + keep inline input open for retry.
   * Casing preserved on append (we store the original trimmed input).
   */
  const handleConfirmNewSubTag = () => {
    const trimmed = customSubTag.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    const isDuplicate = [...programSubTags, ...localSubTags].some(
      (t) => t.toLowerCase() === lower
    );
    if (isDuplicate) {
      Alert.alert('無法新增強度', '強度名稱已存在，請改用別的名稱。');
      return;
    }
    setLocalSubTags((prev) => [...prev, trimmed]);
    setIntensityId(trimmed);
    setCustomSubTagMode(false);
    setCustomSubTag('');
  };

  const handleConfirmNewProgram = async () => {
    const trimmed = customProgramName.trim();
    if (!trimmed || trimmed.length > 60) return;
    setCreatingProgram(true);
    try {
      const created = await onCreateProgram(trimmed);
      // Auto-select the new program and exit inline mode.
      setPeriodId(created.id);
      setCustomProgramMode(false);
      setCustomProgramName('');
    } catch (err) {
      // Dup name (parent's handleCreateProgram → createProgram throws
      // 'DUPLICATE_PROGRAM_NAME') → Alert + keep inline state intact so the
      // user can edit + retry. Other errors → quiet console.warn fallback.
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'DUPLICATE_PROGRAM_NAME') {
        Alert.alert('無法建立計畫', '計畫名稱已存在，請改用別的名稱。');
      } else {
        console.warn('[StartTemplateSheet] createProgram failed:', err);
      }
    } finally {
      setCreatingProgram(false);
    }
  };

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
            <Text style={styles.sectionLabel}>選擇計畫</Text>
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

            {/*
             * 「新增計畫」inline CTA — mirror template-meta-sheet pattern (round
             * 30 + 32). Tap shows an inline TextInput + 建立 button; on success
             * the parent creates the Program row + refreshes its `programs`
             * state, returning {id, name} so we auto-select the new option.
             */}
            <Pressable
              onPress={() => {
                setCustomProgramMode(true);
                setCustomProgramName('');
              }}
              style={[styles.addCta, customProgramMode && styles.addCtaActive]}
            >
              <Text style={styles.addCtaText}>新增計畫</Text>
            </Pressable>
            {customProgramMode ? (
              <View style={styles.inlineRow}>
                <TextInput
                  style={[styles.input, styles.inlineInput]}
                  value={customProgramName}
                  onChangeText={setCustomProgramName}
                  placeholder="輸入新計畫名稱（≤ 60 字）"
                  placeholderTextColor="#9ca3af"
                  maxLength={60}
                  editable={!creatingProgram}
                />
                <Pressable
                  onPress={handleConfirmNewProgram}
                  hitSlop={8}
                  disabled={
                    creatingProgram ||
                    customProgramName.trim().length === 0
                  }
                  style={[
                    styles.inlineConfirm,
                    (creatingProgram ||
                      customProgramName.trim().length === 0) &&
                      styles.inlineConfirmDisabled,
                  ]}
                >
                  <Text style={styles.inlineConfirmText}>
                    {creatingProgram ? '建立中…' : '建立'}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {!isNoneSelected && (
              <>
                <View style={{ height: 16 }} />
                <Text style={styles.sectionLabel}>選擇強度</Text>
                <View style={styles.divider} />
                {/*
                 * Fixed 通用 row (round 35 polish) — represents `sub_tag = null`
                 * within the picked program, aligning with template-meta-sheet
                 * which uses「通用」label for the null sub_tag chip. Selected
                 * state hinges on `intensityId === null && !customSubTagMode`
                 * to avoid showing 通用 as selected while the user is typing a
                 * brand-new sub_tag name.
                 */}
                {(() => {
                  const isSelected =
                    intensityId === null && !customSubTagMode;
                  return (
                    <Pressable
                      onPress={() => {
                        setIntensityId(null);
                        setCustomSubTagMode(false);
                      }}
                      style={({ pressed }) => [
                        styles.row,
                        pressed && styles.rowPressed,
                      ]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isSelected }}
                    >
                      <Text style={styles.radio}>
                        {isSelected ? '◉' : '○'}
                      </Text>
                      <Text style={styles.rowName}>通用</Text>
                      <Text style={styles.rowHint}>(固定項)</Text>
                    </Pressable>
                  );
                })()}
                {[...programSubTags, ...localSubTags].map((tag) => {
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
                })}
                <Pressable
                  onPress={() => {
                    setCustomSubTagMode(true);
                    setCustomSubTag('');
                  }}
                  style={[
                    styles.addCta,
                    customSubTagMode && styles.addCtaActive,
                  ]}
                >
                  <Text style={styles.addCtaText}>新增強度</Text>
                </Pressable>
                {customSubTagMode ? (
                  <View style={styles.inlineRow}>
                    <TextInput
                      style={[styles.input, styles.inlineInput]}
                      value={customSubTag}
                      onChangeText={setCustomSubTag}
                      placeholder="輸入新強度標籤（如 5x5、最大力量）"
                      placeholderTextColor="#9ca3af"
                    />
                    <Pressable
                      onPress={handleConfirmNewSubTag}
                      hitSlop={8}
                      disabled={customSubTag.trim().length === 0}
                      style={[
                        styles.inlineConfirm,
                        customSubTag.trim().length === 0 &&
                          styles.inlineConfirmDisabled,
                      ]}
                    >
                      <Text style={styles.inlineConfirmText}>建立</Text>
                    </Pressable>
                  </View>
                ) : null}
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
  /**
   * Primary CTA「新增計畫 / 強度」— always blue-solid white-text so the entry
   * point visually stands out from the radio rows above. Active state darkens
   * the fill slightly to signal「inline-add mode is open」. Mirrors
   * components/session/template-meta-sheet.tsx (round 32).
   */
  addCta: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#007AFF',
    marginTop: 6,
  },
  addCtaActive: {
    backgroundColor: '#0050B3',
  },
  addCtaText: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '600',
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#f9fafb',
  },
  inlineInput: {
    flex: 1,
  },
  inlineConfirm: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#007AFF',
  },
  inlineConfirmDisabled: {
    opacity: 0.4,
  },
  inlineConfirmText: {
    color: '#fff',
    fontSize: 14,
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
