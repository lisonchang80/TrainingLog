import { BetterSqliteDatabase } from '../../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../../src/db/migrate';
import { createSession } from '../../../src/adapters/sqlite/sessionRepository';
import { insertSessionSet } from '../../../src/adapters/sqlite/setRepository';
import { listExercises } from '../../../src/adapters/sqlite/exerciseRepository';
import { makeEnvelope } from '../../../src/adapters/watch/payloadSchema';
import {
  onHistoryRequest,
  type WatchHistoryReplyPayload,
} from '../../../src/adapters/watch/watchHistory';
import type { Database } from '../../../src/db/types';

const ms = (y: number, m: number, d: number) =>
  new Date(y, m - 1, d, 12, 0, 0).getTime();

describe('onHistoryRequest (#311-A)', () => {
  let db: BetterSqliteDatabase;
  let benchId: string;

  async function loggedSet(args: {
    id: string;
    session_id: string;
    ordering: number;
    weight_kg: number | null;
    reps: number | null;
    set_kind: 'warmup' | 'working' | 'dropset';
    created_at: number;
  }): Promise<void> {
    await insertSessionSet(db, {
      id: args.id,
      session_id: args.session_id,
      exercise_id: benchId,
      weight_kg: args.weight_kg,
      reps: args.reps,
      is_skipped: 0,
      ordering: args.ordering,
      created_at: args.created_at,
      set_kind: args.set_kind,
      parent_set_id: null,
      session_exercise_id: null,
    });
    await db.runAsync(`UPDATE "set" SET is_logged = 1 WHERE id = ?`, args.id);
  }

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    const all = await listExercises(db);
    benchId = all.find((e) => e.name === 'Bench Press')!.id;
    // Session A — newest (2026-05-26): 1 warmup + 2 working.
    const tA = ms(2026, 5, 26);
    await createSession(db, { id: 'sessA', started_at: tA });
    await loggedSet({ id: 'a-w', session_id: 'sessA', ordering: 1, weight_kg: 40, reps: 10, set_kind: 'warmup', created_at: tA + 1 });
    await loggedSet({ id: 'a-1', session_id: 'sessA', ordering: 2, weight_kg: 80, reps: 8, set_kind: 'working', created_at: tA + 2 });
    await loggedSet({ id: 'a-2', session_id: 'sessA', ordering: 3, weight_kg: 75, reps: 6, set_kind: 'working', created_at: tA + 3 });
    // Session B — older (2026-05-22): 1 working.
    const tB = ms(2026, 5, 22);
    await createSession(db, { id: 'sessB', started_at: tB });
    await loggedSet({ id: 'b-1', session_id: 'sessB', ordering: 1, weight_kg: 70, reps: 10, set_kind: 'working', created_at: tB + 1 });
  });

  afterEach(() => db.close());

  function envFor(exerciseId: string, requestId = 'req-1') {
    return makeEnvelope('history-request', { requestId, exerciseId });
  }

  it('replies ok:true with newest-first per-session records, warmup excluded', async () => {
    let reply: WatchHistoryReplyPayload | undefined;
    await onHistoryRequest(db, envFor(benchId), (r) => {
      reply = r as unknown as WatchHistoryReplyPayload;
    });
    expect(reply).toBeDefined();
    expect(reply!.ok).toBe(true);
    expect(reply!.requestId).toBe('req-1');
    expect(reply!.exerciseId).toBe(benchId);
    expect(reply!.records).toHaveLength(2);
    // Newest session first; warmup dropped from count + lines.
    expect(reply!.records[0].id).toBe('2026-05-26');
    expect(reply!.records[0].workingSetCount).toBe(2);
    expect(reply!.records[0].setLines).toEqual(['80kg×8', '75kg×6']);
    expect(reply!.records[0].dateLabel).toMatch(/^05-26 \(.+\)$/);
    expect(reply!.records[1].id).toBe('2026-05-22');
    expect(reply!.records[1].setLines).toEqual(['70kg×10']);
  });

  it('replies ok:true with empty records for an exercise with no history', async () => {
    const other = (await listExercises(db)).find((e) => e.id !== benchId)!.id;
    let reply: WatchHistoryReplyPayload | undefined;
    await onHistoryRequest(db, envFor(other, 'req-2'), (r) => {
      reply = r as unknown as WatchHistoryReplyPayload;
    });
    expect(reply!.ok).toBe(true);
    expect(reply!.exerciseId).toBe(other);
    expect(reply!.records).toEqual([]);
  });

  it('silently drops when no replyHandler (non-realtime channel)', async () => {
    // Must not throw; nothing to assert beyond completion.
    await expect(
      onHistoryRequest(db, envFor(benchId), undefined),
    ).resolves.toBeUndefined();
  });

  it('replies ok:false (not a misleading empty) when the DB read throws', async () => {
    const throwingDb = {
      getFirstAsync: async () => {
        throw new Error('boom');
      },
      getAllAsync: async () => {
        throw new Error('boom');
      },
    } as unknown as Database;
    let reply: WatchHistoryReplyPayload | undefined;
    await onHistoryRequest(throwingDb, envFor(benchId, 'req-3'), (r) => {
      reply = r as unknown as WatchHistoryReplyPayload;
    });
    expect(reply!.ok).toBe(false);
    expect(reply!.requestId).toBe('req-3');
    expect(reply!.records).toEqual([]);
  });
});
