import {
  buildChartSeries,
  type ChartInputRow,
} from '../../src/domain/exercise/exerciseChart';

const row = (over: Partial<ChartInputRow>): ChartInputRow => ({
  id: 'r',
  session_id: 's1',
  session_started_at: 1000,
  weight_kg: 60,
  reps: 8,
  is_skipped: 0,
  load_type: 'loaded',
  bw_snapshot_kg: null,
  ...over,
});

describe('exerciseChart — buildChartSeries', () => {
  it('returns empty series for empty input', () => {
    const s = buildChartSeries([], 'all');
    expect(s.volume).toEqual([]);
    expect(s.max_weight).toEqual([]);
    expect(s.e1rm).toEqual([]);
  });

  it('aggregates volume = Σ(weight × reps) per session', () => {
    const rows = [
      row({ id: 'a', session_id: 's1', weight_kg: 60, reps: 8 }), // 480
      row({ id: 'b', session_id: 's1', weight_kg: 70, reps: 5 }), // 350
      row({ id: 'c', session_id: 's2', session_started_at: 2000, weight_kg: 100, reps: 3 }), // 300
    ];
    const s = buildChartSeries(rows, 'all');
    expect(s.volume).toEqual([
      { session_id: 's1', started_at: 1000, value: 830 },
      { session_id: 's2', started_at: 2000, value: 300 },
    ]);
  });

  it('max_weight = effective load max across sets in session', () => {
    const rows = [
      row({ id: 'a', session_id: 's1', weight_kg: 60, reps: 8 }),
      row({ id: 'b', session_id: 's1', weight_kg: 80, reps: 3 }),
      row({ id: 'c', session_id: 's1', weight_kg: 70, reps: 5 }),
    ];
    const s = buildChartSeries(rows, 'all');
    expect(s.max_weight).toEqual([
      { session_id: 's1', started_at: 1000, value: 80 },
    ]);
  });

  it('e1rm = Epley max per session', () => {
    const rows = [
      row({ id: 'a', session_id: 's1', weight_kg: 100, reps: 3 }), // 100 * (1 + 3/30) = 110
      row({ id: 'b', session_id: 's1', weight_kg: 80, reps: 10 }), // 80 * (1 + 10/30) ≈ 106.67
    ];
    const s = buildChartSeries(rows, 'all');
    expect(s.e1rm[0].value).toBeCloseTo(110, 5);
  });

  it('sorts all series by started_at ASC (time forward)', () => {
    const rows = [
      row({ id: 'a', session_id: 's1', session_started_at: 3000, weight_kg: 50, reps: 5 }),
      row({ id: 'b', session_id: 's2', session_started_at: 1000, weight_kg: 60, reps: 5 }),
      row({ id: 'c', session_id: 's3', session_started_at: 2000, weight_kg: 70, reps: 5 }),
    ];
    const s = buildChartSeries(rows, 'all');
    expect(s.volume.map((p) => p.session_id)).toEqual(['s2', 's3', 's1']);
    expect(s.max_weight.map((p) => p.session_id)).toEqual(['s2', 's3', 's1']);
    expect(s.e1rm.map((p) => p.session_id)).toEqual(['s2', 's3', 's1']);
  });

  it('drops skipped sets from aggregation', () => {
    const rows = [
      row({ id: 'a', weight_kg: 60, reps: 8, is_skipped: 0 }), // counts
      row({ id: 'b', weight_kg: 100, reps: 8, is_skipped: 1 }), // ignored
    ];
    const s = buildChartSeries(rows, 'all');
    expect(s.volume[0].value).toBe(480);
    expect(s.max_weight[0].value).toBe(60);
  });

  describe('rep bucket chip filter (ADR-0017 Q14)', () => {
    const rows = [
      row({ id: 'a', session_id: 's1', weight_kg: 100, reps: 3 }),  // max_strength,  vol=300, e1rm=110
      row({ id: 'b', session_id: 's1', weight_kg: 80, reps: 8 }),   // hypertrophy,   vol=640
      row({ id: 'c', session_id: 's2', session_started_at: 2000, weight_kg: 60, reps: 12 }), // muscle_endurance
    ];

    it('chip=hypertrophy filters volume to hypertrophy sets only', () => {
      const s = buildChartSeries(rows, 'hypertrophy');
      // s1 keeps only set b (640); s2 has no hypertrophy set → dropped
      expect(s.volume).toEqual([
        { session_id: 's1', started_at: 1000, value: 640 },
      ]);
    });

    it('chip=max_strength filters max_weight to that bucket', () => {
      const s = buildChartSeries(rows, 'max_strength');
      expect(s.max_weight).toEqual([
        { session_id: 's1', started_at: 1000, value: 100 },
      ]);
    });

    it('e1rm line is NOT chip-filtered (Q14 rule)', () => {
      // Even though chip=hypertrophy, e1rm still uses set 'a' (max_strength) which has the higher e1rm
      const s = buildChartSeries(rows, 'hypertrophy');
      expect(s.e1rm.map((p) => p.session_id).sort()).toEqual(['s1', 's2']);
      expect(s.e1rm[0].value).toBeCloseTo(110, 5); // from set a (100 × 1.1)
    });
  });

  describe('load_type asymmetry', () => {
    it('loaded: weight × reps', () => {
      const s = buildChartSeries(
        [row({ weight_kg: 100, reps: 5, load_type: 'loaded' })],
        'all'
      );
      expect(s.volume[0].value).toBe(500);
    });

    it('pure bodyweight (B with weight=0): volume=0, e1rm null → e1rm point dropped', () => {
      const s = buildChartSeries(
        [row({ weight_kg: 0, reps: 10, load_type: 'bodyweight' })],
        'all'
      );
      expect(s.volume[0].value).toBe(0);
      expect(s.e1rm).toEqual([]);
    });

    it('assisted: (bw − weight) × reps; bw_snapshot required', () => {
      const s = buildChartSeries(
        [row({ weight_kg: 30, reps: 5, load_type: 'assisted', bw_snapshot_kg: 80 })],
        'all'
      );
      // effective = 80 - 30 = 50; volume = 50 * 5 = 250
      expect(s.volume[0].value).toBe(250);
      expect(s.max_weight[0].value).toBe(50);
    });

    it('assisted without bw_snapshot: no volume / no e1rm; max_weight also dropped', () => {
      const s = buildChartSeries(
        [row({ weight_kg: 30, reps: 5, load_type: 'assisted', bw_snapshot_kg: null })],
        'all'
      );
      expect(s.volume).toEqual([]);
      expect(s.max_weight).toEqual([]);
      expect(s.e1rm).toEqual([]);
    });
  });

  it('drops sessions where no set produces a valid metric (per-series independently)', () => {
    const rows = [
      // s1: pure bw → volume 0, no max_weight, no e1rm
      row({ id: 'a', session_id: 's1', weight_kg: 0, reps: 10, load_type: 'bodyweight' }),
      // s2: normal loaded set → all three lines have data
      row({ id: 'b', session_id: 's2', session_started_at: 2000, weight_kg: 100, reps: 5 }),
    ];
    const s = buildChartSeries(rows, 'all');
    // volume keeps both (s1 has valid 0; volume rule: pure-bw is a valid 0)
    expect(s.volume.map((p) => p.session_id)).toEqual(['s1', 's2']);
    // max_weight drops s1
    expect(s.max_weight.map((p) => p.session_id)).toEqual(['s2']);
    // e1rm drops s1
    expect(s.e1rm.map((p) => p.session_id)).toEqual(['s2']);
  });
});
