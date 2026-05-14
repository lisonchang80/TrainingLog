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
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

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
              <Text style={styles.done}>取消</Text>
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

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    width: '100%',
    alignSelf: 'stretch',
    backgroundColor: '#fff',
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
    color: '#111827',
  },
  done: {
    fontSize: 15,
    color: '#007AFF',
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
    height: 56,
    borderRadius: 12,
    backgroundColor: 'rgba(127,127,127,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 0,
  },
  cellActive: {
    backgroundColor: '#34C759',
  },
  cellText: {
    fontSize: 14,
    lineHeight: 16,
    color: '#374151',
    fontWeight: '500',
    textAlign: 'center',
    textAlignVertical: 'center',
    width: '100%',
    includeFontPadding: false,
  },
  cellTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
});
