/**
 * Pure helper for the 訓練 tab → 計劃訓練 region (ADR-0024 § 2.a).
 *
 * Given the active program (or null) and a templates-by-id lookup, returns
 * a discriminated union describing what the 計劃訓練 row should render:
 *
 *   - 'no-program'  → empty state「沒有啟用的計劃」+ CTA → /programs
 *   - 'rest'        → 灰底「今天休息 💤」row, no tap
 *   - 'template'    → tap-able row with the resolved Template summary
 *
 * The helper does NOT call into any storage layer — caller (UI) supplies the
 * already-fetched `getActiveProgram` result, today's ISO date, and a map of
 * `templatesById`. This keeps the helper trivially testable in node and
 * mirrors how `programManager.todayCell` is already wired in the Today tab.
 */

import { cellForDate } from '../program/programManager';
import type {
  IsoDate,
  ProgramCell,
  ProgramWithCells,
} from '../program/types';
import type { TemplateSummary } from '../../adapters/sqlite/templateRepository';

export type TodayPlan =
  | { kind: 'no-program' }
  | { kind: 'rest'; cell: ProgramCell | null }
  | { kind: 'template'; cell: ProgramCell; template: TemplateSummary };

export function resolveTodayPlan(args: {
  active: ProgramWithCells | null;
  today: IsoDate;
  templatesById: Record<string, TemplateSummary>;
}): TodayPlan {
  const { active, today, templatesById } = args;
  if (!active) return { kind: 'no-program' };
  const cell = cellForDate({
    program: active.program,
    cells: active.cells,
    date: today,
  });
  if (!cell || !cell.template_id) {
    return { kind: 'rest', cell };
  }
  const template = templatesById[cell.template_id];
  if (!template) {
    // Cell points at a template_id that's been deleted — treat as rest so the
    // UI never tries to start a session against a phantom template.
    return { kind: 'rest', cell };
  }
  return { kind: 'template', cell, template };
}
