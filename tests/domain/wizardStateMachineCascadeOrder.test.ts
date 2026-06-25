import {
  complete,
  initialWizardState,
  updateDraft,
  validateStep,
  type WizardState,
} from '../../src/domain/program/wizardStateMachine';

/**
 * `validateStep(_, 'Preview' | 'Confirm')` cascade — first-fail order.
 *
 * Deferred top-5 from 5/24 Agent D's audit §3 low row "wizardStateMachine.validateStep":
 *   "Preview / Confirm cascade validation surfaces the FIRST failing step's
 *    error message — covered indirectly; explicit assertion would be
 *    defensive."
 *
 * The composite check at wizardStateMachine.ts:154-162 is:
 *
 *   validateStep(draft, 'NameAndTag')
 *     ?? validateStep(draft, 'CycleConfig')
 *     ?? validateStep(draft, 'DayPattern')
 *     ?? validateStep(draft, 'CycleSubTags')
 *
 * The order matters for the UX surfaced in `complete()` — when MULTIPLE
 * steps are invalid (typical user blast-clicks straight to Confirm from
 * step 1), the user sees the EARLIEST error first. Re-ordering the
 * cascade would surface a later error (e.g. "cycle_length must be 3-14"
 * instead of "Program name cannot be empty") and re-train muscle memory
 * for thousands of session-creation flows.
 *
 * Pins:
 *   1. All-invalid draft → NameAndTag error (rank 0).
 *   2. Name OK but CycleConfig+DayPattern invalid → CycleConfig error (rank 1).
 *   3. Name+CycleConfig OK but DayPattern+CycleSubTags invalid → DayPattern error (rank 2).
 *   4. Name+CycleConfig+DayPattern OK but CycleSubTags invalid →
 *      CycleSubTags error (rank 3).
 *   5. Confirm uses the same cascade as Preview (regression lock against a
 *      drift where Preview/Confirm get separate logic).
 */

const TODAY = '2026-05-08';

describe('validateStep cascade — Preview / Confirm surface FIRST failing step', () => {
  it('rank 0: all-invalid draft surfaces the NameAndTag error first', () => {
    // Empty name + still-default cycle (3-14 valid) + empty dayPlans = 3 errors
    // would fire; cascade should yield the NameAndTag one.
    const s = initialWizardState(TODAY);
    const previewErr = validateStep(s.draft, 'Preview');
    const confirmErr = validateStep(s.draft, 'Confirm');
    expect(previewErr?.code).toBe('nameEmpty');
    expect(confirmErr?.code).toBe('nameEmpty');
  });

  it('rank 1: name OK, CycleConfig invalid (cycle_length=0), DayPattern empty → CycleConfig error wins', () => {
    let s = initialWizardState(TODAY);
    s = updateDraft(s, { name: 'P', cycle_length: 0 }); // invalid (3-14)
    // dayPlans still empty (would later fail DayPattern), but cascade
    // hits CycleConfig first.
    const err = validateStep(s.draft, 'Preview');
    expect(err?.code).toBe('cycleLengthRange');
    expect(validateStep(s.draft, 'Confirm')?.code).toBe('cycleLengthRange');
  });

  it('rank 2: name+CycleConfig OK, DayPattern invalid (no template picked anywhere), CycleSubTags has out-of-range override → DayPattern error wins', () => {
    let s = initialWizardState(TODAY);
    s = updateDraft(s, {
      name: 'P',
      cycle_length: 7,
      cycle_count: 4,
      start_date: '2026-05-01',
      dayPlans: [
        // All template_id null → "Pick a template for at least one day"
        { day_index: 0, template_id: null, sub_tag: null },
        { day_index: 1, template_id: null, sub_tag: null },
      ],
      overrides: [
        // Out-of-range cycle index would fire CycleSubTags error, but
        // cascade hits DayPattern first.
        { cycle_index: 99, day_index: 0, sub_tag: 'X' },
      ],
    });
    const err = validateStep(s.draft, 'Preview');
    expect(err?.code).toBe('dayPatternNoTemplate');
    expect(validateStep(s.draft, 'Confirm')?.code).toBe('dayPatternNoTemplate');
  });

  it('rank 3: name+CycleConfig+DayPattern OK, only CycleSubTags invalid (override cycle out of range) → CycleSubTags error surfaces', () => {
    let s = initialWizardState(TODAY);
    s = updateDraft(s, {
      name: 'P',
      cycle_length: 7,
      cycle_count: 4,
      start_date: '2026-05-01',
      dayPlans: [{ day_index: 0, template_id: 't1', sub_tag: null }],
      overrides: [
        { cycle_index: 5, day_index: 0, sub_tag: 'X' }, // cycle_count=4 → out of range
      ],
    });
    const err = validateStep(s.draft, 'Preview');
    expect(err?.code).toBe('overrideCycleOutOfRange');
    expect(err?.params).toEqual({ cycleIndex: 5 });
    expect(validateStep(s.draft, 'Confirm')?.code).toBe('overrideCycleOutOfRange');
    // And complete() echoes the same error (it routes through
    // validateStep(draft, 'Confirm') internally).
    const r = complete(s);
    expect('error' in r).toBe(true);
    if ('error' in r) {
      expect(r.error.code).toBe('overrideCycleOutOfRange');
    }
  });

  it('Preview and Confirm share the SAME cascade output for the same draft (no Preview/Confirm divergence)', () => {
    // Exercise every "first failing rank" tier and assert the two composite
    // steps stay in lockstep — guards against a future refactor that
    // accidentally splits Preview vs Confirm into separate validators
    // (e.g. Confirm gaining an extra check that Preview lacks).
    const drafts = [
      initialWizardState(TODAY).draft, // rank 0
      updateDraft(initialWizardState(TODAY), {
        name: 'P',
        cycle_length: 99,
      }).draft, // rank 1
      updateDraft(initialWizardState(TODAY), {
        name: 'P',
        cycle_length: 7,
        cycle_count: 4,
        start_date: '2026-05-01',
        dayPlans: [{ day_index: 0, template_id: null, sub_tag: null }],
      }).draft, // rank 2
      updateDraft(initialWizardState(TODAY), {
        name: 'P',
        cycle_length: 7,
        cycle_count: 4,
        start_date: '2026-05-01',
        dayPlans: [{ day_index: 0, template_id: 't1', sub_tag: null }],
        overrides: [{ cycle_index: 999, day_index: 0, sub_tag: 'X' }],
      }).draft, // rank 3
    ];
    for (const d of drafts) {
      expect(validateStep(d, 'Preview')).toEqual(validateStep(d, 'Confirm'));
    }
  });
});
