import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { getExerciseName } from '../../src/adapters/sqlite/exerciseRepository';

/**
 * Slice 10c overnight #11 — integration-ish smoke for the A↔B switcher's
 * key invariant: when the per-exercise history page receives `partner=<B.id>`
 * via URL (caller side already wires this), the `getExerciseName(db, B.id)`
 * lookup MUST resolve to B's display name. This locks the partner-URL-param
 * round-trip at the repo layer — UI layer is not exercised here (no RN
 * component test infra), but everything above the repo is plumbing only.
 *
 * Fixture: 1 session + cluster pair (se A as parent, se B with parent_id =
 * se A id). Validates the repo helper resolves the partner id from the
 * cluster B's parent_id perspective (the reverse lookup direction users do
 * when they tap the switcher from A → B's page).
 */
describe('cluster A↔B partner lookup — repo round-trip', () => {
  let db: BetterSqliteDatabase;
  const benchId = '00000000-0000-4000-8000-000000000001'; // seed: Bench Press
  const squatId = '00000000-0000-4000-8000-000000000002'; // seed: Back Squat
  const sessionId = 'sess-1';
  const seA_id = 'se-a';
  const seB_id = 'se-b';
  const now = Date.now();

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES (?, ?)`,
      sessionId,
      now
    );
    // session_exercise A (cluster parent) + B (parent_id = A.id). `planned_sets`
    // is NOT NULL — set 0 since this fixture cares only about the pair shape.
    await db.runAsync(
      `INSERT INTO session_exercise (id, session_id, exercise_id, ordering, planned_sets, parent_id)
       VALUES (?, ?, ?, 0, 0, NULL)`,
      seA_id,
      sessionId,
      benchId
    );
    await db.runAsync(
      `INSERT INTO session_exercise (id, session_id, exercise_id, ordering, planned_sets, parent_id)
       VALUES (?, ?, ?, 1, 0, ?)`,
      seB_id,
      sessionId,
      squatId,
      seA_id
    );
  });

  afterEach(() => {
    db.close();
  });

  it('resolves partner (cluster B) name from the cluster A perspective', async () => {
    // Sanity: pair is wired (B.parent_id = A.id, both reference same session)
    const a = await db.getFirstAsync<{ exercise_id: string }>(
      `SELECT exercise_id FROM session_exercise WHERE id = ?`,
      seA_id
    );
    const b = await db.getFirstAsync<{
      exercise_id: string;
      parent_id: string;
    }>(
      `SELECT exercise_id, parent_id FROM session_exercise WHERE id = ?`,
      seB_id
    );
    expect(b?.parent_id).toBe(seA_id);
    expect(a?.exercise_id).toBe(benchId);
    expect(b?.exercise_id).toBe(squatId);

    // Core assertion: given B's exercise_id (passed via `partner=` URL param
    // from a cluster card), the repo helper resolves it to B's display name.
    const partnerName = await getExerciseName(db, squatId);
    expect(partnerName).toBe('Back Squat');

    // Reverse direction also works (from B's page, partner = A.id).
    const otherSide = await getExerciseName(db, benchId);
    expect(otherSide).toBe('Bench Press');
  });
});
