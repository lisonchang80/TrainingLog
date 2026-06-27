import { randomUUID } from 'node:crypto';
import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  addSessionDropsetRow,
  insertSessionSet,
  listSetsBySession,
  removeSessionDropsetRow,
} from '../../src/adapters/sqlite/setRepository';
import { sortSetsByDisplayRank } from '../../src/domain/set/sessionSetLayout';

/**
 * `addSessionDropsetRow` + `removeSessionDropsetRow` — slice 10c overnight #61.
 *
 * Wire the `+` and `−` buttons on dropset followers in the active session
 * (Today) and session detail edit mode. Mirror template editor's
 * `addDropsetRow` / `removeDropsetRow` DB-side behaviour.
 *
 * Invariants under test (A1 no-shift, 2026-06-28):
 *   - new follower appends at session-wide MAX(ordering)+1 (NO shift of later
 *     rows); render order ("DIRECTLY below source") is carried by display_rank
 *   - new follower attaches to chain HEAD (parent_set_id = headId regardless
 *     of whether source was head or follower)
 *   - new follower mirrors source weight_kg / reps / set_kind = 'dropset'
 *   - v019: new follower inherits session_exercise_id from source
 *   - remove guard: throws DROPSET_CHAIN_TOO_SHORT when chain would go
 *     below head + 1 follower
 *   - remove rejects HEADs (use deleteSet instead)
 */

