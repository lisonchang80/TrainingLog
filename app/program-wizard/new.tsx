import { randomUUID } from 'expo-crypto';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
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

import { useDatabase } from '@/components/database-provider';
import {
  createProgram,
  setActiveProgram,
} from '@/src/adapters/sqlite/programRepository';
import {
  attachTemplateToProgram,
  listTemplates,
  type TemplateSummary,
} from '@/src/adapters/sqlite/templateRepository';
import {
  expandWizardDraft,
  utcMsToIsoDate,
} from '@/src/domain/program/programManager';
import {
  WIZARD_STEPS,
  complete,
  initialWizardState,
  isFirstStep,
  isLastStep,
  next as nextStep,
  prev as prevStep,
  stepIndex,
  updateDraft,
  validateStep,
  type WizardState,
  type WizardStep,
} from '@/src/domain/program/wizardStateMachine';

/**
 * 6-step Program creation wizard. State machine logic lives in
 * `wizardStateMachine.ts` — this file is a thin React shell that:
 *   - holds the WizardState in `useState` (replaceable with AsyncStorage for the
 *     "暫存草稿" criterion in a follow-up slice)
 *   - renders a per-step input panel
 *   - on Confirm, expands the draft into cells and persists Program + cells +
 *     attaches each picked template to the new program
 */
