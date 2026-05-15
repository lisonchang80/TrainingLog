import { buildSupersetChartSeries } from '../../src/domain/superset/supersetChart';
import type {
  ExerciseHistoryRow,
  ReusableSupersetHistoryRow,
} from '../../src/adapters/sqlite/exerciseHistoryRepository';

const setRow = (over: Partial<ExerciseHistoryRow>): ExerciseHistoryRow => ({
  session_id: 's1',
  session_started_at: 1000,
  set_id: 'r',
  reps: 8,
  weight_kg: 60,
  set_kind: null,
  rep_bucket: 'hypertrophy',
  ordering: 1,
  load_type: 'loaded',
  bw_snapshot_kg: null,
  ...over,
});

const pairedRow = (
  session_id: string,
  started_at: number,
  setsA: Partial<ExerciseHistoryRow>[],
  setsB: Partial<ExerciseHistoryRow>[]
): ReusableSupersetHistoryRow => ({
  session_id,
  session_started_at: started_at,
  bw_snapshot_kg: null,
  sides: [
    {
      position: 0,
      exercise_id: 'exA',
      exercise_name: 'Bench Press',
      load_type: 'loaded',
      sets: setsA.map((s, i) =>
        setRow({
          session_id,
          session_started_at: started_at,
          set_id: `${session_id}-A-${i}`,
          ordering: i + 1,
          ...s,
        })
      ),
    },
    {
      position: 1,
      exercise_id: 'exB',
      exercise_name: 'Row',
      load_type: 'loaded',
      sets: setsB.map((s, i) =>
        setRow({
          session_id,
          session_started_at: started_at,
          set_id: `${session_id}-B-${i}`,
          ordering: i + 1,
          ...s,
        })
      ),
    },
  ],
});

describe('supersetChart — buildSupersetChartSeries', () => {
  it('returns empty a/b series for empty input', () => {
    const s = buildSupersetChartSeries([], 'all');
    expect(s.a.volume).toEqual([]);
    expect(s.a.max_weight).toEqual([]);
    expect(s.a.e1rm).toEqual([]);
    expect(s.b.volume).toEqual([]);
    expect(s.b.max_weight).toEqual([]);
    expect(s.b.e1rm).toEqual([]);
  });

  it('splits sets into A vs B and aggregates volume per side per session', () => {
    const rows = [
      pairedRow(
        's1',
        1000,
        [
          { weight_kg: 60, reps: 8 }, // A vol = 480
          { weight_kg: 70, reps: 5 }, // A vol = 350
        ],
        [
          { weight_kg: 40, reps: 10 }, // B vol = 400
        ]
      ),
    ];
    const s = buildSupersetChartSeries(rows, 'all');
    expect(s.a.volume).toEqual([
      { session_id: 's1', started_at: 1000, value: 830 },
    ]);
    expect(s.b.volume).toEqual([
      { session_id: 's1', started_at: 1000, value: 400 },
    ]);
  });

  it('max_weight is per-side independent', () => {
    const rows = [
      pairedRow(
        's1',
        1000,
        [{ weight_kg: 100, reps: 3 }],
        [{ weight_kg: 50, reps: 10 }]
      ),
    ];
    const s = buildSupersetChartSeries(rows, 'all');
    expect(s.a.max_weight[0].value).toBe(100);
    expect(s.b.max_weight[0].value).toBe(50);
  });

  it('chip filter narrows volume/max_weight per side but NOT e1rm (Q14 semantics)', () => {
    // 6 reps = strength bucket, 12 reps = hypertrophy
    const rows = [
      pairedRow(
        's1',
        1000,
        [
          { weight_kg: 100, reps: 6 }, // A strength
          { weight_kg: 60, reps: 12 }, // A hypertrophy
        ],
        [
          { weight_kg: 80, reps: 6 }, // B strength
          { weight_kg: 40, reps: 12 }, // B hypertrophy
        ]
      ),
    ];
    const s = buildSupersetChartSeries(rows, 'strength');
    // Only strength sets contribute to volume / max_weight
    expect(s.a.volume[0].value).toBe(600); // 100 * 6
    expect(s.b.volume[0].value).toBe(480); // 80 * 6
    expect(s.a.max_weight[0].value).toBe(100);
    expect(s.b.max_weight[0].value).toBe(80);
    // e1rm uses ALL sets — picks Epley max across both buckets
    expect(s.a.e1rm[0].value).toBeGreaterThan(100); // best of 100*6 and 60*12
    expect(s.b.e1rm[0].value).toBeGreaterThan(80);
  });

  it('sorts each side by session started_at ASC (time forward)', () => {
    const rows = [
      pairedRow('s2', 2000, [{ weight_kg: 60, reps: 8 }], [{ weight_kg: 40, reps: 8 }]),
      pairedRow('s1', 1000, [{ weight_kg: 50, reps: 8 }], [{ weight_kg: 30, reps: 8 }]),
    ];
    const s = buildSupersetChartSeries(rows, 'all');
    expect(s.a.volume.map((p) => p.session_id)).toEqual(['s1', 's2']);
    expect(s.b.volume.map((p) => p.session_id)).toEqual(['s1', 's2']);
  });

  it('handles sessions where one side has no sets — still contributes the other', () => {
    const rows = [
      pairedRow('s1', 1000, [{ weight_kg: 60, reps: 8 }], []),
    ];
    const s = buildSupersetChartSeries(rows, 'all');
    expect(s.a.volume).toEqual([
      { session_id: 's1', started_at: 1000, value: 480 },
    ]);
    expect(s.b.volume).toEqual([]);
  });
});
