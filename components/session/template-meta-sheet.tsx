/**
 * Bottom sheet for 「另存模板」(create-mode convertSessionToTemplate).
 *
 * 2026-05-18 UX: 另存模板按下後跳這個 sheet，引導用戶填 Template 的 3 元組
 * (name + program_id + sub_tag)。name 必填 (空白 fallback 預設名)，
 * program / sub_tag 可選 (null = 通用 / free template)。
 *
 * 2026-05-18 polish (round 30):
 *   - 「不指定」label 改為「通用」(more natural)
 *   - 選「通用」(program_id = null) 時整個強度標籤 section 隱藏 — 通用 template
 *     沒有 program scope，自然也沒有強度概念
 *   - 強度 chip 列只顯示**該 program** 既有的 distinct sub_tags (per-program
 *     filter)，避免跨 program 混顯造成的視覺噪音
 *   - 「自訂」chip rename 為「+ 新增強度」(行為不變 — 點下去切換 inline TextInput)
 *   - 「+ 新增計畫」inline TextInput：mirror 強度的 inline 建立 pattern；只填
 *     name，其他 ProgramCore 欄位用 reasonable defaults (cycle_length=3 是
 *     ADR-0004 最小合法值 / cycle_count=1 / start_date=今日 / main_tag=null /
 *     is_active=0)。用戶可事後到 Program 編輯頁補完整 cycle structure。
 *
 * 2026-05-18 polish (round 32):
 *   - 「新增計畫」/「新增強度」chip 改成藍底白字 primary CTA Pressable
 *     (永遠藍底白字，不隨 active toggle 變淡)，讓「新增」入口從 toggle chip
 *     之中視覺脫穎而出。Active state 改用更深的 #0050B3 微暗一階，仍可辨識。
 *   - 「新增強度」inline TextInput 加「建立」按鈕 (mirror 計畫 pattern)；
 *     新標籤 in-session 暫存到 `localSubTags`，不寫 db（sub_tag 是 free-form
 *     string，落 db 在儲存模板時）。重複名稱不 duplicate chip — 直接 active。
 *
 * Mirrors `components/session/body-data-sheet.tsx`:
 *   Modal { transparent, animationType: 'slide' }
 *   <Pressable backdrop /> → tap-out cancels
 *   <Pressable sheet />    → swallows touches
 *   [取消] [另存模板] [儲存]  top bar
 *
 * 「儲存模板」(update mode) 不走這條路 — update 沿用 linked template 既有的
 * program_id / sub_tag，所以 caller 仍可以用 Alert.prompt 改名。
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { randomUUID } from 'expo-crypto';

import { useDatabase } from '@/components/database-provider';
import { listDistinctSubTagsByProgram } from '@/src/adapters/sqlite/templateRepository';
import { listProgramSubTags } from '@/src/adapters/sqlite/programRepository';
import {
  createProgram,
  listPrograms,
  setActiveProgram,
  type ProgramSummary,
} from '@/src/adapters/sqlite/programRepository';
import { utcMsToIsoDate } from '@/src/domain/program/programManager';
import { getLocale, t } from '@/src/i18n';
import { useTheme, type ThemeTokens } from '@/src/theme';

/**
 * Inline dynamic helper — 4-variant template-meta-sheet help hint copy.
 * Kept local rather than added to `src/i18n/dynamic.ts` (sheet-only usage).
 */
function tTemplateMetaHint(omitName: boolean, programIsDefault: boolean): string {
  const en = getLocale() === 'en';
  if (omitName) {
    return programIsDefault
      ? en
        ? 'When program is "Default", intensity is not set (= free template).'
        : '計畫選「通用」時不指定強度（= 自由模板）。'
      : en
        ? 'Intensity can be "Default" or a new tag.'
        : '強度可選「通用」或新增。';
  }
  return programIsDefault
    ? en
      ? 'Name is required. When program is "Default", intensity is not set (= free template).'
      : '名稱必填、計畫選「通用」時不指定強度（= 自由模板）。'
    : en
      ? 'Name is required. Intensity can be "Default" or a new tag.'
      : '名稱必填、強度可選「通用」或新增。';
}

