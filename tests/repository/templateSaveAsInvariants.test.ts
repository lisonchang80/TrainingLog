import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import {
  attachTemplateToProgram,
  commitTemplateDraft,
  createTemplate,
  findTemplateByTriple,
  getTemplateFull,
} from '../../src/adapters/sqlite/templateRepository';
import { createProgram } from '../../src/adapters/sqlite/programRepository';
import {
  cloneTemplate,
  remapDraftBody,
} from '../../src/domain/template/templateDraft';
import type { Template } from '../../src/domain/template/types';

/**
 * Hardening tests for the 2026-06-04 template-editor 另存模板 / 覆蓋 (save-as /
 * overwrite) data invariants, COMPLEMENTING `templateSaveAsFromTemplate.test.ts`
 * and `templateOverwriteBody.test.ts` (which already cover the happy-path
 * id-remap + the three onSaveAsConfirm outcomes at spot-value granularity).
 *
 * These add the three invariants the task asked to LOCK that the existing
 * suites only checked partially:
 *   1. remapDraftBody preserves the body structure 1:1 (ordering, set kinds,
 *      reps/weight, dropset clusters, superset grouping) — full field-by-field
 *      assertion, not just spot ids.
 *   2. commitTemplateDraft body-overwrite leaves the SOURCE template X
 *      BYTE-IDENTICAL — full getTemplateFull(X) deep-equal before vs after,
 *      for BOTH the no-collision (create Y) and collision (覆蓋 Y) branches.
 *   3. The self-triple branch (outcome c) is UI-only: there is NO repo-level
 *      guard — findTemplateByTriple against X's own triple returns X itself, so
 *      the block lives in onSaveAsConfirm's `existing.id === draft.id` check.
 *
 * better-sqlite3 :memory:, foreign_keys=ON → seed real builtin exercise_ids.
 */
