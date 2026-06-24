/**
 * MG / Equipment bottom-sheet picker — Slice 9.7 (ADR-0017 Q13 + amendment).
 *
 * Single generic picker driven by `cells` prop. Chrome aligned with existing
 * 12-color picker idiom (components/template-editor/template-editor-view.tsx:1310):
 *   - Sheet header: title + 右上 "完成" button
 *   - No drag handle, no bottom "保存" button
 *   - tap cell → immediate onSelect (即選即 commit)
 *   - tap "完成" or backdrop → onClose (selected value already committed)
 *
 * Used for:
 *   - 大分類 picker: 4×3 grid, 11 MG + 1 implicit empty (flex-wrap leaves blank)
 *   - 用具 picker: 4×2 grid, 8 Equipment fills exactly
 */
import React, { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { t } from '@/src/i18n';
import { useTheme, type ThemeTokens } from '@/src/theme';

export interface PickerCell {
  id: string;
  label: string;
}

interface MgEquipmentPickerProps {
  visible: boolean;
  title: string;
  cells: ReadonlyArray<PickerCell>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function MgEquipmentPicker({
  visible,
  title,
  cells,
  selectedId,
  onSelect,
  onClose,
}: MgEquipmentPickerProps) {
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.done}>{t('common', 'done')}</Text>
            </Pressable>
          </View>
          <View style={styles.grid}>
            {cells.map((cell) => {
              const isSelected = cell.id === selectedId;
              return (
                <Pressable
                  key={cell.id}
                  onPress={() => {
                    onSelect(cell.id);
                    onClose();
                  }}
                  style={[styles.cell, isSelected && styles.cellActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}>
                  <Text
                    style={[
                      styles.cellText,
                      isSelected && styles.cellTextActive,
                    ]}>
                    {cell.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      // Modal scrim — kept literal; iOS HIG uses a fixed black dim regardless
      // of mode so the underlying surface darkens consistently.
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'flex-end',
    },
    sheet: {
      width: '100%',
      alignSelf: 'stretch',
      backgroundColor: tokens.bg.modal,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 32,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 16,
    },
    title: {
      fontSize: 16,
      fontWeight: '600',
      color: tokens.text.primary,
    },
    done: {
      fontSize: 15,
      color: tokens.action.primary,
      fontWeight: '500',
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: 12,
    },
    cell: {
      width: '22%',
      height: 44,
      borderRadius: 10,
      backgroundColor: tokens.bg.elevated,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 0,
    },
    cellActive: {
      backgroundColor: tokens.action.success,
    },
    cellText: {
      fontSize: 14,
      lineHeight: 16,
      color: tokens.text.primary,
      fontWeight: '500',
      textAlign: 'center',
      textAlignVertical: 'center',
      width: '100%',
      includeFontPadding: false,
    },
    cellTextActive: {
      color: tokens.action.onPrimary,
      fontWeight: '600',
    },
  });
}