export default function ProgramWizardScreen() {
  const db = useDatabase();
  const router = useRouter();
  const today = utcMsToIsoDate(Date.now());
  const [state, setState] = useState<WizardState>(() => initialWizardState(today));
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const ts = await listTemplates(db);
    setTemplates(ts);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  const onPrev = () => {
    if (isFirstStep(state.step)) {
      router.back();
      return;
    }
    setState(prevStep(state));
  };

  const onNext = () => {
    const r = nextStep(state);
    if ('error' in r) {
      Alert.alert('Cannot continue', r.error);
      return;
    }
    setState(r);
  };

  const onConfirm = async () => {
    const r = complete(state);
    if ('error' in r) {
      Alert.alert('Cannot save', r.error);
      return;
    }
    setBusy(true);
    try {
      const programId = randomUUID();
      const programCore = {
        id: programId,
        name: r.draft.name.trim(),
        main_tag: r.draft.main_tag?.trim() || null,
        cycle_length: r.draft.cycle_length,
        cycle_count: r.draft.cycle_count,
        start_date: r.draft.start_date as string,
        is_active: 0 as const,
      };
      const cells = expandWizardDraft({
        program: programCore,
        dayPlans: r.draft.dayPlans,
        overrides: r.draft.overrides,
        uuid: randomUUID,
      });
      await createProgram(db, { program: programCore, cells });
      // Attach every distinct template that the wizard mapped onto a cell
      // so it's flagged as a Program-attached template per ADR-0003.
      const seen = new Set<string>();
      for (const dp of r.draft.dayPlans) {
        if (dp.template_id && !seen.has(dp.template_id)) {
          seen.add(dp.template_id);
          await attachTemplateToProgram(db, {
            template_id: dp.template_id,
            program_id: programId,
            sub_tag: dp.sub_tag,
          });
        }
      }
      await setActiveProgram(db, { id: programId });
      router.replace(`/program/${programId}`);
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <StepHeader step={state.step} />

          {state.step === 'NameAndTag' && (
            <NameAndTagPanel state={state} setState={setState} />
          )}
          {state.step === 'CycleConfig' && (
            <CycleConfigPanel state={state} setState={setState} />
          )}
          {state.step === 'DayPattern' && (
            <DayPatternPanel
              state={state}
              setState={setState}
              templates={templates}
            />
          )}
          {state.step === 'CycleSubTags' && (
            <CycleSubTagsPanel state={state} setState={setState} />
          )}
          {state.step === 'Preview' && (
            <PreviewPanel state={state} templates={templates} />
          )}
          {state.step === 'Confirm' && <ConfirmPanel state={state} />}

          <View style={styles.navRow}>
            <Pressable
              accessibilityRole="button"
              onPress={onPrev}
              style={({ pressed }) => [
                styles.navBtn,
                styles.navBtnSecondary,
                pressed && styles.btnPressed,
              ]}>
              <Text style={styles.navBtnSecondaryText}>
                {isFirstStep(state.step) ? 'Cancel' : 'Back'}
              </Text>
            </Pressable>
            {isLastStep(state.step) ? (
              <Pressable
                accessibilityRole="button"
                onPress={onConfirm}
                disabled={busy}
                style={({ pressed }) => [
                  styles.navBtn,
                  styles.navBtnPrimary,
                  busy && styles.btnDisabled,
                  pressed && styles.btnPressed,
                ]}>
                <Text style={styles.navBtnPrimaryText}>
                  {busy ? 'Saving…' : 'Create Program'}
                </Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={onNext}
                style={({ pressed }) => [
                  styles.navBtn,
                  styles.navBtnPrimary,
                  pressed && styles.btnPressed,
                ]}>
                <Text style={styles.navBtnPrimaryText}>Next</Text>
              </Pressable>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function StepHeader({ step }: { step: WizardStep }) {
  return (
    <View>
      <Text style={styles.stepLabel}>
        Step {stepIndex(step) + 1} of {WIZARD_STEPS.length}
      </Text>
      <Text style={styles.stepTitle}>{stepTitle(step)}</Text>
      <View style={styles.progressTrack}>
        {WIZARD_STEPS.map((s, i) => (
          <View
            key={s}
            style={[
              styles.progressTick,
              i <= stepIndex(step) && styles.progressTickActive,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

function stepTitle(step: WizardStep): string {
  switch (step) {
    case 'NameAndTag':
      return 'Program 名稱 + 主標籤';
    case 'CycleConfig':
      return 'Cycle 設定';
    case 'DayPattern':
      return 'Cycle 1 每日內容';
    case 'CycleSubTags':
      return '各 Cycle 副標籤調整';
    case 'Preview':
      return '預覽日曆';
    case 'Confirm':
      return '確認建立';
  }
}

function NameAndTagPanel({
  state,
  setState,
}: {
  state: WizardState;
  setState: (s: WizardState) => void;
}) {
  return (
    <View style={styles.panel}>
      <Text style={styles.label}>Program 名稱</Text>
      <TextInput
        style={styles.input}
        value={state.draft.name}
        onChangeText={(name) => setState(updateDraft(state, { name }))}
        placeholder="例：增肌-Q1"
        placeholderTextColor="#999"
      />
      <Text style={styles.label}>主標籤（可空）</Text>
      <TextInput
        style={styles.input}
        value={state.draft.main_tag ?? ''}
        onChangeText={(v) =>
          setState(updateDraft(state, { main_tag: v || null }))
        }
        placeholder="例：力量、增肌、減脂"
        placeholderTextColor="#999"
      />
    </View>
  );
}

function CycleConfigPanel({
  state,
  setState,
}: {
  state: WizardState;
  setState: (s: WizardState) => void;
}) {
  const update = (patch: Partial<WizardState['draft']>) =>
    setState(updateDraft(state, patch));
  return (
    <View style={styles.panel}>
      <Text style={styles.label}>Cycle 長度（3-14 天）</Text>
      <TextInput
        style={styles.input}
        keyboardType="number-pad"
        value={String(state.draft.cycle_length)}
        onChangeText={(v) => update({ cycle_length: Number(v) || 0 })}
      />
      <Text style={styles.label}>Cycle 次數</Text>
      <TextInput
        style={styles.input}
        keyboardType="number-pad"
        value={String(state.draft.cycle_count)}
        onChangeText={(v) => update({ cycle_count: Number(v) || 0 })}
      />
      <Text style={styles.label}>起始日期 (yyyy-mm-dd)</Text>
      <TextInput
        style={styles.input}
        autoCapitalize="none"
        value={state.draft.start_date ?? ''}
        onChangeText={(v) => update({ start_date: v })}
      />
    </View>
  );
}

function DayPatternPanel({
  state,
  setState,
  templates,
}: {
  state: WizardState;
  setState: (s: WizardState) => void;
  templates: TemplateSummary[];
}) {
  const days = Array.from({ length: state.draft.cycle_length }, (_, i) => i);
  const planByDay = useMemo(() => {
    const m = new Map<number, { template_id: string | null; sub_tag: string | null }>();
    for (const dp of state.draft.dayPlans) {
      m.set(dp.day_index, {
        template_id: dp.template_id,
        sub_tag: dp.sub_tag,
      });
    }
    return m;
  }, [state.draft.dayPlans]);

  const updateDay = (
    day_index: number,
    patch: Partial<{ template_id: string | null; sub_tag: string | null }>
  ) => {
    const existing = planByDay.get(day_index) ?? {
      template_id: null,
      sub_tag: null,
    };
    const merged = { ...existing, ...patch };
    const next = state.draft.dayPlans.filter((dp) => dp.day_index !== day_index);
    next.push({ day_index, ...merged });
    next.sort((a, b) => a.day_index - b.day_index);
    setState(updateDraft(state, { dayPlans: next }));
  };

  return (
    <View style={styles.panel}>
      <Text style={styles.hint}>
        每天選擇一個 Template（可留白為休息日）。Cycle 1 的選擇會 fan-out 到每個 cycle；
        若各 cycle 副標籤不同，下一步可逐 cycle 調整。
      </Text>
      {days.map((d) => {
        const plan = planByDay.get(d);
        return (
          <View key={d} style={styles.dayCard}>
            <Text style={styles.dayLabel}>
              Day {d + 1}
              {state.draft.cycle_length === 7
                ? ` · ${['一', '二', '三', '四', '五', '六', '日'][d]}`
                : ''}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.pillsRow}>
              <Pressable
                onPress={() => updateDay(d, { template_id: null, sub_tag: null })}
                style={({ pressed }) => [
                  styles.pill,
                  plan?.template_id == null && styles.pillActive,
                  pressed && styles.btnPressed,
                ]}>
                <Text
                  style={[
                    styles.pillText,
                    plan?.template_id == null && styles.pillTextActive,
                  ]}>
                  休息
                </Text>
              </Pressable>
              {templates.map((t) => {
                const active = plan?.template_id === t.id;
                return (
                  <Pressable
                    key={t.id}
                    onPress={() => updateDay(d, { template_id: t.id })}
                    style={({ pressed }) => [
                      styles.pill,
                      active && styles.pillActive,
                      pressed && styles.btnPressed,
                    ]}>
                    <Text
                      style={[styles.pillText, active && styles.pillTextActive]}>
                      {t.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            {plan?.template_id ? (
              <TextInput
                style={[styles.input, styles.subTagInput]}
                value={plan?.sub_tag ?? ''}
                onChangeText={(v) =>
                  updateDay(d, { sub_tag: v || null })
                }
                placeholder="副標籤（例：10-12RM）"
                placeholderTextColor="#999"
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function CycleSubTagsPanel({
  state,
  setState,
}: {
  state: WizardState;
  setState: (s: WizardState) => void;
}) {
  const dayPlansWithTemplate = state.draft.dayPlans.filter(
    (dp) => dp.template_id != null
  );
  const overrideMap = new Map(
    state.draft.overrides.map((o) => [`${o.cycle_index}:${o.day_index}`, o.sub_tag])
  );
  const update = (cycle_index: number, day_index: number, sub_tag: string | null) => {
    const next = state.draft.overrides.filter(
      (o) => !(o.cycle_index === cycle_index && o.day_index === day_index)
    );
    if (sub_tag != null) {
      next.push({ cycle_index, day_index, sub_tag });
    }
    setState(updateDraft(state, { overrides: next }));
  };

  return (
    <View style={styles.panel}>
      <Text style={styles.hint}>
        若各 cycle 副標籤相同，可直接 Skip。否則為每個 cycle 的特定 day
        覆寫副標籤（留白＝沿用 Day 預設）。
      </Text>
      {Array.from({ length: state.draft.cycle_count }, (_, c) => (
        <View key={c} style={styles.cycleBlock}>
          <Text style={styles.cycleHeader}>Cycle {c + 1}</Text>
          {dayPlansWithTemplate.map((dp) => {
            const key = `${c}:${dp.day_index}`;
            const value = overrideMap.has(key)
              ? overrideMap.get(key) ?? ''
              : '';
            return (
              <View key={dp.day_index} style={styles.subTagRow}>
                <Text style={styles.subTagDayLabel}>D{dp.day_index + 1}</Text>
                <TextInput
                  style={[styles.input, styles.subTagOverrideInput]}
                  value={value}
                  onChangeText={(v) =>
                    update(c, dp.day_index, v ? v : null)
                  }
                  placeholder={dp.sub_tag ?? '（沿用 Day 預設）'}
                  placeholderTextColor="#999"
                />
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function PreviewPanel({
  state,
  templates,
}: {
  state: WizardState;
  templates: TemplateSummary[];
}) {
  const tplById = new Map(templates.map((t) => [t.id, t.name]));
  const overrideMap = new Map(
    state.draft.overrides.map((o) => [`${o.cycle_index}:${o.day_index}`, o.sub_tag])
  );
  const dayPlanMap = new Map(state.draft.dayPlans.map((dp) => [dp.day_index, dp]));
  return (
    <View style={styles.panel}>
      <Text style={styles.hint}>展開後的日曆 — 確認看起來對。</Text>
      {Array.from({ length: state.draft.cycle_count }, (_, c) => (
        <View key={c} style={styles.previewRow}>
          <Text style={styles.previewCycleLabel}>C{c + 1}</Text>
          <View style={styles.previewCells}>
            {Array.from({ length: state.draft.cycle_length }, (_, d) => {
              const dp = dayPlanMap.get(d);
              const tplName = dp?.template_id ? tplById.get(dp.template_id) : null;
              const subTag = overrideMap.has(`${c}:${d}`)
                ? overrideMap.get(`${c}:${d}`) ?? ''
                : dp?.sub_tag ?? '';
              return (
                <View key={d} style={styles.previewCell}>
                  <Text style={styles.previewCellName} numberOfLines={1}>
                    {tplName ?? '—'}
                  </Text>
                  {subTag ? (
                    <Text style={styles.previewCellTag} numberOfLines={1}>
                      {subTag}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

function ConfirmPanel({ state }: { state: WizardState }) {
  const err = validateStep(state.draft, 'Confirm');
  return (
    <View style={styles.panel}>
      <Text style={styles.hint}>檢查無誤後按下方建立。</Text>
      <View style={styles.summaryCard}>
        <Text style={styles.summaryLine}>
          名稱：{state.draft.name || '(未填)'}
        </Text>
        <Text style={styles.summaryLine}>
          主標籤：{state.draft.main_tag ?? '無'}
        </Text>
        <Text style={styles.summaryLine}>
          循環：{state.draft.cycle_count} × {state.draft.cycle_length} 天
        </Text>
        <Text style={styles.summaryLine}>
          起始：{state.draft.start_date ?? '(未填)'}
        </Text>
        <Text style={styles.summaryLine}>
          已配置 Day：
          {state.draft.dayPlans.filter((dp) => dp.template_id).length} 天
        </Text>
        <Text style={styles.summaryLine}>
          副標籤覆寫：{state.draft.overrides.length} 項
        </Text>
      </View>
      {err ? <Text style={styles.errorLine}>⚠️ {err}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  body: { padding: 20, gap: 16, paddingBottom: 48 },
  stepLabel: { fontSize: 12, fontWeight: '600', opacity: 0.6 },
  stepTitle: { fontSize: 22, fontWeight: '700', marginTop: 4 },
  progressTrack: { flexDirection: 'row', gap: 4, marginTop: 12 },
  progressTick: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(127,127,127,0.25)',
  },
  progressTickActive: { backgroundColor: '#0a7ea4' },
  panel: { gap: 10 },
  label: { fontSize: 13, fontWeight: '500', marginTop: 6, opacity: 0.7 },
  hint: { fontSize: 13, opacity: 0.7, marginBottom: 6 },
  input: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(127,127,127,0.12)',
    fontSize: 16,
  },
  subTagInput: { marginTop: 6 },
  dayCard: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(127,127,127,0.08)',
    gap: 6,
  },
  dayLabel: { fontSize: 14, fontWeight: '600' },
  pillsRow: { gap: 8, paddingVertical: 4 },
  pill: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(127,127,127,0.15)',
  },
  pillActive: { backgroundColor: '#0a7ea4' },
  pillText: { fontSize: 13, fontWeight: '500' },
  pillTextActive: { color: 'white' },
  cycleBlock: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(127,127,127,0.08)',
    gap: 6,
    marginBottom: 8,
  },
  cycleHeader: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  subTagRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  subTagDayLabel: { width: 32, fontSize: 12, fontWeight: '600' },
  subTagOverrideInput: { flex: 1, paddingVertical: 8 },
  previewRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6 },
  previewCycleLabel: {
    width: 32,
    fontSize: 12,
    fontWeight: '700',
    paddingTop: 8,
    opacity: 0.7,
  },
  previewCells: { flex: 1, flexDirection: 'row', flexWrap: 'wrap' },
  previewCell: {
    width: '14%',
    minHeight: 48,
    margin: 1,
    padding: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(127,127,127,0.10)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewCellName: { fontSize: 10, fontWeight: '600', textAlign: 'center' },
  previewCellTag: { fontSize: 8, opacity: 0.65, marginTop: 2, textAlign: 'center' },
  summaryCard: {
    padding: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(127,127,127,0.10)',
    gap: 6,
  },
  summaryLine: { fontSize: 14 },
  errorLine: { color: '#dc3545', fontSize: 14, marginTop: 8 },
  navRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  navBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  navBtnPrimary: { backgroundColor: '#0a7ea4' },
  navBtnPrimaryText: { color: 'white', fontSize: 15, fontWeight: '700' },
  navBtnSecondary: { backgroundColor: 'rgba(127,127,127,0.18)' },
  navBtnSecondaryText: { fontSize: 15, fontWeight: '600' },
  btnPressed: { opacity: 0.85 },
  btnDisabled: { opacity: 0.5 },
});
