import {
  canReplayRow,
  classifyRowClusterShape,
  type ReplayTarget,
  type RowClusterShape,
} from '../../src/domain/exercise/replayGate';

/**
 * Replay gate — per-row 「↻ 再次訓練」enable/disable logic.
 *
 * Pre-wave-14: page-level `canReplay` lit up every row uniformly.
 * Wave 14: row's cluster shape vs target's cluster shape determines
 *   button state per-row.
 */

describe('classifyRowClusterShape', () => {
  it('returns {kind: solo} for all-solo rows', () => {
    const sets = [
      { is_in_cluster: false, cluster_partner_exercise_id: null },
      { is_in_cluster: false, cluster_partner_exercise_id: null },
    ];
    expect(classifyRowClusterShape(sets)).toEqual({ kind: 'solo' });
  });

  it('returns {kind: cluster, partner} when all cluster sets share one partner', () => {
    const sets = [
      { is_in_cluster: true, cluster_partner_exercise_id: 'ex-dip' },
      { is_in_cluster: true, cluster_partner_exercise_id: 'ex-dip' },
      { is_in_cluster: true, cluster_partner_exercise_id: 'ex-dip' },
    ];
    expect(classifyRowClusterShape(sets)).toEqual({
      kind: 'cluster',
      partnerExerciseId: 'ex-dip',
    });
  });

  it('returns {kind: cluster_mixed} when cluster sets carry two different partners', () => {
    // Corner case — user did 2 different clusters with this exercise in the
    // same session (Bench+Dip and Bench+PecDeck). Per-row partner is
    // ambiguous so we disable replay defensively.
    const sets = [
      { is_in_cluster: true, cluster_partner_exercise_id: 'ex-dip' },
      { is_in_cluster: true, cluster_partner_exercise_id: 'ex-pec-deck' },
    ];
    expect(classifyRowClusterShape(sets)).toEqual({ kind: 'cluster_mixed' });
  });

  it('returns {kind: cluster_mixed} when is_in_cluster=true but partner is null (defensive)', () => {
    // Legacy / corrupted data — flagged as cluster but no partner_exercise_id.
    // Treat as mixed rather than guess; the gate disables replay.
    const sets = [
      { is_in_cluster: true, cluster_partner_exercise_id: null },
    ];
    expect(classifyRowClusterShape(sets)).toEqual({ kind: 'cluster_mixed' });
  });

  it('ignores solo sets and classifies remaining cluster sets', () => {
    // Defensive — `clusterMode` filtering should make rows uniform, but if
    // a mixed row slips through we should still classify by the cluster sets.
    const sets = [
      { is_in_cluster: false, cluster_partner_exercise_id: null },
      { is_in_cluster: true, cluster_partner_exercise_id: 'ex-dip' },
    ];
    expect(classifyRowClusterShape(sets)).toEqual({
      kind: 'cluster',
      partnerExerciseId: 'ex-dip',
    });
  });

  it('handles empty sets list (returns solo)', () => {
    expect(classifyRowClusterShape([])).toEqual({ kind: 'solo' });
  });
});

describe('canReplayRow', () => {
  const soloShape: RowClusterShape = { kind: 'solo' };
  const clusterShape: RowClusterShape = {
    kind: 'cluster',
    partnerExerciseId: 'ex-dip',
  };
  const otherClusterShape: RowClusterShape = {
    kind: 'cluster',
    partnerExerciseId: 'ex-pec-deck',
  };
  const mixedShape: RowClusterShape = { kind: 'cluster_mixed' };

  const noTarget: ReplayTarget = { kind: 'none' };
  const soloTarget: ReplayTarget = {
    kind: 'solo',
    currentSeId: 'se-current-solo',
  };
  const clusterTarget: ReplayTarget = {
    kind: 'cluster',
    currentSeIdA: 'se-current-A',
    currentSeIdB: 'se-current-B',
    partnerExerciseId: 'ex-dip',
  };

  describe('target=none (library / browse)', () => {
    it('returns false for every row shape (no replay context)', () => {
      expect(canReplayRow(soloShape, noTarget)).toBe(false);
      expect(canReplayRow(clusterShape, noTarget)).toBe(false);
      expect(canReplayRow(otherClusterShape, noTarget)).toBe(false);
      expect(canReplayRow(mixedShape, noTarget)).toBe(false);
    });
  });

  describe('target=solo (caller is a solo card)', () => {
    it('enables solo source rows', () => {
      expect(canReplayRow(soloShape, soloTarget)).toBe(true);
    });

    it('disables cluster source rows (req #3: solo target rejects cluster source)', () => {
      expect(canReplayRow(clusterShape, soloTarget)).toBe(false);
      expect(canReplayRow(otherClusterShape, soloTarget)).toBe(false);
      expect(canReplayRow(mixedShape, soloTarget)).toBe(false);
    });
  });

  describe('target=cluster (caller is a cluster card with specific partner)', () => {
    it('disables solo source rows (req #2: cluster target rejects solo source)', () => {
      expect(canReplayRow(soloShape, clusterTarget)).toBe(false);
    });

    it('enables cluster source rows with matching partner', () => {
      expect(canReplayRow(clusterShape, clusterTarget)).toBe(true);
    });

    it('disables cluster source rows with different partner (req #2: different cluster type)', () => {
      expect(canReplayRow(otherClusterShape, clusterTarget)).toBe(false);
    });

    it('disables mixed-partner cluster source rows (defensive)', () => {
      expect(canReplayRow(mixedShape, clusterTarget)).toBe(false);
    });
  });
});
