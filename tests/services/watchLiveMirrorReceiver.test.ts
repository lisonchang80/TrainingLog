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
  __resetLiveMirrorRevForTests,
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

/**
 * Seed a LIVE (un-ended) session row.
 *
 * H1 (2026-06-01): the live mirror no longer CREATES the session row — it
 * requires the row to already exist + be un-ended (the gate in
 * `replaceLiveMirror` → `reconcileSessionTree`). Production's start path
 * (`onStartFromWatch`) always commits the row before any live tick; these
 * tests mirror that by seeding it. Apply-path tests seed; bad-payload tests
 * (which assert `COUNT(session) === 0`) deliberately do NOT.
 */
async function seedLiveSession(
  db: BetterSqliteDatabase,
  id: string,
  startedAt = 1_700_000_000_000,
): Promise<void> {
  await db.runAsync(
    `INSERT OR IGNORE INTO session (id, started_at, title) VALUES (?, ?, '')`,
    id,
    startedAt,
  );
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
    await seedLiveSession(db, 'sess-1'); // H1: start path owns session creation
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
    await seedLiveSession(db, 'sess-1');
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
    await seedLiveSession(db, 'sess-1');
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
    await seedLiveSession(db, 'sess-1');
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

  // ---- Bidirectional sync optional fields (slice 13d sync-refactor) ----

  it('parses rev / originator / deletedIds when present', () => {
    const parsed = parseLiveMirrorSnapshot({
      sessionId: 'sess-1',
      title: '',
      startedAt: 1,
      exercises: [],
      rev: 42,
      originator: 'iphone',
      deletedIds: { exerciseIds: ['se-x'], setIds: ['set-a', 'set-b'] },
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.rev).toBe(42);
    expect(parsed?.originator).toBe('iphone');
    expect(parsed?.deletedIds).toEqual({
      exerciseIds: ['se-x'],
      setIds: ['set-a', 'set-b'],
    });
  });

  it('legacy snapshot WITHOUT the new fields still parses (fields undefined)', () => {
    const parsed = parseLiveMirrorSnapshot({
      sessionId: 'sess-1',
      title: '',
      startedAt: 1,
      exercises: [],
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.rev).toBeUndefined();
    expect(parsed?.originator).toBeUndefined();
    expect(parsed?.deletedIds).toBeUndefined();
  });

  it('tolerates a deletedIds with only one sub-array present (other → empty)', () => {
    const parsed = parseLiveMirrorSnapshot({
      sessionId: 'sess-1',
      title: '',
      startedAt: 1,
      exercises: [],
      deletedIds: { setIds: ['set-a'] },
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.deletedIds).toEqual({ exerciseIds: [], setIds: ['set-a'] });
  });

  it.each([
    ['non-number rev', { rev: 'x' }],
    ['NaN rev', { rev: NaN }],
    ['unknown originator', { originator: 'phone' }],
    ['non-object deletedIds', { deletedIds: 'nope' }],
    ['deletedIds.exerciseIds with a non-string', { deletedIds: { exerciseIds: [1] } }],
    ['deletedIds.setIds with a non-string', { deletedIds: { setIds: [{}] } }],
  ])('rejects a present-but-malformed %s', (_label, extra) => {
    const parsed = parseLiveMirrorSnapshot({
      sessionId: 'sess-1',
      title: '',
      startedAt: 1,
      exercises: [],
      ...extra,
    });
    expect(parsed).toBeNull();
  });

  // ---- S7b ingest contract: chain-complete tombstone guard (2026-06-02) ----
  // A set-id tombstone batch must not orphan a surviving dropset follower. The
  // forward Watch producer can never emit this (deletion = absence-from-`sets`;
  // the Swift wire has no `deletedIds`), so this guards the speculative
  // reverse-lane / backup-merge ingest: a head-only tombstone is rejected
  // fail-closed, forcing producers to send chain-complete batches.
  const chainSnapshot = (deletedSetIds: string[]) => ({
    sessionId: 'sess-1',
    title: '',
    startedAt: 1,
    exercises: [
      {
        sessionExerciseId: 'se-1',
        exerciseId: 'ex-1',
        exerciseName: 'Deadlift',
        ordering: 0,
        plannedSets: 2,
        sets: [
          { setId: 'h7', ordinal: 0, set_kind: 'dropset', is_logged: true },
          {
            setId: 'f7',
            ordinal: 1,
            set_kind: 'dropset',
            is_logged: true,
            parent_set_id: 'h7',
          },
        ],
      },
    ],
    deletedIds: { exerciseIds: [], setIds: deletedSetIds },
  });

  it('S7b — rejects a head-only tombstone that would orphan a surviving follower', () => {
    // h7 (chain head) tombstoned while f7 (parent_set_id=h7) survives in `sets`
    // → applying it would dangle f7.parent_set_id. Fail-closed: whole tick null.
    expect(parseLiveMirrorSnapshot(chainSnapshot(['h7']))).toBeNull();
  });

  it('S7b — allows a chain-COMPLETE tombstone (head + follower together)', () => {
    const parsed = parseLiveMirrorSnapshot(chainSnapshot(['h7', 'f7']));
    expect(parsed).not.toBeNull();
    expect(parsed?.deletedIds).toEqual({ exerciseIds: [], setIds: ['h7', 'f7'] });
  });

  it('S7b — allows tombstoning a follower only (head survives, no orphan)', () => {
    const parsed = parseLiveMirrorSnapshot(chainSnapshot(['f7']));
    expect(parsed).not.toBeNull();
    expect(parsed?.deletedIds).toEqual({ exerciseIds: [], setIds: ['f7'] });
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

  // v025 display_rank (#1/#2, 2026-06-02). Same nullable-optional contract as
  // the other five: absent (legacy Watch build / JSONEncoder nil-omit) → null;
  // present fractional value kept; present-but-malformed → reject.
  it('absent display_rank → null (legacy Watch build)', () => {
    const parsed = parseLiveMirrorSnapshot(snapWithSet({}));
    expect(parsed?.exercises[0]?.sets[0]?.display_rank).toBeNull();
  });

  it('keeps a present fractional display_rank (mid-insert rank)', () => {
    const parsed = parseLiveMirrorSnapshot(snapWithSet({ display_rank: 1.5 }));
    expect(parsed?.exercises[0]?.sets[0]?.display_rank).toBe(1.5);
  });

  it('keeps a present 0 display_rank (only null/undefined collapse)', () => {
    const parsed = parseLiveMirrorSnapshot(snapWithSet({ display_rank: 0 }));
    expect(parsed?.exercises[0]?.sets[0]?.display_rank).toBe(0);
  });

  it('rejects a present-but-malformed display_rank (string)', () => {
    expect(parseLiveMirrorSnapshot(snapWithSet({ display_rank: '1.5' }))).toBeNull();
  });
});

describe('parseLiveMirrorSnapshot — per-field fail-closed guards (whole tick dropped)', () => {
  // The parser is the iPhone-side ingest gate: every type guard that returns
  // null drops the WHOLE tick (→ bad-payload → self-heals on the next
  // snapshot) so `replaceLiveMirror`'s SQL binds can never receive an
  // undefined / wrong-typed value. The forward Watch producer should never
  // emit these, but a corrupt WC frame (or a future reverse-lane producer)
  // must be rejected rather than half-applied. These cover the individual
  // exercise-level and set-level guards the broader happy-path tests skip.

  /** A minimal well-formed snapshot with one exercise + one set. */
  function base(): Record<string, unknown> {
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
              weight: 80,
              reps: 8,
              rpe: null,
              rest_sec: null,
              notes: null,
              set_kind: 'working',
              is_logged: true,
              parent_set_id: null,
            },
          ],
        },
      ],
    };
  }

  /** Mutate exercises[0] then parse. */
  function withEx(patch: Record<string, unknown>): SessionSnapshot | null {
    const snap = base();
    Object.assign((snap.exercises as Record<string, unknown>[])[0], patch);
    return parseLiveMirrorSnapshot(snap);
  }

  /** Mutate exercises[0].sets[0] then parse. */
  function withSet(patch: Record<string, unknown>): SessionSnapshot | null {
    const snap = base();
    const set = (
      (snap.exercises as Record<string, unknown>[])[0].sets as Record<
        string,
        unknown
      >[]
    )[0];
    Object.assign(set, patch);
    return parseLiveMirrorSnapshot(snap);
  }

  it('sanity — base() parses (so every rejection below is the patch, not the shape)', () => {
    expect(parseLiveMirrorSnapshot(base())).not.toBeNull();
  });

  // ---- exercise-level guards ----
  it('rejects a non-object exercise entry', () => {
    const snap = base();
    (snap.exercises as unknown[])[0] = 'nope';
    expect(parseLiveMirrorSnapshot(snap)).toBeNull();
  });

  it.each([
    ['empty sessionExerciseId', { sessionExerciseId: '' }],
    ['non-string sessionExerciseId', { sessionExerciseId: 7 }],
    ['empty exerciseId', { exerciseId: '' }],
    ['non-string exerciseId', { exerciseId: null }],
    ['non-string exerciseName', { exerciseName: 5 }],
    ['non-number ordering', { ordering: 'a' }],
    ['NaN ordering', { ordering: NaN }],
    ['non-number plannedSets', { plannedSets: 'b' }],
    ['NaN plannedSets', { plannedSets: NaN }],
    ['non-array sets', { sets: {} }],
  ])('rejects exercise with %s', (_label, patch) => {
    expect(withEx(patch as Record<string, unknown>)).toBeNull();
  });

  // ---- set-level guards ----
  it('rejects a non-object set entry', () => {
    const snap = base();
    ((snap.exercises as Record<string, unknown>[])[0].sets as unknown[])[0] = 42;
    expect(parseLiveMirrorSnapshot(snap)).toBeNull();
  });

  it.each([
    ['empty setId', { setId: '' }],
    ['non-string setId', { setId: 1 }],
    ['non-number ordinal', { ordinal: 'x' }],
    ['NaN ordinal', { ordinal: NaN }],
    ['malformed reps (string)', { reps: '8' }],
    ['malformed rpe (string)', { rpe: '9' }],
    ['malformed rest_sec (string)', { rest_sec: '90' }],
    ['Infinity weight', { weight: Infinity }],
    ['non-string non-null notes (number)', { notes: 5 }],
    ['non-string non-null parent_set_id (number)', { parent_set_id: 7 }],
    ['non-boolean is_logged (number)', { is_logged: 1 }],
    ['non-boolean is_logged (string)', { is_logged: 'true' }],
  ])('rejects set with %s', (_label, patch) => {
    expect(withSet(patch as Record<string, unknown>)).toBeNull();
  });

  it('accepts a string parent_set_id (a real follower link)', () => {
    expect(withSet({ parent_set_id: 'head-1' })?.exercises[0]?.sets[0]?.parent_set_id).toBe(
      'head-1',
    );
  });

  it('accepts a string notes value', () => {
    expect(withSet({ notes: 'felt heavy' })?.exercises[0]?.sets[0]?.notes).toBe(
      'felt heavy',
    );
  });
});

