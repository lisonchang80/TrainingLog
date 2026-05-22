import { randomUUID } from 'expo-crypto';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
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
  recordProgramSubTag,
  setActiveProgram,
} from '@/src/adapters/sqlite/programRepository';
import {
  attachTemplateToProgram,
  createTemplate,
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

  // Wizard Step 3 entry point — pre-create a template with placeholder name
  // and push to the template editor without any `fromX` params, so the editor
  // runs in plain edit mode. On save the editor calls `router.back()`, which
  // returns to this wizard with state intact; useFocusEffect re-fetches the
  // templates list so the new template auto-appears as a selectable pill.
  const onCreateNewTemplate = useCallback(async () => {
    try {
      const id = randomUUID();
      await createTemplate(db, { id, name: '新模板' });
      router.push(`/template/${id}`);
    } catch (e) {
      Alert.alert(
        '無法建立模板',
        e instanceof Error ? e.message : String(e)
      );
    }
  }, [db, router]);

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
      // Pre-register 強度 labels typed in Step 1 into the persistent dictionary
      // (`program_sub_tag` v022). INSERT OR IGNORE keeps duplicates silent.
      for (const tag of r.draft.sub_tags) {
        await recordProgramSubTag(db, programId, tag);
      }
      await setActiveProgram(db, { id: programId });
      router.replace(`/program/${programId}`);
    } catch (e) {
      Alert.alert('Save failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const leftLabel = isFirstStep(state.step) ? '取消' : '上一步';
  const rightLabel = isLastStep(state.step)
    ? busy
      ? '儲存中…'
      : '建立'
    : '下一步';
  const rightDisabled = isLastStep(state.step) && busy;

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen
        options={{
          headerLeft: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={leftLabel}
              onPress={onPrev}
              hitSlop={8}
              style={({ pressed }) => [
                styles.headerBtn,
                pressed && styles.btnPressed,
              ]}>
              <Text style={styles.headerBtnSecondary}>{leftLabel}</Text>
            </Pressable>
          ),
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={rightLabel}
              onPress={isLastStep(state.step) ? onConfirm : onNext}
              disabled={rightDisabled}
              hitSlop={8}
              style={({ pressed }) => [
                styles.headerBtn,
                rightDisabled && styles.btnDisabled,
                pressed && styles.btnPressed,
              ]}>
              <Text style={styles.headerBtnPrimary}>{rightLabel}</Text>
            </Pressable>
          ),
        }}
      />
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
              onCreateNewTemplate={onCreateNewTemplate}
            />
          )}
          {state.step === 'CycleSubTags' && (
            <CycleSubTagsPanel state={state} setState={setState} />
          )}
          {state.step === 'Preview' && (
            <PreviewPanel state={state} templates={templates} />
          )}
          {state.step === 'Confirm' && <ConfirmPanel state={state} />}
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
      return '計劃名稱 + 強度';
    case 'CycleConfig':
      return '週期設定';
    case 'DayPattern':
      return '週期 1 每日內容';
    case 'CycleSubTags':
      return '各週期強度調整';
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
  const [pending, setPending] = useState('');
  const addSubTag = () => {
    const v = pending.trim();
    if (!v) return;
    if (state.draft.sub_tags.includes(v)) {
      setPending('');
      return;
    }
    setState(
      updateDraft(state, { sub_tags: [...state.draft.sub_tags, v] })
    );
    setPending('');
  };
  const removeSubTag = (tag: string) => {
    setState(
      updateDraft(state, {
        sub_tags: state.draft.sub_tags.filter((t) => t !== tag),
      })
    );
  };
  return (
    <View style={styles.panel}>
      <Text style={styles.label}>計劃名稱</Text>
      <TextInput
        style={styles.input}
        value={state.draft.name}
        onChangeText={(name) => setState(updateDraft(state, { name }))}
        placeholder="例：增肌-Q1"
        placeholderTextColor="#999"
      />
      <Text style={styles.label}>強度（可空，可多筆）</Text>
      {state.draft.sub_tags.length > 0 ? (
        <View style={styles.tagChipRow}>
          {state.draft.sub_tags.map((tag) => (
            <View key={tag} style={styles.tagChip}>
              <Text style={styles.tagChipText}>{tag}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`移除強度 ${tag}`}
                onPress={() => removeSubTag(tag)}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.tagChipRemove,
                  pressed && styles.btnPressed,
                ]}>
                <Text style={styles.tagChipRemoveText}>−</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.tagAddRow}>
        <TextInput
          style={[styles.input, styles.tagAddInput]}
          value={pending}
          onChangeText={setPending}
          onSubmitEditing={addSubTag}
          returnKeyType="done"
          placeholder="例：10-12RM、II-1"
          placeholderTextColor="#999"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="新增強度"
          onPress={addSubTag}
          disabled={pending.trim().length === 0}
          style={({ pressed }) => [
            styles.tagAddBtn,
            pending.trim().length === 0 && styles.btnDisabled,
            pressed && styles.btnPressed,
          ]}>
          <Text style={styles.tagAddBtnText}>＋</Text>
        </Pressable>
      </View>
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
      <Text style={styles.label}>循環天數（3-14 天）</Text>
      <TextInput
        style={styles.input}
        keyboardType="number-pad"
        value={String(state.draft.cycle_length)}
        onChangeText={(v) => update({ cycle_length: Number(v) || 0 })}
      />
      <Text style={styles.label}>週期數</Text>
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
  onCreateNewTemplate,
}: {
  state: WizardState;
  setState: (s: WizardState) => void;
  templates: TemplateSummary[];
  onCreateNewTemplate: () => Promise<void>;
}) {
  const days = Array.from({ length: state.draft.cycle_length }, (_, i) => i);
  const planByDay = useMemo(() => {
    const m = new Map<number, { template_id: string | null }>();
    for (const dp of state.draft.dayPlans) {
      m.set(dp.day_index, { template_id: dp.template_id });
    }
    return m;
  }, [state.draft.dayPlans]);

  // wave 18d: Step 3 captures template ONLY (no sub_tag). Strength is now
  // picked per-cycle in Step 4. We keep `dayPlans[].sub_tag` in the schema
  // but always write null here — expandWizardDraft + Step 4's per-cycle
  // override expansion drives the final cell.sub_tag.
  const setTemplate = (day_index: number, template_id: string | null) => {
    const next = state.draft.dayPlans.filter((dp) => dp.day_index !== day_index);
    next.push({ day_index, template_id, sub_tag: null });
    next.sort((a, b) => a.day_index - b.day_index);
    setState(updateDraft(state, { dayPlans: next }));
  };

  return (
    <View style={styles.panel}>
      <Text style={styles.hint}>
        每天選擇一個模板（可留白為休息日）。週期 1 的選擇會 fan-out 到每個週期；
        強度在下一步逐週期選擇。
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
                onPress={() => setTemplate(d, null)}
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
                    onPress={() => setTemplate(d, t.id)}
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
              <Pressable
                onPress={onCreateNewTemplate}
                style={({ pressed }) => [
                  styles.pill,
                  styles.pillCreate,
                  pressed && styles.btnPressed,
                ]}>
                <Text style={[styles.pillText, styles.pillCreateText]}>
                  ＋ 新建
                </Text>
              </Pressable>
            </ScrollView>
            {/* sub_tag UI removed — picked per-cycle in Step 4 (wave 18d) */}
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
  // wave 18d: per-cycle ONE sub_tag picker (was per-(cycle, day) override).
  // We keep the underlying `overrides[]` shape unchanged so expandWizardDraft
  // and domain tests don't change — when user picks 強度 X for cycle c, we
  // expand to one override entry per day-with-template in that cycle, all
  // with sub_tag = X. 「無強度」 = clear all entries for that cycle.
  const dayIndicesWithTemplate = useMemo(
    () =>
      state.draft.dayPlans
        .filter((dp) => dp.template_id != null)
        .map((dp) => dp.day_index)
        .sort((a, b) => a - b),
    [state.draft.dayPlans]
  );

  // Inspect overrides for cycle c → detect the cycle's current uniform pick
  // (all days share the same sub_tag) or "mixed" (heterogeneous from legacy
  // data — treated as nothing selected for UI feedback).
  const cyclePick = (c: number): string | null | 'mixed' => {
    const entries = state.draft.overrides.filter((o) => o.cycle_index === c);
    if (entries.length === 0) return null;
    const first = entries[0].sub_tag;
    const uniform = entries.every((e) => e.sub_tag === first);
    return uniform ? first : 'mixed';
  };

  // Custom-mode (free-form input) per cycle. Mirror Step-1's chip + 自訂
  // pattern; enabled either explicitly via「自訂」 chip or implicitly when the
  // existing pick isn't in Step 1's list (e.g. user navigated back).
  const [customCycles, setCustomCycles] = useState<Set<number>>(new Set());
  const isCustomCycle = (c: number, pick: string | null | 'mixed') => {
    if (customCycles.has(c)) return true;
    if (pick == null || pick === 'mixed') return false;
    return !state.draft.sub_tags.includes(pick);
  };
  const enterCustom = (c: number) =>
    setCustomCycles((prev) => {
      const next = new Set(prev);
      next.add(c);
      return next;
    });
  const exitCustom = (c: number) =>
    setCustomCycles((prev) => {
      if (!prev.has(c)) return prev;
      const next = new Set(prev);
      next.delete(c);
      return next;
    });

  const pickCycle = (c: number, sub_tag: string | null) => {
    const without = state.draft.overrides.filter((o) => o.cycle_index !== c);
    if (sub_tag == null) {
      setState(updateDraft(state, { overrides: without }));
      return;
    }
    const added = dayIndicesWithTemplate.map((day_index) => ({
      cycle_index: c,
      day_index,
      sub_tag,
    }));
    setState(updateDraft(state, { overrides: [...without, ...added] }));
  };

  return (
    <View style={styles.panel}>
      <Text style={styles.hint}>
        每個週期選一個強度（套用到此週期內所有有模板的日子）。
        留「無強度」即不套用。
      </Text>
      {Array.from({ length: state.draft.cycle_count }, (_, c) => {
        const pick = cyclePick(c);
        const customMode = isCustomCycle(c, pick);
        const customValue =
          customMode && pick != null && pick !== 'mixed' ? pick : '';
        return (
          <View key={c} style={styles.cycleBlock}>
            <Text style={styles.cycleHeader}>週期 {c + 1}</Text>
            {state.draft.sub_tags.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.pillsRow}>
                <Pressable
                  onPress={() => {
                    exitCustom(c);
                    pickCycle(c, null);
                  }}
                  style={({ pressed }) => [
                    styles.pill,
                    !customMode && pick == null && styles.pillActive,
                    pressed && styles.btnPressed,
                  ]}>
                  <Text
                    style={[
                      styles.pillText,
                      !customMode && pick == null && styles.pillTextActive,
                    ]}>
                    無強度
                  </Text>
                </Pressable>
                {state.draft.sub_tags.map((tag) => {
                  const active = !customMode && pick === tag;
                  return (
                    <Pressable
                      key={tag}
                      onPress={() => {
                        exitCustom(c);
                        pickCycle(c, tag);
                      }}
                      style={({ pressed }) => [
                        styles.pill,
                        active && styles.pillActive,
                        pressed && styles.btnPressed,
                      ]}>
                      <Text
                        style={[
                          styles.pillText,
                          active && styles.pillTextActive,
                        ]}>
                        {tag}
                      </Text>
                    </Pressable>
                  );
                })}
                <Pressable
                  onPress={() => enterCustom(c)}
                  style={({ pressed }) => [
                    styles.pill,
                    customMode && styles.pillActive,
                    pressed && styles.btnPressed,
                  ]}>
                  <Text
                    style={[
                      styles.pillText,
                      customMode && styles.pillTextActive,
                    ]}>
                    自訂
                  </Text>
                </Pressable>
              </ScrollView>
            ) : null}
            {customMode || state.draft.sub_tags.length === 0 ? (
              <TextInput
                style={[styles.input, styles.subTagInput]}
                value={customValue}
                onChangeText={(v) => pickCycle(c, v.trim() || null)}
                placeholder="強度（例：10-12RM）"
                placeholderTextColor="#999"
              />
            ) : null}
          </View>
        );
      })}
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
          強度：
          {state.draft.sub_tags.length === 0
            ? '(無)'
            : state.draft.sub_tags.join('、')}
        </Text>
        <Text style={styles.summaryLine}>
          週期：{state.draft.cycle_count} × {state.draft.cycle_length} 天
        </Text>
        <Text style={styles.summaryLine}>
          起始：{state.draft.start_date ?? '(未填)'}
        </Text>
        <Text style={styles.summaryLine}>
          已配置 Day：
          {state.draft.dayPlans.filter((dp) => dp.template_id).length} 天
        </Text>
        <Text style={styles.summaryLine}>
          強度覆寫：{state.draft.overrides.length} 項
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
  tagChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(10,126,164,0.12)',
    gap: 6,
  },
  tagChipText: { fontSize: 13, fontWeight: '600', color: '#0a7ea4' },
  tagChipRemove: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(10,126,164,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagChipRemoveText: {
    color: '#0a7ea4',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 18,
  },
  tagAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  tagAddInput: { flex: 1 },
  tagAddBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0a7ea4',
  },
  tagAddBtnText: { color: 'white', fontSize: 22, fontWeight: '700', lineHeight: 24 },
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
  pillCreate: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#0a7ea4',
    borderStyle: 'dashed',
  },
  pillCreateText: { color: '#0a7ea4', fontWeight: '600' },
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
  previewRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 6, gap: 4 },
  previewCycleLabel: {
    width: 22,
    fontSize: 12,
    fontWeight: '700',
    paddingTop: 8,
    opacity: 0.7,
    textAlign: 'left',
  },
  previewCells: {
    flex: 1,
    flexDirection: 'row',
    gap: 3,
  },
  previewCell: {
    flex: 1,
    minHeight: 48,
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
  headerBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  headerBtnPrimary: {
    color: '#0a7ea4',
    fontSize: 16,
    fontWeight: '700',
  },
  headerBtnSecondary: {
    color: '#6b7280',
    fontSize: 16,
    fontWeight: '500',
  },
  btnPressed: { opacity: 0.85 },
  btnDisabled: { opacity: 0.5 },
});
