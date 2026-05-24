import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  convertSessionToTemplate,
  getTemplateFull,
} from '../../src/adapters/sqlite/templateRepository';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import {
  createSession,
  insertSessionExercise,
  appendReusableSupersetToSession,
} from '../../src/adapters/sqlite/sessionRepository';
import { insertSessionSet } from '../../src/adapters/sqlite/setRepository';
import {
  insertReusableSuperset,
  findExistingReusableSupersetByPair,
} from '../../src/adapters/sqlite/supersetRepository';

/**
 * `convertSessionToTemplate` with 2 RS cards sharing an exercise — additional
 * coverage beyond the existing `templateConvertFromSession.test.ts` #31 cases.
 *
 * Test gap from `docs/audit/2026-05-24-test-gap-and-dead-code.md` § 5 #3.
 *
 * Cases here lock in:
 *   1. RS1=[A,X] + RS2=[X,B] (X shared) — the resulting template has 2
 *      distinct reusable_superset_id values across the four template_exercise
 *      rows. Each RS's pair (A,X) / (X,B) propagates verbatim per card; the
 *      shared X exercise does NOT cause the two RS template_exercise rows to
 *      collapse onto each other.
 *
 *   2. Entire-pair shared (RS1=[A,X] + RS2=[A,X]): structurally impossible at
 *      the RS template level. `insertReusableSuperset` rejects with
 *      "duplicate RS pair" — verified here so a future change that loosens
 *      that guard (e.g. allowing 2 RS templates with identical exercise pairs)
 *      forces an explicit follow-up to revisit `convertSessionToTemplate`
 *      behavior.
 *
 *   3. 1 RS + 1 solo exercise matching the RS's A side: solo stays solo
 *      (reusable_superset_id NULL in template), RS card stays RS
 *      (reusable_superset_id = rs.id). Verifies the session_exercise_id
 *      isolation (slice 10c #17 / #31) flows through to template_exercise
 *      row-level reusable_superset_id assignment.
 */

const NOW = 1_700_000_000_000;

