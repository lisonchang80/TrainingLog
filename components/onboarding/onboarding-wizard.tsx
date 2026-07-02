/**
 * OnboardingWizard — ADR-0029 新使用者首啟引導（5 步全螢幕精靈）.
 *
 * 歡迎 → 訓練經驗 → 模式推薦 → 輸入身體數據 → 連結 Apple Health.
 *
 * Self-contained (NOT an expo-router screen — rendered by OnboardingGate), so
 * it draws its own top bar (跳過) + footer (上一步 / 下一步·完成) + Step-N-of-M
 * progress, mirroring the program-wizard visual. Side effects are applied
 * incrementally as the user advances (mode on leaving the mode step, body on
 * leaving the body step, HK only if the user taps connect); 跳過 stops here and
 * keeps whatever was already applied (ADR-0029 D5/D8).
 */
import { randomUUID } from 'expo-crypto';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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

import { useDatabase } from '@/components/database-provider';
import { requestHKAuthorization } from '@/src/adapters/healthkit';
import { insertBodyMetric } from '@/src/adapters/sqlite/bodyMetricRepository';
import { getUnitPreference } from '@/src/adapters/sqlite/settingsRepository';
import { useAppMode } from '@/src/app-mode';
import { validateBodyMetric } from '@/src/domain/body/bodyMetricManager';
import type { UnitPreference } from '@/src/domain/body/types';
import { parseWeightInput } from '@/src/domain/body/unitConversion';
import {
  recommendAppMode,
  type ExperienceAnswer,
  type RecommendedMode,
} from '@/src/domain/onboarding/onboardingFlow';
import { t, useLocale } from '@/src/i18n';
import { useOnboarding } from '@/src/onboarding';
import { useTheme, type ThemeTokens } from '@/src/theme';

const STEP_WELCOME = 0;
const STEP_EXPERIENCE = 1;
const STEP_MODE = 2;
const STEP_BODY = 3;
const STEP_HEALTH = 4;
const TOTAL_STEPS = 5;

