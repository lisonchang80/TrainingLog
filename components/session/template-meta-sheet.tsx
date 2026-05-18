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
 * Mirrors `components/session/body-data-sheet.tsx`:
 *   Modal { transparent, animationType: 'slide' }
 *   <Pressable backdrop /> → tap-out cancels
 *   <Pressable sheet />    → swallows touches
 *   [取消] [另存模板] [儲存]  top bar
 *
 * 「儲存模板」(update mode) 不走這條路 — update 沿用 linked template 既有的
 * program_id / sub_tag，所以 caller 仍可以用 Alert.prompt 改名。
 */

import { useEffect, useState } from 'react';
import {
  Modal,
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
import {
  createProgram,
  type ProgramSummary,
} from '@/src/adapters/sqlite/programRepository';
import { utcMsToIsoDate } from '@/src/domain/program/programManager';

export interface TemplateMetaSheetProps {
  visible: boolean;
  /** Default fallback used when user leaves name blank. */
  defaultName: string;
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
  defaultName,
  programs,
  onCancel,
  onConfirm,
  busy = false,
}: TemplateMetaSheetProps) {
  const db = useDatabase();
  const [name, setName] = useState(defaultName);
  const [programId, setProgramId] = useState<string | null>(null);
  const [subTag, setSubTag] = useState<string | null>(null);
  const [customSubTag, setCustomSubTag] = useState('');
  const [customMode, setCustomMode] = useState(false);
  /** Per-program distinct sub_tags, re-fetched whenever programId changes. */
  const [subTags, setSubTags] = useState<string[]>([]);
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

  // Reset state on each open so the sheet is fresh.
  useEffect(() => {
    if (visible) {
      setName(defaultName);
      setProgramId(null);
      setSubTag(null);
      setCustomSubTag('');
      setCustomMode(false);
      setSubTags([]);
      setProgramList(programs);
      setCustomProgramMode(false);
      setCustomProgramName('');
      setCreatingProgram(false);
    }
  }, [visible, defaultName, programs]);

  // Re-fetch per-program sub_tags when the user changes program selection.
  // null program → no fetch, section is hidden entirely.
  useEffect(() => {
    let cancelled = false;
    if (!visible) return;
    if (programId == null) {
      setSubTags([]);
      // Reset 強度 state when switching back to 通用.
      setSubTag(null);
      setCustomMode(false);
      setCustomSubTag('');
      return;
    }
    listDistinctSubTagsByProgram(db, programId)
      .then((tags) => {
        if (!cancelled) setSubTags(tags);
      })
      .catch(() => {
        if (!cancelled) setSubTags([]);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, programId, db]);

  const handleConfirmNewProgram = async () => {
    const trimmedName = customProgramName.trim();
    if (!trimmedName || trimmedName.length > 60) return;
    setCreatingProgram(true);
    try {
      const newId = randomUUID();
      const today = utcMsToIsoDate(Date.now());
      // Reasonable defaults for a "just give me a name" minimal Program:
      //   - main_tag = null (no 週期 tag)
      //   - cycle_length = 3 (ADR-0004 minimum 合法值; programManager.validateProgram
      //     enforces [3, 14] — we can't go lower)
      //   - cycle_count = 1 (single cycle)
      //   - start_date = today (yyyy-mm-dd)
      //   - is_active = 0 (createProgram forces this internally)
      // User can edit cycle structure later from the Program editor page.
      await createProgram(db, {
        program: {
          id: newId,
          name: trimmedName,
          main_tag: null,
          cycle_length: 3,
          cycle_count: 1,
          start_date: today,
          is_active: 0,
        },
      });
      // Append to local chip list (parent will re-fetch next open).
      // Match the ProgramSummary shape — cellCount = 0 since we didn't seed cells.
      const newSummary: ProgramSummary = {
        id: newId,
        name: trimmedName,
        main_tag: null,
        cycle_length: 3,
        cycle_count: 1,
        start_date: today,
        is_active: 0,
        cellCount: 0,
      };
      setProgramList((prev) => [...prev, newSummary]);
      setProgramId(newId);
      setCustomProgramMode(false);
      setCustomProgramName('');
    } catch {
      // Silent: keep user in inline-input mode so they can retry / cancel.
    } finally {
      setCreatingProgram(false);
    }
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
                取消
              </Text>
            </Pressable>
            <Text style={styles.topBarTitle}>另存模板</Text>
            <Pressable onPress={handleConfirm} hitSlop={8} disabled={busy}>
              <Text
                style={[
                  styles.topBarBtnText,
                  styles.topBarConfirm,
                  busy && styles.topBarBtnDisabled,
                ]}
              >
                {busy ? '儲存中…' : '儲存'}
              </Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.body}>
            {/* 名稱 */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>名稱</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder={defaultName}
                placeholderTextColor="#9ca3af"
              />
            </View>

            {/* 歸屬計畫 */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>歸屬計畫</Text>
              <View style={styles.chipRow}>
                <Chip
                  label="通用"
                  active={programId == null && !customProgramMode}
                  onPress={() => {
                    setCustomProgramMode(false);
                    setProgramId(null);
                  }}
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
                  />
                ))}
                <Chip
                  label="+ 新增計畫"
                  active={customProgramMode}
                  onPress={() => {
                    setCustomProgramMode(true);
                    setCustomProgramName('');
                  }}
                />
              </View>
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
            </View>

            {/* 強度標籤 — only when a specific program is selected. */}
            {programId !== null ? (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>強度標籤</Text>
                <View style={styles.chipRow}>
                  <Chip
                    label="通用"
                    active={!customMode && subTag == null}
                    onPress={() => {
                      setCustomMode(false);
                      setSubTag(null);
                    }}
                  />
                  {subTags.map((t) => (
                    <Chip
                      key={t}
                      label={t}
                      active={!customMode && subTag === t}
                      onPress={() => {
                        setCustomMode(false);
                        setSubTag(t);
                      }}
                    />
                  ))}
                  <Chip
                    label="+ 新增強度"
                    active={customMode}
                    onPress={() => {
                      setCustomMode(true);
                      setSubTag(null);
                    }}
                  />
                </View>
                {customMode ? (
                  <TextInput
                    style={[styles.input, styles.customInput]}
                    value={customSubTag}
                    onChangeText={setCustomSubTag}
                    placeholder="輸入新強度標籤（如 5x5、最大力量）"
                    placeholderTextColor="#9ca3af"
                  />
                ) : null}
              </View>
            ) : null}

            <Text style={styles.hint}>
              {programId === null
                ? '名稱必填、計畫選「通用」時不指定強度（= 自由模板）。'
                : '名稱必填、強度可選「通用」或新增。'}
            </Text>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
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
  },
  topBarBtnText: {
    fontSize: 15,
    color: '#6b7280',
  },
  topBarBtnDisabled: {
    opacity: 0.4,
  },
  topBarConfirm: {
    color: '#007AFF',
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
    opacity: 0.7,
    fontWeight: '600',
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
  customInput: {
    marginTop: 6,
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
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(0,122,255,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,122,255,0.2)',
  },
  chipActive: {
    backgroundColor: 'rgba(0,122,255,0.25)',
    borderColor: '#007AFF',
  },
  chipText: {
    fontSize: 13,
    color: '#007AFF',
  },
  chipTextActive: {
    color: '#0050B3',
    fontWeight: '600',
  },
  hint: {
    fontSize: 11,
    opacity: 0.6,
  },
});