describe('addSessionDropsetRow + removeSessionDropsetRow', () => {
  let db: BetterSqliteDatabase;
  const exId = '00000000-0000-4000-8000-000000000001';
  const sessionId = 'sess-dropset';
  const seId = 'se-dropset-1';
  const now = 1700000000000;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES (?, ?)`,
      sessionId,
      now,
    );
  });

  afterEach(() => {
    db.close();
  });

  async function insertSet(
    id: string,
    ordering: number,
    weight_kg: number,
    reps: number,
    set_kind: 'warmup' | 'working' | 'dropset' = 'dropset',
    parent_set_id: string | null = null,
    session_exercise_id: string | null = seId,
  ) {
    await insertSessionSet(db, {
      id,
      session_id: sessionId,
      exercise_id: exId,
      weight_kg,
      reps,
      is_skipped: 0,
      ordering,
      created_at: now,
      set_kind,
      parent_set_id,
      session_exercise_id,
    });
  }

  // --- addSessionDropsetRow ---

  it('addSessionDropsetRow: source is HEAD → new row attaches to head, lands directly below', async () => {
    await insertSet('h', 1, 80, 10, 'dropset', null);
    await insertSet('f1', 2, 60, 10, 'dropset', 'h');

    const res = await addSessionDropsetRow(db, {
      session_id: sessionId,
      after_set_id: 'h',
      uuid: randomUUID,
    });

    // A1: appends at MAX(ordering)+1 = 3, NOT src.ordering+1 (which would have
    // shifted f1). Existing ordinals untouched; render order via display_rank.
    expect(res.ordering).toBe(3);
    const rows = await listSetsBySession(db, sessionId);
    const ordById = new Map(rows.map((r) => [r.id, r.ordering] as const));
    expect(ordById.get('h')).toBe(1);
    expect(ordById.get('f1')).toBe(2);
    expect(ordById.get(res.set_id)).toBe(3);
    // Render order (display_rank): h → new → f1.
    expect(sortSetsByDisplayRank(rows).map((r) => r.id)).toEqual(['h', res.set_id, 'f1']);
    const newRow = rows.find((r) => r.id === res.set_id)!;
    expect(newRow.parent_set_id).toBe('h');
    expect(newRow.set_kind).toBe('dropset');
    expect(newRow.weight_kg).toBe(80);
    expect(newRow.reps).toBe(10);
    expect(newRow.session_exercise_id).toBe(seId);
    expect(newRow.is_logged).toBe(0);
  });

  it('addSessionDropsetRow: source is FOLLOWER → new row still attaches to head (flat chain)', async () => {
    await insertSet('h', 1, 80, 10, 'dropset', null);
    await insertSet('f1', 2, 60, 10, 'dropset', 'h');
    await insertSet('f2', 3, 40, 10, 'dropset', 'h');

    const res = await addSessionDropsetRow(db, {
      session_id: sessionId,
      after_set_id: 'f1',
      uuid: randomUUID,
    });

    // A1: appends at MAX(ordering)+1 = 4; f2 keeps ordering 3 (no shift).
    expect(res.ordering).toBe(4);
    const rows = await listSetsBySession(db, sessionId);
    const ordById = new Map(rows.map((r) => [r.id, r.ordering] as const));
    expect(ordById.get('h')).toBe(1);
    expect(ordById.get('f1')).toBe(2);
    expect(ordById.get('f2')).toBe(3);
    expect(ordById.get(res.set_id)).toBe(4);
    // Render order (display_rank): h → f1 → new → f2.
    expect(sortSetsByDisplayRank(rows).map((r) => r.id)).toEqual([
      'h',
      'f1',
      res.set_id,
      'f2',
    ]);
    const newRow = rows.find((r) => r.id === res.set_id)!;
    // KEY: new follower attaches to chain HEAD, not to source f1.
    expect(newRow.parent_set_id).toBe('h');
    expect(newRow.weight_kg).toBe(60);
    expect(newRow.reps).toBe(10);
  });

  it('addSessionDropsetRow: throws when source not in session', async () => {
    await expect(
      addSessionDropsetRow(db, {
        session_id: sessionId,
        after_set_id: 'nonexistent',
        uuid: randomUUID,
      }),
    ).rejects.toThrow(/not found/);
  });

  it('addSessionDropsetRow: throws when source is not a dropset row', async () => {
    await insertSet('w1', 1, 100, 5, 'working', null);
    await expect(
      addSessionDropsetRow(db, {
        session_id: sessionId,
        after_set_id: 'w1',
        uuid: randomUUID,
      }),
    ).rejects.toThrow(/not a dropset row/);
  });

  // --- removeSessionDropsetRow ---

  it('removeSessionDropsetRow: chain head + 2 followers → can remove one follower', async () => {
    await insertSet('h', 1, 80, 10, 'dropset', null);
    await insertSet('f1', 2, 60, 10, 'dropset', 'h');
    await insertSet('f2', 3, 40, 10, 'dropset', 'h');

    await removeSessionDropsetRow(db, {
      session_id: sessionId,
      set_id: 'f2',
    });

    const rows = await listSetsBySession(db, sessionId);
    expect(rows.map((r) => r.id)).toEqual(['h', 'f1']);
  });

  it('removeSessionDropsetRow: chain head + 1 follower → throws DROPSET_CHAIN_TOO_SHORT', async () => {
    await insertSet('h', 1, 80, 10, 'dropset', null);
    await insertSet('f1', 2, 60, 10, 'dropset', 'h');

    await expect(
      removeSessionDropsetRow(db, {
        session_id: sessionId,
        set_id: 'f1',
      }),
    ).rejects.toThrow(/DROPSET_CHAIN_TOO_SHORT/);

    // Sanity — row not deleted.
    const rows = await listSetsBySession(db, sessionId);
    expect(rows).toHaveLength(2);
  });

  it('removeSessionDropsetRow: refuses to delete chain HEAD (caller should use deleteSet)', async () => {
    await insertSet('h', 1, 80, 10, 'dropset', null);
    await insertSet('f1', 2, 60, 10, 'dropset', 'h');
    await insertSet('f2', 3, 40, 10, 'dropset', 'h');

    await expect(
      removeSessionDropsetRow(db, {
        session_id: sessionId,
        set_id: 'h',
      }),
    ).rejects.toThrow(/is a dropset HEAD/);
  });

  it('removeSessionDropsetRow: throws when set is not a dropset row', async () => {
    await insertSet('w1', 1, 100, 5, 'working', null);
    await expect(
      removeSessionDropsetRow(db, {
        session_id: sessionId,
        set_id: 'w1',
      }),
    ).rejects.toThrow(/not a dropset row/);
  });

  it('removeSessionDropsetRow: throws when set is not found in session', async () => {
    await expect(
      removeSessionDropsetRow(db, {
        session_id: sessionId,
        set_id: 'ghost-set',
      }),
    ).rejects.toThrow(/not found/);
  });
});