export function OnboardingWizard() {
  useLocale(); // re-render on language switch (defensive — flow rarely spans one)
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const db = useDatabase();
  const { setMode: applyAppMode } = useAppMode();
  const { finish } = useOnboarding();

  const [step, setStep] = useState(STEP_WELCOME);
  const [experience, setExperience] = useState<ExperienceAnswer | null>(null);
  const [selectedMode, setSelectedMode] = useState<RecommendedMode>('plan');
  const [busy, setBusy] = useState(false);

  // Body-metric step
  const [unit, setUnit] = useState<UnitPreference>('kg');
  const [bwInput, setBwInput] = useState('');
  const [pbfInput, setPbfInput] = useState('');
  const [smmInput, setSmmInput] = useState('');
  const [bodyError, setBodyError] = useState<string | null>(null);

  // Health step
  const [hkConnecting, setHkConnecting] = useState(false);
  const [hkConnected, setHkConnected] = useState(false);

  useEffect(() => {
    let mounted = true;
    getUnitPreference(db)
      .then((u) => mounted && setUnit(u))
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [db]);

  const onPickExperience = useCallback((exp: ExperienceAnswer) => {
    setExperience(exp);
    setSelectedMode(recommendAppMode(exp)); // pre-select the recommended mode
  }, []);

  /** Insert the body metric if the user entered anything valid. Returns false
   *  (and shows an inline error) only when what they typed is invalid — an
   *  all-blank step is fine (optional) and advances. */
  const trySaveBody = useCallback(async (): Promise<boolean> => {
    const bwKg = parseWeightInput(bwInput, unit);
    const smmKg = parseWeightInput(smmInput, unit);
    const pbfTrim = pbfInput.trim();
    const pbfNum = pbfTrim === '' ? null : Number(pbfTrim);
    const pbf = pbfNum == null ? null : Number.isFinite(pbfNum) ? pbfNum : null;

    if (bwKg == null && pbf == null && smmKg == null) {
      return true; // nothing entered — skip insert, proceed
    }
    const draft = { recorded_at: Date.now(), bodyweight_kg: bwKg, pbf, smm_kg: smmKg };
    const err = validateBodyMetric(draft);
    if (err) {
      setBodyError(translateBodyError(err));
      return false;
    }
    try {
      await insertBodyMetric(db, draft, randomUUID);
      return true;
    } catch {
      setBodyError(t('alert', 'invalidInput'));
      return false;
    }
  }, [bwInput, smmInput, pbfInput, unit, db]);

  const goNext = useCallback(async () => {
    if (busy) return;
    if (step === STEP_EXPERIENCE && experience == null) return;
    setBusy(true);
    try {
      if (step === STEP_MODE) {
        await applyAppMode(selectedMode); // ADR-0029 D5 — write on 下一步
      }
      if (step === STEP_BODY) {
        const ok = await trySaveBody();
        if (!ok) return;
      }
      if (step === STEP_HEALTH) {
        await finish();
        return;
      }
      setStep((s) => s + 1);
    } finally {
      setBusy(false);
    }
  }, [busy, step, experience, selectedMode, applyAppMode, trySaveBody, finish]);

  const goBack = useCallback(() => {
    setBodyError(null);
    setStep((s) => Math.max(STEP_WELCOME, s - 1));
  }, []);

  const onSkip = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await finish();
    } finally {
      setBusy(false);
    }
  }, [busy, finish]);

  const onConnectHealth = useCallback(async () => {
    if (hkConnecting || hkConnected) return;
    setHkConnecting(true);
    try {
      await requestHKAuthorization(db);
      setHkConnected(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert(t('onboarding', 'healthTitle'), message);
    } finally {
      setHkConnecting(false);
    }
  }, [hkConnecting, hkConnected, db]);

  const isLast = step === STEP_HEALTH;
  const primaryLabel = isLast ? t('common', 'done') : t('common', 'next');
  const primaryDisabled = busy || (step === STEP_EXPERIENCE && experience == null);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Top bar — 跳過 always available (ADR-0029 D8) */}
        <View style={styles.topBar}>
          <View style={styles.flex} />
          <Pressable
            accessibilityRole="button"
            onPress={onSkip}
            disabled={busy}
            hitSlop={8}
            style={({ pressed }) => [styles.skipBtn, pressed && styles.pressed]}>
            <Text style={styles.skipLabel}>{t('onboarding', 'skip')}</Text>
          </Pressable>
        </View>

        {/* Step N of M + progress ticks */}
        <View style={styles.header}>
          <Text style={styles.stepLabel}>
            {t('onboarding', 'step')} {step + 1} / {TOTAL_STEPS}
          </Text>
          <View style={styles.progressTrack}>
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <View
                key={i}
                style={[styles.progressTick, i <= step && styles.progressTickActive]}
              />
            ))}
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled">
          {step === STEP_WELCOME && (
            <View style={styles.stepBlock}>
              <Text style={styles.title}>{t('onboarding', 'welcomeTitle')}</Text>
              <Text style={styles.paragraph}>{t('onboarding', 'welcomeBody')}</Text>
            </View>
          )}

          {step === STEP_EXPERIENCE && (
            <View style={styles.stepBlock}>
              <Text style={styles.title}>{t('onboarding', 'expTitle')}</Text>
              <Text style={styles.paragraph}>{t('onboarding', 'expQuestion')}</Text>
              <SelectCard
                styles={styles}
                title={t('onboarding', 'expBeginner')}
                hint={t('onboarding', 'expBeginnerHint')}
                active={experience === 'beginner'}
                onPress={() => onPickExperience('beginner')}
              />
              <SelectCard
                styles={styles}
                title={t('onboarding', 'expExperienced')}
                hint={t('onboarding', 'expExperiencedHint')}
                active={experience === 'experienced'}
                onPress={() => onPickExperience('experienced')}
              />
            </View>
          )}

          {step === STEP_MODE && (
            <View style={styles.stepBlock}>
              <Text style={styles.title}>{t('onboarding', 'modeTitle')}</Text>
              <SelectCard
                styles={styles}
                title={t('onboarding', 'modeMinimal')}
                hint={t('onboarding', 'modeMinimalHint')}
                active={selectedMode === 'minimal'}
                badge={experience === 'beginner' ? t('onboarding', 'recommended') : undefined}
                onPress={() => setSelectedMode('minimal')}
              />
              <SelectCard
                styles={styles}
                title={t('onboarding', 'modePlan')}
                hint={t('onboarding', 'modePlanHint')}
                active={selectedMode === 'plan'}
                badge={experience === 'experienced' ? t('onboarding', 'recommended') : undefined}
                onPress={() => setSelectedMode('plan')}
              />
              <Text style={styles.hint}>{t('onboarding', 'modeBody')}</Text>
            </View>
          )}

          {step === STEP_BODY && (
            <View style={styles.stepBlock}>
              <Text style={styles.title}>{t('onboarding', 'bodyTitle')}</Text>
              <Text style={styles.paragraph}>{t('onboarding', 'bodyBody')}</Text>
              <Field
                styles={styles}
                tokens={tokens}
                label={`${t('domain', 'bodyweight')} (${unit})`}
                value={bwInput}
                onChangeText={(v) => {
                  setBodyError(null);
                  setBwInput(v);
                }}
                placeholder="70.0"
              />
              <Field
                styles={styles}
                tokens={tokens}
                label="PBF (%)"
                value={pbfInput}
                onChangeText={(v) => {
                  setBodyError(null);
                  setPbfInput(v);
                }}
                placeholder="20.0"
              />
              <Field
                styles={styles}
                tokens={tokens}
                label={`SMM (${unit})`}
                value={smmInput}
                onChangeText={(v) => {
                  setBodyError(null);
                  setSmmInput(v);
                }}
                placeholder="32.0"
              />
              {bodyError ? <Text style={styles.errorText}>{bodyError}</Text> : null}
            </View>
          )}

          {step === STEP_HEALTH && (
            <View style={styles.stepBlock}>
              <Text style={styles.title}>{t('onboarding', 'healthTitle')}</Text>
              <Text style={styles.paragraph}>{t('onboarding', 'healthBody')}</Text>
              {hkConnected ? (
                <Text style={styles.connectedLabel}>
                  ✓ {t('status', 'appleHealthConnected')}
                </Text>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  onPress={onConnectHealth}
                  disabled={hkConnecting}
                  style={({ pressed }) => [
                    styles.connectBtn,
                    hkConnecting && styles.disabled,
                    pressed && styles.pressed,
                  ]}>
                  {hkConnecting ? (
                    <ActivityIndicator color={tokens.action.onPrimary} />
                  ) : (
                    <Text style={styles.connectLabel}>
                      {t('button', 'connectAppleHealth')}
                    </Text>
                  )}
                </Pressable>
              )}
            </View>
          )}
        </ScrollView>

        {/* Footer — 上一步 / 下一步·完成 */}
        <View style={styles.footer}>
          {step > STEP_WELCOME ? (
            <Pressable
              accessibilityRole="button"
              onPress={goBack}
              disabled={busy}
              style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}>
              <Text style={styles.backLabel}>{t('common', 'back')}</Text>
            </Pressable>
          ) : (
            <View style={styles.flex} />
          )}
          <Pressable
            accessibilityRole="button"
            onPress={goNext}
            disabled={primaryDisabled}
            style={({ pressed }) => [
              styles.primaryBtn,
              primaryDisabled && styles.disabled,
              pressed && styles.pressed,
            ]}>
            {busy ? (
              <ActivityIndicator color={tokens.action.onPrimary} />
            ) : (
              <Text style={styles.primaryLabel}>{primaryLabel}</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function translateBodyError(err: string): string {
  switch (err) {
    case 'BODYWEIGHT_OUT_OF_RANGE':
      return t('alert', 'invalidBodyweightLong');
    case 'PBF_OUT_OF_RANGE':
      return t('alert', 'invalidPbf');
    case 'SMM_OUT_OF_RANGE':
      return t('alert', 'invalidSmm');
    default:
      return t('alert', 'invalidInput');
  }
}

function SelectCard({
  styles,
  title,
  hint,
  active,
  badge,
  onPress,
}: {
  styles: Styles;
  title: string;
  hint: string;
  active: boolean;
  badge?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.selectCard,
        active && styles.selectCardActive,
        pressed && styles.pressed,
      ]}>
      <View style={styles.flex}>
        <View style={styles.selectTitleRow}>
          <Text style={[styles.selectTitle, active && styles.selectTitleActive]}>{title}</Text>
          {badge ? <Text style={styles.badge}>{badge}</Text> : null}
        </View>
        <Text style={[styles.selectHint, active && styles.selectHintActive]}>{hint}</Text>
      </View>
      {active ? <Text style={styles.selectCheck}>✓</Text> : null}
    </Pressable>
  );
}

