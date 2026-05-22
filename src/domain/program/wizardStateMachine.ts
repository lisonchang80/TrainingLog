/**
 * Module #7 — Program Wizard State Machine (pure logic, no DB, no React).
 *
 * 6 steps for guiding a user through Program creation:
 *
 *   0. NameAndTag    — program `name` + 主標籤 `main_tag`
 *   1. CycleConfig   — `cycle_length` (3-14) + `cycle_count` (≥1) + `start_date`
 *   2. DayPattern    — for each Day in cycle 1, pick template_id + default sub_tag
 *   3. CycleSubTags  — for each (cycle 1..N-1) × (day with template), override sub_tag
 *   4. Preview       — show fan-out grid; no input needed (commit checkbox)
 *   5. Confirm       — final review; complete() emits the persistable bundle
 *
 * Steps are linear (next/prev). The user MAY jump backwards freely; jumping
 * forward to step N requires every step < N to validate. Each step has a
 * pure `validateStep(state, step)` returning null | error string.
 *
 * Draft is fully serializable so it can be persisted (e.g. AsyncStorage) and
 * restored across app restarts — that's the "暫存草稿" criterion in #6.
 *
 * Pure functions only. Tested in `tests/domain/wizardStateMachine.test.ts`.
 */

import type { CycleSubTagOverride, DayPlan } from './programManager';
import type { IsoDate } from './types';

export const WIZARD_STEPS = [
  'NameAndTag',
  'CycleConfig',
  'DayPattern',
  'CycleSubTags',
  'Preview',
  'Confirm',
] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number];

export interface WizardDraft {
  /** Program-level fields. */
  name: string;
  /** @deprecated wave 18 — main_tag UX removed; field kept for back-compat (always null). */
  main_tag: string | null;
  /**
   * 強度 labels to pre-register into `program_sub_tag` dictionary on create.
   * Wave 18 NameAndTag step lets user type multiple strengths with +/-;
   * onConfirm loops these and calls `recordProgramSubTag` per entry.
   * Empty array is valid (= no strengths pre-registered).
   */
  sub_tags: string[];
  cycle_length: number;
  cycle_count: number;
  start_date: IsoDate | null;
  /** One entry per day in cycle 0; missing days are treated as rest days. */
  dayPlans: DayPlan[];
  /** Per-cycle sub_tag overrides; absent = use day's default. */
  overrides: CycleSubTagOverride[];
}

export interface WizardState {
  step: WizardStep;
  draft: WizardDraft;
}

/** Brand-new wizard with sensible defaults. */
export function initialWizardState(today: IsoDate): WizardState {
  return {
    step: 'NameAndTag',
    draft: {
      name: '',
      main_tag: null,
      sub_tags: [],
      cycle_length: 7,
      cycle_count: 4,
      start_date: today,
      dayPlans: [],
      overrides: [],
    },
  };
}

const STEP_INDEX: Record<WizardStep, number> = WIZARD_STEPS.reduce(
  (acc, s, i) => {
    acc[s] = i;
    return acc;
  },
  {} as Record<WizardStep, number>
);

export function stepIndex(step: WizardStep): number {
  return STEP_INDEX[step];
}

export function isFirstStep(step: WizardStep): boolean {
  return step === WIZARD_STEPS[0];
}

export function isLastStep(step: WizardStep): boolean {
  return step === WIZARD_STEPS[WIZARD_STEPS.length - 1];
}

/**
 * Validate a single step's slice of the draft. Returns null on OK or a
 * human-readable error. Does NOT mutate state.
 */
