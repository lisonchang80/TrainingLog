import {
  computeSessionStats,
  formatSessionDuration,
  formatVolumeShort,
  type SessionStatsSetInput,
} from '../../src/domain/session/sessionStats';

/**
 * ADR-0019 Q6 in-session stats panel — pure 3-tile computation.
 */

function s(
  set_kind: 'warmup' | 'working' | 'dropset',
  is_logged: 0 | 1,
  weight_kg: number | null = 60,
  reps: number | null = 10,
): SessionStatsSetInput {
  return { set_kind, is_logged, weight_kg, reps };
}

describe('computeSessionStats', () => {
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
    expect(out.volume_kg).toBe(600); // 60 * 10 only
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

describe('formatSessionDuration', () => {
  it('< 1 minute → 00:SS', () => {
    expect(formatSessionDuration(30_000)).toBe('00:30');
  });

  it('< 1h → MM:SS', () => {
    expect(formatSessionDuration(42 * 60_000 + 7_000)).toBe('42:07');
  });

  it('exactly 1h → 1:00', () => {
    expect(formatSessionDuration(60 * 60_000)).toBe('1:00');
  });

  it('1h 23min → 1:23 (seconds dropped over 1h)', () => {
    expect(formatSessionDuration(60 * 60_000 + 23 * 60_000 + 45_000)).toBe(
      '1:23',
    );
  });

  it('0 → 00:00', () => {
    expect(formatSessionDuration(0)).toBe('00:00');
  });

  it('negative clamps to 00:00', () => {
    expect(formatSessionDuration(-100)).toBe('00:00');
  });
});

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
