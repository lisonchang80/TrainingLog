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
});
