/**
 * Slice 13d D32 — watchLiveMirrorReceiver.ts orchestrator tests.
 *
 * Per ADR-0019 § Slice 13d NEW-Q50 Q6. The orchestrator validates an
 * inbound applicationContext object then delegates to `replaceLiveMirror`
 * (snapshot-replace — the deleted D19 6-kind reducer + D20 LWW are gone;
 * the channel's latest-state-wins semantics ARE the conflict resolution).
 *
 * Coverage:
 *   - happy path — a set mutation snapshot mirrors to iPhone SQLite
 *   - conflict/latest-state-wins — a newer snapshot for the same row
 *     overwrites the stale value (replaces the deleted LWW step: the
 *     most-recent applicationContext is authoritative)
 *   - bad-payload guard — malformed payloads rejected, DB untouched
 *   - idempotency — same applicationContext applied twice = no double-apply
 *     (row counts stable, values identical)
 *   - parse unit cases — direct `parseLiveMirrorSnapshot` boundary checks
 *
 * No WC bridge mocking — the orchestrator takes the raw object directly
 * (the bridge dispatch is owned + tested in connectivity.test.ts). Real
 * SQLite in-memory via better-sqlite3 fixture, same as replaceLiveMirror.
 */

import { BetterSqliteDatabase } from '../../src/adapters/sqlite/betterSqliteDatabase';
import { migrate } from '../../src/db/migrate';
import {
  onLiveMirror,
  parseLiveMirrorSnapshot,
} from '../../src/services/watchLiveMirrorReceiver';
import type { SessionSnapshot } from '../../src/adapters/watch';

const BUILTIN_BENCH_PRESS_ID = '00000000-0000-4000-8000-000000000001';

/** A valid SessionSnapshot — the shape the Watch pushes via
 *  applicationContext. Built as a plain object so tests can also feed it
 *  through the runtime validator unchanged. */
