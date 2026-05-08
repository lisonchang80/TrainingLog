import {
  WIZARD_STEPS,
  complete,
  initialWizardState,
  isFirstStep,
  isLastStep,
  jumpTo,
  next,
  prev,
  stepIndex,
  updateDraft,
  validateStep,
  type WizardState,
} from '../../src/domain/program/wizardStateMachine';

const TODAY = '2026-05-08';

const buildValidState = (): WizardState => {
  let s = initialWizardState(TODAY);
  s = updateDraft(s, { name: '增肌-Q1', main_tag: '增肌' });
  s = updateDraft(s, {
    cycle_length: 7,
    cycle_count: 4,
    start_date: '2026-05-01',
    dayPlans: [
      { day_index: 0, template_id: 't1', sub_tag: '10RM' },
      { day_index: 2, template_id: 't2', sub_tag: '8RM' },
    ],
  });
  return s;
};

describe('wizardStateMachine — step navigation', () => {
  it('initialWizardState starts on NameAndTag', () => {
    const s = initialWizardState(TODAY);
    expect(s.step).toBe('NameAndTag');
    expect(s.draft.start_date).toBe(TODAY);
    expect(isFirstStep(s.step)).toBe(true);
    expect(isLastStep(s.step)).toBe(false);
  });

  it('next advances when current step validates', () => {
    let s = updateDraft(initialWizardState(TODAY), { name: 'X' });
    const r = next(s);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.step).toBe('CycleConfig');
  });

  it('next refuses to advance with invalid current step', () => {
    const s = initialWizardState(TODAY); // empty name
    const r = next(s);
    expect('error' in r).toBe(true);
  });

  it('prev steps back without validation', () => {
    let s = updateDraft(initialWizardState(TODAY), { name: 'X' });
    const r = next(s);
    if ('error' in r) throw new Error('next failed');
    s = r;
    s = prev(s);
    expect(s.step).toBe('NameAndTag');
  });

  it('prev on first step is a no-op', () => {
    const s = initialWizardState(TODAY);
    expect(prev(s).step).toBe('NameAndTag');
  });

  it('next on last step yields error', () => {
    const s = buildValidState();
    const lastIdx = WIZARD_STEPS.length - 1;
    let cur: WizardState = { step: WIZARD_STEPS[lastIdx], draft: s.draft };
    const r = next(cur);
    expect('error' in r).toBe(true);
  });

  it('jumpTo backwards is always allowed', () => {
    const s = buildValidState();
    const cur: WizardState = { step: 'Confirm', draft: s.draft };
    const r = jumpTo(cur, 'NameAndTag');
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.step).toBe('NameAndTag');
  });

  it('jumpTo forwards requires intermediate steps to validate', () => {
    const s = initialWizardState(TODAY); // invalid name
    const r = jumpTo(s, 'Confirm');
    expect('error' in r).toBe(true);
  });

  it('jumpTo forwards succeeds when draft is valid', () => {
    const s = buildValidState();
    const r = jumpTo({ step: 'NameAndTag', draft: s.draft }, 'Confirm');
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.step).toBe('Confirm');
  });
});

describe('wizardStateMachine — validateStep', () => {
  it('NameAndTag fails on empty name', () => {
    expect(
      validateStep(initialWizardState(TODAY).draft, 'NameAndTag')
    ).toMatch(/name/);
  });

  it('CycleConfig fails on out-of-range cycle_length', () => {
    let s = updateDraft(initialWizardState(TODAY), { cycle_length: 2 });
    expect(validateStep(s.draft, 'CycleConfig')).toMatch(/cycle_length/);
    s = updateDraft(s, { cycle_length: 20 });
    expect(validateStep(s.draft, 'CycleConfig')).toMatch(/cycle_length/);
  });

  it('CycleConfig fails on bad start_date', () => {
    const s = updateDraft(initialWizardState(TODAY), { start_date: '2026-5-1' });
    expect(validateStep(s.draft, 'CycleConfig')).toMatch(/start_date/);
  });

  it('DayPattern fails when every day is rest', () => {
    const s = updateDraft(initialWizardState(TODAY), {
      dayPlans: [{ day_index: 0, template_id: null, sub_tag: null }],
    });
    expect(validateStep(s.draft, 'DayPattern')).toMatch(/at least one/);
  });

  it('DayPattern fails on duplicate day_index', () => {
    const s = updateDraft(initialWizardState(TODAY), {
      dayPlans: [
        { day_index: 0, template_id: 't1', sub_tag: null },
        { day_index: 0, template_id: 't2', sub_tag: null },
      ],
    });
    expect(validateStep(s.draft, 'DayPattern')).toMatch(/Duplicate/);
  });

  it('DayPattern fails on day_index out of range', () => {
    const s = updateDraft(initialWizardState(TODAY), {
      dayPlans: [{ day_index: 9, template_id: 't1', sub_tag: null }], // cycle_length is 7
    });
    expect(validateStep(s.draft, 'DayPattern')).toMatch(/outside cycle length/);
  });

  it('CycleSubTags accepts empty overrides', () => {
    const s = updateDraft(initialWizardState(TODAY), { overrides: [] });
    expect(validateStep(s.draft, 'CycleSubTags')).toBeNull();
  });

  it('CycleSubTags fails on cycle/day out of range', () => {
    const s = updateDraft(initialWizardState(TODAY), {
      cycle_count: 4,
      cycle_length: 7,
      overrides: [{ cycle_index: 9, day_index: 0, sub_tag: 'x' }],
    });
    expect(validateStep(s.draft, 'CycleSubTags')).toMatch(/cycle/);
  });

  it('Confirm rolls up validation of all earlier steps', () => {
    const s = initialWizardState(TODAY); // empty name
    expect(validateStep(s.draft, 'Confirm')).toMatch(/name/);
  });
});

describe('wizardStateMachine — complete()', () => {
  it('returns draft on a fully valid state', () => {
    const s = buildValidState();
    const r = complete(s);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.draft.name).toBe('增肌-Q1');
  });

  it('returns error on incomplete state', () => {
    const r = complete(initialWizardState(TODAY));
    expect('error' in r).toBe(true);
  });
});

describe('wizardStateMachine — stepIndex', () => {
  it('produces 0..5 sequentially', () => {
    const indices = WIZARD_STEPS.map((s) => stepIndex(s));
    expect(indices).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
