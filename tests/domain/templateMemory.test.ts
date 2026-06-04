import {
  deriveLatestSetsForExercise,
  type MemoryCandidate,
} from '../../src/domain/template/templateMemory';

function deterministicUuid(prefix = 'new'): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

describe('templateMemory — deriveLatestSetsForExercise', () => {
  it('returns null when no candidate matches the exercise_id', () => {
    const candidates: MemoryCandidate[] = [
      { template_exercise_id: 'te-1', exercise_id: 'bench', updated_at: 1, sets: [] },
    ];
    const out = deriveLatestSetsForExercise({
      exercise_id: 'row',
      candidates,
      uuid: deterministicUuid(),
    });
    expect(out).toBeNull();
  });

  it('picks the candidate with the highest updated_at', () => {
    const candidates: MemoryCandidate[] = [
      {
        template_exercise_id: 'old',
        exercise_id: 'bench',
        updated_at: 100,
        sets: [
          {
            id: 'a',
            position: 0,
            kind: 'working',
            reps: 10,
            weight: 60,
            parent_set_id: null,
            notes: null,
          },
        ],
      },
      {
        template_exercise_id: 'new',
        exercise_id: 'bench',
        updated_at: 200,
        sets: [
          {
            id: 'b',
            position: 0,
            kind: 'working',
            reps: 8,
            weight: 80,
            parent_set_id: null,
            notes: null,
          },
        ],
      },
    ];
    const out = deriveLatestSetsForExercise({
      exercise_id: 'bench',
      candidates,
      uuid: deterministicUuid('u'),
    });
    expect(out).toHaveLength(1);
    expect(out![0]).toMatchObject({ reps: 8, weight: 80 });
  });

  it('rewrites ids with the injected uuid and re-keys positions 0..N', () => {
    const candidates: MemoryCandidate[] = [
      {
        template_exercise_id: 'te-1',
        exercise_id: 'bench',
        updated_at: 1,
        sets: [
          {
            id: 'orig-1',
            position: 0,
            kind: 'warmup',
            reps: 10,
            weight: 40,
            parent_set_id: null,
            notes: null,
          },
          {
            id: 'orig-2',
            position: 1,
            kind: 'working',
            reps: 8,
            weight: 80,
            parent_set_id: null,
            notes: null,
          },
        ],
      },
    ];
    const out = deriveLatestSetsForExercise({
      exercise_id: 'bench',
      candidates,
      uuid: deterministicUuid('u'),
    });
    expect(out!.map((s) => s.id)).toEqual(['u-1', 'u-2']);
    expect(out!.map((s) => s.position)).toEqual([0, 1]);
  });

  it('rewrites cluster parent_set_id through the same id remap', () => {
    const candidates: MemoryCandidate[] = [
      {
        template_exercise_id: 'te-1',
        exercise_id: 'bench',
        updated_at: 1,
        sets: [
          {
            id: 'head-orig',
            position: 0,
            kind: 'dropset',
            reps: 8,
            weight: 80,
            parent_set_id: null,
            notes: null,
          },
          {
            id: 'foll-orig',
            position: 1,
            kind: 'dropset',
            reps: 6,
            weight: 70,
            parent_set_id: 'head-orig',
            notes: null,
          },
        ],
      },
    ];
    const out = deriveLatestSetsForExercise({
      exercise_id: 'bench',
      candidates,
      uuid: deterministicUuid('u'),
    });
    expect(out![0]).toMatchObject({ id: 'u-1', parent_set_id: null });
    expect(out![1]).toMatchObject({ id: 'u-2', parent_set_id: 'u-1' });
  });

  it('drops a dangling parent_set_id to null when the head is absent from the candidate', () => {
    // Defensive: a follower whose parent_set_id references a set that is not in
    // the same candidate's set list cannot be remapped — the `?? null` fallback
    // (line 68) severs the dangling link rather than carrying a stale id.
    const candidates: MemoryCandidate[] = [
      {
        template_exercise_id: 'te-1',
        exercise_id: 'bench',
        updated_at: 1,
        sets: [
          {
            id: 'foll-orig',
            position: 0,
            kind: 'dropset',
            reps: 6,
            weight: 70,
            parent_set_id: 'missing-head', // head not present in this set list
            notes: null,
          },
        ],
      },
    ];
    const out = deriveLatestSetsForExercise({
      exercise_id: 'bench',
      candidates,
      uuid: deterministicUuid('u'),
    });
    expect(out![0]).toMatchObject({ id: 'u-1', parent_set_id: null });
  });

  it('strips notes (memory is structural — notes are per-template)', () => {
    const candidates: MemoryCandidate[] = [
      {
        template_exercise_id: 'te-1',
        exercise_id: 'bench',
        updated_at: 1,
        sets: [
          {
            id: 'a',
            position: 0,
            kind: 'working',
            reps: 8,
            weight: 80,
            parent_set_id: null,
            notes: 'old PR attempt',
          },
        ],
      },
    ];
    const out = deriveLatestSetsForExercise({
      exercise_id: 'bench',
      candidates,
      uuid: deterministicUuid(),
    });
    expect(out![0].notes).toBeNull();
  });

  it('returns an empty list when latest candidate has no sets', () => {
    const candidates: MemoryCandidate[] = [
      { template_exercise_id: 'te-1', exercise_id: 'bench', updated_at: 1, sets: [] },
    ];
    const out = deriveLatestSetsForExercise({
      exercise_id: 'bench',
      candidates,
      uuid: deterministicUuid(),
    });
    expect(out).toEqual([]);
  });
});
