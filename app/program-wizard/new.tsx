import { randomUUID } from 'expo-crypto';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
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
  listProgramSubTags,
  listPrograms,
  overwriteProgram,
  recordProgramSubTag,
  setActiveProgram,
  type ProgramSummary,
} from '@/src/adapters/sqlite/programRepository';
import {
  attachTemplateToProgram,
  createTemplate,
  findNextAvailableTemplateName,
  listTemplateGroupsByName,
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
import {
  t,
  tCycleN,
  tNDays,
  tOverwriteBlockedByActiveSession,
  tOverwriteBannerTitle,
  tRemoveIntensity,
  tWeekdayLabels,
} from '@/src/i18n';
import { useTheme, type ThemeTokens } from '@/src/theme';

/**
 * ADR-0025 — DRY helper. The wizard's many sub-component functions
 * (NameAndTagPanel, CycleConfigPanel, …) each call this instead of
 * repeating useTheme + useMemo. Mirrors the library.tsx pattern.
 */
function useWizStyles() {
  const { tokens } = useTheme();
  return useMemo(() => makeStyles(tokens), [tokens]);
}

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
  const { tokens } = useTheme();
  const styles = useWizStyles();
  const today = utcMsToIsoDate(Date.now());
  const [state, setState] = useState<WizardState>(() => initialWizardState(today));
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [programs, setPrograms] = useState<ProgramSummary[]>([]);
  const [busy, setBusy] = useState(false);

  // Wave 18g (Phase 6, smoke-revision) — same-name overwrite UX is
  // **inline**, not modal: as the user types the name, we detect a
  // matching existing program and (a) pre-fill `draft.sub_tags` with that
  // program's persistent sub_tag dictionary so its chips appear in the
  // strength section immediately, and (b) flag `overwriteTarget` so Step 6
  // confirm path branches to `overwriteProgram` and the banner can render
  // a "will overwrite" notice. Renaming the input clears the target.
  const [overwriteTarget, setOverwriteTarget] =
    useState<ProgramSummary | null>(null);

  const refresh = useCallback(async () => {
    // Wave 18g (smoke-revision) — dedupe-by-name. ADR-0003 lets siblings
    // share a name across different (program_id, sub_tag) triples; the
    // Step 3 picker is "pick a template name to fan out", so duplicate
    // names are redundant clutter. `listTemplateGroupsByName` collapses
    // siblings to the MAX(updated_at) representative (same helper as
    // Templates tab + Programs row picker).
    const [ts, ps] = await Promise.all([
      listTemplateGroupsByName(db),
      listPrograms(db),
    ]);
    setTemplates(ts);
    setPrograms(ps);
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
      const uniqueName = await findNextAvailableTemplateName(
        db,
        t('domain', 'newTemplate'),
      );
      await createTemplate(db, { id, name: uniqueName });
      router.push(`/template/${id}`);
    } catch (e) {
      Alert.alert(
        t('alert', 'cannotCreateTemplate'),
        e instanceof Error ? e.message : String(e)
      );
    }
  }, [db, router]);

  // Wave 18g — case-insensitive trim match against the existing program
  // list. Computed inline as the user types (cheap; just an array scan).
  // Returns the same object reference for stable name → useEffect doesn't
  // refire on every keystroke.
  const overwriteMatch = useMemo<ProgramSummary | null>(() => {
    const typed = state.draft.name.trim().toLowerCase();
    if (!typed) return null;
    return programs.find((p) => p.name.trim().toLowerCase() === typed) ?? null;
  }, [state.draft.name, programs]);

  // Inline detection: when the typed name matches an existing program,
  // load its sub_tag dictionary and replace `draft.sub_tags` so the
  // existing 強度 chips render directly in Step 1. Renaming away clears
  // `overwriteTarget` only — any chips the user has at that point stay
  // put (whether auto-prefilled or manually added) and can be removed
  // individually if not wanted.
  //
  // No setState-inside-updater here: that anti-pattern fires the inner
  // setState during React reconciliation (and twice under StrictMode),
  // which we saw cause a Maximum-update-depth crash when the editor
  // mounted on top of the wizard. Plain top-level setOverwriteTarget +
  // setState calls are safe.
  useEffect(() => {
    if (!overwriteMatch) {
      setOverwriteTarget(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const tags = await listProgramSubTags(db, overwriteMatch.id);
      if (cancelled) return;
      setOverwriteTarget(overwriteMatch);
      // Replace (not merge) — user typed an existing name, so this is the
      // "load existing as the starting point" path. Subsequent manual chip
      // edits are preserved because we only run on `overwriteMatch` change.
      setState((s) => updateDraft(s, { sub_tags: tags }));
    })();
    return () => {
      cancelled = true;
    };
  }, [overwriteMatch, db]);

  // Wizard Step 1 「載入計劃」 entry — pick an existing program and copy its
  // name into the draft. The useEffect above handles loading sub_tags +
  // setting overwriteTarget once the name match is detected.
  const onLoadFromProgram = useCallback(
    async (programId: string) => {
      const picked = programs.find((p) => p.id === programId);
      if (!picked) return;
      setState((prev) => updateDraft(prev, { name: picked.name }));
    },
    [programs]
  );

  const onPrev = () => {
    if (isFirstStep(state.step)) {
      router.back();
      return;
    }
    setState(prevStep(state));
  };

  const onNext = async () => {
    // Wave 18g smoke fix — when leaving Step 1 in overwrite mode, persist
    // any newly-typed intensity labels into the existing program's v022
    // `program_sub_tag` dictionary RIGHT NOW (rather than waiting for Step
    // 6 confirm). User expectation: typing GG-3 / GG-4 in Step 1 should
    // make those chips visible to other app surfaces (儲存模板 sheet,
    // 開始訓練 sheet, programs-tab row picker) without finishing the
    // wizard. INSERT OR IGNORE makes this idempotent — chips already in
    // the dict are silent no-ops.
    //
    // Why only overwrite path: a brand-new program has no `program_id`
    // until Step 6 commits createProgram, so there's nowhere to write the
    // labels. New-program path still defers to Step 6's recordProgramSubTag
    // loop (see onConfirm).
    //
    // Why no rollback on cancel: the v022 dict is a label-only store —
    // having extra chips that aren't referenced by any template / cell is
    // harmless and matches how the dict behaves elsewhere (intentional
    // "remember every label ever typed" per ADR-0021).
    if (state.step === 'NameAndTag' && overwriteTarget) {
      for (const tag of state.draft.sub_tags) {
        await recordProgramSubTag(db, overwriteTarget.id, tag);
      }
    }
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
      // Wave 18g — branch: overwrite existing program in-place vs create
      // new. `overwriteTarget` is only set after explicit user confirm in
      // the modal, so this branch faithfully reflects user intent.
      if (overwriteTarget) {
        const programCore = {
          id: overwriteTarget.id,
          name: r.draft.name.trim(),
          main_tag: r.draft.main_tag?.trim() || null,
          cycle_length: r.draft.cycle_length,
          cycle_count: r.draft.cycle_count,
          start_date: r.draft.start_date as string,
          is_active: overwriteTarget.is_active,
        };
        const cells = expandWizardDraft({
          program: programCore,
          dayPlans: r.draft.dayPlans,
          overrides: r.draft.overrides,
          uuid: randomUUID,
        });
        await overwriteProgram(db, {
          program_id: overwriteTarget.id,
          new_program: programCore,
          new_cells: cells,
          new_sub_tags: r.draft.sub_tags,
        });
        // Re-attach picked templates to the program (mirror create flow).
        const seen = new Set<string>();
        for (const dp of r.draft.dayPlans) {
          if (dp.template_id && !seen.has(dp.template_id)) {
            seen.add(dp.template_id);
            await attachTemplateToProgram(db, {
              template_id: dp.template_id,
              program_id: overwriteTarget.id,
              sub_tag: dp.sub_tag,
            });
          }
        }
        router.replace(`/program/${overwriteTarget.id}`);
        return;
      }

      // Create-new path (unchanged).
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
      // Wave 18g — surface active-session block via dedicated Alert so the
      // user knows they need to finish/discard the in-progress session.
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'PROGRAM_HAS_ACTIVE_SESSION' && overwriteTarget) {
        Alert.alert(
          t('alert', 'cannotOverwrite'),
          tOverwriteBlockedByActiveSession(overwriteTarget.name),
        );
      } else {
        Alert.alert(t('alert', 'saveFailed'), msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const leftLabel = isFirstStep(state.step) ? t('common', 'cancel') : t('common', 'back');
  const rightLabel = isLastStep(state.step)
    ? busy
      ? t('common', 'saving')
      : // Wave 18g (smoke-revision) — overwrite path: label is 「覆蓋」 so
        // the user knows tapping commits to overwriting the existing
        // program (rather than the default 「建立」).
        overwriteTarget
        ? t('button', 'overwrite')
        : t('common', 'create')
    : t('common', 'next');
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
            <NameAndTagPanel
              state={state}
              setState={setState}
              programs={programs}
              overwriteTarget={overwriteTarget}
              onLoadFromProgram={onLoadFromProgram}
            />
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
            <CycleSubTagsPanel
              state={state}
              setState={setState}
              overwriteTarget={overwriteTarget}
            />
          )}
          {state.step === 'Preview' && (
            <PreviewPanel state={state} templates={templates} />
          )}
          {state.step === 'Confirm' && (
            <ConfirmPanel state={state} overwriteTarget={overwriteTarget} />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function StepHeader({ step }: { step: WizardStep }) {
  const styles = useWizStyles();
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
      return t('page', 'wizardStep1');
    case 'CycleConfig':
      return t('page', 'wizardStep2');
    case 'DayPattern':
      return t('page', 'wizardStep3');
    case 'CycleSubTags':
      return t('page', 'wizardStep4');
    case 'Preview':
      return t('page', 'wizardStep5');
    case 'Confirm':
      return t('button', 'confirmCreate');
  }
}

function NameAndTagPanel({
  state,
  setState,
  programs,
  overwriteTarget,
  onLoadFromProgram,
}: {
  state: WizardState;
  setState: (s: WizardState) => void;
  programs: ProgramSummary[];
  // Wave 18g (smoke-revision) — when set, renders an inline banner telling
  // the user the existing program will be overwritten. The strength chips
  // below have already been auto-prefilled by the parent's useEffect.
  overwriteTarget: ProgramSummary | null;
  onLoadFromProgram: (programId: string) => Promise<void>;
}) {
  const { tokens } = useTheme();
  const styles = useWizStyles();
  const [pending, setPending] = useState('');
  const [loadModalOpen, setLoadModalOpen] = useState(false);
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
      <View style={styles.labelRow}>
        <Text style={styles.label}>{t('page', 'programNamePlaceholder')}</Text>
        {programs.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setLoadModalOpen(true)}
            style={({ pressed }) => [
              styles.loadProgramBtn,
              pressed && styles.btnPressed,
            ]}>
            <Text style={styles.loadProgramBtnText}>{t('button', 'loadProgram')}</Text>
          </Pressable>
        ) : null}
      </View>
      <TextInput
        style={styles.input}
        value={state.draft.name}
        onChangeText={(name) => setState(updateDraft(state, { name }))}
        placeholder={t('page', 'programNameExample')}
        placeholderTextColor={tokens.text.tertiary}
      />
      {overwriteTarget ? <OverwriteBanner target={overwriteTarget} /> : null}
      <ProgramPickerModal
        visible={loadModalOpen}
        programs={programs}
        onPick={async (id) => {
          setLoadModalOpen(false);
          await onLoadFromProgram(id);
        }}
        onClose={() => setLoadModalOpen(false)}
      />
      <Text style={styles.label}>{t('page', 'intensityOptionalMulti')}</Text>
      {state.draft.sub_tags.length > 0 ? (
        <View style={styles.tagChipRow}>
          {state.draft.sub_tags.map((tag) => (
            <View key={tag} style={styles.tagChip}>
              <Text style={styles.tagChipText}>{tag}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={tRemoveIntensity(tag)}
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
          placeholder={t('page', 'intensityExample')}
          placeholderTextColor={tokens.text.tertiary}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('button', 'addIntensityPlain')}
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
  const styles = useWizStyles();
  const update = (patch: Partial<WizardState['draft']>) =>
    setState(updateDraft(state, patch));
  return (
    <View style={styles.panel}>
      <Text style={styles.label}>{t('page', 'cycleLengthInput')}</Text>
      <TextInput
        style={styles.input}
        keyboardType="number-pad"
        value={String(state.draft.cycle_length)}
        onChangeText={(v) => update({ cycle_length: Number(v) || 0 })}
      />
      <Text style={styles.label}>{t('domain', 'cycleCount')}</Text>
      <TextInput
        style={styles.input}
        keyboardType="number-pad"
        value={String(state.draft.cycle_count)}
        onChangeText={(v) => update({ cycle_count: Number(v) || 0 })}
      />
      <Text style={styles.label}>{t('page', 'startDateInput')}</Text>
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
  const styles = useWizStyles();
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

  const weekdayLabels = tWeekdayLabels();
  return (
    <View style={styles.panel}>
      <Text style={styles.hint}>{t('page', 'wizardStep3Hint')}</Text>
      {days.map((d) => {
        const plan = planByDay.get(d);
        return (
          <View key={d} style={styles.dayCard}>
            <Text style={styles.dayLabel}>
              Day {d + 1}
              {state.draft.cycle_length === 7
                ? ` · ${weekdayLabels[d]}`
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
                  {t('domain', 'rest')}
                </Text>
              </Pressable>
              {/* Wave 18g (smoke-revision) — 「+新建」 sits right after 休息 so
                  it's reachable without scrolling past every existing template
                  on small screens. */}
              <Pressable
                onPress={onCreateNewTemplate}
                style={({ pressed }) => [
                  styles.pill,
                  styles.pillCreate,
                  pressed && styles.btnPressed,
                ]}>
                <Text style={[styles.pillText, styles.pillCreateText]}>
                  {t('button', 'newTemplate')}
                </Text>
              </Pressable>
              {templates.map((tpl) => {
                const active = plan?.template_id === tpl.id;
                return (
                  <Pressable
                    key={tpl.id}
                    onPress={() => setTemplate(d, tpl.id)}
                    style={({ pressed }) => [
                      styles.pill,
                      active && styles.pillActive,
                      pressed && styles.btnPressed,
                    ]}>
                    <Text
                      style={[styles.pillText, active && styles.pillTextActive]}>
                      {tpl.name}
                    </Text>
                  </Pressable>
                );
              })}
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
  overwriteTarget,
}: {
  state: WizardState;
  setState: (s: WizardState) => void;
  // Wave 18g smoke fix — when set, 自訂 確認 also persists the new chip
  // into v022 `program_sub_tag` immediately (parity with Step 1 → Step 2
  // transition's recordProgramSubTag loop).
  overwriteTarget: ProgramSummary | null;
}) {
  const db = useDatabase();
  const { tokens } = useTheme();
  const styles = useWizStyles();
  // wave 18d: per-cycle ONE sub_tag picker (was per-(cycle, day) override).
  // We keep the underlying `overrides[]` shape unchanged so expandWizardDraft
  // and domain tests don't change — when user picks 強度 X for cycle c, we
  // expand to one override entry per day-with-template in that cycle, all
  // with sub_tag = X. 「通用」 = clear all entries for that cycle.
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
  // Wave 18g smoke fix — per-cycle pending text. Replaces the old on-every-
  // keystroke `pickCycle` write so the user can type freely and explicitly
  // confirm. Keyed by cycle index; "" or absent = empty.
  const [customDrafts, setCustomDrafts] = useState<Map<number, string>>(
    new Map(),
  );
  const getCustomDraft = (c: number): string => customDrafts.get(c) ?? '';
  const setCustomDraft = (c: number, v: string) =>
    setCustomDrafts((prev) => {
      const next = new Map(prev);
      next.set(c, v);
      return next;
    });
  const clearCustomDraft = (c: number) =>
    setCustomDrafts((prev) => {
      if (!prev.has(c)) return prev;
      const next = new Map(prev);
      next.delete(c);
      return next;
    });
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

  // Wave 18g smoke fix — explicit confirm path for 自訂 free-form input.
  // Validates non-empty, appends to draft.sub_tags (so it appears in other
  // cycles' chip rows too), updates this cycle's overrides, then mirrors
  // Step 1 → Step 2's recordProgramSubTag write when overwriteTarget is
  // set so the new label is visible to the rest of the app immediately.
  const confirmCustom = async (c: number) => {
    const trimmed = getCustomDraft(c).trim();
    if (!trimmed) return;
    const newSubTags = state.draft.sub_tags.includes(trimmed)
      ? state.draft.sub_tags
      : [...state.draft.sub_tags, trimmed];
    const without = state.draft.overrides.filter((o) => o.cycle_index !== c);
    const added = dayIndicesWithTemplate.map((day_index) => ({
      cycle_index: c,
      day_index,
      sub_tag: trimmed,
    }));
    // Combined state update so both fields land in one render.
    setState(
      updateDraft(state, {
        sub_tags: newSubTags,
        overrides: [...without, ...added],
      }),
    );
    if (overwriteTarget) {
      await recordProgramSubTag(db, overwriteTarget.id, trimmed);
    }
    exitCustom(c);
    clearCustomDraft(c);
  };

  const cancelCustom = (c: number) => {
    exitCustom(c);
    clearCustomDraft(c);
  };

  return (
    <View style={styles.panel}>
      <Text style={styles.hint}>{t('page', 'wizardStep4Hint')}</Text>
      {Array.from({ length: state.draft.cycle_count }, (_, c) => {
        const pick = cyclePick(c);
        const customMode = isCustomCycle(c, pick);
        return (
          <View key={c} style={styles.cycleBlock}>
            <Text style={styles.cycleHeader}>{tCycleN(c + 1)}</Text>
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
                    {t('common', 'default')}
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
                    {t('common', 'customPlain')}
                  </Text>
                </Pressable>
              </ScrollView>
            ) : null}
            {customMode || state.draft.sub_tags.length === 0 ? (
              <View style={styles.customRow}>
                <TextInput
                  style={[styles.input, styles.customInput]}
                  value={getCustomDraft(c)}
                  onChangeText={(v) => setCustomDraft(c, v)}
                  onSubmitEditing={() => {
                    void confirmCustom(c);
                  }}
                  returnKeyType="done"
                  placeholder={t('page', 'intensityPlaceholder')}
                  placeholderTextColor={tokens.text.tertiary}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('common', 'cancel')}
                  onPress={() => cancelCustom(c)}
                  style={({ pressed }) => [
                    styles.customBtn,
                    styles.customBtnSecondary,
                    pressed && styles.btnPressed,
                  ]}>
                  <Text style={styles.customBtnSecondaryText}>
                    {t('common', 'cancel')}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('common', 'confirm')}
                  onPress={() => {
                    void confirmCustom(c);
                  }}
                  disabled={getCustomDraft(c).trim().length === 0}
                  style={({ pressed }) => [
                    styles.customBtn,
                    styles.customBtnPrimary,
                    getCustomDraft(c).trim().length === 0 &&
                      styles.btnDisabled,
                    pressed && styles.btnPressed,
                  ]}>
                  <Text style={styles.customBtnPrimaryText}>
                    {t('common', 'confirm')}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/**
 * Wave 18g (smoke-revision) — inline banner shown when the typed name
 * matches an existing program. Pure presentation; the existing strength
 * chips have already been auto-prefilled into draft.sub_tags by the
 * parent component's useEffect. User cancels by renaming away.
 */
function OverwriteBanner({ target }: { target: ProgramSummary }) {
  const styles = useWizStyles();
  return (
    <View style={styles.overwriteBanner}>
      <Text style={styles.overwriteBannerTitle}>
        {tOverwriteBannerTitle(target.name)}
      </Text>
      <Text style={styles.overwriteBannerBody}>
        {t('alert', 'overwriteSheetBodyConsequence')}
      </Text>
    </View>
  );
}

function ProgramPickerModal({
  visible,
  programs,
  onPick,
  onClose,
}: {
  visible: boolean;
  programs: ProgramSummary[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const styles = useWizStyles();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable
          style={styles.modalSheet}
          // Stop propagation so taps inside the sheet don't dismiss it.
          onPress={(e) => e.stopPropagation()}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t('page', 'selectProgramToLoad')}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              hitSlop={8}>
              <Text style={styles.modalClose}>{t('common', 'close')}</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.modalList}>
            {programs.length === 0 ? (
              <Text style={styles.modalEmpty}>{t('alert', 'noProgramsToLoad')}</Text>
            ) : (
              programs.map((p) => (
                <Pressable
                  key={p.id}
                  accessibilityRole="button"
                  onPress={() => onPick(p.id)}
                  style={({ pressed }) => [
                    styles.modalRow,
                    pressed && styles.btnPressed,
                  ]}>
                  <Text style={styles.modalRowName}>{p.name}</Text>
                  <Text style={styles.modalRowMeta}>
                    {p.cycle_count} × {tNDays(p.cycle_length)}
                    {p.is_active ? ` ${t('common', 'inProgress')}` : ''}
                  </Text>
                </Pressable>
              ))
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function PreviewPanel({
  state,
  templates,
}: {
  state: WizardState;
  templates: TemplateSummary[];
}) {
  const styles = useWizStyles();
  const tplById = new Map(templates.map((t) => [t.id, t.name]));
  const overrideMap = new Map(
    state.draft.overrides.map((o) => [`${o.cycle_index}:${o.day_index}`, o.sub_tag])
  );
  const dayPlanMap = new Map(state.draft.dayPlans.map((dp) => [dp.day_index, dp]));
  return (
    <View style={styles.panel}>
      <Text style={styles.hint}>{t('page', 'wizardStep5Hint')}</Text>
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

function ConfirmPanel({
  state,
  overwriteTarget,
}: {
  state: WizardState;
  overwriteTarget: ProgramSummary | null;
}) {
  const styles = useWizStyles();
  const err = validateStep(state.draft, 'Confirm');
  return (
    <View style={styles.panel}>
      <Text style={styles.hint}>{t('page', 'wizardStep6')}</Text>
      {overwriteTarget ? <OverwriteBanner target={overwriteTarget} /> : null}
      <View style={styles.summaryCard}>
        <Text style={styles.summaryLine}>
          {t('page', 'summaryName')}
          {state.draft.name || t('common', 'empty')}
        </Text>
        <Text style={styles.summaryLine}>
          {t('page', 'summaryIntensity')}
          {state.draft.sub_tags.length === 0
            ? t('common', 'noneParen')
            : state.draft.sub_tags.join(t('page', 'summarySeparator'))}
        </Text>
        <Text style={styles.summaryLine}>
          {`${t('page', 'summaryCycle')}${state.draft.cycle_count} × ${tNDays(state.draft.cycle_length)}`}
        </Text>
        <Text style={styles.summaryLine}>
          {t('page', 'summaryStart')}
          {state.draft.start_date ?? t('common', 'empty')}
        </Text>
        <Text style={styles.summaryLine}>
          {`${t('page', 'summaryConfiguredDays')}${state.draft.dayPlans.filter((dp) => dp.template_id).length}${t('page', 'summarySuffixDays')}`}
        </Text>
        <Text style={styles.summaryLine}>
          {`${t('page', 'summaryIntensityOverride')}${state.draft.overrides.length}${t('page', 'summarySuffixCount')}`}
        </Text>
      </View>
      {err ? <Text style={styles.errorLine}>⚠️ {err}</Text> : null}
    </View>
  );
}

/**
 * ADR-0025 — all colors flow from theme tokens. Layout (flex/padding/radius)
 * stays in StyleSheet for perf; colors interpolate per-token.
 */
function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: tokens.bg.base },
    flex: { flex: 1 },
    body: { padding: 20, gap: 16, paddingBottom: 48 },
    stepLabel: { fontSize: 12, fontWeight: '600', color: tokens.text.secondary },
    stepTitle: {
      fontSize: 22,
      fontWeight: '700',
      marginTop: 4,
      color: tokens.text.primary,
    },
    progressTrack: { flexDirection: 'row', gap: 4, marginTop: 12 },
    progressTick: {
      flex: 1,
      height: 4,
      borderRadius: 2,
      backgroundColor: tokens.bg.elevated,
    },
    progressTickActive: { backgroundColor: tokens.action.primary },
    panel: { gap: 10 },
    label: {
      fontSize: 13,
      fontWeight: '500',
      marginTop: 6,
      color: tokens.text.secondary,
    },
    labelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    loadProgramBtn: {
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: 8,
      backgroundColor: tokens.bg.elevated,
    },
    loadProgramBtnText: {
      fontSize: 12,
      fontWeight: '600',
      color: tokens.action.primary,
    },
    modalBackdrop: {
      flex: 1,
      // Fixed-dark scrim — standard modal overlay convention, both modes.
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end',
    },
    modalSheet: {
      maxHeight: '70%',
      backgroundColor: tokens.bg.modal,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 24,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    modalTitle: { fontSize: 16, fontWeight: '700', color: tokens.text.primary },
    modalClose: { fontSize: 14, color: tokens.action.primary, fontWeight: '600' },
    modalList: { flexGrow: 0 },
    modalEmpty: {
      paddingVertical: 24,
      textAlign: 'center',
      color: tokens.text.secondary,
      fontSize: 13,
    },
    modalRow: {
      paddingVertical: 12,
      paddingHorizontal: 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: tokens.border.subtle,
    },
    modalRowName: { fontSize: 15, fontWeight: '600', color: tokens.text.primary },
    modalRowMeta: { fontSize: 12, color: tokens.text.secondary, marginTop: 2 },
    // Wave 18g (smoke-revision) — inline overwrite banner. Subtle destructive
    // tint background + thin border so it reads as a warning but doesn't
    // overpower the rest of Step 1's compact layout.
    overwriteBanner: {
      marginTop: 4,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 8,
      backgroundColor: tokens.bg.elevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tokens.action.destructive,
      gap: 4,
    },
    overwriteBannerTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: tokens.action.destructive,
    },
    overwriteBannerBody: {
      fontSize: 12,
      lineHeight: 17,
      color: tokens.text.secondary,
    },
    hint: { fontSize: 13, color: tokens.text.secondary, marginBottom: 6 },
    input: {
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 10,
      backgroundColor: tokens.bg.elevated,
      fontSize: 16,
      color: tokens.text.primary,
    },
    // Wave 18g smoke fix — 自訂 free-form input + 確認/取消 buttons in Step 4.
    customRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 6,
    },
    customInput: { flex: 1 },
    customBtn: {
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: 10,
      minWidth: 60,
      alignItems: 'center',
    },
    customBtnSecondary: { backgroundColor: tokens.bg.elevated },
    customBtnSecondaryText: {
      fontSize: 13,
      fontWeight: '600',
      color: tokens.text.primary,
    },
    customBtnPrimary: { backgroundColor: tokens.action.primary },
    customBtnPrimaryText: {
      fontSize: 13,
      fontWeight: '700',
      color: tokens.action.onPrimary,
    },
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
      backgroundColor: tokens.bg.elevated,
      gap: 6,
    },
    tagChipText: { fontSize: 13, fontWeight: '600', color: tokens.action.primary },
    tagChipRemove: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: tokens.bg.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tagChipRemoveText: {
      color: tokens.action.primary,
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
      backgroundColor: tokens.action.primary,
    },
    tagAddBtnText: {
      color: tokens.action.onPrimary,
      fontSize: 22,
      fontWeight: '700',
      lineHeight: 24,
    },
    dayCard: {
      padding: 12,
      borderRadius: 10,
      backgroundColor: tokens.bg.elevated,
      gap: 6,
    },
    dayLabel: { fontSize: 14, fontWeight: '600', color: tokens.text.primary },
    pillsRow: { gap: 8, paddingVertical: 4 },
    pill: {
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: 999,
      backgroundColor: tokens.bg.surface,
    },
    pillActive: { backgroundColor: tokens.action.primary },
    pillText: { fontSize: 13, fontWeight: '500', color: tokens.text.primary },
    pillTextActive: { color: tokens.action.onPrimary },
    pillCreate: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: tokens.action.primary,
      borderStyle: 'dashed',
    },
    pillCreateText: { color: tokens.action.primary, fontWeight: '600' },
    cycleBlock: {
      padding: 12,
      borderRadius: 10,
      backgroundColor: tokens.bg.elevated,
      gap: 6,
      marginBottom: 8,
    },
    cycleHeader: {
      fontSize: 14,
      fontWeight: '700',
      marginBottom: 4,
      color: tokens.text.primary,
    },
    previewRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginBottom: 6,
      gap: 4,
    },
    previewCycleLabel: {
      width: 22,
      fontSize: 12,
      fontWeight: '700',
      paddingTop: 8,
      color: tokens.text.secondary,
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
      backgroundColor: tokens.bg.elevated,
      justifyContent: 'center',
      alignItems: 'center',
    },
    previewCellName: {
      fontSize: 10,
      fontWeight: '600',
      textAlign: 'center',
      color: tokens.text.primary,
    },
    previewCellTag: {
      fontSize: 8,
      color: tokens.text.tertiary,
      marginTop: 2,
      textAlign: 'center',
    },
    summaryCard: {
      padding: 14,
      borderRadius: 10,
      backgroundColor: tokens.bg.elevated,
      gap: 6,
    },
    summaryLine: { fontSize: 14, color: tokens.text.primary },
    errorLine: { color: tokens.action.destructive, fontSize: 14, marginTop: 8 },
    headerBtn: {
      paddingHorizontal: 8,
      paddingVertical: 6,
    },
    headerBtnPrimary: {
      color: tokens.action.primary,
      fontSize: 16,
      fontWeight: '700',
    },
    headerBtnSecondary: {
      color: tokens.text.secondary,
      fontSize: 16,
      fontWeight: '500',
    },
    btnPressed: { opacity: 0.85 },
    btnDisabled: { opacity: 0.5 },
  });
}
