import { randomUUID } from 'expo-crypto';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BodyTrendChart, SERIES_COLORS } from '@/components/body-trend-chart';
import { useDatabase } from '@/components/database-provider';
import {
  insertBodyMetric,
  listBodyMetrics,
} from '@/src/adapters/sqlite/bodyMetricRepository';
import { getUnitPreference } from '@/src/adapters/sqlite/settingsRepository';
import {
  DEFAULT_VISIBILITY,
  latestPerMetric,
  toggleVisibility,
  validateBodyMetric,
} from '@/src/domain/body/bodyMetricManager';
import type {
  BodyChartVisibility,
  BodyMetric,
  UnitPreference,
} from '@/src/domain/body/types';
import {
  formatWeight,
  kgToDisplay,
  parseWeightInput,
} from '@/src/domain/body/unitConversion';

/**
 * Body tab — slice 7.
 *
 *   1. Show latest readings (bw / PBF / SMM) at top.
 *   2. Input form to log a new measurement (any subset of three fields).
 *   3. Trend chart (3 series, toggleable, dual Y axis).
 *
 * Storage in kg / %; display in current unit_preference.
 */
export default function BodyScreen() {
  const db = useDatabase();
  const [metrics, setMetrics] = useState<BodyMetric[]>([]);
  const [unit, setUnit] = useState<UnitPreference>('kg');
  const [bwInput, setBwInput] = useState('');
  const [pbfInput, setPbfInput] = useState('');
  const [smmInput, setSmmInput] = useState('');
  const [visibility, setVisibility] = useState<BodyChartVisibility>(DEFAULT_VISIBILITY);
  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [list, u] = await Promise.all([listBodyMetrics(db), getUnitPreference(db)]);
    setMetrics(list);
    setUnit(u);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const latest = latestPerMetric(metrics);

  const onSave = async () => {
    setErrorText(null);
    const bwKg = parseWeightInput(bwInput, unit);
    const smmKg = parseWeightInput(smmInput, unit);
    const pbfTrim = pbfInput.trim();
    const pbfNum = pbfTrim === '' ? null : Number(pbfTrim);
    const pbf =
      pbfNum == null ? null : Number.isFinite(pbfNum) ? pbfNum : null;

    const draft = {
      recorded_at: Date.now(),
      bodyweight_kg: bwKg,
      pbf,
      smm_kg: smmKg,
    };
    const err = validateBodyMetric(draft);
    if (err) {
      setErrorText(translateError(err));
      return;
    }
    setBusy(true);
    try {
      await insertBodyMetric(db, draft, randomUUID);
      setBwInput('');
      setPbfInput('');
      setSmmInput('');
      await refresh();
    } catch (e) {
      Alert.alert('儲存失敗', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled">
          <Text style={styles.heading}>Body</Text>

          {/* Latest readings */}
          <View style={styles.statsRow}>
            <Stat
              label="體重"
              value={
                latest.bodyweight_kg != null
                  ? formatWeight(latest.bodyweight_kg, unit)
                  : '—'
              }
              color={SERIES_COLORS.bodyweight}
            />
            <Stat
              label="PBF"
              value={latest.pbf != null ? `${latest.pbf.toFixed(1)} %` : '—'}
              color={SERIES_COLORS.pbf}
            />
            <Stat
              label="SMM"
              value={
                latest.smm_kg != null ? formatWeight(latest.smm_kg, unit) : '—'
              }
              color={SERIES_COLORS.smm}
            />
          </View>

          {/* Input form */}
          <Text style={styles.section}>新增記錄</Text>
          <View style={styles.inputRow}>
            <Field
              label={`體重 (${unit})`}
              value={bwInput}
              onChangeText={setBwInput}
              placeholder={
                latest.bodyweight_kg != null
                  ? kgToDisplay(latest.bodyweight_kg, unit).toFixed(1)
                  : '70.0'
              }
            />
            <Field
              label="PBF (%)"
              value={pbfInput}
              onChangeText={setPbfInput}
              placeholder={latest.pbf != null ? latest.pbf.toFixed(1) : '20.0'}
            />
            <Field
              label={`SMM (${unit})`}
              value={smmInput}
              onChangeText={setSmmInput}
              placeholder={
                latest.smm_kg != null
                  ? kgToDisplay(latest.smm_kg, unit).toFixed(1)
                  : '32.0'
              }
            />
          </View>
          {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
          <Pressable
            accessibilityRole="button"
            onPress={onSave}
            disabled={busy}
            style={({ pressed }) => [
              styles.saveBtn,
              busy && styles.btnDisabled,
              pressed && styles.btnPressed,
            ]}>
            <Text style={styles.saveBtnText}>{busy ? '儲存中…' : '儲存'}</Text>
          </Pressable>

          {/* Chart */}
          <Text style={styles.section}>趨勢</Text>
          <BodyTrendChart metrics={metrics} visibility={visibility} unit={unit} />
          <View style={styles.legendRow}>
            <LegendChip
              label="體重"
              color={SERIES_COLORS.bodyweight}
              active={visibility.bodyweight}
              onPress={() => setVisibility((v) => toggleVisibility(v, 'bodyweight'))}
            />
            <LegendChip
              label="PBF"
              color={SERIES_COLORS.pbf}
              active={visibility.pbf}
              onPress={() => setVisibility((v) => toggleVisibility(v, 'pbf'))}
            />
            <LegendChip
              label="SMM"
              color={SERIES_COLORS.smm}
              active={visibility.smm}
              onPress={() => setVisibility((v) => toggleVisibility(v, 'smm'))}
            />
          </View>

          <Text style={styles.section}>歷史 ({metrics.length})</Text>
          {metrics.length === 0 ? (
            <Text style={styles.muted}>尚無記錄</Text>
          ) : (
            <View style={styles.historyList}>
              {[...metrics]
                .sort((a, b) => b.recorded_at - a.recorded_at)
                .slice(0, 20)
                .map((m) => (
                  <View key={m.id} style={styles.historyRow}>
                    <Text style={styles.historyTime}>
                      {formatDateTime(m.recorded_at)}
                    </Text>
                    <Text style={styles.historyValues}>
                      {formatRow(m, unit)}
                    </Text>
                  </View>
                ))}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={[styles.stat, { borderColor: color }]}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (s: string) => void;
  placeholder: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#999"
        keyboardType="decimal-pad"
        style={styles.input}
      />
    </View>
  );
}

function LegendChip({
  label,
  color,
  active,
  onPress,
}: {
  label: string;
  color: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.legendChip,
        active && { backgroundColor: color, borderColor: color },
        pressed && styles.btnPressed,
      ]}>
      <View
        style={[
          styles.legendDot,
          { backgroundColor: active ? '#fff' : color },
        ]}
      />
      <Text style={[styles.legendLabel, active && styles.legendLabelActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function translateError(err: string): string {
  switch (err) {
    case 'EMPTY':
      return '至少輸入一個欄位（體重 / PBF / SMM）';
    case 'BODYWEIGHT_OUT_OF_RANGE':
      return '體重數值不合理（應為 0–500 kg）';
    case 'PBF_OUT_OF_RANGE':
      return 'PBF 應為 0–100 %';
    case 'SMM_OUT_OF_RANGE':
      return 'SMM 數值不合理（應為 0–200 kg）';
    default:
      return '輸入有誤';
  }
}

function formatRow(m: BodyMetric, unit: UnitPreference): string {
  const parts: string[] = [];
  if (m.bodyweight_kg != null) parts.push(`體重 ${formatWeight(m.bodyweight_kg, unit)}`);
  if (m.pbf != null) parts.push(`PBF ${m.pbf.toFixed(1)}%`);
  if (m.smm_kg != null) parts.push(`SMM ${formatWeight(m.smm_kg, unit)}`);
  return parts.join(' · ');
}

function formatDateTime(ms: number): string {
  const d = new Date(ms);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${m}/${day} ${hh}:${mm}`;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  body: { padding: 24, gap: 12, paddingBottom: 48 },
  heading: { fontSize: 28, fontWeight: '700', marginBottom: 4 },
  statsRow: { flexDirection: 'row', gap: 8, marginVertical: 8 },
  stat: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    backgroundColor: 'rgba(127,127,127,0.06)',
  },
  statValue: { fontSize: 18, fontWeight: '700' },
  statLabel: { fontSize: 12, opacity: 0.65, marginTop: 4 },
  section: { fontSize: 16, fontWeight: '600', marginTop: 12 },
  inputRow: { flexDirection: 'row', gap: 8 },
  field: { flex: 1, gap: 4 },
  fieldLabel: { fontSize: 12, opacity: 0.7 },
  input: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(127,127,127,0.12)',
    fontSize: 16,
  },
  saveBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#0a7ea4',
    alignItems: 'center',
    marginTop: 4,
  },
  saveBtnText: { color: 'white', fontSize: 16, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },
  btnPressed: { opacity: 0.85 },
  errorText: { color: '#dc3545', fontSize: 13 },
  legendRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  legendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: 'rgba(127,127,127,0.3)',
  },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontSize: 13, fontWeight: '500' },
  legendLabelActive: { color: 'white', fontWeight: '600' },
  muted: { fontSize: 14, opacity: 0.6 },
  historyList: { gap: 6 },
  historyRow: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(127,127,127,0.08)',
    gap: 2,
  },
  historyTime: { fontSize: 12, opacity: 0.6 },
  historyValues: { fontSize: 14 },
});
