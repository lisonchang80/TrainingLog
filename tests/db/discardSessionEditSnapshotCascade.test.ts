import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import { discardSession } from '../../src/adapters/sqlite/sessionRepository';
import {
  getSetting,
  setSetting,
} from '../../src/adapters/sqlite/settingsRepository';
import { editSnapshotKey } from '../../src/domain/session/editSnapshotPersistence';

/**
 * Card 12R / Round G Q2b cascade — `discardSession` 等於「該 session
 * 從未發生」，因此 `session_edit_snapshot_${id}` 也應同步消失，避免下次有
 * 同 id 的 session 重生（極罕見、但 id 衝突仍可能）或 orphan setting row
 * 殘留在 app_settings。
 *
 * 這 test 不關心 unlock back-refs，只驗 snapshot row 的 cascade 行為。
 */
describe('discardSession × edit-mode snapshot cascade', () => {
  let db: BetterSqliteDatabase;
  const sessionId = 'sess-12r-cascade';
  const otherSessionId = 'sess-other-12r';

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES (?, ?)`,
      sessionId,
      Date.now(),
    );
    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES (?, ?)`,
      otherSessionId,
      Date.now(),
    );
  });

  test('cascade deletes session_edit_snapshot row for the discarded session', async () => {
    await setSetting(db, editSnapshotKey(sessionId), {
      snap: {
        session: { id: sessionId, started_at: 1, ended_at: null },
        sessionExercises: [],
        sets: [],
        achievementUnlocks: [],
      },
      savedAt: Date.now(),
    });
    expect(await getSetting(db, editSnapshotKey(sessionId))).not.toBeNull();

    await discardSession(db, sessionId);

    expect(await getSetting(db, editSnapshotKey(sessionId))).toBeNull();
  });

  test('does NOT touch snapshots for OTHER sessions (key isolation)', async () => {
    const otherStored = {
      snap: {
        session: { id: otherSessionId, started_at: 2, ended_at: null },
        sessionExercises: [],
        sets: [],
        achievementUnlocks: [],
      },
      savedAt: Date.now(),
    };
    await setSetting(db, editSnapshotKey(otherSessionId), otherStored);

    await discardSession(db, sessionId);

    const stillThere = await getSetting(db, editSnapshotKey(otherSessionId));
    expect(stillThere).toEqual(otherStored);
  });

  test('no snapshot row → discardSession still succeeds (idempotent DELETE)', async () => {
    // No setSetting call — confirms the cascade DELETE is a no-op when
    // nothing was persisted (the common path: session that was never
    // edited at all).
    await expect(discardSession(db, sessionId)).resolves.not.toThrow();
    expect(await getSetting(db, editSnapshotKey(sessionId))).toBeNull();
  });
});
