import {
  CLUSTER_FILTER_MODES,
  DEFAULT_CLUSTER_MODE,
  clusterFilterLabel,
  filterSetsByClusterMode,
  parseClusterMode,
  type ClusterFilterMode,
} from '../../src/domain/exercise/clusterFilter';

/**
 * clusterFilter — 3-段 cluster filter logic for exercise history / chart pages.
 * Replaces the standalone superset history/chart pages (slice 10c).
 *
 * Coverage: 3 mode × { empty / solo-only / cluster-only / mixed } + label +
 * URL-param parsing + constants stability.
 */

type Row = { id: string; is_in_cluster: boolean };

const solo1: Row = { id: 'solo-1', is_in_cluster: false };
const solo2: Row = { id: 'solo-2', is_in_cluster: false };
const cluA: Row = { id: 'clu-a', is_in_cluster: true };
const cluB: Row = { id: 'clu-b', is_in_cluster: true };

describe('clusterFilter — constants', () => {
  it('exposes the 3 modes in left→right display order', () => {
    expect(CLUSTER_FILTER_MODES).toEqual([
      'exclude_cluster',
      'all',
      'cluster_only',
    ]);
  });

  it('defaults to "all" (preserves legacy / page-default behavior)', () => {
    expect(DEFAULT_CLUSTER_MODE).toBe('all');
  });
});

describe('clusterFilter — clusterFilterLabel', () => {
  it('returns the 3 Chinese labels per spec', () => {
    expect(clusterFilterLabel('exclude_cluster')).toBe('不含超級組');
    expect(clusterFilterLabel('all')).toBe('包含超級組');
    expect(clusterFilterLabel('cluster_only')).toBe('只含超級組');
  });
});

describe('clusterFilter — filterSetsByClusterMode', () => {
  describe('empty input', () => {
    const empty: Row[] = [];
    it.each(CLUSTER_FILTER_MODES)('returns [] for mode %s', (mode) => {
      expect(filterSetsByClusterMode(empty, mode)).toEqual([]);
    });

    it('returns a NEW array (not the same reference) for mode all', () => {
      const out = filterSetsByClusterMode(empty, 'all');
      expect(out).not.toBe(empty);
    });
  });

  describe('solo-only input', () => {
    const rows: Row[] = [solo1, solo2];
    it('mode=exclude_cluster keeps everything', () => {
      expect(filterSetsByClusterMode(rows, 'exclude_cluster')).toEqual([
        solo1,
        solo2,
      ]);
    });
    it('mode=all keeps everything', () => {
      expect(filterSetsByClusterMode(rows, 'all')).toEqual([solo1, solo2]);
    });
    it('mode=cluster_only returns []', () => {
      expect(filterSetsByClusterMode(rows, 'cluster_only')).toEqual([]);
    });
  });

  describe('cluster-only input', () => {
    const rows: Row[] = [cluA, cluB];
    it('mode=exclude_cluster returns []', () => {
      expect(filterSetsByClusterMode(rows, 'exclude_cluster')).toEqual([]);
    });
    it('mode=all keeps everything', () => {
      expect(filterSetsByClusterMode(rows, 'all')).toEqual([cluA, cluB]);
    });
    it('mode=cluster_only keeps everything', () => {
      expect(filterSetsByClusterMode(rows, 'cluster_only')).toEqual([
        cluA,
        cluB,
      ]);
    });
  });

  describe('mixed input', () => {
    const rows: Row[] = [solo1, cluA, solo2, cluB];
    it('mode=exclude_cluster drops cluster rows in source order', () => {
      expect(filterSetsByClusterMode(rows, 'exclude_cluster')).toEqual([
        solo1,
        solo2,
      ]);
    });
    it('mode=all preserves source order without filtering', () => {
      expect(filterSetsByClusterMode(rows, 'all')).toEqual([
        solo1,
        cluA,
        solo2,
        cluB,
      ]);
    });
    it('mode=cluster_only drops solo rows in source order', () => {
      expect(filterSetsByClusterMode(rows, 'cluster_only')).toEqual([
        cluA,
        cluB,
      ]);
    });
  });

  it('does NOT mutate the input array (mode=exclude_cluster)', () => {
    const rows: Row[] = [solo1, cluA];
    const before = [...rows];
    filterSetsByClusterMode(rows, 'exclude_cluster');
    expect(rows).toEqual(before);
  });
});

describe('clusterFilter — parseClusterMode', () => {
  it('passes through valid string values', () => {
    expect(parseClusterMode('exclude_cluster')).toBe<ClusterFilterMode>(
      'exclude_cluster'
    );
    expect(parseClusterMode('all')).toBe<ClusterFilterMode>('all');
    expect(parseClusterMode('cluster_only')).toBe<ClusterFilterMode>(
      'cluster_only'
    );
  });

  it('uses the first entry for arrays (expo-router can deliver string[])', () => {
    expect(parseClusterMode(['cluster_only', 'all'])).toBe<ClusterFilterMode>(
      'cluster_only'
    );
  });

  it('falls back to DEFAULT for null / undefined / unknown values', () => {
    expect(parseClusterMode(null)).toBe(DEFAULT_CLUSTER_MODE);
    expect(parseClusterMode(undefined)).toBe(DEFAULT_CLUSTER_MODE);
    expect(parseClusterMode('')).toBe(DEFAULT_CLUSTER_MODE);
    expect(parseClusterMode('garbage')).toBe(DEFAULT_CLUSTER_MODE);
    expect(parseClusterMode([])).toBe(DEFAULT_CLUSTER_MODE);
  });
});
