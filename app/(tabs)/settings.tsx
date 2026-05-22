import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabase } from '@/components/database-provider';
import {
  getAutoPopupRestTimer,
  getUnitPreference,
  setAutoPopupRestTimer,
  setUnitPreference,
} from '@/src/adapters/sqlite/settingsRepository';
import type { UnitPreference } from '@/src/domain/body/types';
import { t } from '@/src/i18n';

/**
 * Settings tab — slice 7 ships the unit preference toggle.
 * Slice 15 (Backup) brings backup mode + export / restore.
 */
export default function SettingsScreen() {
  const db = useDatabase();
  const router = useRouter();
  const [unit, setUnit] = useState<UnitPreference>('kg');
  /**
   * Rest timer auto-popup toggle (ADR-0019 § slice 10d S1).
   *
   * Backed by `app_settings.auto_popup_rest_timer` (v016 seed default `1`).
   * Read on focus, persisted optimistically on toggle. `null` = loading.
   */
  const [autoPopup, setAutoPopup] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    const [u, popup] = await Promise.all([
      getUnitPreference(db),
      getAutoPopupRestTimer(db),
    ]);
    setUnit(u);
    setAutoPopup(popup);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const onSet = async (next: UnitPreference) => {
    if (next === unit) return;
    setUnit(next);
    await setUnitPreference(db, next);
  };

  const onToggleAutoPopup = async (next: boolean) => {
    // Optimistic — UI updates first so the Switch feels snappy. DB write
    // races against the next render but Switch is idempotent (write the
    // same boolean twice = no-op).
    setAutoPopup(next);
    await setAutoPopupRestTimer(db, next);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.heading}>{t('page', 'settings')}</Text>

        {/* TODO(i18n): no key for "Unit preference" section title in strings.ts */}
        <Text style={styles.section}>Unit preference</Text>
        <View style={styles.toggleRow}>
          <UnitOption
            label="kg"
            active={unit === 'kg'}
            onPress={() => onSet('kg')}
          />
          <UnitOption
            label="lb"
            active={unit === 'lb'}
            onPress={() => onSet('lb')}
          />
        </View>
        <Text style={styles.hint}>
          {/* TODO(i18n): no key for unit-preference hint paragraph */}
          顯示單位切換（資料以 kg 儲存，僅影響顯示與輸入）。
        </Text>

        <Text style={styles.section}>{t('domain', 'trainingPreferences')}</Text>
        <View style={styles.switchRow}>
          <View style={styles.switchLabelGroup}>
            <Text style={styles.switchLabel}>{t('status', 'autoShowRestCountdown')}</Text>
            <Text style={styles.hint}>
              {/* TODO(i18n): no key for auto-popup hint paragraph */}
              打✓ 完成一組後自動跳出 60 秒倒數視窗（可手動關閉視窗或跳過）。
            </Text>
          </View>
          <Switch
            value={autoPopup ?? true}
            onValueChange={onToggleAutoPopup}
            disabled={autoPopup === null}
          />
        </View>

        <Text style={styles.section}>{t('domain', 'data')}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/body')}
          style={({ pressed }) => [
            styles.linkRow,
            pressed && styles.btnPressed,
          ]}>
          <Text style={styles.linkLabel}>{t('page', 'bodyMetrics')}</Text>
          <Text style={styles.linkChevron}>›</Text>
        </Pressable>
        <Text style={styles.hint}>
          {/* TODO(i18n): no key for body-metrics hint paragraph */}
          體重 / PBF / SMM 趨勢與歷史記錄。快速輸入仍可從 Today 頁進入。
        </Text>

        <Text style={styles.section}>{t('page', 'backupRestore')}</Text>
        <Text style={styles.placeholder}>{t('status', 'backupComingSlice15')}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function UnitOption({
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
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.option,
        active && styles.optionActive,
        pressed && styles.btnPressed,
      ]}>
      <Text style={[styles.optionLabel, active && styles.optionLabelActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { padding: 24, gap: 12 },
  heading: { fontSize: 28, fontWeight: '700', marginBottom: 4 },
  section: { fontSize: 16, fontWeight: '600', marginTop: 12 },
  toggleRow: { flexDirection: 'row', gap: 8 },
  option: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: 'rgba(127,127,127,0.12)',
  },
  optionActive: { backgroundColor: '#0a7ea4' },
  optionLabel: { fontSize: 18, fontWeight: '600' },
  optionLabelActive: { color: 'white' },
  hint: { fontSize: 12, opacity: 0.6 },
  placeholder: { fontSize: 14, opacity: 0.6 },
  btnPressed: { opacity: 0.85 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: 'rgba(127,127,127,0.12)',
  },
  linkLabel: { flex: 1, fontSize: 16, fontWeight: '500' },
  linkChevron: { fontSize: 22, fontWeight: '300', opacity: 0.5 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: 'rgba(127,127,127,0.12)',
    gap: 12,
  },
  switchLabelGroup: { flex: 1, gap: 2 },
  switchLabel: { fontSize: 16, fontWeight: '500' },
});
