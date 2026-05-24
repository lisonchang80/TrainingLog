import {
  EDIT_SNAPSHOT_TTL_MS,
  editSnapshotKey,
  isEditSnapshotStale,
  validateStoredEditSnapshot,
} from '../../src/domain/session/editSnapshotPersistence';

describe('editSnapshotKey', () => {
  test('namespaces by session id', () => {
    expect(editSnapshotKey('abc-123')).toBe('session_edit_snapshot_abc-123');
  });

  test('different ids produce different keys (no collision)', () => {
    expect(editSnapshotKey('sess-A')).not.toBe(editSnapshotKey('sess-B'));
  });
});

describe('isEditSnapshotStale', () => {
  const SAVED = 1_700_000_000_000;

  test('fresh snapshot (1 hour old) is NOT stale', () => {
    expect(isEditSnapshotStale(SAVED, SAVED + 60 * 60 * 1000)).toBe(false);
  });

  test('snapshot at exactly TTL boundary IS stale (>= cutoff)', () => {
    expect(isEditSnapshotStale(SAVED, SAVED + EDIT_SNAPSHOT_TTL_MS)).toBe(true);
  });

  test('snapshot 7 days + 1 ms old IS stale', () => {
    expect(
      isEditSnapshotStale(SAVED, SAVED + EDIT_SNAPSHOT_TTL_MS + 1),
    ).toBe(true);
  });

  test('snapshot 6 days 23 hours old is NOT stale', () => {
    const sixDays23h = 6 * 24 * 60 * 60 * 1000 + 23 * 60 * 60 * 1000;
    expect(isEditSnapshotStale(SAVED, SAVED + sixDays23h)).toBe(false);
  });

  test('custom ttlMs override works', () => {
    expect(isEditSnapshotStale(SAVED, SAVED + 5_000, 1_000)).toBe(true);
    expect(isEditSnapshotStale(SAVED, SAVED + 500, 1_000)).toBe(false);
  });

  test('clock-skew: nowMs earlier than savedAt → not stale (defensive)', () => {
    // If user adjusts system clock backward we shouldn't aggressively
    // discard — a negative delta is < ttlMs so this returns false.
    expect(isEditSnapshotStale(SAVED, SAVED - 60 * 1000)).toBe(false);
  });
});

describe('validateStoredEditSnapshot', () => {
  function makeValid() {
    return {
      savedAt: 1_700_000_000_000,
      snap: {
        session: { id: 's1', started_at: 100, ended_at: null },
        sessionExercises: [],
        sets: [],
        achievementUnlocks: [],
      },
    };
  }

  test('null / undefined → null', () => {
    expect(validateStoredEditSnapshot(null)).toBeNull();
    expect(validateStoredEditSnapshot(undefined)).toBeNull();
  });

  test('primitive (string / number / bool) → null', () => {
    expect(validateStoredEditSnapshot('garbage')).toBeNull();
    expect(validateStoredEditSnapshot(42)).toBeNull();
    expect(validateStoredEditSnapshot(true)).toBeNull();
  });

  test('missing savedAt → null', () => {
    const v = makeValid() as Partial<ReturnType<typeof makeValid>>;
    delete (v as Record<string, unknown>).savedAt;
    expect(validateStoredEditSnapshot(v)).toBeNull();
  });

  test('NaN savedAt → null (Number.isFinite guard)', () => {
    const v = makeValid();
    v.savedAt = NaN;
    expect(validateStoredEditSnapshot(v)).toBeNull();
  });

  test('missing snap → null', () => {
    const v = makeValid() as Partial<ReturnType<typeof makeValid>>;
    delete (v as Record<string, unknown>).snap;
    expect(validateStoredEditSnapshot(v)).toBeNull();
  });

  test('snap missing session sub-object → null', () => {
    const v = makeValid();
    delete (v.snap as Record<string, unknown>).session;
    expect(validateStoredEditSnapshot(v)).toBeNull();
  });

  test('snap missing sets array → null', () => {
    const v = makeValid();
    delete (v.snap as Record<string, unknown>).sets;
    expect(validateStoredEditSnapshot(v)).toBeNull();
  });

  test('session missing started_at → null', () => {
    const v = makeValid();
    delete (v.snap.session as Record<string, unknown>).started_at;
    expect(validateStoredEditSnapshot(v)).toBeNull();
  });

  test('well-formed value round-trips to typed StoredEditSnapshot', () => {
    const v = makeValid();
    const out = validateStoredEditSnapshot(v);
    expect(out).not.toBeNull();
    expect(out?.savedAt).toBe(1_700_000_000_000);
    expect(out?.snap.session.id).toBe('s1');
  });
});
