/**
 * In-session Body data editor sheet — replaces the previous inline panel on
 * the Today screen (slice 10c overnight #4 第 3 點).
 *
 * Opens from the Today header ⋯ menu → 「Body data」. Same three fields as
 * the inline panel (體重 / PBF / SMM), same save semantics — caller handles
 * the actual DB insert via `onSave` (parent already owns the
 * `insertBodyMetric` call + reload). The snapshot badge is rendered inside
 * the sheet so the user can confirm the value frozen on the active session
 * before editing.
 *
 * Mirrors `components/shared/set-note-sheet.tsx`:
 *   Modal { transparent, animationType: 'slide' }
 *   <Pressable backdrop /> → tap-out cancels
 *   <Pressable sheet />    → swallows touches
 *   [取消] [Body data] [儲存]  top bar
 *
 * The 「儲存」 button doubles as the bottom-bar save action so the sheet
 * keeps a single canonical commit gesture (no dangling 「儲存 body data」
 * button below the inputs). Disabled while `busy` true.
 *
 * Snapshot badge: shown above the inputs when `bwSnapshotKg != null`. The
 * inline 🔒 BW snapshot pill from the old layout moves here verbatim (per
 * spec: "snapshot badge: 先砍 — snapshot 資訊在 sheet 內看").
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { UnitPreference } from '@/src/domain/body/types';
import { formatWeight } from '@/src/domain/body/unitConversion';
import { t } from '@/src/i18n';
import { useTheme, type ThemeTokens } from '@/src/theme';

interface BodyDataSheetProps {
  visible: boolean;
  unit: UnitPreference;
  /** Session-frozen bw snapshot (kg). NULL = no snapshot yet → hide badge. */
  bwSnapshotKg: number | null;
  /** Initial input values (caller-owned so the parent can reset on save). */
  bwInput: string;
  pbfInput: string;
  smmInput: string;
  onBwInputChange: (v: string) => void;
  onPbfInputChange: (v: string) => void;
  onSmmInputChange: (v: string) => void;
  /** Triggered by top-bar 「儲存」. Parent runs validateBodyMetric + insert. */
  onSave: () => void;
  onClose: () => void;
  /** Disables save while parent's DB write is in flight. */
  busy: boolean;
}

export function BodyDataSheet({
  visible,
  unit,
  bwSnapshotKg,
  bwInput,
  pbfInput,
  smmInput,
  onBwInputChange,
  onPbfInputChange,
  onSmmInputChange,
  onSave,
  onClose,
  busy,
}: BodyDataSheetProps) {
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  // Mirror set-note-sheet's autofocus-on-open pattern by keying off `visible`.
  const [, setMountTick] = useState(0);
  useEffect(() => {
    if (visible) setMountTick((t) => t + 1);
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}} accessibilityViewIsModal>
          <View style={styles.topBar}>
            <Pressable onPress={onClose} hitSlop={8} disabled={busy} accessibilityRole="button">
              <Text
                style={[
                  styles.topBarBtnText,
                  busy && styles.topBarBtnDisabled,
                ]}
              >
                {t('common', 'cancel')}
              </Text>
            </Pressable>
            <Text style={styles.topBarTitle}>{t('button', 'bodyData')}</Text>
            <Pressable onPress={onSave} hitSlop={8} disabled={busy} accessibilityRole="button">
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

          <View style={styles.body}>
            {bwSnapshotKg != null ? (
              <View style={styles.snapshotBadge}>
                <Text style={styles.snapshotBadgeText}>
                  🔒 BW snapshot · {formatWeight(bwSnapshotKg, unit)}
                </Text>
              </View>
            ) : null}

            <View style={styles.row}>
              <Field
                label={`${t('domain', 'bodyweight')} (${unit})`}
                value={bwInput}
                onChange={onBwInputChange}
                styles={styles}
                tokens={tokens}
              />
              <Field
                label="PBF (%)"
                value={pbfInput}
                onChange={onPbfInputChange}
                styles={styles}
                tokens={tokens}
              />
              <Field
                label={`SMM (${unit})`}
                value={smmInput}
                onChange={onSmmInputChange}
                styles={styles}
                tokens={tokens}
              />
            </View>

            <Text style={styles.hint}>{t('status', 'bwSnapshotFrozenHint')}</Text>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function Field({
  label,
  value,
  onChange,
  styles,
  tokens,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  styles: Styles;
  tokens: ThemeTokens;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        keyboardType="decimal-pad"
        selectTextOnFocus
        value={value}
        onChangeText={onChange}
        placeholder="—"
        placeholderTextColor={tokens.text.tertiary}
      />
    </View>
  );
}

/**
 * ADR-0025 — token-driven styles. Backdrop kept raw rgba (dim layer).
 * Snapshot badge previously used 'rgba(10,126,164,0.15)' bg + '#0a7ea4'
 * text — kept as a low-saturation tint of action.primary by deriving
 * from the token via opacity. fieldLabel + hint use text.secondary
 * (replaces opacity-only Text without color — the wave 2 bug).
 */
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
      gap: 12,
    },
    snapshotBadge: {
      alignSelf: 'flex-start',
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 999,
      backgroundColor: tokens.bg.elevated,
    },
    snapshotBadgeText: {
      fontSize: 12,
      fontWeight: '600',
      color: tokens.action.primary,
    },
    row: {
      flexDirection: 'row',
      gap: 8,
    },
    field: {
      flex: 1,
      gap: 4,
    },
    fieldLabel: {
      fontSize: 11,
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
    hint: {
      fontSize: 11,
      color: tokens.text.secondary,
    },
  });
}