function snapshot(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    sessionId: 'sess-1',
    title: 'Push Day',
    startedAt: 1_700_000_000_000,
    exercises: [
      {
        sessionExerciseId: 'se-1',
        exerciseId: BUILTIN_BENCH_PRESS_ID,
        exerciseName: 'Bench Press',
        ordering: 0,
        plannedSets: 3,
        sets: [
          {
            setId: 'set-1',
            ordinal: 0,
            weight: 80,
            reps: 8,
            rpe: null,
            rest_sec: 90,
            notes: null,
            set_kind: 'working',
            is_logged: true,
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('Slice 13d D32 — onLiveMirror orchestrator', () => {
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it('happy path — set mutation snapshot mirrors to iPhone SQLite', async () => {
    const result = await onLiveMirror(db, snapshot());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sessionId).toBe('sess-1');
      expect(result.exerciseCount).toBe(1);
      expect(result.setCount).toBe(1);
    }

    const session = await db.getFirstAsync<{ title: string }>(
      'SELECT title FROM session WHERE id = ?',
      'sess-1',
    );
    expect(session?.title).toBe('Push Day');

    const set = await db.getFirstAsync<{
      weight_kg: number;
      reps: number;
      is_logged: number;
    }>(
      'SELECT weight_kg, reps, is_logged FROM "set" WHERE id = ?',
      'set-1',
    );
    expect(set).toEqual({ weight_kg: 80, reps: 8, is_logged: 1 });
  });

  it('latest-state-wins — newer snapshot overwrites the stale value (replaces deleted LWW)', async () => {
    await onLiveMirror(db, snapshot());

    // A later applicationContext for the SAME set carries a mutated
    // weight. Per Q6 the iPhone unconditionally adopts the latest — no
    // per-field LWW reconcile (that lives in Watch in-memory now).
    const newer = snapshot({
      exercises: [
        {
          sessionExerciseId: 'se-1',
          exerciseId: BUILTIN_BENCH_PRESS_ID,
          exerciseName: 'Bench Press',
          ordering: 0,
          plannedSets: 3,
          sets: [
            {
              setId: 'set-1',
              ordinal: 0,
              weight: 90, // mutated 80 → 90
              reps: 6, // mutated 8 → 6
              rpe: null,
              rest_sec: 90,
              notes: 'top set',
              set_kind: 'working',
              is_logged: true,
            },
          ],
        },
      ],
    });
    const result = await onLiveMirror(db, newer);
    expect(result.ok).toBe(true);

    const set = await db.getFirstAsync<{
      weight_kg: number;
      reps: number;
      notes: string | null;
    }>(
      'SELECT weight_kg, reps, notes FROM "set" WHERE id = ?',
      'set-1',
    );
    expect(set).toEqual({ weight_kg: 90, reps: 6, notes: 'top set' });

    // No row duplication — still exactly one set row.
    const count = await db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM "set"',
    );
    expect(count?.n).toBe(1);
  });

  it('idempotency — same applicationContext applied twice does not double-apply', async () => {
    const ctx = snapshot();
    const first = await onLiveMirror(db, ctx);
    const second = await onLiveMirror(db, ctx);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    const sessionCount = await db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM session',
    );
    const exerciseCount = await db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM session_exercise',
    );
    const setCount = await db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM "set"',
    );
    expect(sessionCount?.n).toBe(1);
    expect(exerciseCount?.n).toBe(1);
    expect(setCount?.n).toBe(1);
  });

  it('bad-payload guard — non-object rejected, db untouched', async () => {
    const result = await onLiveMirror(db, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad-payload');

    const count = await db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM session',
    );
    expect(count?.n).toBe(0);
  });

  it('bad-payload guard — missing sessionId rejected, db untouched', async () => {
    const { sessionId, ...rest } = snapshot();
    void sessionId;
    const result = await onLiveMirror(db, rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad-payload');

    const count = await db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM session',
    );
    expect(count?.n).toBe(0);
  });

  it('bad-payload guard — malformed nested set rejected (whole snapshot dropped)', async () => {
    const malformed = {
      ...snapshot(),
      exercises: [
        {
          sessionExerciseId: 'se-1',
          exerciseId: BUILTIN_BENCH_PRESS_ID,
          exerciseName: 'Bench Press',
          ordering: 0,
          plannedSets: 3,
          sets: [{ setId: 'set-1' /* missing required fields */ }],
        },
      ],
    };
    const result = await onLiveMirror(db, malformed);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bad-payload');

    const count = await db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM session',
    );
    expect(count?.n).toBe(0);
  });

  it('empty exercises — snapshot still mirrors the session row', async () => {
    const result = await onLiveMirror(db, snapshot({ exercises: [] }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.exerciseCount).toBe(0);
      expect(result.setCount).toBe(0);
    }

    const session = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM session WHERE id = ?',
      'sess-1',
    );
    expect(session).not.toBeNull();
  });

  it('never throws — db-error surfaces as structured result, not an exception', async () => {
    // Close the db so replaceLiveMirror's transaction fails. The
    // orchestrator must convert the throw into {ok:false, code:'db-error'}.
    db.close();
    const result = await onLiveMirror(db, snapshot());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('db-error');

    // Re-open for the afterEach close() (idempotent on betterSqlite).
    db = new BetterSqliteDatabase(':memory:');
  });
});

