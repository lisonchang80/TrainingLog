import {
  planResolveTarget,
  type ResolveTargetPlan,
  type TargetTemplateSelection,
  type TargetTemplateSource,
} from '../../src/domain/template/resolveTargetTemplate';

/**
 * Tests for overnight #48 第 2 點 — `planResolveTarget` pure decision tree.
 *
 * Decision matrix (selection vs source, plus sibling_lookup_result):
 *
 *   1. matchesSelf (triple ==)              → use_self (no DB work)
 *   2. !matchesSelf + lookup_hit            → use_sibling
 *   3. !matchesSelf + lookup_miss + 通用    → fallback_with_alert
 *   4. !matchesSelf + lookup_miss + 非通用  → spawn
 */

const SHEET_TPL_REP: TargetTemplateSource = {
  id: 'tpl-rep',
  name: 'Smoke',
  // representative happens to be (Smoke, TEST_id, TEST-4) — the case the
  // user-reported bug exhibits (selecting ●通用 still opened this row pre-fix).
  program_id: 'TEST_id',
  sub_tag: 'TEST-4',
};

const SHEET_TPL_NONE: TargetTemplateSource = {
  id: 'tpl-none',
  name: 'Smoke',
  program_id: null,
  sub_tag: null,
};

describe('planResolveTarget', () => {
  it('case 1: matchesSelf (non-通用) → use_self', () => {
    const sel: TargetTemplateSelection = {
      wanted_program_id: 'TEST_id',
      wanted_sub_tag: 'TEST-4',
    };
    const plan = planResolveTarget(SHEET_TPL_REP, sel, null);
    expect(plan).toEqual<ResolveTargetPlan>({
      kind: 'use_self',
      template_id: 'tpl-rep',
    });
  });

  it('case 1b: matchesSelf (通用, both NULL) → use_self', () => {
    const sel: TargetTemplateSelection = {
      wanted_program_id: null,
      wanted_sub_tag: null,
    };
    const plan = planResolveTarget(SHEET_TPL_NONE, sel, null);
    expect(plan).toEqual<ResolveTargetPlan>({
      kind: 'use_self',
      template_id: 'tpl-none',
    });
  });

  it('case 2: !matchesSelf + lookup hit → use_sibling (non-通用 path)', () => {
    const sel: TargetTemplateSelection = {
      wanted_program_id: 'PROG_B',
      wanted_sub_tag: 'TEST-1',
    };
    const plan = planResolveTarget(SHEET_TPL_REP, sel, { id: 'sibling-x' });
    expect(plan).toEqual<ResolveTargetPlan>({
      kind: 'use_sibling',
      template_id: 'sibling-x',
    });
  });

  it('case 2b: !matchesSelf + lookup hit → use_sibling (通用 path with existing 通用 sibling)', () => {
    // User selects ●通用 (P=NULL), sibling (Smoke, NULL, TEST-1) exists.
    // Pre-fix bug: this case returned representative (tpl-rep) — now hits use_sibling.
    const sel: TargetTemplateSelection = {
      wanted_program_id: null,
      wanted_sub_tag: 'TEST-1',
    };
    const plan = planResolveTarget(SHEET_TPL_REP, sel, { id: 'sibling-none-t1' });
    expect(plan).toEqual<ResolveTargetPlan>({
      kind: 'use_sibling',
      template_id: 'sibling-none-t1',
    });
  });

  it('case 3: !matchesSelf + lookup miss + 通用 → fallback_with_alert', () => {
    const sel: TargetTemplateSelection = {
      wanted_program_id: null,
      wanted_sub_tag: 'TEST-1',
    };
    const plan = planResolveTarget(SHEET_TPL_REP, sel, null);
    expect(plan.kind).toBe('fallback_with_alert');
    if (plan.kind !== 'fallback_with_alert') throw new Error('narrow');
    expect(plan.template_id).toBe('tpl-rep');
    // #50 simplification: unified Alert text regardless of 通用/非通用.
    expect(plan.alert.title).toBe('尚未建立模板');
    expect(plan.alert.body).toBe('啟用最新模板');
  });

  it('case 3b: !matchesSelf + lookup miss + 通用 + sub_tag NULL → fallback to rep + Alert', () => {
    const sel: TargetTemplateSelection = {
      wanted_program_id: null,
      wanted_sub_tag: null,
    };
    const plan = planResolveTarget(SHEET_TPL_REP, sel, null);
    expect(plan.kind).toBe('fallback_with_alert');
    if (plan.kind !== 'fallback_with_alert') throw new Error('narrow');
    expect(plan.template_id).toBe('tpl-rep');
    expect(plan.alert.title).toBe('尚未建立模板');
    expect(plan.alert.body).toBe('啟用最新模板');
  });

  it('case 4: !matchesSelf + lookup miss + 非通用 → fallback (#50 simplification, was spawn)', () => {
    const sel: TargetTemplateSelection = {
      wanted_program_id: 'PROG_B',
      wanted_sub_tag: 'TEST-1',
    };
    const plan = planResolveTarget(SHEET_TPL_REP, sel, null);
    expect(plan).toEqual<ResolveTargetPlan>({
      kind: 'fallback_with_alert',
      template_id: 'tpl-rep',
      alert: {
        title: '尚未建立模板',
        body: '啟用最新模板',
      },
    });
  });

  it('case 4b: !matchesSelf + lookup miss + 非通用 + sub_tag NULL → fallback', () => {
    const sel: TargetTemplateSelection = {
      wanted_program_id: 'PROG_B',
      wanted_sub_tag: null,
    };
    const plan = planResolveTarget(SHEET_TPL_REP, sel, null);
    expect(plan.kind).toBe('fallback_with_alert');
    if (plan.kind !== 'fallback_with_alert') throw new Error('narrow');
    expect(plan.template_id).toBe('tpl-rep');
  });

  it('regression: source has program but selection sub_tag changes → fallback (#50, was spawn)', () => {
    // (Smoke, TEST_id, TEST-4) source, selection (TEST_id, TEST-5) — same
    // program different sub_tag. #50 拍板簡化：所有 miss 走 fallback、不 spawn。
    const sel: TargetTemplateSelection = {
      wanted_program_id: 'TEST_id',
      wanted_sub_tag: 'TEST-5',
    };
    const plan = planResolveTarget(SHEET_TPL_REP, sel, null);
    expect(plan.kind).toBe('fallback_with_alert');
    if (plan.kind !== 'fallback_with_alert') throw new Error('narrow');
    expect(plan.template_id).toBe('tpl-rep');
  });
});
