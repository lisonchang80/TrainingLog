import {
  sessionSnapshotDirty,
  type DirtyCheckState,
} from '../../src/domain/session/sessionSnapshotDirty';

const baseSet = {
  weight_kg: 80,
  reps: 5,
  is_skipped: 0,
  ordering: 1,
  set_kind: 'working',
  parent_set_id: null,
  is_logged: 1,
  notes: null,
  session_exercise_id: 'se1',
};
const baseSE = {
  ordering: 1,
  parent_id: null,
  rest_sec: null,
};
function base(): DirtyCheckState {
  return {
    session: { started_at: 1000, ended_at: 2000 },
    sessionExercises: [{ id: 'se1', ...baseSE }],
    sets: [{ id: 's1', ...baseSet }],
  };
}

describe('sessionSnapshotDirty', () => {
  it('returns false when current matches snapshot exactly', () => {
    expect(sessionSnapshotDirty(base(), base())).toBe(false);
  });

  it('detects session.started_at change', () => {
    const cur = base();
    cur.session.started_at = 1001;
    expect(sessionSnapshotDirty(cur, base())).toBe(true);
  });

  it('detects session.ended_at change (number → null)', () => {
    const cur = base();
    cur.session.ended_at = null;
    expect(sessionSnapshotDirty(cur, base())).toBe(true);
  });

  it('detects added set (length mismatch)', () => {
    const cur = base();
    cur.sets = [...cur.sets, { id: 's2', ...baseSet, ordering: 2 }];
    expect(sessionSnapshotDirty(cur, base())).toBe(true);
  });

  it('detects removed set', () => {
    const cur = base();
    cur.sets = [];
    expect(sessionSnapshotDirty(cur, base())).toBe(true);
  });

  it('detects weight_kg change on same id', () => {
    const cur = base();
    cur.sets = [{ id: 's1', ...baseSet, weight_kg: 90 }];
    expect(sessionSnapshotDirty(cur, base())).toBe(true);
  });

  it('detects is_logged toggle', () => {
    const cur = base();
    cur.sets = [{ id: 's1', ...baseSet, is_logged: 0 }];
    expect(sessionSnapshotDirty(cur, base())).toBe(true);
  });

  it('detects set_kind change', () => {
    const cur = base();
    cur.sets = [{ id: 's1', ...baseSet, set_kind: 'dropset' }];
    expect(sessionSnapshotDirty(cur, base())).toBe(true);
  });

  it('detects parent_set_id change (null → string)', () => {
    const cur = base();
    cur.sets = [{ id: 's1', ...baseSet, parent_set_id: 'head1' }];
    expect(sessionSnapshotDirty(cur, base())).toBe(true);
  });

  it('detects notes change (null → string)', () => {
    const cur = base();
    cur.sets = [{ id: 's1', ...baseSet, notes: 'a note' }];
    expect(sessionSnapshotDirty(cur, base())).toBe(true);
  });

  it('detects sessionExercise ordering change', () => {
    const cur = base();
    cur.sessionExercises = [{ id: 'se1', ...baseSE, ordering: 2 }];
    expect(sessionSnapshotDirty(cur, base())).toBe(true);
  });

  it('detects sessionExercise rest_sec change', () => {
    const cur = base();
    cur.sessionExercises = [{ id: 'se1', ...baseSE, rest_sec: 90 }];
    expect(sessionSnapshotDirty(cur, base())).toBe(true);
  });

  it('detects added sessionExercise (length mismatch)', () => {
    const cur = base();
    cur.sessionExercises = [...cur.sessionExercises, { id: 'se2', ...baseSE }];
    expect(sessionSnapshotDirty(cur, base())).toBe(true);
  });

  it('detects removed sessionExercise (length mismatch)', () => {
    const cur = base();
    cur.sessionExercises = [];
    expect(sessionSnapshotDirty(cur, base())).toBe(true);
  });

  it('detects sessionExercise parent_id change (null → string)', () => {
    const cur = base();
    cur.sessionExercises = [{ id: 'se1', ...baseSE, parent_id: 'head-se' }];
    expect(sessionSnapshotDirty(cur, base())).toBe(true);
  });

  it('detects set is_skipped toggle', () => {
    const cur = base();
    cur.sets = [{ id: 's1', ...baseSet, is_skipped: 1 }];
    expect(sessionSnapshotDirty(cur, base())).toBe(true);
  });

  it('detects set reps change', () => {
    const cur = base();
    cur.sets = [{ id: 's1', ...baseSet, reps: 8 }];
    expect(sessionSnapshotDirty(cur, base())).toBe(true);
  });

  it('detects set session_exercise_id change (reparent)', () => {
    const cur = base();
    cur.sets = [{ id: 's1', ...baseSet, session_exercise_id: 'se2' }];
    expect(sessionSnapshotDirty(cur, base())).toBe(true);
  });

  it('detects set replaced by different id (length match)', () => {
    const cur = base();
    cur.sets = [{ id: 'sOther', ...baseSet }];
    expect(sessionSnapshotDirty(cur, base())).toBe(true);
  });

  it('detects sessionExercise replaced by different id (length match)', () => {
    const cur = base();
    cur.sessionExercises = [{ id: 'seOther', ...baseSE }];
    expect(sessionSnapshotDirty(cur, base())).toBe(true);
  });

  it('detects weight_kg null → number (nullish-coalescing branch)', () => {
    const cur = base();
    cur.sets = [{ id: 's1', ...baseSet, weight_kg: 100 }];
    const snap = base();
    snap.sets = [{ id: 's1', ...baseSet, weight_kg: null }];
    expect(sessionSnapshotDirty(cur, snap)).toBe(true);
  });

  it('detects reps null → number (nullish-coalescing branch)', () => {
    const cur = base();
    cur.sets = [{ id: 's1', ...baseSet, reps: 5 }];
    const snap = base();
    snap.sets = [{ id: 's1', ...baseSet, reps: null }];
    expect(sessionSnapshotDirty(cur, snap)).toBe(true);
  });

  it('detects session_exercise_id null → string (nullish-coalescing branch)', () => {
    const cur = base();
    cur.sets = [{ id: 's1', ...baseSet, session_exercise_id: 'se1' }];
    const snap = base();
    snap.sets = [{ id: 's1', ...baseSet, session_exercise_id: null }];
    expect(sessionSnapshotDirty(cur, snap)).toBe(true);
  });

  it('detects session.ended_at null → number (nullish-coalescing branch)', () => {
    const cur = base();
    cur.session.ended_at = 2000;
    const snap = base();
    snap.session.ended_at = null;
    expect(sessionSnapshotDirty(cur, snap)).toBe(true);
  });

  it('treats both-null nullable fields as equal across the board', () => {
    const cur = base();
    cur.session.ended_at = null;
    cur.sets = [
      {
        id: 's1',
        weight_kg: null,
        reps: null,
        is_skipped: 0,
        ordering: 1,
        set_kind: 'working',
        parent_set_id: null,
        is_logged: 0,
        notes: null,
        session_exercise_id: null,
      },
    ];
    const snap = base();
    snap.session.ended_at = null;
    snap.sets = [
      {
        id: 's1',
        weight_kg: null,
        reps: null,
        is_skipped: 0,
        ordering: 1,
        set_kind: 'working',
        parent_set_id: null,
        is_logged: 0,
        notes: null,
        session_exercise_id: null,
      },
    ];
    expect(sessionSnapshotDirty(cur, snap)).toBe(false);
  });

  it('order-insensitive on sets array (id-keyed comparison)', () => {
    const cur = base();
    cur.sets = [
      { id: 's2', ...baseSet, ordering: 2 },
      { id: 's1', ...baseSet },
    ];
    const snap = base();
    snap.sets = [
      { id: 's1', ...baseSet },
      { id: 's2', ...baseSet, ordering: 2 },
    ];
    expect(sessionSnapshotDirty(cur, snap)).toBe(false);
  });
});
