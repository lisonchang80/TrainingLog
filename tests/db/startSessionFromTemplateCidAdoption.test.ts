/**
 * Phase C-id (set-level id-adoption, 2026-07-05) coverage for
 * `startSessionFromTemplate` + `snapshotForSession`.
 *
 * A Watch-led template start builds its session tree OFFLINE (the Watch's
 * `buildSnapshotFromFatTree`) and now mints REAL uuids for every
 * session_exercise / session_set row, shipping them via
 * `StartFromWatchPayload.idTree`. The iPhone must ADOPT those ids verbatim
 * (position-aligned) instead of minting its own, so both devices share the
 * SAME set/exercise ids from the first frame — which is what lets the reverse
 * live-mirror match by id (fixing the template-start non-last-dropset
 * corruption + making tombstone-by-id precise). See ADR-0019 § Phase C-id.
 *
 * These tests assert the ADOPTION (verbatim ids), the FALLBACK (mint when a
 * position has no / an empty supplied id, and legacy callers that omit the
 * tree entirely), and the parent-remap correctness (dropset follower
 * parent_set_id + superset exercise parent_id both resolve against the
 * SUPPLIED ids, never a stray minted one).
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { listExercises } from '../../src/adapters/sqlite/exerciseRepository';
import {
  addTemplateExercise,
  createTemplate,
} from '../../src/adapters/sqlite/templateRepository';
import { startSessionFromTemplate } from '../../src/adapters/sqlite/sessionFromTemplate';
import { snapshotForSession } from '../../src/domain/template/templateManager';

interface SessionSetRow {
  id: string;
  session_exercise_id: string | null;
  ordering: number;
  set_kind: 'warmup' | 'working' | 'dropset';
  parent_set_id: string | null;
}

async function fetchSessionSets(
  db: BetterSqliteDatabase,
  session_id: string,
): Promise<SessionSetRow[]> {
  return db.getAllAsync<SessionSetRow>(
    `SELECT id, session_exercise_id, ordering, set_kind, parent_set_id
       FROM "set"
      WHERE session_id = ?
      ORDER BY session_exercise_id, ordering ASC`,
    session_id,
  );
}

async function fetchSessionExerciseIds(
  db: BetterSqliteDatabase,
  session_id: string,
): Promise<string[]> {
  const rows = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM session_exercise WHERE session_id = ? ORDER BY ordering ASC`,
    session_id,
  );
  return rows.map((r) => r.id);
}

describe('startSessionFromTemplate — Phase C-id id-adoption', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  async function seedOneExerciseThreeSets(templateId: string): Promise<string> {
    const exercises = await listExercises(db);
    const bench = exercises.find((e) => e.name === 'Bench Press')!;
    let n = 0;
    const uuid = () => `tpl-uuid-${++n}`;
    await createTemplate(db, { id: templateId, name: 'Push', now: () => 100 });
    const { id: teId } = await addTemplateExercise(db, {
      template_id: templateId,
      exercise_id: bench.id,
      default_sets: 0,
      default_reps: 0,
      default_weight_kg: 0,
      uuid,
      now: () => 100,
    });
    for (let i = 0; i < 3; i++) {
      await db.runAsync(
        `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight)
         VALUES (?, ?, ?, 'working', ?, ?)`,
        `tpl-set-${i}`,
        teId,
        i,
        8,
        80,
      );
    }
    return teId;
  }

  // Two distinct exercises, each with two working sets — needed to exercise the
  // A-1 cross-exercise collision cases (duplicate seId across exercises;
  // duplicate setId across exercises, since the `set` PK is global).
  async function seedTwoExercisesTwoSetsEach(
    templateId: string,
  ): Promise<void> {
    const exercises = await listExercises(db);
    const [exA, exB] = exercises; // first two library entries (always present)
    let n = 0;
    const uuid = () => `tpl2-uuid-${++n}`;
    await createTemplate(db, { id: templateId, name: 'Full', now: () => 100 });
    const exIds = [exA.id, exB.id];
    for (let e = 0; e < 2; e++) {
      const { id: teId } = await addTemplateExercise(db, {
        template_id: templateId,
        exercise_id: exIds[e],
        default_sets: 0,
        default_reps: 0,
        default_weight_kg: 0,
        uuid,
        now: () => 100,
      });
      for (let i = 0; i < 2; i++) {
        await db.runAsync(
          `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight)
           VALUES (?, ?, ?, 'working', ?, ?)`,
          `tpl2-set-${e}-${i}`,
          teId,
          i,
          8,
          80,
        );
      }
    }
  }

  it('adopts Watch-supplied session_exercise + session_set ids verbatim', async () => {
    await seedOneExerciseThreeSets('tpl-adopt');

    const { session_id } = await startSessionFromTemplate(db, {
      template_id: 'tpl-adopt',
      uuid: () => 'MINTED-SHOULD-NOT-APPEAR',
      now: () => 1_000,
      supplied_id_tree: {
        seIds: ['watch-se-A'],
        setIds: [['watch-set-0', 'watch-set-1', 'watch-set-2']],
      },
    });

    const seIds = await fetchSessionExerciseIds(db, session_id);
    expect(seIds).toEqual(['watch-se-A']);

    const sets = await fetchSessionSets(db, session_id);
    expect(sets.map((s) => s.id)).toEqual([
      'watch-set-0',
      'watch-set-1',
      'watch-set-2',
    ]);
    // Every set links to the ADOPTED session_exercise id.
    for (const s of sets) {
      expect(s.session_exercise_id).toBe('watch-se-A');
      expect(s.id).not.toContain('MINTED');
    }
  });

  it('mints its own ids when no idTree is supplied (unchanged legacy path)', async () => {
    await seedOneExerciseThreeSets('tpl-legacy');

    let n = 0;
    const { session_id } = await startSessionFromTemplate(db, {
      template_id: 'tpl-legacy',
      uuid: () => `mint-${++n}`,
      now: () => 1_000,
      // supplied_id_tree omitted
    });

    const sets = await fetchSessionSets(db, session_id);
    expect(sets).toHaveLength(3);
    for (const s of sets) {
      expect(s.id).toMatch(/^mint-/);
    }
  });

  it('falls back to minting for positions without a supplied (or empty) id — no throw on count mismatch', async () => {
    await seedOneExerciseThreeSets('tpl-partial');

    let n = 0;
    const { session_id } = await startSessionFromTemplate(db, {
      template_id: 'tpl-partial',
      uuid: () => `mint-${++n}`,
      now: () => 1_000,
      supplied_id_tree: {
        seIds: ['watch-se-A'],
        // Only the first set has a supplied id; second is empty string
        // (falsy → mint); third is missing entirely (undefined → mint).
        setIds: [['watch-set-0', '']],
      },
    });

    const sets = await fetchSessionSets(db, session_id);
    expect(sets).toHaveLength(3);
    expect(sets[0].id).toBe('watch-set-0');
    expect(sets[1].id).toMatch(/^mint-/); // empty string → minted
    expect(sets[2].id).toMatch(/^mint-/); // missing → minted
    // All still linked to the adopted SE id.
    for (const s of sets) expect(s.session_exercise_id).toBe('watch-se-A');
  });

  it('tolerates a malformed idTree missing setIds — adopts seIds, mints sets, never throws (audit A🟡-1)', async () => {
    await seedOneExerciseThreeSets('tpl-malformed');

    let n = 0;
    // The wire is an untrusted boundary (`isWCEnvelope` is shallow): a
    // malformed / future-version sender could ship `idTree: { seIds }` with
    // no `setIds` key at all. Pre-fix this TypeError'd
    // (`undefined[i]`) inside `onStartFromWatch`'s catch → session silently
    // never created and no reverse-TUI 'created'. Post-fix it must degrade
    // to the legacy mint path for sets while still adopting the se ids.
    const { session_id } = await startSessionFromTemplate(db, {
      template_id: 'tpl-malformed',
      uuid: () => `mint-${++n}`,
      now: () => 1_000,
      supplied_id_tree: {
        seIds: ['watch-se-A'],
        // setIds intentionally absent — malformed wire shape.
      } as { seIds: string[]; setIds: string[][] },
    });

    const seIds = await fetchSessionExerciseIds(db, session_id);
    expect(seIds).toEqual(['watch-se-A']);

    const sets = await fetchSessionSets(db, session_id);
    expect(sets).toHaveLength(3);
    for (const s of sets) {
      expect(s.id).toMatch(/^mint-/); // no setIds → all minted
      expect(s.session_exercise_id).toBe('watch-se-A');
    }
  });

  it('remaps a dropset follower parent_set_id onto the ADOPTED head id', async () => {
    const exercises = await listExercises(db);
    const bench = exercises.find((e) => e.name === 'Bench Press')!;
    let n = 0;
    const uuid = () => `tpl-uuid-${++n}`;
    await createTemplate(db, { id: 'tpl-drop', name: 'Drop', now: () => 100 });
    const { id: teId } = await addTemplateExercise(db, {
      template_id: 'tpl-drop',
      exercise_id: bench.id,
      default_sets: 0,
      default_reps: 0,
      default_weight_kg: 0,
      uuid,
      now: () => 100,
    });
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight, parent_set_id)
       VALUES (?, ?, ?, 'working', ?, ?, NULL)`,
      'tpl-head',
      teId,
      0,
      8,
      80,
    );
    await db.runAsync(
      `INSERT INTO template_set (id, template_exercise_id, position, set_kind, reps, weight, parent_set_id)
       VALUES (?, ?, ?, 'dropset', ?, ?, ?)`,
      'tpl-follower',
      teId,
      1,
      6,
      70,
      'tpl-head',
    );

    const { session_id } = await startSessionFromTemplate(db, {
      template_id: 'tpl-drop',
      uuid: () => 'MINTED-SHOULD-NOT-APPEAR',
      now: () => 1_000,
      supplied_id_tree: {
        seIds: ['watch-se-A'],
        setIds: [['watch-head', 'watch-follower']],
      },
    });

    const sets = await fetchSessionSets(db, session_id);
    const head = sets.find((s) => s.set_kind === 'working')!;
    const follower = sets.find((s) => s.set_kind === 'dropset')!;
    expect(head.id).toBe('watch-head');
    expect(head.parent_set_id).toBeNull();
    // Follower points at the ADOPTED head id, not the template id nor a mint.
    expect(follower.id).toBe('watch-follower');
    expect(follower.parent_set_id).toBe('watch-head');
  });

  it('snapshotForSession remaps an exercise parent_id onto the ADOPTED se id (superset)', () => {
    const snaps = snapshotForSession({
      template: {
        id: 'tpl',
        name: 'Superset',
        exercises: [
          {
            id: 'te-A',
            exercise_id: 'ex-1',
            ordering: 1,
            default_sets: 3,
            default_reps: 8,
            default_weight_kg: 50,
            is_evergreen: 0,
            parent_id: null,
            reusable_superset_id: 'rs-1',
            rest_sec: null,
          },
          {
            id: 'te-B',
            exercise_id: 'ex-2',
            ordering: 2,
            default_sets: 3,
            default_reps: 8,
            default_weight_kg: 40,
            is_evergreen: 0,
            parent_id: 'te-A',
            reusable_superset_id: 'rs-1',
            rest_sec: null,
          },
        ],
      },
      session_id: 'sess-1',
      uuid: () => 'MINTED-SHOULD-NOT-APPEAR',
      suppliedIds: ['watch-se-A', 'watch-se-B'],
    });

    expect(snaps.map((s) => s.id)).toEqual(['watch-se-A', 'watch-se-B']);
    // The B-side child's parent_id resolves to the ADOPTED A id, not a mint.
    expect(snaps[1].parent_id).toBe('watch-se-A');
  });

  // ---- audit A-1 (2026-07-05): malformed idTree with DUPLICATE / COLLIDING
  // supplied ids must never raise a UNIQUE violation on INSERT. Pre-fix each of
  // these threw inside `startSessionFromTemplate` (the raw INSERT hit a dup
  // TEXT PRIMARY KEY), which bubbled into `onStartFromWatch`'s catch → session
  // silently never created + no reverse-TUI 'created'. Post-fix `dedupeSupplied
  // Ids` keeps the FIRST occurrence verbatim and mints the rest. ----

  it('dedupes duplicate supplied set ids within one exercise — first wins, rest minted, no UNIQUE throw (audit A-1)', async () => {
    await seedOneExerciseThreeSets('tpl-a1-dupset');
    let n = 0;
    const { session_id } = await startSessionFromTemplate(db, {
      template_id: 'tpl-a1-dupset',
      uuid: () => `mint-${++n}`,
      now: () => 1_000,
      supplied_id_tree: {
        seIds: ['watch-se-A'],
        // Two positions carry the SAME set id — the constructible malformed case.
        setIds: [['dup-set', 'dup-set', 'watch-set-2']],
      },
    });

    const sets = await fetchSessionSets(db, session_id);
    expect(sets).toHaveLength(3); // session created, not silently dropped
    const ids = sets.map((s) => s.id);
    expect(ids).toContain('dup-set'); // first occurrence adopted verbatim
    expect(ids).toContain('watch-set-2');
    expect(ids.filter((id) => id === 'dup-set')).toHaveLength(1); // no dup PK
    expect(ids.filter((id) => id.startsWith('mint-'))).toHaveLength(1); // 2nd minted
    for (const s of sets) expect(s.session_exercise_id).toBe('watch-se-A');
  });

  it('dedupes duplicate supplied session_exercise ids across exercises — first wins, rest minted (audit A-1)', async () => {
    await seedTwoExercisesTwoSetsEach('tpl-a1-dupse');
    let n = 0;
    const { session_id } = await startSessionFromTemplate(db, {
      template_id: 'tpl-a1-dupse',
      uuid: () => `mint-${++n}`,
      now: () => 1_000,
      supplied_id_tree: {
        seIds: ['dup-se', 'dup-se'], // both exercises claim the same se id
        setIds: [
          ['se0-set0', 'se0-set1'],
          ['se1-set0', 'se1-set1'],
        ],
      },
    });

    const seIds = await fetchSessionExerciseIds(db, session_id);
    expect(seIds).toHaveLength(2);
    expect(seIds.filter((id) => id === 'dup-se')).toHaveLength(1); // no dup PK
    expect(seIds.filter((id) => id.startsWith('mint-'))).toHaveLength(1);
    // All four sets landed (both exercises kept a valid, distinct se id).
    const sets = await fetchSessionSets(db, session_id);
    expect(sets).toHaveLength(4);
  });

  it('dedupes a supplied set id that collides across two exercises — global set PK, first wins (audit A-1)', async () => {
    await seedTwoExercisesTwoSetsEach('tpl-a1-crossset');
    let n = 0;
    const { session_id } = await startSessionFromTemplate(db, {
      template_id: 'tpl-a1-crossset',
      uuid: () => `mint-${++n}`,
      now: () => 1_000,
      supplied_id_tree: {
        seIds: ['se-A', 'se-B'],
        setIds: [
          ['shared-set', 'se0-set1'],
          ['shared-set', 'se1-set1'], // same id as exercise 0's first set
        ],
      },
    });

    const sets = await fetchSessionSets(db, session_id);
    expect(sets).toHaveLength(4); // session created, not silently dropped
    const ids = sets.map((s) => s.id);
    expect(ids.filter((id) => id === 'shared-set')).toHaveLength(1); // no dup PK
    expect(ids.filter((id) => id.startsWith('mint-'))).toHaveLength(1); // collision minted
  });
});