interface TemplateMetaSheetProps {
  visible: boolean;
  /**
   * Top-bar title. Defaults to '另存模板' (session detail caller). Template
   * editor caller passes '儲存模板' instead (round 15 polish, programs tab
   * 「+ 建立新模板」flow — same sheet used to confirm program + sub_tag at
   * save time inside the template editor).
   */
  title?: string;
  /**
   * Hide the 名稱 input row entirely. Used by template editor caller where
   * the name already lives in the editor body — the sheet only needs to
   * confirm program + sub_tag. The defaultName is still passed through to
   * onConfirm.name unchanged.
   */
  omitName?: boolean;
  /** Default fallback used when user leaves name blank. */
  defaultName: string;
  /**
   * Pre-selected program_id when the sheet opens. Used by the session detail
   * 另存模板 flow to prefill from the session's linked template (2026-05-20
   * overnight #55) — template-based session opens with the linked template's
   * (name, program, sub_tag); freestyle session opens with all three blank
   * (`undefined`/`null` here, blank `defaultName` over there). `undefined`
   * means "no prefill" (existing call sites; behave as before).
   */
  defaultProgramId?: string | null;
  /** Pre-selected sub_tag when the sheet opens. See `defaultProgramId`. */
  defaultSubTag?: string | null;
  /**
   * Round 15 polish — when set, the inline 「+ 新增計畫」 helper seeds the new
   * Program with these dimensions / start_date instead of the minimal
   * defaults (cycle_length=3 / cycle_count=1 / start_date=today). Used by
   * the template-editor caller in import mode so a freshly-created program
   * inherits the originating cell's program shape, avoiding the "原循環天數
   * 跑掉了" UX surprise. `undefined` = keep minimal defaults (session-detail
   * caller's existing behavior).
   */
  defaultProgramDimensions?: {
    cycle_length: number;
    cycle_count: number;
    start_date: string;
  };
  /** Existing programs from listPrograms (excludes the reserved 「無」 row). */
  programs: ProgramSummary[];
  onCancel: () => void;
  onConfirm: (args: {
    name: string;
    program_id: string | null;
    sub_tag: string | null;
  }) => void;
  /** Disables save while parent's DB write is in flight. */
  busy?: boolean;
}

