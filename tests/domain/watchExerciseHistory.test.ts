import {
  buildWatchHistoryRecords,
  type BuildWatchHistoryOptions,
  type WatchHistorySetRow,
} from '../../src/domain/watch/watchExerciseHistory';

// zh weekday labels, index = Date.getDay() (0=Sun..6=Sat).
const ZH_WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'] as const;

// Local-noon timestamps so getMonth/getDate/getDay are stable across CI TZ.
const ms = (y: number, m: number, d: number) =>
  new Date(y, m - 1, d, 12, 0, 0).getTime();

function row(
  partial: Partial<WatchHistorySetRow> & {
    session_id: string;
    session_started_at: number;
  },
): WatchHistorySetRow {
  return {
    reps: 8,
    weight_kg: 80,
    set_kind: 'working',
    load_type: 'loaded',
    bw_snapshot_kg: null,
    ...partial,
  };
}

// Options factory — a constant `增肌` bucket keeps most assertions simple; the
// reps-dependent variant (below) proves the bucket tracks the TOP set's reps.
const mkOpts = (
  overrides?: Partial<BuildWatchHistoryOptions>,
): BuildWatchHistoryOptions => ({
  unit: 'kg',
  weekdayLabels: ZH_WEEKDAYS,
  topSetLabel: '頂組：',
  bucketLabelFor: (reps) => (reps == null ? '' : '增肌'),
  ...overrides,
});

