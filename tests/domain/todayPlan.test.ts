import { resolveTodayPlan } from '../../src/domain/training/todayPlan';
import type {
  ProgramCell,
  ProgramCore,
  ProgramWithCells,
} from '../../src/domain/program/types';
import type { TemplateSummary } from '../../src/adapters/sqlite/templateRepository';

function tpl(id: string, name: string): TemplateSummary {
  return {
    id,
    name,
    created_at: 0,
    updated_at: 0,
    program_id: null,
    sub_tag: null,
    exerciseCount: 0,
  };
}

function programCore(): ProgramCore {
  return {
    id: 'prog-1',
    name: 'Test Program',
    main_tag: null,
    cycle_length: 3,
    cycle_count: 2,
    start_date: '2026-05-24',
    is_active: 1,
  };
}

function cell(
  cycle_index: number,
  day_index: number,
  template_id: string | null
): ProgramCell {
  return {
    id: `c-${cycle_index}-${day_index}`,
    program_id: 'prog-1',
    cycle_index,
    day_index,
    template_id,
    sub_tag: null,
  };
}

describe('resolveTodayPlan (ADR-0024 § 2.a)', () => {
  const templatesById: Record<string, TemplateSummary> = {
    'tpl-push': tpl('tpl-push', 'Push Day'),
  };

  it('returns no-program when there is no active program', () => {
    expect(
      resolveTodayPlan({ active: null, today: '2026-05-24', templatesById })
    ).toEqual({ kind: 'no-program' });
  });

  it('returns template when today’s cell points at a real template', () => {
    const active: ProgramWithCells = {
      program: programCore(),
      cells: [cell(0, 0, 'tpl-push')],
    };
    const out = resolveTodayPlan({
      active,
      today: '2026-05-24',
      templatesById,
    });
    expect(out.kind).toBe('template');
    if (out.kind === 'template') {
      expect(out.template.id).toBe('tpl-push');
    }
  });

  it('returns rest when today’s cell exists but has no template (rest day)', () => {
    const active: ProgramWithCells = {
      program: programCore(),
      cells: [cell(0, 0, null)],
    };
    const out = resolveTodayPlan({
      active,
      today: '2026-05-24',
      templatesById,
    });
    expect(out.kind).toBe('rest');
  });

  it('returns rest when no cell exists for today (off-program)', () => {
    const active: ProgramWithCells = {
      program: programCore(),
      cells: [], // empty grid
    };
    const out = resolveTodayPlan({
      active,
      today: '2026-05-24',
      templatesById,
    });
    expect(out.kind).toBe('rest');
  });

  it('treats a deleted-template reference as rest, never as a phantom row', () => {
    const active: ProgramWithCells = {
      program: programCore(),
      cells: [cell(0, 0, 'tpl-ghost')], // not in templatesById
    };
    const out = resolveTodayPlan({
      active,
      today: '2026-05-24',
      templatesById,
    });
    expect(out.kind).toBe('rest');
  });
});