describe('convertSessionToTemplate × 2 RS sharing an exercise (additional coverage)', () => {
  let db: BetterSqliteDatabase;
  let benchId: string;
  let squatId: string;
  let chestDipId: string;
  let cableId: string;
  let counter = 0;
  const uuid = () => `uuid-${++counter}`;
  const now = () => NOW;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    const exercises = await listExercises(db);
    benchId = exercises.find((e) => e.name === 'Bench Press')!.id;
    squatId = exercises.find((e) => e.name === 'Back Squat')!.id;
    chestDipId = exercises.find((e) => e.name === 'Chest Dip')!.id;
    cableId = exercises.find((e) => e.name === 'Cable Crossover')!.id;
    counter = 0;
  });

  afterEach(() => db.close());

  it('Case 1: RS1=[Bench,ChestDip] + RS2=[Cable,ChestDip] — template carries 2 distinct reusable_superset_id values across 4 rows', async () => {
    // Build 2 real RS templates that share ChestDip on the B side.
    const rs1 = await insertReusableSuperset(
      db,
      {
        name: 'Bench + ChestDip',
        color_hex: null,
        exercise_ids: [benchId, chestDipId],
      },
      uuid,
      now,
    );
    const rs2 = await insertReusableSuperset(
      db,
      {
        name: 'Cable + ChestDip',
        color_hex: null,
        exercise_ids: [cableId, chestDipId],
      },
      uuid,
      now,
    );
    expect(rs1).not.toBe(rs2);

    // Drop both RS into the same session via the production helper so we get
    // real session_exercise.reusable_superset_id + parent_id wiring (not a
    // hand-crafted fixture).
    await createSession(db, { id: 'sess-share', started_at: NOW });
    const pair1 = await appendReusableSupersetToSession(db, {
      session_id: 'sess-share',
      reusable_superset_id: rs1,
      uuid,
    });
    const pair2 = await appendReusableSupersetToSession(db, {
      session_id: 'sess-share',
      reusable_superset_id: rs2,
      uuid,
    });

    // Log a working set on each card so the template gets a non-empty
    // template_set list per template_exercise.
    await insertSessionSet(db, {
      id: 'set-1a',
      session_id: 'sess-share',
      exercise_id: benchId,
      session_exercise_id: pair1.a_id,
      weight_kg: 60,
      reps: 8,
      is_skipped: 0,
      ordering: 1,
      created_at: NOW,
      set_kind: 'working',
      parent_set_id: null,
    });
    await insertSessionSet(db, {
      id: 'set-1b',
      session_id: 'sess-share',
      exercise_id: chestDipId,
      session_exercise_id: pair1.b_id,
      weight_kg: 0,
      reps: 10,
      is_skipped: 0,
      ordering: 2,
      created_at: NOW + 1000,
      set_kind: 'working',
      parent_set_id: null,
    });
    await insertSessionSet(db, {
      id: 'set-2a',
      session_id: 'sess-share',
      exercise_id: cableId,
      session_exercise_id: pair2.a_id,
      weight_kg: 20,
      reps: 12,
      is_skipped: 0,
      ordering: 3,
      created_at: NOW + 2000,
      set_kind: 'working',
      parent_set_id: null,
    });
    await insertSessionSet(db, {
      id: 'set-2b',
      session_id: 'sess-share',
      exercise_id: chestDipId,
      session_exercise_id: pair2.b_id,
      weight_kg: 0,
      reps: 6,
      is_skipped: 0,
      ordering: 4,
      created_at: NOW + 3000,
      set_kind: 'working',
      parent_set_id: null,
    });

    const tplId = await convertSessionToTemplate(db, {
      session_id: 'sess-share',
      template_name: 'Two RS Sharing Chest Dip',
      mode: 'create',
      uuid,
      now,
    });

    const tpl = await getTemplateFull(db, tplId);
    expect(tpl).not.toBeNull();
    expect(tpl!.exercises).toHaveLength(4);

    const [r1a, r1b, r2a, r2b] = tpl!.exercises;

    // RS1 A: Bench, reusable_superset_id = rs1
    expect(r1a.exercise_id).toBe(benchId);
    expect(r1a.reusable_superset_id).toBe(rs1);
    expect(r1a.parent_id).toBeNull();
    expect(r1a.sets).toHaveLength(1);

    // RS1 B: ChestDip, reusable_superset_id = rs1, parent_id = r1a.id
    expect(r1b.exercise_id).toBe(chestDipId);
    expect(r1b.reusable_superset_id).toBe(rs1);
    expect(r1b.parent_id).toBe(r1a.id);
    expect(r1b.sets).toHaveLength(1);
    expect(r1b.sets[0].reps).toBe(10); // RS1's chest dip reps, not RS2's

    // RS2 A: Cable, reusable_superset_id = rs2
    expect(r2a.exercise_id).toBe(cableId);
    expect(r2a.reusable_superset_id).toBe(rs2);
    expect(r2a.parent_id).toBeNull();
    expect(r2a.sets).toHaveLength(1);

    // RS2 B: ChestDip, reusable_superset_id = rs2, parent_id = r2a.id
    expect(r2b.exercise_id).toBe(chestDipId);
    expect(r2b.reusable_superset_id).toBe(rs2);
    expect(r2b.parent_id).toBe(r2a.id);
    expect(r2b.sets).toHaveLength(1);
    expect(r2b.sets[0].reps).toBe(6); // RS2's chest dip reps, not RS1's

    // The 4 reusable_superset_id values across the template — 2 distinct rs ids.
    const distinctRsIds = new Set(
      tpl!.exercises.map((e) => e.reusable_superset_id).filter(Boolean),
    );
    expect(distinctRsIds.size).toBe(2);
    expect(distinctRsIds.has(rs1)).toBe(true);
    expect(distinctRsIds.has(rs2)).toBe(true);
  });

  it('Case 2: entire-pair shared (RS1=[A,X] + RS2=[A,X]) is structurally impossible — insertReusableSuperset rejects the second template', async () => {
    // First RS with the (Bench, Squat) pair — succeeds.
    const rs1 = await insertReusableSuperset(
      db,
      {
        name: 'RS1 Bench+Squat',
        color_hex: null,
        exercise_ids: [benchId, squatId],
      },
      uuid,
      now,
    );
    expect(rs1).toBeTruthy();

    // Pre-check: the order-insensitive lookup already finds the existing pair.
    expect(
      await findExistingReusableSupersetByPair(db, squatId, benchId),
    ).toBe(rs1);

    // Second RS with the SAME pair — even reversed (Squat, Bench) — must throw.
    // This locks in the dup-pair guard so a future loosening triggers explicit
    // re-evaluation of `convertSessionToTemplate`'s assumption that each
    // session_exercise.reusable_superset_id maps 1-to-1 with a unique pair.
    await expect(
      insertReusableSuperset(
        db,
        {
          name: 'RS2 Squat+Bench (reversed)',
          color_hex: null,
          exercise_ids: [squatId, benchId],
        },
        uuid,
        now,
      ),
    ).rejects.toThrow(/duplicate RS pair/i);
  });

  it('Case 3: 1 RS + 1 solo matching RS A-side — solo stays solo, RS stays RS in the resulting template', async () => {
    // RS template: Bench (A) + Squat (B). Then a solo Bench card.
    // Slice 10c #20 dup-guard SCOPE: solo guard fires only when both rows have
    // reusable_superset_id IS NULL. RS A-side Bench (NOT NULL rs id) does not
    // trip the solo bench guard — they're independent buckets.
    const rsId = await insertReusableSuperset(
      db,
      {
        name: 'Bench + Squat RS',
        color_hex: null,
        exercise_ids: [benchId, squatId],
      },
      uuid,
      now,
    );

    await createSession(db, { id: 'sess-mix', started_at: NOW });
    const pair = await appendReusableSupersetToSession(db, {
      session_id: 'sess-mix',
      reusable_superset_id: rsId,
      uuid,
    });
    // Add solo Bench card (same exercise as RS A side). The hand-crafted
    // insertSessionExercise here mirrors what `appendSessionExercise` would
    // produce — reusable_superset_id NULL + parent_id NULL.
    const soloBenchId = 'se-solo-bench';
    await insertSessionExercise(db, {
      id: soloBenchId,
      session_id: 'sess-mix',
      exercise_id: benchId,
      ordering: 3,
      planned_sets: 3,
      planned_reps: null,
      planned_weight_kg: null,
      template_id: null,
      is_evergreen: 0,
      parent_id: null,
      reusable_superset_id: null,
      rest_sec: null,
    });

    // Log a set on each of the 3 cards.
    await insertSessionSet(db, {
      id: 'set-rs-a',
      session_id: 'sess-mix',
      exercise_id: benchId,
      session_exercise_id: pair.a_id,
      weight_kg: 80,
      reps: 6,
      is_skipped: 0,
      ordering: 1,
      created_at: NOW,
      set_kind: 'working',
      parent_set_id: null,
    });
    await insertSessionSet(db, {
      id: 'set-rs-b',
      session_id: 'sess-mix',
      exercise_id: squatId,
      session_exercise_id: pair.b_id,
      weight_kg: 100,
      reps: 5,
      is_skipped: 0,
      ordering: 2,
      created_at: NOW + 1000,
      set_kind: 'working',
      parent_set_id: null,
    });
    await insertSessionSet(db, {
      id: 'set-solo',
      session_id: 'sess-mix',
      exercise_id: benchId,
      session_exercise_id: soloBenchId,
      weight_kg: 50,
      reps: 12,
      is_skipped: 0,
      ordering: 3,
      created_at: NOW + 2000,
      set_kind: 'warmup',
      parent_set_id: null,
    });

    const tplId = await convertSessionToTemplate(db, {
      session_id: 'sess-mix',
      template_name: 'RS Plus Solo',
      mode: 'create',
      uuid,
      now,
    });

    const tpl = await getTemplateFull(db, tplId);
    expect(tpl!.exercises).toHaveLength(3);

    // Ordering follows session_exercise.ordering ASC:
    // 1: RS A (Bench, rs=rsId, parent NULL)
    // 2: RS B (Squat, rs=rsId, parent = RS A's new template id)
    // 3: Solo Bench (rs=NULL, parent NULL)
    const [rsA, rsB, solo] = tpl!.exercises;

    // RS A
    expect(rsA.exercise_id).toBe(benchId);
    expect(rsA.reusable_superset_id).toBe(rsId);
    expect(rsA.parent_id).toBeNull();
    expect(rsA.sets).toHaveLength(1);
    expect(rsA.sets[0].weight).toBe(80);

    // RS B
    expect(rsB.exercise_id).toBe(squatId);
    expect(rsB.reusable_superset_id).toBe(rsId);
    expect(rsB.parent_id).toBe(rsA.id);
    expect(rsB.sets).toHaveLength(1);

    // Solo — same exercise as RS A but with NULL rs id; #31 isolation means
    // its set list is its own (the warmup), NOT polluted with RS A's working
    // set.
    expect(solo.exercise_id).toBe(benchId);
    expect(solo.reusable_superset_id).toBeNull();
    expect(solo.parent_id).toBeNull();
    expect(solo.sets).toHaveLength(1);
    expect(solo.sets[0].kind).toBe('warmup');
    expect(solo.sets[0].weight).toBe(50);

    // RS A's set list also stays clean — only its working set, no warmup leak.
    expect(rsA.sets.map((s) => s.kind)).toEqual(['working']);
  });

});
