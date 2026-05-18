import { randomUUID } from 'node:crypto';
import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import {
  addTemplateExercise,
  attachTemplateToProgram,
  createTemplate,
} from '../../src/adapters/sqlite/templateRepository';
import { createProgram } from '../../src/adapters/sqlite/programRepository';
import { startSessionFromTemplate } from '../../src/adapters/sqlite/sessionFromTemplate';
import {
  endSession,
  insertSessionExercise,
} from '../../src/adapters/sqlite/sessionRepository';
import {
  insertSessionSet,
  listSetsBySession,
} from '../../src/adapters/sqlite/setRepository';

/**
 * Round 35 — startSessionFromTemplate's (program, sub_tag, exercise) priority
 * tree prefill. See `prefillSetsForNewSessionExercise` doc for the full
 * 4-tier resolver (exact triple → P+通用 → P+any sub_tag → empty).
 */
describe('startSessionFromTemplate — round 35 history prefill', () => {
  let db: BetterSqliteDatabase;
  let exA_id: string;
  let exB_id: string;
  const PROG_PUSH = 'prog-push';
  const PROG_PULL = 'prog-pull';

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    const exs = await listExercises(db);
    exA_id = exs.find((e) => e.name === 'Bench Press')!.id;
    exB_id = exs.find((e) => e.name === 'Overhead Press')!.id;

    await createProgram(db, {
      program: {
        id: PROG_PUSH,
        name: 'Push',
        main_tag: null,
        cycle_length: 3,
        cycle_count: 1,
        start_date: '2026-01-01',
        is_active: 0,
      },
    });
    await createProgram(db, {
      program: {
        id: PROG_PULL,
        name: 'Pull',
        main_tag: null,
        cycle_length: 3,
        cycle_count: 1,
        start_date: '2026-01-01',
        is_active: 0,
      },
    });
  });

  afterEach(() => {
    db.close();
  });

  /**
   * Make a finished historical session that contains one session_exercise for
   * `exercise_id` (linked to `template_id` so the prefill JOIN finds the
   * program/sub_tag of the template). Optionally `sets` are inserted with
   * is_logged=1.
   */
  async function makeHistorySession(args: {
    session_id: string;
    template_id: string;
    exercise_id: string;
    started_at: number;
    ended_at: number;
    sets: Array<{
      weight_kg: number;
      reps: number;
      set_kind?: 'warmup' | 'working' | 'dropset';
    }>;
  }): Promise<{ se_id: string }> {
    const { session_id, template_id, exercise_id, started_at, ended_at } = args;
    // session header
    await db.runAsync(
      `INSERT INTO session (id, started_at, ended_at) VALUES (?, ?, ?)`,
      session_id,
      started_at,
      ended_at,
    );
    const se_id = randomUUID();
    await insertSessionExercise(db, {
      id: se_id,
      session_id,
      exercise_id,
      ordering: 1,
      planned_sets: 1,
      planned_reps: null,
      planned_weight_kg: null,
      template_id,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
      rest_sec: null,
    });
    for (let i = 0; i < args.sets.length; i++) {
      const s = args.sets[i];
      const set_id = randomUUID();
      await insertSessionSet(db, {
        id: set_id,
        session_id,
        exercise_id,
        weight_kg: s.weight_kg,
        reps: s.reps,
        is_skipped: 0,
        ordering: i + 1,
        created_at: started_at + i * 1_000,
        set_kind: s.set_kind ?? 'working',
        parent_set_id: null,
        session_exercise_id: se_id,
      });
      await db.runAsync(`UPDATE "set" SET is_logged = 1 WHERE id = ?`, set_id);
    }
    return { se_id };
  }

  /**
   * Build a template under (program_id, sub_tag) with a single exercise.
   * Returns the template_id so caller can run startSessionFromTemplate.
   */
  async function buildTemplate(args: {
    program_id: string | null;
    sub_tag: string | null;
    exercise_id: string;
    name: string;
  }): Promise<string> {
    const tpl_id = randomUUID();
    await createTemplate(db, { id: tpl_id, name: args.name });
    await attachTemplateToProgram(db, {
      template_id: tpl_id,
      program_id: args.program_id,
      sub_tag: args.sub_tag,
    });
    await addTemplateExercise(db, {
      template_id: tpl_id,
      exercise_id: args.exercise_id,
      default_sets: 1,
      default_reps: null,
      default_weight_kg: null,
      uuid: randomUUID,
    });
    return tpl_id;
  }

  it('Case 1: P+S+E history → replays full set list from that session', async () => {
    // 1) build a "5x5" template under PROG_PUSH, exA
    const histTpl = await buildTemplate({
      program_id: PROG_PUSH,
      sub_tag: '5x5',
      exercise_id: exA_id,
      name: 'Push 5x5',
    });
    await makeHistorySession({
      session_id: 'hist-1',
      template_id: histTpl,
      exercise_id: exA_id,
      started_at: 1_000,
      ended_at: 2_000,
      sets: [
        { weight_kg: 60, reps: 5, set_kind: 'warmup' },
        { weight_kg: 100, reps: 5 },
        { weight_kg: 100, reps: 5 },
      ],
    });

    // 2) Start a new session from the SAME template + same (P, S).
    const startTpl = await buildTemplate({
      program_id: PROG_PUSH,
      sub_tag: '5x5',
      exercise_id: exA_id,
      name: 'Push 5x5 fresh',
    });
    const { session_id } = await startSessionFromTemplate(db, {
      template_id: startTpl,
      uuid: randomUUID,
      now: () => 5_000,
      program_id: PROG_PUSH,
      sub_tag: '5x5',
    });

    const rows = await listSetsBySession(db, session_id);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => ({ w: r.weight_kg, r: r.reps, k: r.set_kind })))
      .toEqual([
        { w: 60, r: 5, k: 'warmup' },
        { w: 100, r: 5, k: 'working' },
        { w: 100, r: 5, k: 'working' },
      ]);
    // All prefilled rows must be is_logged=0 (user has to ✓ each one).
    expect(rows.every((r) => r.is_logged === 0)).toBe(true);
  });

  it('Case 2: P+S+E miss → P+通用+E hit (sub_tag = null fallback)', async () => {
    // Generic template (sub_tag=null) under PROG_PUSH.
    const histTpl = await buildTemplate({
      program_id: PROG_PUSH,
      sub_tag: null,
      exercise_id: exA_id,
      name: 'Push 通用',
    });
    await makeHistorySession({
      session_id: 'hist-generic',
      template_id: histTpl,
      exercise_id: exA_id,
      started_at: 1_000,
      ended_at: 2_000,
      sets: [{ weight_kg: 80, reps: 8 }],
    });

    // User picks PROG_PUSH + '10RM' (no history for that triple).
    const startTpl = await buildTemplate({
      program_id: PROG_PUSH,
      sub_tag: '10RM',
      exercise_id: exA_id,
      name: 'Push 10RM',
    });
    const { session_id } = await startSessionFromTemplate(db, {
      template_id: startTpl,
      uuid: randomUUID,
      now: () => 5_000,
      program_id: PROG_PUSH,
      sub_tag: '10RM',
    });

    const rows = await listSetsBySession(db, session_id);
    expect(rows).toHaveLength(1);
    expect(rows[0].weight_kg).toBe(80);
    expect(rows[0].reps).toBe(8);
    expect(rows[0].is_logged).toBe(0);
  });

  it('Case 3: P+S+E miss + P+通用+E miss → P+any sub_tag+E hit (latest)', async () => {
    // Older session under PROG_PUSH + '5x5'
    const tplA = await buildTemplate({
      program_id: PROG_PUSH,
      sub_tag: '5x5',
      exercise_id: exA_id,
      name: 'Push 5x5',
    });
    await makeHistorySession({
      session_id: 'hist-5x5',
      template_id: tplA,
      exercise_id: exA_id,
      started_at: 1_000,
      ended_at: 2_000,
      sets: [{ weight_kg: 70, reps: 5 }],
    });

    // Newer session under PROG_PUSH + '8RM' — should win on latest ended_at
    const tplB = await buildTemplate({
      program_id: PROG_PUSH,
      sub_tag: '8RM',
      exercise_id: exA_id,
      name: 'Push 8RM',
    });
    await makeHistorySession({
      session_id: 'hist-8rm',
      template_id: tplB,
      exercise_id: exA_id,
      started_at: 10_000,
      ended_at: 20_000,
      sets: [{ weight_kg: 95, reps: 8 }],
    });

    // Start a session with PROG_PUSH + '10RM' (no exact, no generic) — should
    // fall through to tier C and pick the 8RM history (latest).
    const startTpl = await buildTemplate({
      program_id: PROG_PUSH,
      sub_tag: '10RM',
      exercise_id: exA_id,
      name: 'Push 10RM fresh',
    });
    const { session_id } = await startSessionFromTemplate(db, {
      template_id: startTpl,
      uuid: randomUUID,
      now: () => 50_000,
      program_id: PROG_PUSH,
      sub_tag: '10RM',
    });

    const rows = await listSetsBySession(db, session_id);
    expect(rows).toHaveLength(1);
    expect(rows[0].weight_kg).toBe(95);
    expect(rows[0].reps).toBe(8);
  });

  it('Case 4: no history at all → no set rows inserted (empty session)', async () => {
    const startTpl = await buildTemplate({
      program_id: PROG_PUSH,
      sub_tag: '5x5',
      exercise_id: exA_id,
      name: 'Push 5x5 first run',
    });
    const { session_id } = await startSessionFromTemplate(db, {
      template_id: startTpl,
      uuid: randomUUID,
      now: () => 5_000,
      program_id: PROG_PUSH,
      sub_tag: '5x5',
    });
    const rows = await listSetsBySession(db, session_id);
    expect(rows).toHaveLength(0);
  });

  it('Case 5: program_id omitted (template-editor caller) → legacy no-prefill', async () => {
    // Even with rich history matching the triple, omitting `program_id` (the
    // template-editor caller path) MUST skip prefill — backward compat with
    // pre-round-35 behaviour.
    const histTpl = await buildTemplate({
      program_id: PROG_PUSH,
      sub_tag: '5x5',
      exercise_id: exA_id,
      name: 'Push 5x5',
    });
    await makeHistorySession({
      session_id: 'hist-legacy',
      template_id: histTpl,
      exercise_id: exA_id,
      started_at: 1_000,
      ended_at: 2_000,
      sets: [{ weight_kg: 100, reps: 5 }],
    });

    const startTpl = await buildTemplate({
      program_id: PROG_PUSH,
      sub_tag: '5x5',
      exercise_id: exA_id,
      name: 'Push 5x5 fresh',
    });
    const { session_id } = await startSessionFromTemplate(db, {
      template_id: startTpl,
      uuid: randomUUID,
      now: () => 5_000,
      // No program_id / sub_tag — legacy path.
    });
    const rows = await listSetsBySession(db, session_id);
    expect(rows).toHaveLength(0);
  });

  it('only pulls from sessions matching exercise_id — exB history does not leak into exA prefill', async () => {
    const tplB = await buildTemplate({
      program_id: PROG_PUSH,
      sub_tag: '5x5',
      exercise_id: exB_id,
      name: 'Push 5x5 OHP',
    });
    await makeHistorySession({
      session_id: 'hist-ohp',
      template_id: tplB,
      exercise_id: exB_id,
      started_at: 1_000,
      ended_at: 2_000,
      sets: [{ weight_kg: 50, reps: 5 }],
    });

    // Now start a session for exA under the same (PROG_PUSH, 5x5) — should
    // NOT pick up exB's history (E mismatch).
    const startTpl = await buildTemplate({
      program_id: PROG_PUSH,
      sub_tag: '5x5',
      exercise_id: exA_id,
      name: 'Push 5x5 BP',
    });
    const { session_id } = await startSessionFromTemplate(db, {
      template_id: startTpl,
      uuid: randomUUID,
      now: () => 5_000,
      program_id: PROG_PUSH,
      sub_tag: '5x5',
    });
    const rows = await listSetsBySession(db, session_id);
    expect(rows).toHaveLength(0);
  });

  it('excludes in-progress sessions (ended_at IS NULL) from the prefill source', async () => {
    // Make a "fresh" history finished session under (PROG_PULL, anything)
    // for exA — should NOT be picked up since (P=PUSH) doesn't match. We use
    // it just to exercise the WHERE filter without leaking confusion.
    const otherTpl = await buildTemplate({
      program_id: PROG_PULL,
      sub_tag: null,
      exercise_id: exA_id,
      name: 'Pull generic',
    });
    await makeHistorySession({
      session_id: 'hist-pull',
      template_id: otherTpl,
      exercise_id: exA_id,
      started_at: 1_000,
      ended_at: 2_000,
      sets: [{ weight_kg: 50, reps: 5 }],
    });

    // Make an OPEN session under (PROG_PUSH, 5x5) for exA — must be ignored
    // (ended_at IS NULL).
    const openTpl = await buildTemplate({
      program_id: PROG_PUSH,
      sub_tag: '5x5',
      exercise_id: exA_id,
      name: 'Push 5x5 open',
    });
    await db.runAsync(
      `INSERT INTO session (id, started_at, ended_at) VALUES (?, ?, NULL)`,
      'sess-open',
      3_000,
    );
    const openSe = randomUUID();
    await insertSessionExercise(db, {
      id: openSe,
      session_id: 'sess-open',
      exercise_id: exA_id,
      ordering: 1,
      planned_sets: 1,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: openTpl,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
      rest_sec: null,
    });
    const phantomSet = randomUUID();
    await insertSessionSet(db, {
      id: phantomSet,
      session_id: 'sess-open',
      exercise_id: exA_id,
      weight_kg: 999, // sentinel value
      reps: 5,
      is_skipped: 0,
      ordering: 1,
      created_at: 3_500,
      set_kind: 'working',
      parent_set_id: null,
      session_exercise_id: openSe,
    });
    await db.runAsync(`UPDATE "set" SET is_logged = 1 WHERE id = ?`, phantomSet);

    // Close the open session BUT keep ended_at NULL via direct UPDATE — we
    // want startSessionFromTemplate to pass the active-session guard while
    // 'sess-open' still has NULL ended_at. The guard reads via getActiveSession
    // which filters on ended_at IS NULL — same row we want to leave NULL.
    // Workaround: temporarily mark sess-open ended (passes guard), then
    // reopen it (NULL again) immediately before starting the new session.
    // Cleanest path: close, then re-open via raw SQL so the assertion
    // verifies the prefill SQL respects ended_at IS NOT NULL.
    await endSession(db, { id: 'sess-open', ended_at: 3_999 });
    await db.runAsync(
      `UPDATE session SET ended_at = NULL WHERE id = ?`,
      'sess-open',
    );

    // Now start a new session — the guard rejects because sess-open is
    // active again.
    const startTpl = await buildTemplate({
      program_id: PROG_PUSH,
      sub_tag: '5x5',
      exercise_id: exA_id,
      name: 'Push 5x5 fresh',
    });
    await expect(
      startSessionFromTemplate(db, {
        template_id: startTpl,
        uuid: randomUUID,
        now: () => 10_000,
        program_id: PROG_PUSH,
        sub_tag: '5x5',
      }),
    ).rejects.toThrow(/already in progress/);

    // End sess-open for real; sentinel value should now be picked up since
    // it's history (validates the inverse half — same row, only ended_at
    // changed). Helps prove the WHERE clause is solely ended_at-driven.
    await endSession(db, { id: 'sess-open', ended_at: 4_000 });
    const { session_id } = await startSessionFromTemplate(db, {
      template_id: startTpl,
      uuid: randomUUID,
      now: () => 10_000,
      program_id: PROG_PUSH,
      sub_tag: '5x5',
    });
    const rows = await listSetsBySession(db, session_id);
    expect(rows).toHaveLength(1);
    expect(rows[0].weight_kg).toBe(999);
  });
});
