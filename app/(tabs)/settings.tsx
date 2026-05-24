import { randomUUID } from 'expo-crypto';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabase } from '@/components/database-provider';
import { insertBodyMetric } from '@/src/adapters/sqlite/bodyMetricRepository';
import {
  getAutoPopupRestTimer,
  getUnitPreference,
  setAutoPopupRestTimer,
  setUnitPreference,
} from '@/src/adapters/sqlite/settingsRepository';
import type { UnitPreference } from '@/src/domain/body/types';
import { parseWeightInput } from '@/src/domain/body/unitConversion';
import { t } from '@/src/i18n';
import {
  loadStoredLocale,
  resolveLocale,
  saveStoredLocale,
  type StoredLocaleValue,
} from '@/src/i18n/locale-persist';
import { setLocale } from '@/src/i18n/strings';

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
  /**
   * Phase 5 — locale preference. `'auto'` follows device locale, `'zh'` /
   * `'en'` are explicit overrides. Backed by AsyncStorage via
   * `locale-persist.ts`. `null` while loading (renders a default snapshot).
   */
  const [localePref, setLocalePref] = useState<StoredLocaleValue | null>(null);
  /**
   * ADR-0024 § 5 — 體重 row mini sheet state.
   *   - `bwSheetOpen`: modal visibility
   *   - `bwInput`: current TextInput value (raw string, parsed on save)
   *   - `bwBusy`: insert-in-flight guard
   */
  const [bwSheetOpen, setBwSheetOpen] = useState(false);
  const [bwInput, setBwInput] = useState('');
  const [bwBusy, setBwBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [u, popup, loc] = await Promise.all([
      getUnitPreference(db),
      getAutoPopupRestTimer(db),
      loadStoredLocale(),
    ]);
    setUnit(u);
    setAutoPopup(popup);
    setLocalePref(loc);
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

  /**
   * Phase 5 — apply locale change.
   *   1. Persist to AsyncStorage.
   *   2. Push resolved locale into the module-level i18n state so subsequent
   *      `t(...)` calls return the new language.
   *   3. Local state bump forces this screen to re-render with new labels.
   * Re-rendering the rest of the app happens lazily as other screens mount /
   * focus — module-level locale is read at every `t(...)` call.
   */
  const onPickLocale = async (next: StoredLocaleValue) => {
    if (next === localePref) return;
    setLocalePref(next);
    await saveStoredLocale(next);
    setLocale(resolveLocale(next));
  };

  // ADR-0024 § 5 — 體重 mini sheet handlers.
  const onOpenBwSheet = () => {
    setBwInput('');
    setBwSheetOpen(true);
  };

  const onSaveBw = async () => {
    const bwKg = parseWeightInput(bwInput, unit);
    if (bwKg == null || bwKg <= 0 || bwKg > 500) {
      Alert.alert('體重輸入無效', '請輸入 0–500 之間的正數');
      return;
    }
    setBwBusy(true);
    try {
      await insertBodyMetric(
        db,
        {
          recorded_at: Date.now(),
          bodyweight_kg: bwKg,
          pbf: null,
          smm_kg: null,
        },
        randomUUID,
      );
      setBwSheetOpen(false);
      setBwInput('');
    } catch (e) {
      Alert.alert('儲存失敗', e instanceof Error ? e.message : String(e));
    } finally {
      setBwBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.heading}>{t('page', 'settings')}</Text>

        <Text style={styles.section}>{t('page', 'unitPreferenceSection')}</Text>
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
        <Text style={styles.hint}>{t('page', 'unitPreferenceHint')}</Text>

        {/* ADR-0024 § 5 — 體重 row。位於單位偏好之下、訓練偏好之上。
            Quick capture via mini sheet → insertBodyMetric. History list /
            chart 仍走既有「資料 → 體重資料」路徑（下方 linkRow）。 */}
        <Text style={styles.section}>體重</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="紀錄體重"
          onPress={onOpenBwSheet}
          style={({ pressed }) => [
            styles.bwRow,
            pressed && styles.btnPressed,
          ]}>
          <Text style={styles.bwRowLabel}>＋ 紀錄體重</Text>
          <Text style={styles.bwRowHint}>單位依上方偏好（{unit}）</Text>
        </Pressable>

        <Text style={styles.section}>{t('domain', 'trainingPreferences')}</Text>
        <View style={styles.switchRow}>
          <View style={styles.switchLabelGroup}>
            <Text style={styles.switchLabel}>{t('status', 'autoShowRestCountdown')}</Text>
            <Text style={styles.hint}>{t('page', 'autoPopupRestTimerHint')}</Text>
          </View>
          <Switch
            value={autoPopup ?? true}
            onValueChange={onToggleAutoPopup}
            disabled={autoPopup === null}
          />
        </View>

        <Text style={styles.section}>{t('page', 'languageSection')}</Text>
        <View style={styles.langGroup}>
          <LangOption
            label={t('status', 'languageAuto')}
            active={localePref === 'auto'}
            disabled={localePref === null}
            onPress={() => onPickLocale('auto')}
          />
          <LangOption
            label={t('status', 'languageZh')}
            active={localePref === 'zh'}
            disabled={localePref === null}
            onPress={() => onPickLocale('zh')}
          />
          <LangOption
            label={t('status', 'languageEn')}
            active={localePref === 'en'}
            disabled={localePref === null}
            onPress={() => onPickLocale('en')}
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
        <Text style={styles.hint}>{t('page', 'bodyMetricsHint')}</Text>

        <Text style={styles.section}>{t('page', 'backupRestore')}</Text>
        <Text style={styles.placeholder}>{t('status', 'backupComingSlice15')}</Text>
      </ScrollView>

      {/* ADR-0024 § 5 — 體重 mini sheet (modal). 單一 TextInput + 儲存。 */}
      <Modal
        visible={bwSheetOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setBwSheetOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalHeading}>紀錄體重</Text>
            <Text style={styles.modalLabel}>體重 ({unit})</Text>
            <TextInput
              style={styles.modalInput}
              keyboardType="decimal-pad"
              value={bwInput}
              onChangeText={setBwInput}
              placeholder={unit === 'kg' ? '70.0' : '154.0'}
              placeholderTextColor="#999"
              autoFocus
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setBwSheetOpen(false)}
                disabled={bwBusy}
                style={({ pressed }) => [
                  styles.modalSecondaryBtn,
                  bwBusy && styles.btnDisabled,
                  pressed && styles.btnPressed,
                ]}>
                <Text style={styles.modalSecondaryText}>取消</Text>
              </Pressable>
              <Pressable
                onPress={onSaveBw}
                disabled={bwBusy}
                style={({ pressed }) => [
                  styles.modalPrimaryBtn,
                  bwBusy && styles.btnDisabled,
                  pressed && styles.btnPressed,
                ]}>
                <Text style={styles.modalPrimaryText}>
                  {bwBusy ? '儲存中…' : '儲存'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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

/**
 * Phase 5 — single radio-style row for the language toggle. List-style (one
 * per row) rather than side-by-side because labels can be long (e.g.
 * "Traditional Chinese") and would wrap awkwardly in a flex-row.
 */
function LangOption({
  label,
  active,
  disabled,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected: active, disabled: !!disabled }}
      style={({ pressed }) => [
        styles.langRow,
        active && styles.langRowActive,
        pressed && styles.btnPressed,
      ]}>
      <Text style={[styles.langLabel, active && styles.langLabelActive]}>
        {label}
      </Text>
      {active ? <Text style={styles.langCheck}>✓</Text> : null}
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
  langGroup: { gap: 8 },
  langRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: 'rgba(127,127,127,0.12)',
  },
  langRowActive: { backgroundColor: '#0a7ea4' },
  langLabel: { flex: 1, fontSize: 16, fontWeight: '500' },
  langLabelActive: { color: 'white' },
  langCheck: { fontSize: 18, color: 'white', fontWeight: '700' },
  // ADR-0024 § 5 — 體重 row + mini sheet.
  bwRow: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: 'rgba(127,127,127,0.12)',
    gap: 4,
  },
  bwRowLabel: { fontSize: 16, fontWeight: '600' },
  bwRowHint: { fontSize: 12, opacity: 0.7 },
  btnDisabled: { opacity: 0.5 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 24,
  },
  modalSheet: {
    backgroundColor: 'white',
    borderRadius: 14,
    padding: 20,
    gap: 12,
  },
  modalHeading: { fontSize: 18, fontWeight: '700' },
  modalLabel: { fontSize: 13, opacity: 0.7 },
  modalInput: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: 'rgba(127,127,127,0.12)',
    fontSize: 18,
  },
  modalActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  modalPrimaryBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#0a7ea4',
    alignItems: 'center',
  },
  modalPrimaryText: { color: 'white', fontSize: 16, fontWeight: '700' },
  modalSecondaryBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(127,127,127,0.2)',
    alignItems: 'center',
  },
  modalSecondaryText: { fontSize: 14, fontWeight: '600' },
});