describe('Slice 13d D32 — parseLiveMirrorSnapshot validator', () => {
  it('accepts a well-formed snapshot', () => {
    const parsed = parseLiveMirrorSnapshot({
      sessionId: 'sess-1',
      title: '',
      startedAt: 1_700_000_000_000,
      exercises: [],
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.sessionId).toBe('sess-1');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['array', []],
    ['string', 'nope'],
    ['empty sessionId', { sessionId: '', title: '', startedAt: 1, exercises: [] }],
    ['non-number startedAt', { sessionId: 's', title: '', startedAt: 'x', exercises: [] }],
    ['NaN startedAt', { sessionId: 's', title: '', startedAt: NaN, exercises: [] }],
    ['non-array exercises', { sessionId: 's', title: '', startedAt: 1, exercises: {} }],
    ['non-string title', { sessionId: 's', title: 5, startedAt: 1, exercises: [] }],
  ])('rejects %s', (_label, input) => {
    expect(parseLiveMirrorSnapshot(input)).toBeNull();
  });

  it('rejects an invalid set_kind', () => {
    const parsed = parseLiveMirrorSnapshot({
      sessionId: 's',
      title: '',
      startedAt: 1,
      exercises: [
        {
          sessionExerciseId: 'se',
          exerciseId: 'ex',
          exerciseName: 'X',
          ordering: 0,
          plannedSets: 1,
          sets: [
            {
              setId: 'set',
              ordinal: 0,
              weight: null,
              reps: null,
              rpe: null,
              rest_sec: null,
              notes: null,
              set_kind: 'bogus',
              is_logged: false,
            },
          ],
        },
      ],
    });
    expect(parsed).toBeNull();
  });

  it('accepts nullable numeric set fields (weight/reps/rpe/rest_sec null)', () => {
    const parsed = parseLiveMirrorSnapshot({
      sessionId: 's',
      title: 't',
      startedAt: 1,
      exercises: [
        {
          sessionExerciseId: 'se',
          exerciseId: 'ex',
          exerciseName: 'X',
          ordering: 0,
          plannedSets: 1,
          sets: [
            {
              setId: 'set',
              ordinal: 0,
              weight: null,
              reps: null,
              rpe: null,
              rest_sec: null,
              notes: null,
              set_kind: 'warmup',
              is_logged: false,
            },
          ],
        },
      ],
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.exercises[0]?.sets[0]?.weight).toBeNull();
  });
});

describe('Slice 13d D29 — parser tolerates WC-omitted nil optionals (absent → null)', () => {
  // The D29 Watch producer encodes via Swift JSONEncoder, which OMITS nil
  // optionals (WC applicationContext is plist-based and cannot carry JSON
  // null). So the five nullable set fields arrive ABSENT — the parser must
  // normalise absent → null. Required fields stay strict.
  function snapWithSet(setExtra: Record<string, unknown>) {
    return {
      sessionId: 's',
      title: 't',
      startedAt: 1,
      exercises: [
        {
          sessionExerciseId: 'se',
          exerciseId: 'ex',
          exerciseName: 'X',
          ordering: 0,
          plannedSets: 1,
          sets: [
            {
              setId: 'set',
              ordinal: 0,
              set_kind: 'working',
              is_logged: false,
              ...setExtra,
            },
          ],
        },
      ],
    };
  }

  it('accepts a set with all five nullable fields ABSENT → coerced to null', () => {
    const parsed = parseLiveMirrorSnapshot(snapWithSet({}));
    expect(parsed).not.toBeNull();
    const s = parsed?.exercises[0]?.sets[0];
    expect(s?.weight).toBeNull();
    expect(s?.reps).toBeNull();
    expect(s?.rpe).toBeNull();
    expect(s?.rest_sec).toBeNull();
    expect(s?.notes).toBeNull();
  });

  it('keeps a present 0 weight/reps as 0 (only null/undefined collapse)', () => {
    const parsed = parseLiveMirrorSnapshot(snapWithSet({ weight: 0, reps: 0 }));
    expect(parsed?.exercises[0]?.sets[0]?.weight).toBe(0);
    expect(parsed?.exercises[0]?.sets[0]?.reps).toBe(0);
  });

  it('still rejects a present-but-malformed optional (string weight)', () => {
    expect(parseLiveMirrorSnapshot(snapWithSet({ weight: '80' }))).toBeNull();
  });

  it('still rejects when a REQUIRED field is absent (ordinal omitted)', () => {
    const bad = snapWithSet({});
    delete (bad.exercises[0].sets[0] as Record<string, unknown>).ordinal;
    expect(parseLiveMirrorSnapshot(bad)).toBeNull();
  });

  it('round-trips a Swift-style payload (logged set, rpe/rest_sec/notes omitted)', () => {
    // Mirrors what LiveMirror.project → JSONEncoder emits for a logged
    // working set whose rpe/rest_sec/notes are nil: those keys absent,
    // weight/reps present, is_logged true.
    const parsed = parseLiveMirrorSnapshot(
      snapWithSet({ weight: 100, reps: 5, is_logged: true }),
    );
    expect(parsed).not.toBeNull();
    const s = parsed?.exercises[0]?.sets[0];
    expect(s?.weight).toBe(100);
    expect(s?.reps).toBe(5);
    expect(s?.is_logged).toBe(true);
    expect(s?.rpe).toBeNull();
    expect(s?.rest_sec).toBeNull();
    expect(s?.notes).toBeNull();
  });
});