export function validateStep(draft: WizardDraft, step: WizardStep): string | null {
  switch (step) {
    case 'NameAndTag':
      if (!draft.name || !draft.name.trim()) return 'Program name cannot be empty';
      return null;
    case 'CycleConfig':
      if (
        !Number.isInteger(draft.cycle_length) ||
        draft.cycle_length < 3 ||
        draft.cycle_length > 14
      ) {
        return 'cycle_length must be 3-14';
      }
      if (!Number.isInteger(draft.cycle_count) || draft.cycle_count < 1) {
        return 'cycle_count must be ≥ 1';
      }
      if (!draft.start_date || !/^\d{4}-\d{2}-\d{2}$/.test(draft.start_date)) {
        return 'start_date must be ISO yyyy-mm-dd';
      }
      return null;
    case 'DayPattern':
      // At least one non-rest day so the program isn't completely empty.
      if (draft.dayPlans.every((dp) => dp.template_id == null)) {
        return 'Pick a template for at least one day';
      }
      // No duplicate day_index entries.
      {
        const seen = new Set<number>();
        for (const dp of draft.dayPlans) {
          if (seen.has(dp.day_index)) {
            return `Duplicate day plan for day ${dp.day_index}`;
          }
          seen.add(dp.day_index);
          if (dp.day_index < 0 || dp.day_index >= draft.cycle_length) {
            return `Day index ${dp.day_index} outside cycle length ${draft.cycle_length}`;
          }
        }
      }
      return null;
    case 'CycleSubTags':
      // Optional step — overrides may be empty.
      for (const o of draft.overrides) {
        if (o.cycle_index < 0 || o.cycle_index >= draft.cycle_count) {
          return `Override cycle ${o.cycle_index} out of range`;
        }
        if (o.day_index < 0 || o.day_index >= draft.cycle_length) {
          return `Override day ${o.day_index} out of range`;
        }
      }
      return null;
    case 'Preview':
    case 'Confirm':
      // Composite — re-validate everything below them.
      return (
        validateStep(draft, 'NameAndTag') ??
        validateStep(draft, 'CycleConfig') ??
        validateStep(draft, 'DayPattern') ??
        validateStep(draft, 'CycleSubTags')
      );
  }
}

/**
 * Try to advance one step. Returns the new state or `{ error }`. Refuses to
 * advance past the last step or when the current step doesn't validate.
 */
export function next(state: WizardState): WizardState | { error: string } {
  const err = validateStep(state.draft, state.step);
  if (err) return { error: err };
  if (isLastStep(state.step)) return { error: 'Already at last step' };
  const nextIdx = stepIndex(state.step) + 1;
  return { step: WIZARD_STEPS[nextIdx], draft: state.draft };
}

/** Step backwards. Always allowed (no validation). */
export function prev(state: WizardState): WizardState {
  if (isFirstStep(state.step)) return state;
  const prevIdx = stepIndex(state.step) - 1;
  return { step: WIZARD_STEPS[prevIdx], draft: state.draft };
}

/**
 * Jump to an arbitrary step. Backward jumps are always free; forward jumps
 * require every intermediate step to validate (so the user can't shortcut
 * to Confirm with a half-filled draft).
 */
export function jumpTo(
  state: WizardState,
  target: WizardStep
): WizardState | { error: string } {
  const fromIdx = stepIndex(state.step);
  const toIdx = stepIndex(target);
  if (toIdx <= fromIdx) {
    return { step: target, draft: state.draft };
  }
  for (let i = fromIdx; i < toIdx; i++) {
    const err = validateStep(state.draft, WIZARD_STEPS[i]);
    if (err) return { error: `${WIZARD_STEPS[i]}: ${err}` };
  }
  return { step: target, draft: state.draft };
}

/** Replace the draft (e.g. on field edit). Step is preserved. */
export function updateDraft(
  state: WizardState,
  patch: Partial<WizardDraft>
): WizardState {
  return { step: state.step, draft: { ...state.draft, ...patch } };
}

/**
 * Final completion: validate the WHOLE draft (treats it as Confirm step) and
 * either return the validated draft or an error. Caller passes this draft +
 * a uuid into `expandWizardDraft` (programManager) to produce the cell list.
 */
export function complete(
  state: WizardState
): { draft: WizardDraft } | { error: string } {
  const err = validateStep(state.draft, 'Confirm');
  if (err) return { error: err };
  return { draft: state.draft };
}
