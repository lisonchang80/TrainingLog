/**
 * Bottom sheet for 「另存模板」(create-mode convertSessionToTemplate).
 *
 * 2026-05-18 UX: 另存模板按下後跳這個 sheet，引導用戶填 Template 的 3 元組
 * (name + program_id + sub_tag)。name 必填 (空白 fallback 預設名)，
 * program / sub_tag 可選 (null = 不指定)。
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

import type { ProgramSummary } from '@/src/adapters/sqlite/programRepository';

export interface TemplateMetaSheetProps {
  visible: boolean;
  /** Default fallback used when user leaves name blank. */
  defaultName: string;
  /** Existing programs from listPrograms (excludes the reserved 「無」 row). */
  programs: ProgramSummary[];
  /** Distinct existing sub_tags from listDistinctSubTags. */
  subTags: string[];
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
  subTags,
  onCancel,
  onConfirm,
  busy = false,
}: TemplateMetaSheetProps) {
  const [name, setName] = useState(defaultName);
  const [programId, setProgramId] = useState<string | null>(null);
  const [subTag, setSubTag] = useState<string | null>(null);
  const [customSubTag, setCustomSubTag] = useState('');
  const [customMode, setCustomMode] = useState(false);

  // Reset state on each open so the sheet is fresh.
  useEffect(() => {
    if (visible) {
      setName(defaultName);
      setProgramId(null);
      setSubTag(null);
      setCustomSubTag('');
      setCustomMode(false);
    }
  }, [visible, defaultName]);

  const handleConfirm = () => {
    const trimmed = name.trim() || defaultName;
    const finalSubTag = customMode
      ? (customSubTag.trim() || null)
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
                  label="不指定"
                  active={programId == null}
                  onPress={() => setProgramId(null)}
                />
                {programs.map((p) => (
                  <Chip
                    key={p.id}
                    label={p.name}
                    active={programId === p.id}
                    onPress={() => setProgramId(p.id)}
                  />
                ))}
              </View>
            </View>

            {/* 強度標籤 */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>強度標籤</Text>
              <View style={styles.chipRow}>
                <Chip
                  label="不指定"
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
                  label="自訂"
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

            <Text style={styles.hint}>
              名稱必填、計畫與強度可不指定（null = free template）。
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
