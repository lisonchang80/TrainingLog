import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabase } from '@/components/database-provider';
import {
  getUnitPreference,
  setUnitPreference,
} from '@/src/adapters/sqlite/settingsRepository';
import type { UnitPreference } from '@/src/domain/body/types';

/**
 * Settings tab — slice 7 ships the unit preference toggle.
 * Slice 15 (Backup) brings backup mode + export / restore.
 */
export default function SettingsScreen() {
  const db = useDatabase();
  const router = useRouter();
  const [unit, setUnit] = useState<UnitPreference>('kg');

  const refresh = useCallback(async () => {
    const u = await getUnitPreference(db);
    setUnit(u);
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

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.heading}>Settings</Text>

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
          顯示單位切換（資料以 kg 儲存，僅影響顯示與輸入）。
        </Text>

        <Text style={styles.section}>數據</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/body')}
          style={({ pressed }) => [
            styles.linkRow,
            pressed && styles.btnPressed,
          ]}>
          <Text style={styles.linkLabel}>身體數據</Text>
          <Text style={styles.linkChevron}>›</Text>
        </Pressable>
        <Text style={styles.hint}>
          體重 / PBF / SMM 趨勢與歷史記錄。快速輸入仍可從 Today 頁進入。
        </Text>

        <Text style={styles.section}>備份 / 還原</Text>
        <Text style={styles.placeholder}>於 slice 15 加入。</Text>
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
});
