import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  appendSessionExercise,
  createSession,
} from '../../src/adapters/sqlite/sessionRepository';
import { insertSessionSet } from '../../src/adapters/sqlite/setRepository';
import {
  buildLiveMirrorPayload,
  setLiveMirrorEpoch,
  __resetLiveMirrorProducerForTests,
} from '../../src/services/iphoneLiveMirrorProducer';
import type { Database } from '../../src/db/types';

/**
 * ADR-0028 edit-lock epoch stamping for the iPhone→Watch live-mirror producer
 * (`src/services/iphoneLiveMirrorProducer.ts`).
 *
 * The base suite (`iphoneLiveMirrorProducer.test.ts`) never calls
 * `setLiveMirrorEpoch`, so the `epoch > 0 ? { epoch } : {}` stamp branch and the
 * `setLiveMirrorEpoch` / `epochFor` accessors were uncovered. These pin the
 * ADR-0028 contract: a non-cast (epoch 0) session OMITS the `epoch` key (byte-
 * compat pre-lock shape); a paired session stamps the current token epoch so the
 * Watch lock machine can arbitrate (apply at ==, demote at >, drop at <).
 */

const BENCH = '00000000-0000-4000-8000-000000000001';

async function seedSession(db: Database, sessionId: string): Promise<void> {
  await createSession(db, {
    id: sessionId,
    started_at: 1_700_000_000_000,
    title: 'Push Day',
  });
  await appendSessionExercise(db, {
    id: `${sessionId}-se-1`,
    session_id: sessionId,
    exercise_id: BENCH,
  });
  await insertSessionSet(db, {
    id: `${sessionId}-set-1`,
    session_id: sessionId,
    exercise_id: BENCH,
    weight_kg: 100,
    reps: 5,
    is_skipped: 0,
    ordering: 1,
    created_at: 1_700_000_000_001,
    set_kind: 'working',
    parent_set_id: null,
    session_exercise_id: `${sessionId}-se-1`,
  });
}

async function makeDb(): Promise<Database> {
  const db = new BetterSqliteDatabase(':memory:');
  await migrate(db);
  return db;
}

afterEach(() => {
  __resetLiveMirrorProducerForTests();
  // The reset helper does NOT clear lockEpoch (it's a separate Map); reset it
  // back to "unpaired" explicitly so cross-test state can't leak the stamp.
  setLiveMirrorEpoch('sess-epoch', 0);
  setLiveMirrorEpoch('sess-noepoch', 0);
});

describe('iphoneLiveMirrorProducer — ADR-0028 epoch stamping', () => {
  it('OMITS the epoch key for a non-cast session (epoch 0 / unpaired)', async () => {
    const db = await makeDb();
    await seedSession(db, 'sess-noepoch');

    const payload = await buildLiveMirrorPayload(db, 'sess-noepoch');
    expect(payload).not.toBeNull();
    // Pre-lock byte-compat: no `epoch` field at all (not `epoch: 0`).
    expect(payload as object).not.toHaveProperty('epoch');
  });

  it('STAMPS the current token epoch once a session is paired (epoch > 0)', async () => {
    const db = await makeDb();
    await seedSession(db, 'sess-epoch');

    setLiveMirrorEpoch('sess-epoch', 7);
    const payload = await buildLiveMirrorPayload(db, 'sess-epoch');

    expect(payload).not.toBeNull();
    expect((payload as { epoch?: number }).epoch).toBe(7);
  });

  it('reflects the LATEST epoch after a re-pair (epoch change is picked up)', async () => {
    const db = await makeDb();
    await seedSession(db, 'sess-epoch');

    setLiveMirrorEpoch('sess-epoch', 3);
    const first = await buildLiveMirrorPayload(db, 'sess-epoch');
    expect((first as { epoch?: number }).epoch).toBe(3);

    // A new lock token bumps the epoch — the next projection carries the new one.
    setLiveMirrorEpoch('sess-epoch', 9);
    const second = await buildLiveMirrorPayload(db, 'sess-epoch');
    expect((second as { epoch?: number }).epoch).toBe(9);
  });

  it('a session reset back to epoch 0 drops the stamp again (unpair)', async () => {
    const db = await makeDb();
    await seedSession(db, 'sess-epoch');

    setLiveMirrorEpoch('sess-epoch', 5);
    const paired = await buildLiveMirrorPayload(db, 'sess-epoch');
    expect((paired as { epoch?: number }).epoch).toBe(5);

    setLiveMirrorEpoch('sess-epoch', 0);
    const unpaired = await buildLiveMirrorPayload(db, 'sess-epoch');
    expect(unpaired as object).not.toHaveProperty('epoch');
  });

  it('epoch is per-session (one session paired does not stamp another)', async () => {
    const db = await makeDb();
    await seedSession(db, 'sess-epoch');
    await seedSession(db, 'sess-noepoch');

    setLiveMirrorEpoch('sess-epoch', 4);

    const paired = await buildLiveMirrorPayload(db, 'sess-epoch');
    const other = await buildLiveMirrorPayload(db, 'sess-noepoch');

    expect((paired as { epoch?: number }).epoch).toBe(4);
    expect(other as object).not.toHaveProperty('epoch');
  });
});
