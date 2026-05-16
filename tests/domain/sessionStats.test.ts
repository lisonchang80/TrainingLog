import {
  computeSessionStats,
  computeSessionVolume,
  formatDurationHHMM,
  type SessionVolumeInput,
} from '../../src/domain/session/sessionStats';

/**
 * Session-level stats for the history detail page header tiles
 * (ADR-0019 Q10, slice 10c session detail page).
 *
 * Covers:
 *  - 容量 (volume) — warmup excluded, is_logged=1 filter
 *  - asymmetric cluster handling
 *  - empty session, single-set session
 *  - HH:mm duration formatter
 *  - composite computeSessionStats
 */

function mk(
  set_kind: 'warmup' | 'working' | 'dropset',
  is_logged: 0 | 1,
  weight_kg: number | null = 60,
  reps: number | null = 10,
): SessionVolumeInput {
  return { set_kind, is_logged, weight_kg, reps };
}

describe('computeSessionVolume', () => {
  it('empty session → 0 volume', () => {
    expect(computeSessionVolume([])).toBe(0);
  });

  it('single logged working set → weight × reps', () => {
    expect(computeSessionVolume([mk('working', 1, 80, 5)])).toBe(400);
  });

  it('warmup is_logged=1 is EXCLUDED from volume', () => {
    const sets: SessionVolumeInput[] = [
      mk('warmup', 1, 40, 12), // skipped (warmup)
      mk('working', 1, 60, 10), // counted
    ];
    expect(computeSessionVolume(sets)).toBe(600);
  });

  it('working is_logged=0 is EXCLUDED from volume', () => {
    const sets: SessionVolumeInput[] = [
      mk('working', 0, 60, 10), // not logged → skipped
      mk('working', 1, 70, 8), // counted
    ];
    expect(computeSessionVolume(sets)).toBe(70 * 8);
  });

  it('dropset is_logged=1 IS included (non-warmup, logged)', () => {
    const sets: SessionVolumeInput[] = [
      mk('working', 1, 60, 10),
      mk('dropset', 1, 45, 8),
    ];
    expect(computeSessionVolume(sets)).toBe(60 * 10 + 45 * 8);
  });

  it('asymmetric cluster: A side 4 cycles logged, B side 3 cycles logged', () => {
    // Cluster pairs are stored as two separate session_exercise rows whose
    // sets are linked via parent_set_id. From the volume POV each row's set
    // contributes its own weight×reps; asymmetric just means one side has
    // fewer logged rows than the other.
    const setsA: SessionVolumeInput[] = [
      mk('working', 1, 80, 5),
      mk('working', 1, 80, 5),
      mk('working', 1, 80, 5),
      mk('working', 1, 80, 5),
    ];
    const setsB: SessionVolumeInput[] = [
      mk('working', 1, 25, 12),
      mk('working', 1, 25, 12),
      mk('working', 1, 25, 12),
      mk('working', 0, 25, 12), // 4th cycle on B side NOT logged
    ];
    const all = [...setsA, ...setsB];
    expect(computeSessionVolume(all)).toBe(80 * 5 * 4 + 25 * 12 * 3);
  });

  it('null weight or reps contribute 0 (defensive)', () => {
    const sets: SessionVolumeInput[] = [
      mk('working', 1, null, 10),
      mk('working', 1, 60, null),
      mk('working', 1, 60, 10),
    ];
    expect(computeSessionVolume(sets)).toBe(60 * 10);
  });
});

describe('formatDurationHHMM', () => {
  it('zero ms → 00:00', () => {
    expect(formatDurationHHMM(0)).toBe('00:00');
  });

  it('1 hour 13 min → 01:13', () => {
    expect(formatDurationHHMM((3600 + 13 * 60) * 1000)).toBe('01:13');
  });

  it('rolls past 24h without wrapping', () => {
    // 48h 5min — open-ended in-progress session left for 2 days
    expect(formatDurationHHMM((48 * 3600 + 5 * 60) * 1000)).toBe('48:05');
  });

  it('null / undefined → 00:00 (defensive)', () => {
    expect(formatDurationHHMM(null)).toBe('00:00');
    expect(formatDurationHHMM(undefined)).toBe('00:00');
  });

  it('negative duration → 00:00 (defensive)', () => {
    expect(formatDurationHHMM(-1000)).toBe('00:00');
  });

  it('seconds are truncated (no rounding up)', () => {
    // 5min 59.9s should show 05 minutes still
    expect(formatDurationHHMM(5 * 60 * 1000 + 59_900)).toBe('00:05');
  });
});

describe('computeSessionStats', () => {
  it('ended session: duration = ended_at - started_at; volume reflects sets; kcal passthrough', () => {
    const started_at = 1_700_000_000_000;
    const ended_at = started_at + (1 * 3600 + 13 * 60) * 1000; // 1h13
    const stats = computeSessionStats({
      session: { started_at, ended_at, kcal: 350 },
      exerciseCount: 3,
      sets: [
        mk('warmup', 1, 40, 12), // excluded
        mk('working', 1, 60, 10), // 600
        mk('working', 1, 70, 8), // 560
      ],
    });
    expect(stats.durationMs).toBe((1 * 3600 + 13 * 60) * 1000);
    expect(stats.volume).toBe(1160);
    expect(stats.exerciseCount).toBe(3);
    expect(stats.kcal).toBe(350);
  });

  it('open session: duration measured against now()', () => {
    const started_at = 1_700_000_000_000;
    const nowTs = started_at + 5 * 60 * 1000;
    const stats = computeSessionStats({
      session: { started_at, ended_at: null, kcal: null },
      exerciseCount: 0,
      sets: [],
      now: () => nowTs,
    });
    expect(stats.durationMs).toBe(5 * 60 * 1000);
    expect(stats.volume).toBe(0);
    expect(stats.kcal).toBeNull();
  });

  it('empty session: volume 0, exerciseCount 0, durationMs floored to 0 when ended_at < started_at', () => {
    // Defensive: caller passes bad data — clamp to 0 rather than emit negative.
    const stats = computeSessionStats({
      session: { started_at: 2000, ended_at: 1000, kcal: null },
      exerciseCount: 0,
      sets: [],
    });
    expect(stats.durationMs).toBe(0);
    expect(stats.volume).toBe(0);
    expect(stats.exerciseCount).toBe(0);
    expect(stats.kcal).toBeNull();
  });
});
