import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  createSession,
  insertSessionExercise,
  listSessions,
  loadHistoryListRows,
} from '../../src/adapters/sqlite/sessionRepository';
import { insertSet, updateSetFields, listSetsBySession } from '../../src/adapters/sqlite/setRepository';
import {
  createTemplate,
  attachTemplateToProgram,
  applyRecolorSiblings,
  getSessionLinkedTemplateTriple,
  getTemplateFull,
} from '../../src/adapters/sqlite/templateRepository';
import { createProgram } from '../../src/adapters/sqlite/programRepository';
import { countUniqueExercises } from '../../src/domain/session/countUniqueExercises';
import { computeSessionVolume } from '../../src/domain/session/sessionStats';

/**
 * Equivalence proof for `loadHistoryListRows` (perf/history-list-aggregate).
 *
 * The History tab previously fired 1 + 3N queries: `listSessions` then, per
 * session, `listSetsBySession` + `getSessionLinkedTemplateTriple` +
 * `getTemplateFull`, computing volume / exercise count / triple / color in
 * JS. `loadHistoryListRows` collapses that to a fixed 3 set-based queries.
 *
 * This suite re-implements the OLD per-session derivation inline
 * (`computeOldPath`) and asserts the aggregate output is EQUAL field-by-field
 * (volume, exercise count, triple, color, ordering) — the guardrail that the
 * rewrite is behaviour-preserving.
 *
 * FK note: foreign_keys=ON in the test adapter, so set/session_exercise rows
 * reference the real builtin exercise UUIDs (…001/002/003 from the v001/v006
 * seeds) rather than synthetic ids.
 */

// Real builtin exercise UUIDs (v001 / v006 seeds — FK targets).
const BENCH = '00000000-0000-4000-8000-000000000001';
const SQUAT = '00000000-0000-4000-8000-000000000002';
const DEAD = '00000000-0000-4000-8000-000000000003';

// FREESTYLE_COLOR — mirrors the literal in ListView.tsx (the side-bar grey
// fallback the UI applies when a session has no linked template OR the linked
// template's color_hex is empty/missing).
const FREESTYLE_COLOR = '#D1D5DB';

interface OldPathRow {
  session_id: string;
  volume: number;
  exerciseCount: number;
  triple: {
    template_id: string;
    template_name: string;
    program_id: string | null;
    program_name: string | null;
    sub_tag: string | null;
  } | null;
  tplColor: string;
}

/**
 * Faithful re-implementation of the OLD ListView.loadInto per-session
 * derivation (the code this branch deleted). Used as the reference oracle.
 */
async function computeOldPath(db: BetterSqliteDatabase): Promise<OldPathRow[]> {
  const sessions = await listSessions(db);
  const out: OldPathRow[] = [];
  for (const session of sessions) {
    const sets = await listSetsBySession(db, session.id);
    const triple = await getSessionLinkedTemplateTriple(db, session.id);
    let tplColor = FREESTYLE_COLOR;
    if (triple) {
      const tpl = await getTemplateFull(db, triple.template_id);
      if (tpl && tpl.color_hex && tpl.color_hex.length > 0) {
        tplColor = tpl.color_hex;
      }
    }
    const volume = computeSessionVolume(
      sets.map((s) => ({
        set_kind: s.set_kind,
        is_logged: s.is_logged,
        weight_kg: s.weight_kg,
        reps: s.reps,
      })),
    );
    out.push({
      session_id: session.id,
      volume,
      exerciseCount: countUniqueExercises(sets),
      triple,
      tplColor,
    });
  }
  return out;
}

/** Convert the new aggregate row into the OldPathRow shape for comparison. */
function projectAggregate(
  rows: Awaited<ReturnType<typeof loadHistoryListRows>>,
): OldPathRow[] {
  return rows.map((r) => ({
    session_id: r.session.id,
    volume: r.volume,
    exerciseCount: r.exerciseCount,
    triple: r.triple
      ? {
          template_id: r.triple.template_id,
          template_name: r.triple.template_name,
          program_id: r.triple.program_id,
          program_name: r.triple.program_name,
          sub_tag: r.triple.sub_tag,
        }
      : null,
    tplColor:
      r.triple && r.triple.color_hex && r.triple.color_hex.length > 0
        ? r.triple.color_hex
        : FREESTYLE_COLOR,
  }));
}