describe('buildWatchHistoryRecords', () => {
  it('folds flat session-DESC rows into per-session records, newest first', () => {
    const t1 = ms(2026, 5, 26);
    const t2 = ms(2026, 5, 22);
    const rows: WatchHistorySetRow[] = [
      row({ session_id: 's1', session_started_at: t1, weight_kg: 80, reps: 8 }),
      row({ session_id: 's1', session_started_at: t1, weight_kg: 75, reps: 6 }),
      row({ session_id: 's2', session_started_at: t2, weight_kg: 70, reps: 10 }),
    ];
    const out = buildWatchHistoryRecords(rows, mkOpts());
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe('2026-05-26');
    // Full yyyy-MM-dd date header (2026-06-09 手機-aligned layout).
    expect(out[0].dateLabel).toBe(
      `2026-05-26 (${ZH_WEEKDAYS[new Date(t1).getDay()]})`,
    );
    expect(out[0].workingSetCount).toBe(2);
    expect(out[0].setLines).toEqual(['80kg×8', '75kg×6']);
    // 頂組 = heaviest set of the session (80kg×8).
    expect(out[0].topSetLine).toBe('頂組：80kg×8（增肌）');
    expect(out[1].id).toBe('2026-05-22');
    expect(out[1].setLines).toEqual(['70kg×10']);
    expect(out[1].topSetLine).toBe('頂組：70kg×10（增肌）');
  });

  it('excludes warmup sets from count + lines (but warmup never wins 頂組)', () => {
    const t = ms(2026, 5, 26);
    const out = buildWatchHistoryRecords(
      [
        // A heavy warmup must NOT become the 頂組 even though it's heaviest overall.
        row({ session_id: 's1', session_started_at: t, set_kind: 'warmup', weight_kg: 100, reps: 5 }),
        row({ session_id: 's1', session_started_at: t, set_kind: 'working', weight_kg: 80, reps: 8 }),
        row({ session_id: 's1', session_started_at: t, set_kind: 'dropset', weight_kg: 60, reps: 6 }),
      ],
      mkOpts(),
    );
    expect(out[0].workingSetCount).toBe(2); // working + dropset, warmup dropped
    expect(out[0].setLines).toEqual(['80kg×8', '60kg×6']);
    // 100kg warmup excluded → top = 80kg working (> 60kg dropset head).
    expect(out[0].topSetLine).toBe('頂組：80kg×8（增肌）');
  });

  it('頂組 bucket label tracks the TOP set\'s reps', () => {
    const t = ms(2026, 5, 26);
    const out = buildWatchHistoryRecords(
      [
        row({ session_id: 's1', session_started_at: t, weight_kg: 100, reps: 3 }), // heaviest
        row({ session_id: 's1', session_started_at: t, weight_kg: 60, reps: 12 }),
      ],
      mkOpts({
        bucketLabelFor: (reps) =>
          reps == null ? '' : reps <= 6 ? '力量' : reps <= 10 ? '增肌' : '耐力',
      }),
    );
    // Top = 100kg×3 → bucket from 3 reps = 力量 (not the 60kg×12 set's 耐力).
    expect(out[0].topSetLine).toBe('頂組：100kg×3（力量）');
  });

  it('picks 頂組 by effective load, not raw weight (assisted)', () => {
    const t = ms(2026, 5, 26);
    // Assisted: eff = bw - weight, so the LOWER assist weight is the harder set.
    const out = buildWatchHistoryRecords(
      [
        row({ session_id: 's1', session_started_at: t, load_type: 'assisted', bw_snapshot_kg: 80, weight_kg: 30, reps: 8 }), // eff 50
        row({ session_id: 's1', session_started_at: t, load_type: 'assisted', bw_snapshot_kg: 80, weight_kg: 20, reps: 6 }), // eff 60 → top
      ],
      mkOpts(),
    );
    // eff-based pick → the 20kg (reps 6) set, NOT the heavier-by-raw-weight 30kg.
    expect(out[0].topSetLine).toBe('頂組：20kg×6（增肌）');
  });

  it('converts weights to lb when unit=lb (displayWeight, 1-dp)', () => {
    const t = ms(2026, 5, 26);
    const out = buildWatchHistoryRecords(
      [row({ session_id: 's1', session_started_at: t, weight_kg: 80, reps: 8 })],
      mkOpts({ unit: 'lb' }),
    );
    // kgToLb(80)=176.3698 → round 1-dp → 176.4
    expect(out[0].setLines).toEqual(['176.4lb×8']);
    expect(out[0].topSetLine).toBe('頂組：176.4lb×8（增肌）');
  });

  it('renders bodyweight (null / 0 added weight) as BW×reps; 頂組 null when no weighted set', () => {
    const t = ms(2026, 5, 26);
    const out = buildWatchHistoryRecords(
      [
        row({ session_id: 's1', session_started_at: t, load_type: 'bodyweight', weight_kg: null, reps: 12 }),
        row({ session_id: 's1', session_started_at: t, load_type: 'bodyweight', weight_kg: 0, reps: 15 }),
      ],
      mkOpts(),
    );
    expect(out[0].setLines).toEqual(['BW×12', 'BW×15']);
    // No eligible weighted set (null/0) → 頂組 hidden. '' (wire-safe sentinel,
    // NOT null — a JS null would bridge to NSNull and WCSession would reject).
    expect(out[0].topSetLine).toBe('');
  });

  it('caps at limitSessions (default 3) most-recent sessions', () => {
    const rows: WatchHistorySetRow[] = [5, 4, 3, 2, 1].map((d) =>
      row({ session_id: `s${d}`, session_started_at: ms(2026, 5, 20 + d) }),
    );
    const def = buildWatchHistoryRecords(rows, mkOpts());
    expect(def).toHaveLength(3);
    expect(def.map((r) => r.id)).toEqual(['2026-05-25', '2026-05-24', '2026-05-23']);
    const two = buildWatchHistoryRecords(rows, mkOpts({ limitSessions: 2 }));
    expect(two).toHaveLength(2);
  });

  it('skips a warmup-only session so the N returned are meaningful', () => {
    const out = buildWatchHistoryRecords(
      [
        row({ session_id: 's1', session_started_at: ms(2026, 5, 26), set_kind: 'warmup' }),
        row({ session_id: 's2', session_started_at: ms(2026, 5, 22), set_kind: 'working', weight_kg: 70, reps: 8 }),
      ],
      mkOpts({ limitSessions: 1 }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('2026-05-22'); // warmup-only s1 skipped
  });

  it('returns [] for no rows', () => {
    expect(buildWatchHistoryRecords([], mkOpts())).toEqual([]);
  });
});
