import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  createSession,
  insertSessionExercise,
  listSessions,
  loadCalendarMonthRows,
} from '../../src/adapters/sqlite/sessionRepository';
import {
  insertSet,
  updateSetFields,
  listSetsBySession,
} from '../../src/adapters/sqlite/setRepository';
import {
  createTemplate,
  attachTemplateToProgram,
  applyRecolorSiblings,
  getSessionLinkedTemplateTriple,
  getTemplateFull,
} from '../../src/adapters/sqlite/templateRepository';
import { createProgram } from '../../src/adapters/sqlite/programRepository';
import { computeSessionVolume } from '../../src/domain/session/sessionStats';

/**
 * Equivalence proof for `loadCalendarMonthRows` (perf #4, scale-audit report
 * 08). `MonthGridView.load()` used to `listSessions(db)` (ALL rows), filter to
 * the visible month in JS, then per session run `listSetsBySession` +
 * `getSessionLinkedTemplateTriple` + `getTemplateFull` (1 + 3N fan-out). The
 * new loader scopes the session query to [start, end) and aggregates volume /
 * triple / color in a FIXED 3 queries.
 *
 * This suite re-implements the OLD per-session derivation inline
 * (`computeOldPath`, scoped to the same month window the component used) and
 * asserts field-by-field equality with the loader output — AND that sessions
 * in adjacent months are EXCLUDED.
 *
 * FK note: foreign_keys=ON in the test adapter, so set/session_exercise rows
 * reference the real builtin exercise UUIDs (…001/002/003 seeds).
 */

const BENCH = '00000000-0000-4000-8000-000000000001';
const SQUAT = '00000000-0000-4000-8000-000000000002';
const DEAD = '00000000-0000-4000-8000-000000000003';

// Grey fallback the UI applies when a session has no linked template OR the
// linked template's color_hex is empty (mirrors MonthGridView's FREESTYLE_BG).
const FREESTYLE_COLOR = '#D1D5DB';

// Same local-timezone month bounds the component computes via `monthRangeMs`.
function monthRangeMs(year: number, month: number): { start: number; end: number } {
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0).getTime();
  const endDate = new Date(year, month, 1, 0, 0, 0, 0);
  return { start, end: endDate.getTime() };
}

// A timestamp on the Nth day of the given month, noon local (well inside the
// month bounds regardless of timezone).
function dayInMonth(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day, 12, 0, 0, 0).getTime();
}

interface OldEnriched {
  id: string;
  started_at: number;
  capacity: number;
  template_id: string | null;
  template_name: string | null;
  color_hex: string; // grey fallback applied
  sub_tag: string | null;
  program_name: string | null;
}

/**
 * Faithful re-implementation of the OLD MonthGridView.load() per-session
 * derivation (the code this branch deleted), scoped to the month window.
 */
async function computeOldPath(
  db: BetterSqliteDatabase,
  range: { start: number; end: number }
): Promise<OldEnriched[]> {
  const all = await listSessions(db);
  const window = all.filter((s) => s.started_at >= range.start && s.started_at < range.end);
  const out: OldEnriched[] = [];
  for (const s of window) {
    const sets = await listSetsBySession(db, s.id);
    const triple = await getSessionLinkedTemplateTriple(db, s.id);
    let color = FREESTYLE_COLOR;
    if (triple) {
      const tpl = await getTemplateFull(db, triple.template_id);
      if (tpl && tpl.color_hex.length > 0) color = tpl.color_hex;
    }
    const capacity = computeSessionVolume(
      sets.map((x) => ({
        set_kind: x.set_kind,
        is_logged: x.is_logged,
        weight_kg: x.weight_kg,
        reps: x.reps,
      })),
    );
    out.push({
      id: s.id,
      started_at: s.started_at,
      capacity,
      template_id: triple?.template_id ?? null,
      template_name: triple?.template_name ?? null,
      color_hex: color,
      sub_tag: triple?.sub_tag ?? null,
      program_name: triple?.program_name ?? null,
    });
  }
  // listSessions is started_at DESC; loader is also started_at DESC. Keep order.
  return out;
}

