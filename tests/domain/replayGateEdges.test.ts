/**
 * Edge coverage for `src/domain/exercise/replayGate.ts`.
 *
 * The base `replayGate.test.ts` covers the full target × row-shape matrix.
 * These lock the partner-id boundary the base suite skips:
 *
 *   1. An empty-string `cluster_partner_exercise_id` is treated as a VALID
 *      partner, NOT as "no partner". The classifier guards with `!= null`
 *      (a null check, not a truthiness check), so `''` is added to the
 *      partner Set → `{kind:'cluster', partnerExerciseId:''}`. This documents
 *      that an empty partner id does not collapse to `cluster_mixed`.
 *   2. `canReplayRow` matches an empty-string partner to an empty-string
 *      target partner (strict `===`), and rejects when one is '' and the
 *      other is a real id.
 *   3. A single cluster set classifies to `cluster` (not mixed) — the
 *      minimal one-partner case.
 */

import {
  canReplayRow,
  classifyRowClusterShape,
  type ReplayTarget,
} from '../../src/domain/exercise/replayGate';

describe('classifyRowClusterShape — empty-string partner id', () => {
  it('treats "" partner id as a valid single partner (not cluster_mixed)', () => {
    const sets = [
      { is_in_cluster: true, cluster_partner_exercise_id: '' },
      { is_in_cluster: true, cluster_partner_exercise_id: '' },
    ];
    expect(classifyRowClusterShape(sets)).toEqual({
      kind: 'cluster',
      partnerExerciseId: '',
    });
  });

  it('a single cluster set with a real partner classifies as cluster', () => {
    const sets = [{ is_in_cluster: true, cluster_partner_exercise_id: 'ex-dip' }];
    expect(classifyRowClusterShape(sets)).toEqual({
      kind: 'cluster',
      partnerExerciseId: 'ex-dip',
    });
  });

  it('"" partner and a real partner in the same row → cluster_mixed', () => {
    const sets = [
      { is_in_cluster: true, cluster_partner_exercise_id: '' },
      { is_in_cluster: true, cluster_partner_exercise_id: 'ex-dip' },
    ];
    expect(classifyRowClusterShape(sets)).toEqual({ kind: 'cluster_mixed' });
  });
});

describe('canReplayRow — empty-string partner matching', () => {
  const emptyTarget: ReplayTarget = {
    kind: 'cluster',
    currentSeIdA: 'a',
    currentSeIdB: 'b',
    partnerExerciseId: '',
  };

  it('matches an empty-partner row to an empty-partner target', () => {
    expect(
      canReplayRow({ kind: 'cluster', partnerExerciseId: '' }, emptyTarget),
    ).toBe(true);
  });

  it('rejects a real-partner row against an empty-partner target', () => {
    expect(
      canReplayRow({ kind: 'cluster', partnerExerciseId: 'ex-dip' }, emptyTarget),
    ).toBe(false);
  });

  it('rejects an empty-partner row against a real-partner target', () => {
    const realTarget: ReplayTarget = {
      kind: 'cluster',
      currentSeIdA: 'a',
      currentSeIdB: 'b',
      partnerExerciseId: 'ex-dip',
    };
    expect(
      canReplayRow({ kind: 'cluster', partnerExerciseId: '' }, realTarget),
    ).toBe(false);
  });
});