function Field({
  styles,
  tokens,
  label,
  value,
  onChangeText,
  placeholder,
}: {
  styles: Styles;
  tokens: ThemeTokens;
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
        placeholderTextColor={tokens.text.tertiary}
        keyboardType="decimal-pad"
        selectTextOnFocus
        style={styles.input}
      />
    </View>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: tokens.bg.base },
    flex: { flex: 1 },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 8,
      minHeight: 44,
    },
    skipBtn: { paddingHorizontal: 8, paddingVertical: 6 },
    skipLabel: { fontSize: 16, fontWeight: '500', color: tokens.text.secondary },
    header: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8 },
    stepLabel: { fontSize: 12, fontWeight: '600', color: tokens.text.secondary },
    progressTrack: { flexDirection: 'row', gap: 4, marginTop: 10 },
    progressTick: {
      flex: 1,
      height: 4,
      borderRadius: 2,
      backgroundColor: tokens.bg.elevated,
    },
    progressTickActive: { backgroundColor: tokens.action.primary },
    body: { padding: 20, gap: 16, paddingBottom: 40 },
    stepBlock: { gap: 14 },
    title: { fontSize: 24, fontWeight: '700', color: tokens.text.primary },
    paragraph: { fontSize: 15, lineHeight: 22, color: tokens.text.secondary },
    hint: { fontSize: 13, color: tokens.text.tertiary },
    errorText: { fontSize: 14, color: tokens.action.destructive },
    selectCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 16,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: tokens.border.default,
      backgroundColor: tokens.bg.elevated,
    },
    selectCardActive: {
      borderColor: tokens.action.primary,
      backgroundColor: tokens.action.primary,
    },
    selectTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    selectTitle: { fontSize: 17, fontWeight: '600', color: tokens.text.primary },
    selectTitleActive: { color: tokens.action.onPrimary },
    selectHint: { fontSize: 13, marginTop: 2, color: tokens.text.secondary },
    selectHintActive: { color: tokens.action.onPrimary, opacity: 0.9 },
    selectCheck: { fontSize: 20, fontWeight: '700', color: tokens.action.onPrimary },
    badge: {
      fontSize: 11,
      fontWeight: '700',
      color: tokens.action.onPrimary,
      backgroundColor: tokens.action.success,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 8,
      overflow: 'hidden',
    },
    field: { gap: 6 },
    fieldLabel: { fontSize: 14, fontWeight: '500', color: tokens.text.secondary },
    input: {
      fontSize: 17,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 10,
      backgroundColor: tokens.bg.surface,
      color: tokens.text.primary,
    },
    connectBtn: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 14,
      borderRadius: 12,
      backgroundColor: tokens.action.primary,
      minHeight: 50,
    },
    connectLabel: { fontSize: 16, fontWeight: '600', color: tokens.action.onPrimary },
    connectedLabel: { fontSize: 16, fontWeight: '600', color: tokens.action.success },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 20,
      paddingTop: 10,
      paddingBottom: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.border.subtle,
    },
    backBtn: { paddingVertical: 14, paddingHorizontal: 20 },
    backLabel: { fontSize: 16, fontWeight: '500', color: tokens.action.primary },
    primaryBtn: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 14,
      borderRadius: 12,
      backgroundColor: tokens.action.primary,
      minHeight: 50,
    },
    primaryLabel: { fontSize: 17, fontWeight: '700', color: tokens.action.onPrimary },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.85 },
  });
}