/** Project the loader output into the OldEnriched shape (apply grey fallback). */
function projectLoader(
  rows: Awaited<ReturnType<typeof loadCalendarMonthRows>>,
): OldEnriched[] {
  return rows.map((r) => ({
    id: r.id,
    started_at: r.started_at,
    capacity: r.capacity,
    template_id: r.template_id,
    template_name: r.template_name,
    color_hex: r.color_hex.length > 0 ? r.color_hex : FREESTYLE_COLOR,
    sub_tag: r.sub_tag,
    program_name: r.program_name,
  }));
}

describe('loadCalendarMonthRows — equivalence with the old per-session calendar path', () => {
  let db: BetterSqliteDatabase;
  let seId = 0;
  let setId = 0;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    seId = 0;
    setId = 0;
  });

  afterEach(() => {
    db.close();
  });

  async function addExercise(args: {
    session_id: string;
    exercise_id: string;
    ordering: number;
    template_id?: string | null;
  }): Promise<string> {
    const id = `se-${++seId}`;
    await insertSessionExercise(db, {
      id,
      session_id: args.session_id,
      exercise_id: args.exercise_id,
      ordering: args.ordering,
      planned_sets: 3,
      planned_reps: 8,
      planned_weight_kg: 60,
      template_id: args.template_id ?? null,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
      rest_sec: null,
    });
    return id;
  }

  async function addSet(args: {
    session_id: string;
    exercise_id: string;
    session_exercise_id: string;
    ordering: number;
    weight_kg: number | null;
    reps: number | null;
    set_kind?: 'warmup' | 'working' | 'dropset';
    is_logged?: boolean;
    is_skipped?: number;
  }): Promise<void> {
    const id = `set-${++setId}`;
    await insertSet(db, {
      id,
      session_id: args.session_id,
      exercise_id: args.exercise_id,
      weight_kg: args.weight_kg,
      reps: args.reps,
      is_skipped: args.is_skipped ?? 0,
      ordering: args.ordering,
      created_at: 1000 + setId,
      session_exercise_id: args.session_exercise_id,
    });
    const patch: { set_kind?: 'warmup' | 'working' | 'dropset'; is_logged?: number } = {};
    if (args.set_kind && args.set_kind !== 'working') patch.set_kind = args.set_kind;
    if (args.is_logged) patch.is_logged = 1;
    if (Object.keys(patch).length > 0) await updateSetFields(db, id, patch);
  }

  it('returns [] for a month with no sessions', async () => {
    const range = monthRangeMs(2026, 6);
    expect(await loadCalendarMonthRows(db, range)).toEqual([]);
    expect(projectLoader(await loadCalendarMonthRows(db, range))).toEqual(
      await computeOldPath(db, range),
    );
  });

  it('matches the old path for the target month AND excludes adjacent months', async () => {
    // Program + two templates with explicit colors.
    await createProgram(db, {
      program: {
        id: 'prog-1',
        name: '增肌-Q2',
        main_tag: '增肌',
        cycle_length: 3,
        cycle_count: 1,
        start_date: '2026-06-01',
        is_active: 0,
      },
    });
    await createTemplate(db, { id: 'tpl-push', name: 'Push Day', color_hex: '#FF0000', now: () => 1 });
    await attachTemplateToProgram(db, { template_id: 'tpl-push', program_id: 'prog-1', sub_tag: '5x5' });
    // Template with empty color_hex → must fall back to grey.
    await createTemplate(db, { id: 'tpl-pull', name: 'Pull Day', color_hex: '#00FF00', now: () => 2 });
    await applyRecolorSiblings(db, { name: 'Pull Day', color_hex: '', now: () => 3 });

    const TY = 2026;
    const TM = 6; // target month = June 2026

    // ── June 5: template-linked (tpl-push), warmup + working + dropset ──
    await createSession(db, { id: 'in-1', started_at: dayInMonth(TY, TM, 5), title: 'In1' });
    const a1 = await addExercise({ session_id: 'in-1', exercise_id: BENCH, ordering: 1, template_id: 'tpl-push' });
    const a2 = await addExercise({ session_id: 'in-1', exercise_id: SQUAT, ordering: 2, template_id: 'tpl-push' });
    await addSet({ session_id: 'in-1', exercise_id: BENCH, session_exercise_id: a1, ordering: 1, weight_kg: 40, reps: 10, set_kind: 'warmup', is_logged: true }); // excluded from volume
    await addSet({ session_id: 'in-1', exercise_id: BENCH, session_exercise_id: a1, ordering: 2, weight_kg: 60, reps: 8, set_kind: 'working', is_logged: true }); // 480
    await addSet({ session_id: 'in-1', exercise_id: SQUAT, session_exercise_id: a2, ordering: 3, weight_kg: 100, reps: 5, set_kind: 'dropset', is_logged: true }); // 500

    // ── June 20: template-linked (tpl-pull, empty color → grey), null weight ──
    await createSession(db, { id: 'in-2', started_at: dayInMonth(TY, TM, 20), title: 'In2' });
    const b1 = await addExercise({ session_id: 'in-2', exercise_id: DEAD, ordering: 1, template_id: 'tpl-pull' });
    await addSet({ session_id: 'in-2', exercise_id: DEAD, session_exercise_id: b1, ordering: 1, weight_kg: null, reps: 8, set_kind: 'working', is_logged: true }); // 0
    await addSet({ session_id: 'in-2', exercise_id: DEAD, session_exercise_id: b1, ordering: 2, weight_kg: 80, reps: 6, set_kind: 'working', is_logged: true }); // 480

    // ── June 20: a SECOND same-day session, freestyle (no template) ──
    await createSession(db, { id: 'in-3', started_at: dayInMonth(TY, TM, 20) + 3600_000, title: 'In3' });
    const c1 = await addExercise({ session_id: 'in-3', exercise_id: BENCH, ordering: 1, template_id: null });
    await addSet({ session_id: 'in-3', exercise_id: BENCH, session_exercise_id: c1, ordering: 1, weight_kg: 50, reps: 12, set_kind: 'working', is_logged: true }); // 600

    // ── Boundary: exactly start-of-June 00:00 local → INCLUDED (>= start) ──
    const { start, end } = monthRangeMs(TY, TM);
    await createSession(db, { id: 'in-edge-start', started_at: start, title: 'Edge0' });
    const e1 = await addExercise({ session_id: 'in-edge-start', exercise_id: SQUAT, ordering: 1, template_id: 'tpl-push' });
    await addSet({ session_id: 'in-edge-start', exercise_id: SQUAT, session_exercise_id: e1, ordering: 1, weight_kg: 70, reps: 10, set_kind: 'working', is_logged: true }); // 700

    // ── OUT OF RANGE: May 31 (previous month) — must be EXCLUDED ──
    await createSession(db, { id: 'out-may', started_at: dayInMonth(TY, 5, 31), title: 'OutMay' });
    const m1 = await addExercise({ session_id: 'out-may', exercise_id: BENCH, ordering: 1, template_id: 'tpl-push' });
    await addSet({ session_id: 'out-may', exercise_id: BENCH, session_exercise_id: m1, ordering: 1, weight_kg: 999, reps: 9, set_kind: 'working', is_logged: true });

    // ── OUT OF RANGE: exactly start-of-July 00:00 local (= end) — EXCLUDED (< end) ──
    await createSession(db, { id: 'out-jul-edge', started_at: end, title: 'OutJulEdge' });
    const j1 = await addExercise({ session_id: 'out-jul-edge', exercise_id: SQUAT, ordering: 1, template_id: 'tpl-pull' });
    await addSet({ session_id: 'out-jul-edge', exercise_id: SQUAT, session_exercise_id: j1, ordering: 1, weight_kg: 123, reps: 4, set_kind: 'working', is_logged: true });

    // ── OUT OF RANGE: July 10 (next month) — must be EXCLUDED ──
    await createSession(db, { id: 'out-jul', started_at: dayInMonth(TY, 7, 10), title: 'OutJul' });
    const k1 = await addExercise({ session_id: 'out-jul', exercise_id: DEAD, ordering: 1, template_id: 'tpl-pull' });
    await addSet({ session_id: 'out-jul', exercise_id: DEAD, session_exercise_id: k1, ordering: 1, weight_kg: 321, reps: 7, set_kind: 'working', is_logged: true });

    const range = { start, end };
    const loaderRows = await loadCalendarMonthRows(db, range);
    const projected = projectLoader(loaderRows);
    const oldPath = await computeOldPath(db, range);

    // Core guardrail: field-by-field equivalence with the old per-session path.
    expect(projected).toEqual(oldPath);

    // Exactly the four in-month sessions, none of the three out-of-range ones,
    // newest started_at first (in-3 = June20+1h, in-2 = June20, in-1 = June5,
    // in-edge-start = June 1 00:00).
    expect(loaderRows.map((r) => r.id)).toEqual([
      'in-3',
      'in-2',
      'in-1',
      'in-edge-start',
    ]);
    expect(loaderRows.map((r) => r.id)).not.toContain('out-may');
    expect(loaderRows.map((r) => r.id)).not.toContain('out-jul');
    expect(loaderRows.map((r) => r.id)).not.toContain('out-jul-edge');

    const byId = new Map(loaderRows.map((r) => [r.id, r]));
    // in-1: warmup excluded → 480 + 500 = 980; tpl-push triple + red color.
    expect(byId.get('in-1')!.capacity).toBe(980);
    expect(byId.get('in-1')!.template_id).toBe('tpl-push');
    expect(byId.get('in-1')!.template_name).toBe('Push Day');
    // 2026-06-26 — calendar surfaces session.title (was hard-coded '').
    expect(byId.get('in-1')!.title).toBe('In1');
    expect(byId.get('in-1')!.program_name).toBe('增肌-Q2');
    expect(byId.get('in-1')!.sub_tag).toBe('5x5');
    expect(byId.get('in-1')!.color_hex).toBe('#FF0000');
    // in-2: null-weight 0 + 480 = 480; tpl-pull empty color → '' (grey applied in UI).
    expect(byId.get('in-2')!.capacity).toBe(480);
    expect(byId.get('in-2')!.template_id).toBe('tpl-pull');
    expect(byId.get('in-2')!.color_hex).toBe('');
    expect(byId.get('in-2')!.program_name).toBeNull();
    // in-3: freestyle → null template, 600.
    expect(byId.get('in-3')!.template_id).toBeNull();
    expect(byId.get('in-3')!.template_name).toBeNull();
    expect(byId.get('in-3')!.title).toBe('In3');
    expect(byId.get('in-3')!.color_hex).toBe('');
    expect(byId.get('in-3')!.capacity).toBe(600);
    // in-edge-start (June 1 00:00 exactly): included, 700.
    expect(byId.get('in-edge-start')!.capacity).toBe(700);
    expect(byId.get('in-edge-start')!.template_id).toBe('tpl-push');
  });

  it('tie-break: two templates equal count → earliest ordering wins (mirrors getSessionLinkedTemplateTriple)', async () => {
    await createTemplate(db, { id: 'tpl-early', name: 'Early', color_hex: '#111111', now: () => 1 });
    await createTemplate(db, { id: 'tpl-late', name: 'Late', color_hex: '#222222', now: () => 2 });
    await createSession(db, { id: 'tie', started_at: dayInMonth(2026, 6, 15), title: 'tie' });
    await addExercise({ session_id: 'tie', exercise_id: BENCH, ordering: 1, template_id: 'tpl-early' });
    await addExercise({ session_id: 'tie', exercise_id: SQUAT, ordering: 2, template_id: 'tpl-late' });

    const range = monthRangeMs(2026, 6);
    const rows = await loadCalendarMonthRows(db, range);
    expect(projectLoader(rows)).toEqual(await computeOldPath(db, range));
    expect(rows[0].template_id).toBe('tpl-early');
    expect(rows[0].color_hex).toBe('#111111');
  });
});
