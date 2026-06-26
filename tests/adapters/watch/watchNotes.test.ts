import { BetterSqliteDatabase } from '../../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../../src/db/migrate';
import { listExercises } from '../../../src/adapters/sqlite/exerciseRepository';
import { updateExerciseNotes } from '../../../src/adapters/sqlite/exerciseLibraryRepository';
import { makeEnvelope } from '../../../src/adapters/watch/payloadSchema';
import {
  onNotesRequest,
  type WatchNotesReplyPayload,
} from '../../../src/adapters/watch/watchNotes';
import type { Database } from '../../../src/db/types';

describe('onNotesRequest (Goal 3a)', () => {
  let db: BetterSqliteDatabase;
  let benchId: string;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    benchId = (await listExercises(db)).find((e) => e.name === 'Bench Press')!.id;
    await updateExerciseNotes(db, benchId, '胸口下沿啟動，手肘 45 度。');
  });

  afterEach(() => db.close());

  function envFor(exerciseId: string, requestId = 'req-1') {
    return makeEnvelope('notes-request', { requestId, exerciseId });
  }

  it('replies ok:true with the exercise note for an exercise that has one', async () => {
    let reply: WatchNotesReplyPayload | undefined;
    await onNotesRequest(db, envFor(benchId), (r) => {
      reply = r as unknown as WatchNotesReplyPayload;
    });
    expect(reply).toBeDefined();
    expect(reply!.ok).toBe(true);
    expect(reply!.requestId).toBe('req-1');
    expect(reply!.exerciseId).toBe(benchId);
    expect(reply!.notes).toBe('胸口下沿啟動，手肘 45 度。');
  });

  it("replies ok:true with notes:'' (never null) for an exercise with no note", async () => {
    const other = (await listExercises(db)).find((e) => e.id !== benchId)!.id;
    let reply: WatchNotesReplyPayload | undefined;
    await onNotesRequest(db, envFor(other, 'req-2'), (r) => {
      reply = r as unknown as WatchNotesReplyPayload;
    });
    expect(reply!.ok).toBe(true);
    expect(reply!.exerciseId).toBe(other);
    // '' on the wire — NSNull would make WCSession reject the plist reply.
    expect(reply!.notes).toBe('');
  });

  it('silently drops when no replyHandler (non-realtime channel)', async () => {
    await expect(
      onNotesRequest(db, envFor(benchId), undefined),
    ).resolves.toBeUndefined();
  });

  it('replies ok:false (not a misleading empty) when the DB read throws', async () => {
    const throwingDb = {
      getFirstAsync: async () => {
        throw new Error('boom');
      },
    } as unknown as Database;
    let reply: WatchNotesReplyPayload | undefined;
    await onNotesRequest(throwingDb, envFor(benchId, 'req-3'), (r) => {
      reply = r as unknown as WatchNotesReplyPayload;
    });
    expect(reply!.ok).toBe(false);
    expect(reply!.requestId).toBe('req-3');
    expect(reply!.notes).toBe('');
  });
});
