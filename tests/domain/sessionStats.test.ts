import {
  computeDetailPageStats,
  computeSessionStats,
  computeSessionVolume,
  formatTrainingDuration,
  formatVolumeShort,
  type SessionStatsSetInput,
  type SessionVolumeInput,
} from '../../src/domain/session/sessionStats';

/**
 * Merged from two parallel overnight branches (slice 10c):
 *   - Agent A: detail page 4-tile stats (ADR-0019 Q10)
 *   - Agent C: in-session 3-tile stats panel (ADR-0019 Q6)
 *
 * Both share underlying `computeSessionVolume`. Separate format helpers.
 */

function mk(
  set_kind: 'warmup' | 'working' | 'dropset',
  is_logged: 0 | 1,
  weight_kg: number | null = 60,
  reps: number | null = 10,
): SessionVolumeInput {
  return { set_kind, is_logged, weight_kg, reps };
}

function s(
  set_kind: 'warmup' | 'working' | 'dropset',
  is_logged: 0 | 1,
  weight_kg: number | null = 60,
  reps: number | null = 10,
): SessionStatsSetInput {
  return { set_kind, is_logged, weight_kg, reps };
}

// ── Shared volume function ────────────────────────────────────────────────────

describe('computeSessionVolume (shared)', () => {
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

// ── In-session stats panel (Agent C, Q6) ──────────────────────────────────────

describe('computeSessionStats (in-session 3-tile)', () => {
  it('empty session → zeros except duration', () => {
    const out = computeSessionStats({
      sets: [],
      exercise_count: 0,
      started_at_ms: 0,
      now_ms: 60_000,
    });
    expect(out).toEqual({
      duration_ms: 60_000,
      volume_kg: 0,
      exercise_count: 0,
    });
  });

  it('logged working sets contribute to volume', () => {
    const out = computeSessionStats({
      sets: [s('working', 1, 60, 10), s('working', 1, 70, 8)],
      exercise_count: 1,
      started_at_ms: 0,
      now_ms: 0,
    });
    expect(out.volume_kg).toBe(60 * 10 + 70 * 8);
  });

  it('warmup excluded from volume even when is_logged=1', () => {
    const out = computeSessionStats({
      sets: [s('warmup', 1, 40, 12), s('working', 1, 60, 10)],
      exercise_count: 1,
      started_at_ms: 0,
      now_ms: 0,
    });
    expect(out.volume_kg).toBe(600);
  });

  it('non-logged sets excluded from volume', () => {
    const out = computeSessionStats({
      sets: [s('working', 0, 80, 5), s('working', 1, 60, 10)],
      exercise_count: 1,
      started_at_ms: 0,
      now_ms: 0,
    });
    expect(out.volume_kg).toBe(600);
  });

  it('dropset logged contributes to volume (non-warmup)', () => {
    const out = computeSessionStats({
      sets: [s('working', 1, 60, 10), s('dropset', 1, 45, 8)],
      exercise_count: 1,
      started_at_ms: 0,
      now_ms: 0,
    });
    expect(out.volume_kg).toBe(60 * 10 + 45 * 8);
  });

  it('null reps / weight treated as 0', () => {
    const out = computeSessionStats({
      sets: [s('working', 1, null, 10), s('working', 1, 60, null)],
      exercise_count: 1,
      started_at_ms: 0,
      now_ms: 0,
    });
    expect(out.volume_kg).toBe(0);
  });

  it('duration_ms clamps to 0 on clock skew (now < start)', () => {
    const out = computeSessionStats({
      sets: [],
      exercise_count: 0,
      started_at_ms: 100,
      now_ms: 50,
    });
    expect(out.duration_ms).toBe(0);
  });

  it('exercise_count passes through verbatim', () => {
    const out = computeSessionStats({
      sets: [],
      exercise_count: 5,
      started_at_ms: 0,
      now_ms: 0,
    });
    expect(out.exercise_count).toBe(5);
  });
});

// ── Detail page stats (Agent A, Q10) ──────────────────────────────────────────

describe('computeDetailPageStats (detail page 4-tile)', () => {
  it('ended session: duration = ended_at - started_at; volume reflects sets; kcal passthrough', () => {
    const started_at = 1_700_000_000_000;
    const ended_at = started_at + (1 * 3600 + 13 * 60) * 1000;
    const stats = computeDetailPageStats({
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
    const stats = computeDetailPageStats({
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
    const stats = computeDetailPageStats({
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

// ── Formatters ────────────────────────────────────────────────────────────────

describe('formatVolumeShort', () => {
  it('zero → "0"', () => {
    expect(formatVolumeShort(0)).toBe('0');
  });

  it('< 1000 rounds to int', () => {
    expect(formatVolumeShort(425.7)).toBe('426');
  });

  it('>= 1000 shows 1 decimal k', () => {
    expect(formatVolumeShort(1234)).toBe('1.2k');
    expect(formatVolumeShort(12_500)).toBe('12.5k');
  });
});

// ── formatTrainingDuration — overnight #47 第 4 點 ────────────────────────────

describe('formatTrainingDuration (overnight #47)', () => {
  it('0 seconds → 0\' 00"', () => {
    expect(formatTrainingDuration(0)).toBe(`0' 00"`);
  });

  it('5 seconds → 0\' 05" (seconds zero-padded)', () => {
    expect(formatTrainingDuration(5)).toBe(`0' 05"`);
  });

  it('65 seconds → 1\' 05" (sub-hour, minutes unpadded)', () => {
    expect(formatTrainingDuration(65)).toBe(`1' 05"`);
  });

  it('1425 seconds (23:45) → 23\' 45"', () => {
    expect(formatTrainingDuration(1425)).toBe(`23' 45"`);
  });

  it('3600 seconds (exactly 1 hr) → 1 hr 0\' 00"', () => {
    expect(formatTrainingDuration(3600)).toBe(`1 hr 0' 00"`);
  });

  it('7325 seconds (2hr 2:05) → 2 hr 2\' 05"', () => {
    expect(formatTrainingDuration(7325)).toBe(`2 hr 2' 05"`);
  });

  it('negative seconds clamp to 0\' 00"', () => {
    expect(formatTrainingDuration(-1)).toBe(`0' 00"`);
    expect(formatTrainingDuration(-3600)).toBe(`0' 00"`);
  });

  it('non-finite seconds clamp to 0\' 00"', () => {
    expect(formatTrainingDuration(NaN)).toBe(`0' 00"`);
    expect(formatTrainingDuration(Infinity)).toBe(`0' 00"`);
    expect(formatTrainingDuration(-Infinity)).toBe(`0' 00"`);
  });

  it('floors fractional seconds before formatting', () => {
    expect(formatTrainingDuration(65.9)).toBe(`1' 05"`);
  });
});
