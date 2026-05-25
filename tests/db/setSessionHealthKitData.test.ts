import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  endSession,
  setSessionHealthKitData,
} from '../../src/adapters/sqlite/sessionRepository';

/**
 * Slice 13c C3 — setSessionHealthKitData persistence tests.
 *
 * After finish flow runs HK reader (active energy aggregate) + writer
 * (saveTrainingLogWorkout), it persists kcal + workout uuid back to the
 * session row via setSessionHealthKitData. Both fields are nullable —
 * Q8 best-effort means a HK failure passes null for that column.
 *
 * What's covered:
 *   - Both values persist roundtrip (happy path)
 *   - kcal=null + uuid=null silent skip (HK denied / writer failed)
 *   - kcal only (writer failed but reader succeeded — uuid=null)
 *   - uuid only (reader failed but writer succeeded — kcal=null)
 *   - Overwrite semantics (second call replaces both columns;
 *     defensive even though finish flow only fires once per session)
 */

describe('Slice 13c C3 — setSessionHealthKitData', () => {
  let db: BetterSqliteDatabase;
  const sessionId = 'sess-13c-hk';
  const startedAt = 1700000000000;
  const endedAt = 1700000300000; // 5 min session

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    await db.runAsync(
      `INSERT INTO session (id, started_at) VALUES (?, ?)`,
      sessionId,
      startedAt,
    );
    await endSession(db, { id: sessionId, ended_at: endedAt });
  });

  afterEach(() => {
    db.close();
  });

  async function readHKColumns() {
    return db.getFirstAsync<{
      kcal: number | null;
      healthkit_workout_uuid: string | null;
    }>(
      `SELECT kcal, healthkit_workout_uuid FROM session WHERE id = ?`,
      sessionId,
    );
  }

  it('persists kcal + uuid roundtrip on happy path', async () => {
    await setSessionHealthKitData(db, {
      id: sessionId,
      kcal: 497,
      healthkit_workout_uuid: 'HK-UUID-ABC',
    });
    const row = await readHKColumns();
    expect(row?.kcal).toBe(497);
    expect(row?.healthkit_workout_uuid).toBe('HK-UUID-ABC');
  });

  it('persists nulls when both reader+writer failed (Q8 best-effort)', async () => {
    await setSessionHealthKitData(db, {
      id: sessionId,
      kcal: null,
      healthkit_workout_uuid: null,
    });
    const row = await readHKColumns();
    expect(row?.kcal).toBeNull();
    expect(row?.healthkit_workout_uuid).toBeNull();
  });

  it('persists kcal only when writer failed but reader succeeded', async () => {
    await setSessionHealthKitData(db, {
      id: sessionId,
      kcal: 300,
      healthkit_workout_uuid: null,
    });
    const row = await readHKColumns();
    expect(row?.kcal).toBe(300);
    expect(row?.healthkit_workout_uuid).toBeNull();
  });

  it('persists uuid only when reader failed but writer succeeded', async () => {
    await setSessionHealthKitData(db, {
      id: sessionId,
      kcal: null,
      healthkit_workout_uuid: 'HK-UUID-XYZ',
    });
    const row = await readHKColumns();
    expect(row?.kcal).toBeNull();
    expect(row?.healthkit_workout_uuid).toBe('HK-UUID-XYZ');
  });

  it('second call overwrites both columns', async () => {
    await setSessionHealthKitData(db, {
      id: sessionId,
      kcal: 100,
      healthkit_workout_uuid: 'FIRST',
    });
    await setSessionHealthKitData(db, {
      id: sessionId,
      kcal: 200,
      healthkit_workout_uuid: 'SECOND',
    });
    const row = await readHKColumns();
    expect(row?.kcal).toBe(200);
    expect(row?.healthkit_workout_uuid).toBe('SECOND');
  });

  it('handles fractional kcal precision (REAL column)', async () => {
    await setSessionHealthKitData(db, {
      id: sessionId,
      kcal: 247.83,
      healthkit_workout_uuid: 'HK-FRAC',
    });
    const row = await readHKColumns();
    expect(row?.kcal).toBeCloseTo(247.83, 2);
  });
});