describe('另存模板 / 覆蓋 data invariants (2026-06-04 redesign — hardening)', () => {
  let db: BetterSqliteDatabase;
  let benchId: string;
  let squatId: string;
  let ohpId: string;

  function makeUuidGen(prefix = 'gen'): () => string {
    let n = 0;
    return () => `${prefix}-${++n}`;
  }

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    const exercises = await listExercises(db);
    benchId = exercises.find((e) => e.name === 'Bench Press')!.id;
    squatId = exercises.find((e) => e.name === 'Back Squat')!.id;
    // 'Overhead Press' was archived by v028 — use an active overhead-press variant.
    ohpId = exercises.find((e) => e.name === 'Dumbbell Shoulder Press')!.id;
    await createProgram(db, {
      program: {
        id: 'prog-A',
        name: 'Program A',
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
   * Seed the SOURCE template X = "胸日" (prog-A, 10RM) with a body that
   * exercises EVERY linkage kind the remap must preserve:
   *   - a superset cluster: Bench (parent) + Squat (child via parent_id)
   *   - a reusable_superset_id stamped on both cluster rows
   *   - a solo OHP exercise after the cluster (proves non-cluster rows survive)
   *   - a dropset chain on Bench (warmup + working head + dropset follower via
   *     parent_set_id), and multi-set lists with mixed kinds / reps / weights.
   * Returns X's id.
   */
  async function seedX(id = 'tpl-X'): Promise<string> {
    await db.runAsync(
      `INSERT INTO superset (id, name, color_hex, use_count, created_at, updated_at)
       VALUES (?, ?, NULL, 0, ?, ?)`,
      'rs-1',
      'Chest RS',
      1000,
      1000,
    );
    await createTemplate(db, { id, name: '胸日', now: () => 1000 });
    await attachTemplateToProgram(db, {
      template_id: id,
      program_id: 'prog-A',
      sub_tag: '10RM',
      now: () => 1000,
    });
    // Bench parent (ordering 1), reusable cluster.
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, default_reps,
          default_weight_kg, is_evergreen, parent_id, rest_seconds,
          reusable_superset_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'te-bench', id, benchId, 1, 3, 8, 80, 0, null, 90, 'rs-1', 1000,
    );
    // Squat child (ordering 2), parent_id → te-bench, evergreen, same rs.
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, default_reps,
          default_weight_kg, is_evergreen, parent_id, rest_seconds,
          reusable_superset_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'te-squat', id, squatId, 2, 1, 5, 100, 1, 'te-bench', 120, 'rs-1', 1000,
    );
    // Solo OHP after the cluster (ordering 3).
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, default_reps,
          default_weight_kg, is_evergreen, parent_id, rest_seconds,
          reusable_superset_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'te-ohp', id, ohpId, 3, 2, 10, 40, 0, null, 60, null, 1000,
    );
    // Bench sets: warmup + working head + dropset follower (chained).
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind,
         reps, weight, parent_set_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      'ts-b1', 'te-bench', 0, 'warmup', 12, 40, null, 'warm',
    );
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind,
         reps, weight, parent_set_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      'ts-b2', 'te-bench', 1, 'working', 8, 80, null, null,
    );
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind,
         reps, weight, parent_set_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      'ts-b3', 'te-bench', 2, 'dropset', 6, 60, 'ts-b2', 'drop',
    );
    // Squat sets: one working.
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind,
         reps, weight, parent_set_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      'ts-s1', 'te-squat', 0, 'working', 5, 100, null, null,
    );
    // OHP sets: two working.
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind,
         reps, weight, parent_set_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      'ts-o1', 'te-ohp', 0, 'working', 10, 40, null, null,
    );
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind,
         reps, weight, parent_set_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      'ts-o2', 'te-ohp', 1, 'working', 10, 40, null, null,
    );
    return id;
  }

  /**
   * Replay the editor's `writeBodyTo(targetId)` against the CURRENT draft body:
   * clone → fresh ids via remapDraftBody → commitTemplateDraft into the target,
   * keeping the target's identity. Mirrors onSaveAsConfirm exactly.
   */
  async function writeBodyTo(
    targetId: string,
    draftExercises: Template['exercises'],
    uuid: () => string,
  ): Promise<void> {
    const target = await getTemplateFull(db, targetId);
    if (!target) throw new Error('TARGET_TEMPLATE_NOT_FOUND');
    await commitTemplateDraft(db, {
      committed: target,
      draft: {
        id: targetId,
        name: target.name,
        color_hex: target.color_hex,
        program_id: target.program_id ?? null,
        sub_tag: target.sub_tag ?? null,
        exercises: remapDraftBody(draftExercises, targetId, uuid),
      },
      now: () => 5000,
    });
  }

  // -------------------------------------------------------------------------
  // Invariant 1 — remapDraftBody preserves structure 1:1 (full field-by-field).
  // -------------------------------------------------------------------------

  it('remapDraftBody: every id is NEW; structure (ordering / kinds / reps / weight / clusters / superset) preserved 1:1', async () => {
    await seedX();
    const x = (await getTemplateFull(db, 'tpl-X'))!;
    const remapped = remapDraftBody(x.exercises, 'tpl-Y', makeUuidGen('r'));

    // Same number of exercises, same order.
    expect(remapped).toHaveLength(x.exercises.length);

    // Collect the full set of OLD ids (exercises + sets) so we can assert
    // none of them survive into the remapped body.
    const oldExIds = new Set(x.exercises.map((e) => e.id));
    const oldSetIds = new Set(x.exercises.flatMap((e) => e.sets.map((s) => s.id)));

    remapped.forEach((rex, i) => {
      const sex = x.exercises[i];
      // ── Exercise: fresh id, re-pointed template_id, preserved scalar fields.
      expect(rex.id).not.toBe(sex.id);
      expect(oldExIds.has(rex.id)).toBe(false);
      expect(rex.template_id).toBe('tpl-Y');
      expect(rex.exercise_id).toBe(sex.exercise_id);
      expect(rex.ordering).toBe(sex.ordering);
      expect(rex.section).toBe(sex.section);
      expect(rex.rest_seconds).toBe(sex.rest_seconds);
      // reusable_superset_id carried verbatim (NOT remapped — it's a library FK).
      expect(rex.reusable_superset_id).toBe(sex.reusable_superset_id);

      // ── Sets: same count, fresh ids, preserved scalar fields.
      expect(rex.sets).toHaveLength(sex.sets.length);
      rex.sets.forEach((rs, j) => {
        const ss = sex.sets[j];
        expect(rs.id).not.toBe(ss.id);
        expect(oldSetIds.has(rs.id)).toBe(false);
        expect(rs.position).toBe(ss.position);
        expect(rs.kind).toBe(ss.kind);
        expect(rs.reps).toBe(ss.reps);
        expect(rs.weight).toBe(ss.weight);
        expect(rs.notes).toBe(ss.notes);
      });
    });

    const [bench, squat, ohp] = remapped;

    // ── Superset grouping: the child's parent_id points at the NEW parent id.
    expect(squat.parent_id).toBe(bench.id);
    // ── Solo rows keep parent_id null.
    expect(bench.parent_id).toBeNull();
    expect(ohp.parent_id).toBeNull();

    // ── Dropset cluster: the follower's parent_set_id points at the NEW head id.
    const benchWorking = bench.sets[1];
    const benchDropset = bench.sets[2];
    expect(benchDropset.kind).toBe('dropset');
    expect(benchDropset.parent_set_id).toBe(benchWorking.id);
    // ── Non-follower sets keep parent_set_id null.
    expect(bench.sets[0].parent_set_id).toBeNull();
    expect(benchWorking.parent_set_id).toBeNull();

    // ── Every remapped id is unique across the whole body (no aliasing).
    const allRemappedIds = [
      ...remapped.map((e) => e.id),
      ...remapped.flatMap((e) => e.sets.map((s) => s.id)),
    ];
    expect(new Set(allRemappedIds).size).toBe(allRemappedIds.length);
  });

  // -------------------------------------------------------------------------
  // Invariant 2 — SOURCE X is BYTE-IDENTICAL (full deep-equal) across BOTH
  // 另存 branches.
  // -------------------------------------------------------------------------

  it('另存 (no collision → create Y): X is BYTE-IDENTICAL before/after (getTemplateFull deep-equal)', async () => {
    await seedX();
    const xBefore = await getTemplateFull(db, 'tpl-X');

    // Simulate an UNSAVED on-screen edit on the draft — must NOT reach X.
    const draft = cloneTemplate(xBefore!);
    draft.exercises[0].sets[1].weight = 999;
    draft.exercises[2].sets[0].reps = 1;

    // No-collision branch: createTemplate + attachTemplateToProgram + writeBodyTo.
    const newId = 'tpl-Y';
    await createTemplate(db, { id: newId, name: '胸日複製', now: () => 5000 });
    await attachTemplateToProgram(db, {
      template_id: newId,
      program_id: 'prog-A',
      sub_tag: '8RM',
      now: () => 5000,
    });
    await writeBodyTo(newId, draft.exercises, makeUuidGen('y'));

    // ★ X byte-identical — full structural deep-equal of the hydrated tree.
    const xAfter = await getTemplateFull(db, 'tpl-X');
    expect(xAfter).toEqual(xBefore);

    // Y received the edited body (sanity: the create branch did write Y).
    const y = await getTemplateFull(db, newId);
    expect(y!.exercises[0].sets[1].weight).toBe(999);
    expect(y!.exercises[2].sets[0].reps).toBe(1);
    expect(y!.sub_tag).toBe('8RM');
  });

  it('覆蓋 (collision → overwrite existing Y): X is BYTE-IDENTICAL before/after (getTemplateFull deep-equal)', async () => {
    await seedX();
    const xBefore = await getTemplateFull(db, 'tpl-X');

    // Existing Y = (胸日, prog-A, 8RM) with a DIFFERENT body to be overwritten.
    await createTemplate(db, { id: 'tpl-Y', name: '胸日', now: () => 2000 });
    await attachTemplateToProgram(db, {
      template_id: 'tpl-Y',
      program_id: 'prog-A',
      sub_tag: '8RM',
      now: () => 2000,
    });
    await db.runAsync(
      `INSERT INTO template_exercise
         (id, template_id, exercise_id, ordering, default_sets, default_reps,
          default_weight_kg, is_evergreen, parent_id, rest_seconds,
          reusable_superset_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      'te-y-old', 'tpl-Y', squatId, 1, 1, 5, 60, 0, null, 60, null, 2000,
    );
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind,
         reps, weight, parent_set_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      'ts-y-old', 'te-y-old', 0, 'working', 5, 60, null, null,
    );

    // 覆蓋 branch: collision resolved to Y, writeBodyTo(Y) overwrites it.
    const existing = await findTemplateByTriple(db, {
      name: '胸日',
      program_id: 'prog-A',
      sub_tag: '8RM',
    });
    expect(existing!.id).toBe('tpl-Y');
    const draft = cloneTemplate(xBefore!);
    await writeBodyTo(existing!.id, draft.exercises, makeUuidGen('y'));

    // Y's body is wholesale-replaced with X's body; Y's identity preserved.
    const y = await getTemplateFull(db, 'tpl-Y');
    expect(y!.exercises.map((e) => e.exercise_id)).toEqual([
      benchId,
      squatId,
      ohpId,
    ]);
    expect(y!.exercises.map((e) => e.id)).not.toContain('te-y-old');
    expect(y!.sub_tag).toBe('8RM'); // identity untouched

    // ★ X byte-identical — full structural deep-equal.
    const xAfter = await getTemplateFull(db, 'tpl-X');
    expect(xAfter).toEqual(xBefore);
  });

  // -------------------------------------------------------------------------
  // Invariant 3 — the self-triple branch (outcome c) is UI-only.
  // -------------------------------------------------------------------------

  it('self-triple: there is NO repo-level guard — findTemplateByTriple returns X itself (block is UI-only in onSaveAsConfirm)', async () => {
    await seedX();
    const xBefore = await getTemplateFull(db, 'tpl-X');

    // The triple the user kept identical to X's own (name + program + sub_tag).
    const existing = await findTemplateByTriple(db, {
      name: '胸日',
      program_id: 'prog-A',
      sub_tag: '10RM',
    });
    // The repo layer happily returns X's own row — there is NO guard here.
    // onSaveAsConfirm short-circuits on `existing.id === draft.id` BEFORE any
    // write, which is the only thing protecting X from a self-overwrite.
    expect(existing).not.toBeNull();
    expect(existing!.id).toBe('tpl-X');

    // Document the consequence: IF the UI guard were absent and the repo path
    // ran writeBodyTo(X) with the remapped draft, X's body would be REWRITTEN
    // with fresh ids (a no-op in content but NOT byte-identical). This proves
    // the guard is load-bearing — the repo does not protect X on its own.
    const draft = cloneTemplate(xBefore!);
    await writeBodyTo(existing!.id, draft.exercises, makeUuidGen('selftriple'));
    const xAfter = await getTemplateFull(db, 'tpl-X');
    // Content is preserved (same exercise_ids / kinds / reps / weights)...
    expect(xAfter!.exercises.map((e) => e.exercise_id)).toEqual(
      xBefore!.exercises.map((e) => e.exercise_id),
    );
    // ...but the row ids were regenerated → NOT byte-identical, which is
    // exactly why the UI must block this branch.
    expect(xAfter!.exercises.map((e) => e.id)).not.toEqual(
      xBefore!.exercises.map((e) => e.id),
    );
  });
});