describe('Slice 13d sync fast lane — onLiveMirror rev anti-reorder guard', () => {
  // The Watch dual-fires every live snapshot over sendMessage (instant) AND
  // applicationContext (late backstop). A late appContext can carry an OLDER
  // state than a sendMessage already applied; without the per-session rev
  // high-water mark it would clobber the fresher value — the "亂七八糟 /
  // 遞減組跳號" reorder. The guard drops any inbound whose rev <= lastApplied.
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    __resetLiveMirrorRevForTests();
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    // H1: live mirror requires a pre-existing live session. Seed every id this
    // block exercises so the rev-guard behaviour (not the liveness gate) is
    // what's under test.
    for (const id of ['sess-1', 'sess-2', 'A', 'B']) {
      await seedLiveSession(db, id);
    }
  });

  afterEach(() => {
    db.close();
  });

  /** A snapshot for set-1 with a given rev + weight (rev omitted → legacy). */
  function snapWith(opts: {
    rev?: number;
    weight: number;
    sessionId?: string;
  }): SessionSnapshot {
    const s = snapshot({
      sessionId: opts.sessionId ?? 'sess-1',
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
              weight: opts.weight,
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
    });
    if (opts.rev !== undefined) s.rev = opts.rev;
    return s;
  }

  async function weightOf(): Promise<number | null> {
    const row = await db.getFirstAsync<{ weight_kg: number }>(
      'SELECT weight_kg FROM "set" WHERE id = ?',
      'set-1',
    );
    return row?.weight_kg ?? null;
  }

  it('drops an out-of-order (lower-rev) redelivery and does NOT clobber', async () => {
    const a = await onLiveMirror(db, snapWith({ rev: 100, weight: 80 }));
    expect(a.ok).toBe(true);

    // A LATE applicationContext carrying an older state (rev 50, weight 999).
    const b = await onLiveMirror(db, snapWith({ rev: 50, weight: 999 }));
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.code).toBe('stale');

    // The fresher 80 survives — the stale 999 was dropped before any write.
    expect(await weightOf()).toBe(80);
  });

  it('applies a newer (higher-rev) snapshot', async () => {
    await onLiveMirror(db, snapWith({ rev: 100, weight: 80 }));
    const r = await onLiveMirror(db, snapWith({ rev: 200, weight: 90 }));
    expect(r.ok).toBe(true);
    expect(await weightOf()).toBe(90);
  });

  it('drops an equal-rev redelivery (dual-fire dedup: sendMessage + appContext same rev)', async () => {
    await onLiveMirror(db, snapWith({ rev: 100, weight: 80 }));
    // The other channel delivers the SAME emit (same rev). Even if its
    // payload differed, rev <= mark → dropped (no late clobber).
    const dup = await onLiveMirror(db, snapWith({ rev: 100, weight: 999 }));
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.code).toBe('stale');
    expect(await weightOf()).toBe(80);
  });

  it('high-water mark is per-session — a different session is not gated', async () => {
    await onLiveMirror(db, snapWith({ rev: 100, weight: 80, sessionId: 'sess-1' }));
    // sess-2 has its own (empty) mark; even a "lower" rev applies — it is the
    // first snapshot for that session, not an out-of-order one.
    const other = snapshot({ sessionId: 'sess-2', exercises: [] });
    other.rev = 50;
    const r = await onLiveMirror(db, other);
    expect(r.ok).toBe(true);

    const row = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM session WHERE id = ?',
      'sess-2',
    );
    expect(row).not.toBeNull();
  });

  it('absent rev (legacy producer) bypasses the guard entirely', async () => {
    await onLiveMirror(db, snapWith({ rev: 100, weight: 80 }));
    // No rev → no comparison → applies even though it would be "behind" the
    // mark. Preserves backward-compat with a pre-fix appContext-only producer.
    const r = await onLiveMirror(db, snapWith({ weight: 77 }));
    expect(r.ok).toBe(true);
    expect(await weightOf()).toBe(77);
  });

  // ─── Self-heal: a db-error claims the mark BEFORE the await ──────────
  // The guard `lastAppliedRev.set(...)` runs BEFORE `await replaceLiveMirror`
  // (so a concurrent older delivery from the other channel can't slip past in
  // the check↔write gap). A consequence: if the DB write then FAILS, the mark
  // is already advanced. Verify the recovery behaviour around that.

  it('db-error rolls the mark back, then a HIGHER rev on a reopened db applies (self-heal)', async () => {
    // rev 100 claims the mark, the DB write fails (closed db), and the MED
    // rollback restores the mark to its prior value (none here).
    db.close();
    const failed = await onLiveMirror(db, snapWith({ rev: 100, weight: 80 }));
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.code).toBe('db-error');

    // Reopen — the Watch keeps pushing with ever-higher revs, so the NEXT
    // (rev 200) push applies and re-seeds the iPhone mirror. No stuck state.
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    await seedLiveSession(db, 'sess-1'); // reopened db — re-seed the live row
    const healed = await onLiveMirror(db, snapWith({ rev: 200, weight: 90 }));
    expect(healed.ok).toBe(true);
    expect(await weightOf()).toBe(90);
  });

  it('after a db-error, the SAME-rev dual-fire backstop re-applies (MED self-heal)', async () => {
    // The MED rollback makes the mark track last-APPLIED, not last-SEEN: on a
    // failed write the claim is rolled back, so the dual-fired applicationContext
    // backstop — which carries the SAME rev (100) as the failed sendMessage — is
    // NOT gated out as stale and re-applies, healing within the same emit instead
    // of waiting for the next Watch mutation. (overnight review MED, 2026-06-01.)
    db.close();
    const failed = await onLiveMirror(db, snapWith({ rev: 100, weight: 80 }));
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.code).toBe('db-error');

    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    await seedLiveSession(db, 'sess-1'); // reopened db — re-seed the live row
    const backstop = await onLiveMirror(db, snapWith({ rev: 100, weight: 80 }));
    expect(backstop.ok).toBe(true); // same rev re-applies — claim was rolled back
    expect(await weightOf()).toBe(80);
  });

  // ─── Interleave: two sessions keep independent high-water marks ─────

  it('two sessions interleaved keep independent marks (one stale drop does not gate the other)', async () => {
    // Per-session distinct exercise/set ids (the `set`/`session_exercise` PKs
    // are global ids — sharing 'set-1' across sessions would UPSERT one row).
    function sessSnap(opts: {
      rev: number;
      weight: number;
      sessionId: string;
    }): SessionSnapshot {
      const s = snapshot({
        sessionId: opts.sessionId,
        exercises: [
          {
            sessionExerciseId: `se-${opts.sessionId}`,
            exerciseId: BUILTIN_BENCH_PRESS_ID,
            exerciseName: 'Bench Press',
            ordering: 0,
            plannedSets: 3,
            sets: [
              {
                setId: `set-${opts.sessionId}`,
                ordinal: 0,
                weight: opts.weight,
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
      });
      s.rev = opts.rev;
      return s;
    }
    const weightFor = async (sessionId: string) => {
      const row = await db.getFirstAsync<{ weight_kg: number }>(
        'SELECT weight_kg FROM "set" WHERE session_id = ? AND id = ?',
        sessionId,
        `set-${sessionId}`,
      );
      return row?.weight_kg ?? null;
    };

    // Interleave: A@100, B@100, A@90 (stale for A), B@200 (fresh for B).
    expect((await onLiveMirror(db, sessSnap({ rev: 100, weight: 80, sessionId: 'A' }))).ok).toBe(true);
    expect((await onLiveMirror(db, sessSnap({ rev: 100, weight: 50, sessionId: 'B' }))).ok).toBe(true);

    // A@90 is behind A's mark (100) → dropped, A keeps 80.
    const aStale = await onLiveMirror(db, sessSnap({ rev: 90, weight: 999, sessionId: 'A' }));
    expect(aStale.ok).toBe(false);
    if (!aStale.ok) expect(aStale.code).toBe('stale');

    // B@200 is ahead of B's mark (100) → applies, unaffected by A's gating.
    const bFresh = await onLiveMirror(db, sessSnap({ rev: 200, weight: 60, sessionId: 'B' }));
    expect(bFresh.ok).toBe(true);

    expect(await weightFor('A')).toBe(80); // A unchanged by its stale drop
    expect(await weightFor('B')).toBe(60); // B advanced independently
  });

  it('absent-rev tick after a present-rev tick still applies AND does not corrupt the mark', async () => {
    // rev 100 → mark = 100.
    await onLiveMirror(db, snapWith({ rev: 100, weight: 80 }));
    // A legacy (rev-absent) tick bypasses the guard and applies (weight 77).
    // Crucially it must NOT touch the high-water mark.
    const legacy = await onLiveMirror(db, snapWith({ weight: 77 }));
    expect(legacy.ok).toBe(true);
    expect(await weightOf()).toBe(77);

    // The mark is still 100: a subsequent rev-90 (< 100) is STILL dropped — the
    // absent tick neither advanced nor reset the mark.
    const stale = await onLiveMirror(db, snapWith({ rev: 90, weight: 999 }));
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.code).toBe('stale');
    expect(await weightOf()).toBe(77); // legacy value survives, stale dropped

    // And a rev-101 (> 100) applies — confirms the mark is exactly 100, not
    // bumped by the absent tick.
    const fresh = await onLiveMirror(db, snapWith({ rev: 101, weight: 88 }));
    expect(fresh.ok).toBe(true);
    expect(await weightOf()).toBe(88);
  });

  it('claim-before-await — the mark advances synchronously at call time, BEFORE the DB write awaits', async () => {
    // Gap #2 — verify the source's "claim BEFORE await" ordering, which is what
    // makes the guard race-safe: in production WC delivers messages serially,
    // but the guard still claims the high-water mark synchronously (before the
    // first `await`) so an older redelivery that arrives the instant after can
    // never pass its rev<=mark check in the check↔write gap.
    //
    // NOTE we do NOT model true-parallel transactions here: better-sqlite3
    // transactions are synchronous and non-reentrant ("cannot start a
    // transaction within a transaction"), and production never has two
    // onLiveMirror writes truly overlapping on one db handle. We instead start
    // the newer call (claiming the mark synchronously) and assert that a
    // SUBSEQUENT older call observes the already-advanced mark even though the
    // newer write has not yet been awaited to completion.
    const newerPromise = onLiveMirror(db, snapWith({ rev: 100, weight: 80 }));
    // The mark is ALREADY 100 (claimed synchronously above) before we await.
    // An older redelivery created now is dropped as stale on its synchronous
    // guard check — it never reaches a DB write, so no transaction collision.
    const olderResult = await onLiveMirror(db, snapWith({ rev: 50, weight: 999 }));
    expect(olderResult.ok).toBe(false);
    if (!olderResult.ok) expect(olderResult.code).toBe('stale');

    const newerResult = await newerPromise;
    expect(newerResult.ok).toBe(true);
    expect(await weightOf()).toBe(80); // the stale 999 never landed
  });

  it('__resetLiveMirrorRevForTests clears the mark (app-restart re-seed semantics)', async () => {
    await onLiveMirror(db, snapWith({ rev: 100, weight: 80 }));
    // Without a reset, rev 50 would be stale. After a reset (mimicking an
    // iPhone app restart that drops the in-memory map), the first push for the
    // session re-seeds the mark unconditionally — even a "lower" absolute rev.
    __resetLiveMirrorRevForTests();
    const afterReset = await onLiveMirror(db, snapWith({ rev: 50, weight: 70 }));
    expect(afterReset.ok).toBe(true);
    expect(await weightOf()).toBe(70);
  });
});

describe('Slice 13d H1 — onLiveMirror session-liveness gate', () => {
  // A live tick that lands after the session was discarded (放棄) or finalized
  // (完成) must be dropped, NOT applied — otherwise it resurrects a zombie
  // session or re-inserts a purged row. `onLiveMirror` surfaces this as
  // `{ok:false, code:'session-gone'}`. (See replaceLiveMirror H1 gate tests for
  // the reconcile-level assertions.)
  let db: BetterSqliteDatabase;

  beforeEach(async () => {
    __resetLiveMirrorRevForTests();
    db = new BetterSqliteDatabase(':memory:');
    await migrate(db);
    // No seed — each test controls session presence.
  });

  afterEach(() => {
    db.close();
  });

  it('discarded session (row absent) → code:session-gone, nothing written', async () => {
    const result = await onLiveMirror(db, snapshot());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('session-gone');

    const s = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM session');
    expect(s?.n).toBe(0);
  });

  it('finalized session (ended_at set) → code:session-gone, no re-insert', async () => {
    await seedLiveSession(db, 'sess-1');
    await db.runAsync(
      'UPDATE session SET ended_at = ? WHERE id = ?',
      1_700_000_100_000,
      'sess-1',
    );
    const result = await onLiveMirror(db, snapshot());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('session-gone');

    // The snapshot's exercise was NOT re-inserted; session stays ended.
    const e = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM session_exercise');
    expect(e?.n).toBe(0);
    const row = await db.getFirstAsync<{ ended_at: number | null }>(
      'SELECT ended_at FROM session WHERE id = ?',
      'sess-1',
    );
    expect(row?.ended_at).toBe(1_700_000_100_000);
  });

  it('live (un-ended) session → applies normally', async () => {
    await seedLiveSession(db, 'sess-1');
    const result = await onLiveMirror(db, snapshot());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.exerciseCount).toBe(1);
  });
});