describe('loadHistoryListRows — equivalence with the old per-session path', () => {
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

  it('returns [] for a 0-session DB', async () => {
    expect(await loadHistoryListRows(db)).toEqual([]);
    expect(projectAggregate(await loadHistoryListRows(db))).toEqual(
      await computeOldPath(db),
    );
  });

  it('matches the old path across a representative mixed dataset', async () => {
    // Program + two templates with explicit colors.
    await createProgram(db, {
      program: {
        id: 'prog-1',
        name: '增肌-Q1',
        main_tag: '增肌',
        cycle_length: 3,
        cycle_count: 1,
        start_date: '2026-01-01',
        is_active: 0,
      },
    });
    await createTemplate(db, { id: 'tpl-push', name: 'Push Day', color_hex: '#FF0000', now: () => 1 });
    await attachTemplateToProgram(db, {
      template_id: 'tpl-push',
      program_id: 'prog-1',
      sub_tag: '5x5',
    });
    // Template with NO program and an EMPTY color_hex → must fall back to grey.
    await createTemplate(db, { id: 'tpl-pull', name: 'Pull Day', color_hex: '#00FF00', now: () => 2 });
    await applyRecolorSiblings(db, { name: 'Pull Day', color_hex: '', now: () => 3 });

    // --- Session A: linked to tpl-push, warmup + working + dropset, multi-exercise ---
    await createSession(db, { id: 'sess-A', started_at: 5000, title: 'A' });
    const seA1 = await addExercise({ session_id: 'sess-A', exercise_id: BENCH, ordering: 1, template_id: 'tpl-push' });
    const seA2 = await addExercise({ session_id: 'sess-A', exercise_id: SQUAT, ordering: 2, template_id: 'tpl-push' });
    // warmup (excluded from volume even when logged)
    await addSet({ session_id: 'sess-A', exercise_id: BENCH, session_exercise_id: seA1, ordering: 1, weight_kg: 40, reps: 10, set_kind: 'warmup', is_logged: true });
    // working logged → contributes 60*8 = 480
    await addSet({ session_id: 'sess-A', exercise_id: BENCH, session_exercise_id: seA1, ordering: 2, weight_kg: 60, reps: 8, set_kind: 'working', is_logged: true });
    // working UNLOGGED → excluded
    await addSet({ session_id: 'sess-A', exercise_id: BENCH, session_exercise_id: seA1, ordering: 3, weight_kg: 60, reps: 8, set_kind: 'working', is_logged: false });
    // dropset logged → contributes 100*5 = 500
    await addSet({ session_id: 'sess-A', exercise_id: SQUAT, session_exercise_id: seA2, ordering: 4, weight_kg: 100, reps: 5, set_kind: 'dropset', is_logged: true });

    // --- Session B: linked to tpl-pull (empty color → grey), null weight/reps set ---
    await createSession(db, { id: 'sess-B', started_at: 4000, title: 'B' });
    const seB1 = await addExercise({ session_id: 'sess-B', exercise_id: DEAD, ordering: 1, template_id: 'tpl-pull' });
    // logged working with NULL weight → contributes 0
    await addSet({ session_id: 'sess-B', exercise_id: DEAD, session_exercise_id: seB1, ordering: 1, weight_kg: null, reps: 8, set_kind: 'working', is_logged: true });
    // logged working normal → 80*6 = 480
    await addSet({ session_id: 'sess-B', exercise_id: DEAD, session_exercise_id: seB1, ordering: 2, weight_kg: 80, reps: 6, set_kind: 'working', is_logged: true });

    // --- Session C: FREESTYLE (no template_id on any session_exercise) ---
    await createSession(db, { id: 'sess-C', started_at: 3000, title: 'C' });
    const seC1 = await addExercise({ session_id: 'sess-C', exercise_id: BENCH, ordering: 1, template_id: null });
    await addSet({ session_id: 'sess-C', exercise_id: BENCH, session_exercise_id: seC1, ordering: 1, weight_kg: 50, reps: 12, set_kind: 'working', is_logged: true });

    // --- Session D: mixed templates (tie-break by count, then MIN(ordering)) ---
    // 2 rows tpl-push + 1 row tpl-pull → tpl-push wins (more common).
    await createSession(db, { id: 'sess-D', started_at: 2000, title: 'D' });
    await addExercise({ session_id: 'sess-D', exercise_id: BENCH, ordering: 1, template_id: 'tpl-push' });
    await addExercise({ session_id: 'sess-D', exercise_id: SQUAT, ordering: 2, template_id: 'tpl-push' });
    await addExercise({ session_id: 'sess-D', exercise_id: DEAD, ordering: 3, template_id: 'tpl-pull' });
    // no sets → volume 0, exerciseCount 0

    // --- Session E: EMPTY session (no exercises, no sets) ---
    await createSession(db, { id: 'sess-E', started_at: 1000, title: 'E' });

    const aggregate = projectAggregate(await loadHistoryListRows(db));
    const oldPath = await computeOldPath(db);

    // Field-by-field equivalence is the core guardrail.
    expect(aggregate).toEqual(oldPath);

    // Pin down a few exact values so a regression in BOTH paths can't pass.
    const byId = new Map(aggregate.map((r) => [r.session_id, r]));
    // ordering: newest started_at first (A=5000, B=4000, C=3000, D=2000, E=1000).
    expect(aggregate.map((r) => r.session_id)).toEqual([
      'sess-A', 'sess-B', 'sess-C', 'sess-D', 'sess-E',
    ]);
    // A: warmup excluded, unlogged excluded → 480 + 500 = 980; 2 unique exercises.
    expect(byId.get('sess-A')!.volume).toBe(980);
    expect(byId.get('sess-A')!.exerciseCount).toBe(2);
    expect(byId.get('sess-A')!.triple).toEqual({
      template_id: 'tpl-push',
      template_name: 'Push Day',
      program_id: 'prog-1',
      program_name: '增肌-Q1',
      sub_tag: '5x5',
    });
    expect(byId.get('sess-A')!.tplColor).toBe('#FF0000');
    // B: null-weight set 0 + 480 = 480; 1 unique exercise; empty color → grey.
    expect(byId.get('sess-B')!.volume).toBe(480);
    expect(byId.get('sess-B')!.exerciseCount).toBe(1);
    expect(byId.get('sess-B')!.tplColor).toBe(FREESTYLE_COLOR);
    expect(byId.get('sess-B')!.triple?.template_id).toBe('tpl-pull');
    expect(byId.get('sess-B')!.triple?.program_name).toBeNull();
    // C: freestyle → null triple, grey color; volume 600, 1 exercise.
    expect(byId.get('sess-C')!.triple).toBeNull();
    expect(byId.get('sess-C')!.tplColor).toBe(FREESTYLE_COLOR);
    expect(byId.get('sess-C')!.volume).toBe(600);
    expect(byId.get('sess-C')!.exerciseCount).toBe(1);
    // D: tie-break → tpl-push (more common); no sets → 0 / 0.
    expect(byId.get('sess-D')!.triple?.template_id).toBe('tpl-push');
    expect(byId.get('sess-D')!.volume).toBe(0);
    expect(byId.get('sess-D')!.exerciseCount).toBe(0);
    // E: empty → null triple, grey, 0 / 0.
    expect(byId.get('sess-E')!.triple).toBeNull();
    expect(byId.get('sess-E')!.tplColor).toBe(FREESTYLE_COLOR);
    expect(byId.get('sess-E')!.volume).toBe(0);
    expect(byId.get('sess-E')!.exerciseCount).toBe(0);
  });

  it('matches when two templates tie on count → earliest ordering wins (mirrors getSessionLinkedTemplateTriple)', async () => {
    await createTemplate(db, { id: 'tpl-early', name: 'Early', color_hex: '#111111', now: () => 1 });
    await createTemplate(db, { id: 'tpl-late', name: 'Late', color_hex: '#222222', now: () => 2 });
    await createSession(db, { id: 'sess-tie', started_at: 9000, title: 'tie' });
    // 1 row each → tie on count; tpl-early has MIN(ordering)=1 < tpl-late's 2.
    await addExercise({ session_id: 'sess-tie', exercise_id: BENCH, ordering: 1, template_id: 'tpl-early' });
    await addExercise({ session_id: 'sess-tie', exercise_id: SQUAT, ordering: 2, template_id: 'tpl-late' });

    const aggregate = projectAggregate(await loadHistoryListRows(db));
    expect(aggregate).toEqual(await computeOldPath(db));
    expect(aggregate[0].triple?.template_id).toBe('tpl-early');
    expect(aggregate[0].tplColor).toBe('#111111');
  });
});