export function TemplateMetaSheet({
  visible,
  title,
  omitName = false,
  defaultName,
  defaultProgramId,
  defaultSubTag,
  defaultProgramDimensions,
  programs,
  onCancel,
  onConfirm,
  busy = false,
}: TemplateMetaSheetProps) {
  // Default title resolved at call time so locale switches at runtime propagate.
  const resolvedTitle = title ?? t('button', 'saveAsTemplate');
  const db = useDatabase();
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const [name, setName] = useState(defaultName);
  const [programId, setProgramId] = useState<string | null>(
    defaultProgramId ?? null,
  );
  const [subTag, setSubTag] = useState<string | null>(defaultSubTag ?? null);
  const [customSubTag, setCustomSubTag] = useState('');
  const [customMode, setCustomMode] = useState(false);
  /** Per-program distinct sub_tags, re-fetched whenever programId changes. */
  const [subTags, setSubTags] = useState<string[]>([]);
  /**
   * In-session user-added sub_tags (via「新增強度」→「建立」button). Not
   * persisted to db — sub_tag is a free-form string column, the new tag lands
   * in db only when the parent's `onConfirm` insert fires. Rendered alongside
   * `subTags` so the new chip appears immediately. Cleared on each open.
   */
  const [localSubTags, setLocalSubTags] = useState<string[]>([]);
  /**
   * Local copy of the program list — seeded from props on open and grows when
   * the user creates a new program via the「+ 新增計畫」inline input. We don't
   * push back into the parent's state; parent re-fetches `listPrograms` on
   * each open so any program created here surfaces next time the sheet opens.
   */
  const [programList, setProgramList] = useState<ProgramSummary[]>(programs);
  /** Inline「+ 新增計畫」TextInput state — mirrors the「+ 新增強度」pattern. */
  const [customProgramMode, setCustomProgramMode] = useState(false);
  const [customProgramName, setCustomProgramName] = useState('');
  const [creatingProgram, setCreatingProgram] = useState(false);

  // Reset state on each open so the sheet is fresh. 2026-05-20 overnight #55:
  // honor `defaultProgramId` / `defaultSubTag` for prefill (template-based
  // session uses linked template's identity). When `defaultSubTag` is set,
  // seed it into `localSubTags` so the chip renders immediately — the
  // per-program DB fetch below appends to that set (dedup happens via the
  // [...subTags, ...localSubTags] render path).
  //
  // Round 15 polish: preserve inline-typed state across sheet re-opens
  //   (`localSubTags`, `customSubTag`, `customMode`, `customProgramMode`,
  //   `customProgramName`) so accidental backdrop-tap doesn't lose the
  //   user's typed-but-unsaved chips. `programList` is re-fetched from DB
  //   on every open via the secondary effect below so freshly-created
  //   programs (already persisted) reappear without parent involvement.
  useEffect(() => {
    if (visible) {
      setName(defaultName);
      setProgramId(defaultProgramId ?? null);
      setSubTag(defaultSubTag ?? null);
      setSubTags([]);
      // localSubTags / customSubTag / customMode / customProgramMode /
      // customProgramName intentionally NOT reset here — preserves inline
      // user input across sheet open/close pairs within the same parent
      // session. They're cleared individually by handleConfirm /
      // handleConfirmNewSubTag / handleConfirmNewProgram on success.
      setCreatingProgram(false);
    }
  }, [visible, defaultName, defaultProgramId, defaultSubTag]);

  // Round 15 polish: re-fetch the programs list on every open so an
  // inline-created program (already persisted via `createProgram` in
  // handleConfirmNewProgram) reappears as a chip after the sheet is
  // dismissed and re-opened. Otherwise the sheet inherits the parent's
  // potentially-stale `programs` prop which doesn't include the new one.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    listPrograms(db)
      .then((progs) => {
        if (!cancelled) setProgramList(progs);
      })
      .catch(() => {
        if (!cancelled) setProgramList(programs);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, db, programs]);

  // Re-fetch per-program sub_tags when the user changes program selection.
  // null program → no fetch, section is hidden entirely.
  //
  // 2026-05-20 overnight #55: when the sheet opens with a prefilled `subTag`
  // that may not appear in the DB-fetched list (e.g. the linked template's
  // sub_tag was the only row with that value), we keep it in `localSubTags`
  // so the chip renders + stays active. Stale tags from a previous program
  // are dropped via `keepTags` filter (only keep the currently-selected one
  // if any).
  useEffect(() => {
    let cancelled = false;
    if (!visible) return;
    if (programId == null) {
      setSubTags([]);
      setLocalSubTags([]);
      // Reset 強度 state when switching back to 通用.
      setSubTag(null);
      setCustomMode(false);
      setCustomSubTag('');
      return;
    }
    // Switching to a different program → drop the previous program's in-session
    // tags so they don't bleed across programs. Preserve only the currently
    // active prefill subTag (if any) so its chip survives across the fetch.
    setLocalSubTags((prev) =>
      subTag != null && prev.includes(subTag) ? [subTag] : [],
    );
    // Wave 18g smoke fix — union of two sources:
    //   (a) `listDistinctSubTagsByProgram` — sub_tags currently classified
    //       on templates (legacy / wave-pre-22 path).
    //   (b) `listProgramSubTags` — v022 persistent dictionary; remembers
    //       every sub_tag the program-wizard or row-apply ever introduced,
    //       even if no template references it yet. Without this union the
    //       「儲存模板」 sheet would only show classifications that hit a
    //       template, dropping every dictionary-only label (e.g. user
    //       typed GG-2 in Step 1 but no template attached to GG yet).
    //   Mirror of start-template-sheet's same fix.
    Promise.all([
      listDistinctSubTagsByProgram(db, programId),
      listProgramSubTags(db, programId),
    ])
      .then(([templateTags, dictionaryTags]) => {
        if (cancelled) return;
        const merged = Array.from(
          new Set([...templateTags, ...dictionaryTags]),
        );
        merged.sort((a, b) => a.localeCompare(b));
        setSubTags(merged);
        // If the prefilled subTag isn't already in the merged list, keep
        // it in localSubTags so the chip remains visible + active.
        if (subTag != null && !merged.includes(subTag)) {
          setLocalSubTags((prev) =>
            prev.includes(subTag) ? prev : [...prev, subTag],
          );
        } else if (subTag != null && merged.includes(subTag)) {
          // The merged list already has it — drop the duplicate from localSubTags.
          setLocalSubTags((prev) => prev.filter((t) => t !== subTag));
        }
      })
      .catch(() => {
        if (!cancelled) setSubTags([]);
      });
    return () => {
      cancelled = true;
    };
    // We intentionally exclude `subTag` from the dep array — `subTag` is
    // driven BY this effect's results in the prefill case, so adding it would
    // cause a re-fetch loop on user chip-tap. The prefill path runs once on
    // open (programId changes from null → prefilled) and reads `subTag` from
    // the closure of that first run, which is exactly what we want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, programId, db]);

  const handleConfirmNewProgram = async () => {
    const trimmedName = customProgramName.trim();
    if (!trimmedName || trimmedName.length > 60) return;
    setCreatingProgram(true);
    try {
      const newId = randomUUID();
      const today = utcMsToIsoDate(Date.now());
      // Inherit dimensions from caller-provided default (round 15 polish —
      // programs tab "+ 建立新模板" import caller passes the originating
      // cell's program shape so the new program isn't forced to 1×3).
      // Falls back to ADR-0004-minimum 3×1 today when caller doesn't set it
      // (session-detail 另存模板 caller's existing UX).
      const seedLength = defaultProgramDimensions?.cycle_length ?? 3;
      const seedCount = defaultProgramDimensions?.cycle_count ?? 1;
      const seedStart = defaultProgramDimensions?.start_date ?? today;
      await createProgram(db, {
        program: {
          id: newId,
          name: trimmedName,
          main_tag: null,
          cycle_length: seedLength,
          cycle_count: seedCount,
          start_date: seedStart,
          is_active: 0,
        },
      });
      // Match wizard-path UX (app/program-wizard/new.tsx) — newly-created
      // program becomes the active one so 訓練 tab「計劃訓練」row + Watch
      // picker pick it up without an extra user step. Atomic per
      // setActiveProgram impl (single transaction clears every other row).
      await setActiveProgram(db, { id: newId });
      // Append to local chip list (parent will re-fetch next open).
      // Match the ProgramSummary shape — cellCount = 0 since we didn't seed cells.
      const newSummary: ProgramSummary = {
        id: newId,
        name: trimmedName,
        main_tag: null,
        cycle_length: seedLength,
        cycle_count: seedCount,
        start_date: seedStart,
        is_active: 1,
        cellCount: 0,
      };
      setProgramList((prev) => [
        ...prev.map((p) => (p.is_active ? { ...p, is_active: 0 as const } : p)),
        newSummary,
      ]);
      setProgramId(newId);
      setCustomProgramMode(false);
      setCustomProgramName('');
    } catch (err) {
      // Dup name (createProgram throws 'DUPLICATE_PROGRAM_NAME' case-insensitive
      // + trim) → Alert + keep inline state intact so user can edit + retry.
      // Other errors → quiet console.warn fallback (same inline-retry UX).
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'DUPLICATE_PROGRAM_NAME') {
        Alert.alert(t('alert', 'programNameExists'), t('alert', 'programNameExistsMsg'));
      } else {
        console.warn('[TemplateMetaSheet] createProgram failed:', err);
      }
    } finally {
      setCreatingProgram(false);
    }
  };

  /**
   * Confirm an in-session new sub_tag from the inline TextInput. Pure local
   * state — no db write (sub_tag is just a string column, it lands when the
   * parent's onConfirm fires with this subTag value).
   *
   * Dup guard (case-insensitive): if the trimmed name (lower-cased) collides
   * with either the fetched `subTags` (per-program distinct from db) or the
   * in-session `localSubTags`, surface an Alert and keep the inline input
   * open so the user can rename + retry. Casing is preserved on append —
   * we store the user's original trimmed input, not the lower-cased form.
   */
  const handleConfirmNewSubTag = () => {
    const trimmed = customSubTag.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    const isDuplicate = [...subTags, ...localSubTags].some(
      (t) => t.toLowerCase() === lower
    );
    if (isDuplicate) {
      Alert.alert(t('alert', 'variantExists'), t('alert', 'intensityNameExists'));
      return;
    }
    setLocalSubTags((prev) => [...prev, trimmed]);
    setSubTag(trimmed);
    setCustomMode(false);
    setCustomSubTag('');
  };

  const handleConfirm = () => {
    const trimmed = name.trim() || defaultName;
    // 通用 program → always null sub_tag (section hidden).
    const finalSubTag =
      programId == null
        ? null
        : customMode
          ? customSubTag.trim() || null
          : subTag;
    onConfirm({
      name: trimmed,
      program_id: programId,
      sub_tag: finalSubTag,
    });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onCancel}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.avoider}
      >
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.topBar}>
            <Pressable onPress={onCancel} hitSlop={8} disabled={busy}>
              <Text
                style={[
                  styles.topBarBtnText,
                  busy && styles.topBarBtnDisabled,
                ]}
              >
                {t('common', 'cancel')}
              </Text>
            </Pressable>
            <Text style={styles.topBarTitle}>{resolvedTitle}</Text>
            <Pressable onPress={handleConfirm} hitSlop={8} disabled={busy}>
              <Text
                style={[
                  styles.topBarBtnText,
                  styles.topBarConfirm,
                  busy && styles.topBarBtnDisabled,
                ]}
              >
                {busy ? t('common', 'saving') : t('common', 'save')}
              </Text>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            {/* 名稱 — hidden when omitName=true (template editor caller, where
                name lives in the editor body inline). defaultName still goes
                to onConfirm.name unchanged via the `name` state. */}
            {omitName ? null : (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>{t('page', 'nameFieldLabel')}</Text>
                <TextInput
                  style={styles.input}
                  value={name}
                  onChangeText={setName}
                  placeholder={defaultName}
                  placeholderTextColor={tokens.text.tertiary}
                />
              </View>
            )}

            {/* 歸屬計畫 */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>{t('page', 'templateProgramLabel')}</Text>
              <View style={styles.chipRow}>
                <Chip
                  label={t('common', 'default')}
                  active={programId == null && !customProgramMode}
                  onPress={() => {
                    setCustomProgramMode(false);
                    setProgramId(null);
                  }}
                  styles={styles}
                />
                {programList.map((p) => (
                  <Chip
                    key={p.id}
                    label={p.name}
                    active={programId === p.id && !customProgramMode}
                    onPress={() => {
                      setCustomProgramMode(false);
                      setProgramId(p.id);
                    }}
                    styles={styles}
                  />
                ))}
                <Pressable
                  onPress={() => {
                    setCustomProgramMode(true);
                    setCustomProgramName('');
                  }}
                  style={[
                    styles.addCta,
                    customProgramMode && styles.addCtaActive,
                  ]}
                >
                  <Text style={styles.addCtaText}>{t('button', 'addProgram')}</Text>
                </Pressable>
              </View>
              {customProgramMode ? (
                <View style={styles.inlineRow}>
                  <TextInput
                    style={[styles.input, styles.inlineInput]}
                    value={customProgramName}
                    onChangeText={setCustomProgramName}
                    placeholder={t('page', 'newProgramNamePlaceholder')}
                    placeholderTextColor={tokens.text.tertiary}
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
                      {creatingProgram ? t('button', 'creating') : t('common', 'create')}
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </View>

            {/* 強度標籤 — only when a specific program is selected. */}
            {programId !== null ? (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>{t('page', 'templateIntensityLabel')}</Text>
                <View style={styles.chipRow}>
                  <Chip
                    label={t('common', 'default')}
                    active={!customMode && subTag == null}
                    onPress={() => {
                      setCustomMode(false);
                      setSubTag(null);
                    }}
                    styles={styles}
                  />
                  {[...subTags, ...localSubTags].map((tag) => (
                    <Chip
                      key={tag}
                      label={tag}
                      active={!customMode && subTag === tag}
                      onPress={() => {
                        setCustomMode(false);
                        setSubTag(tag);
                      }}
                      styles={styles}
                    />
                  ))}
                  <Pressable
                    onPress={() => {
                      setCustomMode(true);
                      setSubTag(null);
                    }}
                    style={[
                      styles.addCta,
                      customMode && styles.addCtaActive,
                    ]}
                  >
                    <Text style={styles.addCtaText}>{t('button', 'addIntensityPlain')}</Text>
                  </Pressable>
                </View>
                {customMode ? (
                  <View style={styles.inlineRow}>
                    <TextInput
                      style={[styles.input, styles.inlineInput]}
                      value={customSubTag}
                      onChangeText={setCustomSubTag}
                      placeholder={t('page', 'newIntensityWithExamplePlaceholder')}
                      placeholderTextColor={tokens.text.tertiary}
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
                      <Text style={styles.inlineConfirmText}>{t('common', 'create')}</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ) : null}

            <Text style={styles.hint}>
              {tTemplateMetaHint(omitName, programId === null)}
            </Text>
          </ScrollView>
        </Pressable>
      </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

type Styles = ReturnType<typeof makeStyles>;

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

/**
 * ADR-0025 — token-driven styles. The «新增計畫 / 新增強度» CTA chip stays
 * action.primary regardless of `addCtaActive` (which previously darkened to
 * `#0050B3`); the darker state now drops a step via `opacity: 0.85` rather
 * than introducing a brand-darker shade we'd have to add as a new token.
 */
function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
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
    },
    topBarBtnText: {
      fontSize: 15,
      color: tokens.text.secondary,
    },
    topBarBtnDisabled: {
      opacity: 0.4,
    },
    topBarConfirm: {
      color: tokens.action.primary,
      fontWeight: '600',
    },
    body: {
      padding: 16,
      gap: 16,
    },
    field: {
      gap: 6,
    },
    fieldLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: tokens.text.secondary,
    },
    input: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tokens.border.default,
      borderRadius: 8,
      paddingVertical: 10,
      paddingHorizontal: 12,
      fontSize: 15,
      color: tokens.text.primary,
      backgroundColor: tokens.bg.surface,
    },
    inlineRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 6,
    },
    inlineInput: {
      flex: 1,
    },
    inlineConfirm: {
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: 8,
      backgroundColor: tokens.action.primary,
    },
    inlineConfirmDisabled: {
      opacity: 0.4,
    },
    inlineConfirmText: {
      color: tokens.action.onPrimary,
      fontSize: 14,
      fontWeight: '600',
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
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
    /**
     * CTA chip for「新增計畫」/「新增強度」.
     * #3 (2026-05-30) — 改外框樣式（透明底 + primary 虛線框 + primary 字），
     * 與「選中標籤」(chipActive = 實心 primary) 拉開色差，使用者反映原本兩者
     * 同為實心藍、分不出「已選」vs「新增」。外框 = 明確的「建立新項目」動作。
     * Active state 仍以 opacity 0.85 表達按壓。
     */
    addCta: {
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 999,
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: tokens.action.primary,
    },
    addCtaActive: {
      opacity: 0.85,
    },
    addCtaText: {
      fontSize: 13,
      color: tokens.action.primary,
      fontWeight: '600',
    },
    hint: {
      fontSize: 11,
      color: tokens.text.secondary,
    },
  });
}
