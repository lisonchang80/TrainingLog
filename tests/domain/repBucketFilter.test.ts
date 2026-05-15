import {
  REP_BUCKET_CHIPS,
  bucketDomainLabel,
  filterSetsByBucket,
  matchesChip,
  repRangeLabel,
  type RepBucketChip,
} from '../../src/domain/exercise/repBucketFilter';

describe('repBucketFilter — REP_BUCKET_CHIPS', () => {
  it('leads with "all" then 5 buckets low→high', () => {
    expect(REP_BUCKET_CHIPS).toEqual([
      'all',
      'max_strength',
      'strength',
      'hypertrophy',
      'muscle_endurance',
      'endurance',
    ]);
  });
});

describe('repBucketFilter — repRangeLabel', () => {
  it('renders ADR-0017 Q14 default labels', () => {
    expect(repRangeLabel('all')).toBe('全部');
    expect(repRangeLabel('max_strength')).toBe('1-3');
    expect(repRangeLabel('strength')).toBe('4-6');
    expect(repRangeLabel('hypertrophy')).toBe('7-10');
    expect(repRangeLabel('muscle_endurance')).toBe('11-15');
    expect(repRangeLabel('endurance')).toBe('16+');
  });
});

describe('repBucketFilter — bucketDomainLabel', () => {
  it('renders ADR-0009 amended bucket names', () => {
    expect(bucketDomainLabel('all')).toBe('全部');
    expect(bucketDomainLabel('max_strength')).toBe('最大力量');
    expect(bucketDomainLabel('strength')).toBe('力量');
    expect(bucketDomainLabel('hypertrophy')).toBe('增肌');
    expect(bucketDomainLabel('muscle_endurance')).toBe('肌耐力');
    expect(bucketDomainLabel('endurance')).toBe('耐力');
  });
});

describe('repBucketFilter — matchesChip', () => {
  it('"all" matches everything including invalid reps', () => {
    expect(matchesChip(5, 'all')).toBe(true);
    expect(matchesChip(null, 'all')).toBe(true);
    expect(matchesChip(0, 'all')).toBe(true);
  });

  it.each([
    [1, 'max_strength'],
    [3, 'max_strength'],
    [4, 'strength'],
    [6, 'strength'],
    [7, 'hypertrophy'],
    [10, 'hypertrophy'],
    [11, 'muscle_endurance'],
    [15, 'muscle_endurance'],
    [16, 'endurance'],
    [50, 'endurance'],
  ] as const)('reps=%i → bucket=%s', (reps, bucket) => {
    expect(matchesChip(reps, bucket)).toBe(true);
    // Non-matching buckets reject
    const others = (
      ['max_strength', 'strength', 'hypertrophy', 'muscle_endurance', 'endurance'] as RepBucketChip[]
    ).filter((b) => b !== bucket);
    for (const o of others) expect(matchesChip(reps, o)).toBe(false);
  });

  it('invalid reps never matches a specific bucket', () => {
    expect(matchesChip(null, 'max_strength')).toBe(false);
    expect(matchesChip(0, 'max_strength')).toBe(false);
    expect(matchesChip(NaN, 'strength')).toBe(false);
  });
});

describe('repBucketFilter — filterSetsByBucket', () => {
  const sets = [
    { id: 's1', reps: 2 },
    { id: 's2', reps: 5 },
    { id: 's3', reps: 8 },
    { id: 's4', reps: 12 },
    { id: 's5', reps: 20 },
    { id: 's6', reps: null },
  ];

  it('"all" returns every set unchanged (copy)', () => {
    const got = filterSetsByBucket(sets, 'all');
    expect(got.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
    expect(got).not.toBe(sets); // returns a copy
  });

  it('narrows by single bucket', () => {
    expect(filterSetsByBucket(sets, 'max_strength').map((s) => s.id)).toEqual(['s1']);
    expect(filterSetsByBucket(sets, 'strength').map((s) => s.id)).toEqual(['s2']);
    expect(filterSetsByBucket(sets, 'hypertrophy').map((s) => s.id)).toEqual(['s3']);
    expect(filterSetsByBucket(sets, 'muscle_endurance').map((s) => s.id)).toEqual(['s4']);
    expect(filterSetsByBucket(sets, 'endurance').map((s) => s.id)).toEqual(['s5']);
  });

  it('drops invalid-rep sets when narrowed to a specific bucket', () => {
    const got = filterSetsByBucket(sets, 'max_strength');
    expect(got.map((s) => s.id)).not.toContain('s6');
  });

  it('preserves input order', () => {
    const shuffled = [sets[4], sets[0], sets[2], sets[1]];
    const got = filterSetsByBucket(shuffled, 'all');
    expect(got.map((s) => s.id)).toEqual(['s5', 's1', 's3', 's2']);
  });
});
