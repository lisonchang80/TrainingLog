/**
 * Tests for the pure achievements-panel view-model
 * (`src/domain/achievement/achievementPanelModel.ts`, ADR-0009 Slice 17).
 *
 * Coverage:
 *   - default tier ladders derived from definition rows (1/10/.../50, session 1..500)
 *   - 碰過 filtering (only touched mg/bucket cards appear)
 *   - first_combo → bucket card level-0「入門」badge (entryBadge)
 *   - session_count milestone always shown
 *   - top-tier maxed (nextThreshold null)
 *   - numerator/denominator (currentCount / nextThreshold) correctness
 */

import {
  buildAchievementPanelCards,
  type PanelModelInput,
} from '../../src/domain/achievement/achievementPanelModel';
import type { AchievementDefinitionRow } from '../../src/domain/achievement/types';

// ---- seed-shaped fixtures --------------------------------------------------

const PR_LADDER = [1, 10, 20, 30, 40, 50] as const;
const SESSION_LADDER = [1, 5, 10, 25, 50, 100, 250, 500] as const;

let idSeq = 0;
const nextId = () => ++idSeq;

function def(o: Partial<AchievementDefinitionRow>): AchievementDefinitionRow {
  return {
    id: nextId(),
    code: `code-${idSeq}`,
    category: 'session_count',
    display_name: '',
    description: null,
    mg_id: null,
    bucket_id: null,
    pr_type: null,
    threshold: null,
    tier: 1,
    ...o,
  };
}

/** Build a full pr_per_mg ladder (weight+volume) for one mg. */
function mgLadder(mg: string): AchievementDefinitionRow[] {
  const rows: AchievementDefinitionRow[] = [];
  for (const type of ['weight', 'volume'] as const) {
    PR_LADDER.forEach((threshold, idx) =>
      rows.push(def({ category: 'pr_per_mg', mg_id: mg, pr_type: type, threshold, tier: idx + 1 }))
    );
  }
  return rows;
}

/** Build a full pr_per_bucket ladder (weight+volume) for one bucket. */
function bucketLadder(bucket: string): AchievementDefinitionRow[] {
  const rows: AchievementDefinitionRow[] = [];
  for (const type of ['weight', 'volume'] as const) {
    PR_LADDER.forEach((threshold, idx) =>
      rows.push(
        def({ category: 'pr_per_bucket', bucket_id: bucket, pr_type: type, threshold, tier: idx + 1 })
      )
    );
  }
  return rows;
}

function sessionLadder(): AchievementDefinitionRow[] {
  return SESSION_LADDER.map((threshold, idx) =>
    def({ category: 'session_count', threshold, tier: idx + 1 })
  );
}

function firstCombo(mg: string, bucket: string): AchievementDefinitionRow {
  return def({ category: 'first_combo', mg_id: mg, bucket_id: bucket });
}

function baseInput(over: Partial<PanelModelInput> = {}): PanelModelInput {
  return {
    defs: [],
    unlockedIds: new Set<number>(),
    perMg: new Map(),
    perBucket: new Map(),
    touchedMgs: new Set<string>(),
    touchedBuckets: new Set<string>(),
    totalSessionCount: 0,
    ...over,
  };
}

beforeEach(() => {
  idSeq = 0;
});

// ---- 碰過 filtering --------------------------------------------------------

describe('碰過 filtering — mg cards', () => {
  it('shows mg cards ONLY for touched muscle groups', () => {
    const defs = [...mgLadder('mg-chest'), ...mgLadder('mg-back')];
    const input = baseInput({ defs, touchedMgs: new Set(['mg-chest']) });
    const cards = buildAchievementPanelCards(input, 'mg');
    expect(cards.map((c) => c.groupId).sort()).toEqual(['mg-chest', 'mg-chest']);
    // two cards: weight + volume for chest only
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.prType).sort()).toEqual(['volume', 'weight']);
  });

  it('returns no mg cards when nothing is touched', () => {
    const defs = mgLadder('mg-chest');
    expect(buildAchievementPanelCards(baseInput({ defs }), 'mg')).toHaveLength(0);
  });
});

describe('碰過 filtering — bucket cards', () => {
  it('shows bucket cards ONLY for touched buckets', () => {
    const defs = [...bucketLadder('hypertrophy'), ...bucketLadder('strength')];
    const input = baseInput({ defs, touchedBuckets: new Set(['hypertrophy']) });
    const cards = buildAchievementPanelCards(input, 'bucket');
    expect(new Set(cards.map((c) => c.groupId))).toEqual(new Set(['hypertrophy']));
    expect(cards).toHaveLength(2);
  });
});

// ---- default ladder + numerator/denominator -------------------------------

describe('tier state — default ladders', () => {
  it('count below first rung → tier 0, next = 1, not maxed', () => {
    const defs = mgLadder('mg-chest');
    const input = baseInput({ defs, touchedMgs: new Set(['mg-chest']) });
    const card = buildAchievementPanelCards(input, 'mg').find((c) => c.prType === 'weight')!;
    expect(card.currentTier).toBe(0);
    expect(card.currentCount).toBe(0);
    expect(card.nextThreshold).toBe(1);
    expect(card.reachedThreshold).toBe(0);
    expect(card.maxed).toBe(false);
    expect(card.totalTiers).toBe(6);
  });

  it('count between rungs → correct tier + numerator/denominator', () => {
    const defs = mgLadder('mg-chest');
    const input = baseInput({
      defs,
      touchedMgs: new Set(['mg-chest']),
      perMg: new Map([['mg-chest', { weight: 23, volume: 5 }]]),
    });
    const cards = buildAchievementPanelCards(input, 'mg');
    const w = cards.find((c) => c.prType === 'weight')!;
    // ladder 1,10,20,30,40,50; count 23 → cleared 1,10,20 = tier 3, next 30
    expect(w.currentTier).toBe(3);
    expect(w.reachedThreshold).toBe(20);
    expect(w.currentCount).toBe(23);
    expect(w.nextThreshold).toBe(30);
    expect(w.maxed).toBe(false);
    const v = cards.find((c) => c.prType === 'volume')!;
    // count 5 → cleared only 1 = tier 1, next 10
    expect(v.currentTier).toBe(1);
    expect(v.reachedThreshold).toBe(1);
    expect(v.nextThreshold).toBe(10);
  });

  it('exact threshold counts toward that rung', () => {
    const defs = mgLadder('mg-chest');
    const input = baseInput({
      defs,
      touchedMgs: new Set(['mg-chest']),
      perMg: new Map([['mg-chest', { weight: 10, volume: 0 }]]),
    });
    const w = buildAchievementPanelCards(input, 'mg').find((c) => c.prType === 'weight')!;
    expect(w.currentTier).toBe(2); // 1 and 10 cleared
    expect(w.reachedThreshold).toBe(10);
    expect(w.nextThreshold).toBe(20);
  });
});

// ---- top-tier maxed --------------------------------------------------------

describe('top tier maxed', () => {
  it('count ≥ top rung → maxed, nextThreshold null, tierIndex = totalTiers', () => {
    const defs = mgLadder('mg-chest');
    const input = baseInput({
      defs,
      touchedMgs: new Set(['mg-chest']),
      perMg: new Map([['mg-chest', { weight: 999, volume: 50 }]]),
    });
    const cards = buildAchievementPanelCards(input, 'mg');
    for (const c of cards) {
      expect(c.maxed).toBe(true);
      expect(c.nextThreshold).toBeNull();
      expect(c.currentTier).toBe(6);
      expect(c.tierIndex).toBe(6);
    }
  });
});

// ---- first_combo → entry badge --------------------------------------------

describe('first_combo → bucket card level-0「入門」badge', () => {
  it('entryBadge lit when bucket is 碰過', () => {
    const defs = bucketLadder('hypertrophy');
    const input = baseInput({ defs, touchedBuckets: new Set(['hypertrophy']) });
    const cards = buildAchievementPanelCards(input, 'bucket');
    expect(cards.every((c) => c.entryBadge)).toBe(true);
  });

  it('entryBadge lit (and card shown) via an unlocked first_combo even if touched set is absent', () => {
    const fc = firstCombo('mg-chest', 'hypertrophy');
    const defs = [fc, ...bucketLadder('hypertrophy')];
    const input = baseInput({
      defs,
      touchedBuckets: new Set<string>(), // not in the working-set touched set
      unlockedIds: new Set([fc.id]),
    });
    const cards = buildAchievementPanelCards(input, 'bucket');
    expect(cards).toHaveLength(2);
    expect(cards.every((c) => c.entryBadge)).toBe(true);
  });

  it('no first_combo unlock + not touched → bucket card hidden', () => {
    const fc = firstCombo('mg-chest', 'hypertrophy');
    const defs = [fc, ...bucketLadder('hypertrophy')];
    const input = baseInput({ defs }); // nothing unlocked, nothing touched
    expect(buildAchievementPanelCards(input, 'bucket')).toHaveLength(0);
  });
});

// ---- milestone always shown -----------------------------------------------

describe('session_count milestone — always shown', () => {
  it('milestone card is returned even with zero sessions', () => {
    const defs = sessionLadder();
    const cards = buildAchievementPanelCards(baseInput({ defs }), 'milestone');
    expect(cards).toHaveLength(1);
    const m = cards[0];
    expect(m.kind).toBe('milestone');
    expect(m.currentCount).toBe(0);
    expect(m.currentTier).toBe(0);
    expect(m.nextThreshold).toBe(1);
    expect(m.totalTiers).toBe(8);
  });

  it('milestone uses the session ladder (1,5,10,25,50,100,250,500)', () => {
    const defs = sessionLadder();
    const input = baseInput({ defs, totalSessionCount: 30 });
    const m = buildAchievementPanelCards(input, 'milestone')[0];
    // cleared 1,5,10,25 = tier 4, next 50
    expect(m.currentTier).toBe(4);
    expect(m.reachedThreshold).toBe(25);
    expect(m.nextThreshold).toBe(50);
    expect(m.maxed).toBe(false);
  });

  it('milestone maxed at 500+', () => {
    const defs = sessionLadder();
    const m = buildAchievementPanelCards(baseInput({ defs, totalSessionCount: 600 }), 'milestone')[0];
    expect(m.maxed).toBe(true);
    expect(m.nextThreshold).toBeNull();
    expect(m.currentTier).toBe(8);
  });
});

// ---- 'all' filter aggregation ---------------------------------------------

describe("'all' filter aggregates mg + bucket + milestone", () => {
  it('returns touched mg cards, touched bucket cards, and the milestone', () => {
    const defs = [
      ...mgLadder('mg-chest'),
      ...bucketLadder('hypertrophy'),
      ...sessionLadder(),
    ];
    const input = baseInput({
      defs,
      touchedMgs: new Set(['mg-chest']),
      touchedBuckets: new Set(['hypertrophy']),
    });
    const cards = buildAchievementPanelCards(input, 'all');
    const kinds = cards.map((c) => c.kind);
    expect(kinds.filter((k) => k === 'mg')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'bucket')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'milestone')).toHaveLength(1);
    // milestone is last
    expect(cards[cards.length - 1].kind).toBe('milestone');
  });

  it('milestone still present in all even with no touched groups', () => {
    const defs = [...mgLadder('mg-chest'), ...sessionLadder()];
    const cards = buildAchievementPanelCards(baseInput({ defs }), 'all');
    expect(cards).toHaveLength(1);
    expect(cards[0].kind).toBe('milestone');
  });
});

// ---- ordering preserves definition order ----------------------------------

describe('card ordering', () => {
  it('mg cards follow definition order, weight before volume', () => {
    const defs = [...mgLadder('mg-chest'), ...mgLadder('mg-back')];
    const input = baseInput({ defs, touchedMgs: new Set(['mg-chest', 'mg-back']) });
    const cards = buildAchievementPanelCards(input, 'mg');
    expect(cards.map((c) => `${c.groupId}:${c.prType}`)).toEqual([
      'mg-chest:weight',
      'mg-chest:volume',
      'mg-back:weight',
      'mg-back:volume',
    ]);
  });
});

// =====================================================================
// Slice 17 hardening (2026-06-16) — exhaustive tier-threshold boundary
// table + 4-category + volume/weight coverage.
// PR ladder = 1/10/20/30/40/50 (6 rungs). Tier thresholds per spec.
// =====================================================================

describe('tier-threshold boundary table — PR ladder 1/10/20/30/40/50', () => {
  /**
   * For a given cumulative PR count, return the weight card built off a
   * single touched mg ladder. Centralises the fixture so every boundary
   * row reads as one assertion.
   */
  const weightCardAt = (count: number) => {
    const defs = mgLadder('mg-chest');
    const input = baseInput({
      defs,
      touchedMgs: new Set(['mg-chest']),
      perMg: new Map([['mg-chest', { weight: count, volume: 0 }]]),
    });
    return buildAchievementPanelCards(input, 'mg').find((c) => c.prType === 'weight')!;
  };

  // [count, expectedTier (第N級), expectedNextThreshold, expectedReached]
  const table: ReadonlyArray<[number, number, number | null, number]> = [
    [0, 0, 1, 0], // below first rung
    [1, 1, 10, 1], // exactly first rung
    [9, 1, 10, 1], // just below second rung
    [10, 2, 20, 10], // exactly second rung
    [11, 2, 20, 10], // just above second rung
    [19, 2, 20, 10], // just below third rung
    [20, 3, 30, 20], // exactly third rung
    [49, 5, 50, 40], // just below top rung
    [50, 6, null, 50], // exactly top rung → maxed
    [51, 6, null, 50], // above top rung → still maxed
  ];

  it.each(table)(
    'count %d → 第%d級, next=%s, reached=%d',
    (count, tier, next, reached) => {
      const card = weightCardAt(count);
      expect(card.currentCount).toBe(count);
      expect(card.currentTier).toBe(tier);
      expect(card.reachedThreshold).toBe(reached);
      expect(card.nextThreshold).toBe(next);
      expect(card.totalTiers).toBe(6);
    },
  );

  it('numerator/denominator (currentCount / nextThreshold) — mid-ladder progress bar', () => {
    const card = weightCardAt(23);
    // Progress toward the next rung: 23 cleared toward the 30 rung.
    expect(card.currentCount).toBe(23);
    expect(card.nextThreshold).toBe(30);
    expect(card.maxed).toBe(false);
  });
});

describe('maxed state at count ≥ top rung', () => {
  const cardAt = (count: number) =>
    buildAchievementPanelCards(
      baseInput({
        defs: mgLadder('mg-chest'),
        touchedMgs: new Set(['mg-chest']),
        perMg: new Map([['mg-chest', { weight: count, volume: 0 }]]),
      }),
      'mg',
    ).find((c) => c.prType === 'weight')!;

  it('count === 50 (top rung) → maxed, nextThreshold null, tier 6, tierIndex 6', () => {
    const c = cardAt(50);
    expect(c.maxed).toBe(true);
    expect(c.nextThreshold).toBeNull();
    expect(c.currentTier).toBe(6);
    expect(c.tierIndex).toBe(6);
    expect(c.reachedThreshold).toBe(50);
  });

  it('count far above top rung keeps the same maxed view-model (no over-count tier inflation)', () => {
    const c = cardAt(1_000);
    expect(c.maxed).toBe(true);
    expect(c.nextThreshold).toBeNull();
    expect(c.currentTier).toBe(6); // clamped to ladder length, never 7+
    expect(c.tierIndex).toBe(6);
    // currentCount still reflects the raw achieved count (denominator side
    // is null when maxed, so the bar renders full).
    expect(c.currentCount).toBe(1_000);
  });
});

describe('「碰過」filter — only touched groups produce cards', () => {
  it('an untouched mg with a full ladder yields NO card even with PR counts present', () => {
    // Counts exist (e.g. a stale replay) but the mg is not in touchedMgs —
    // mirrors a warmup-only / never-worked muscle group being excluded.
    const defs = mgLadder('mg-legs');
    const input = baseInput({
      defs,
      touchedMgs: new Set<string>(), // NOT touched
      perMg: new Map([['mg-legs', { weight: 30, volume: 30 }]]),
    });
    expect(buildAchievementPanelCards(input, 'mg')).toHaveLength(0);
  });

  it('touched mg surfaces both weight + volume cards; untouched sibling is excluded', () => {
    const defs = [...mgLadder('mg-chest'), ...mgLadder('mg-legs')];
    const input = baseInput({
      defs,
      touchedMgs: new Set(['mg-chest']), // only chest "碰過"
      perMg: new Map([
        ['mg-chest', { weight: 5, volume: 2 }],
        ['mg-legs', { weight: 9, volume: 9 }],
      ]),
    });
    const cards = buildAchievementPanelCards(input, 'mg');
    expect(cards).toHaveLength(2);
    expect(new Set(cards.map((c) => c.groupId))).toEqual(new Set(['mg-chest']));
    expect(cards.map((c) => c.prType).sort()).toEqual(['volume', 'weight']);
  });

  it('an untouched bucket with no first_combo unlock is excluded (warmup-only bucket case)', () => {
    const defs = bucketLadder('max_strength');
    const input = baseInput({
      defs,
      touchedBuckets: new Set<string>(),
      perBucket: new Map([['max_strength', { weight: 12, volume: 0 }]]),
    });
    expect(buildAchievementPanelCards(input, 'bucket')).toHaveLength(0);
  });
});

describe('first_combo → bucket level-0「入門」badge (entryBadge)', () => {
  it('first_combo unlock alone (no working set) still shows the card + lights entryBadge at tier 0', () => {
    const fc = firstCombo('mg-chest', 'strength');
    const defs = [fc, ...bucketLadder('strength')];
    const input = baseInput({
      defs,
      touchedBuckets: new Set<string>(), // no working set
      unlockedIds: new Set([fc.id]),
      perBucket: new Map(), // zero PRs → tier 0
    });
    const cards = buildAchievementPanelCards(input, 'bucket');
    expect(cards).toHaveLength(2);
    for (const c of cards) {
      expect(c.entryBadge).toBe(true);
      expect(c.currentTier).toBe(0); // level-0 入門, no rung cleared yet
      expect(c.tierIndex).toBe(0);
      expect(c.kind).toBe('bucket');
    }
  });

  it('mg cards never carry an entryBadge (bucket-only concept)', () => {
    const defs = mgLadder('mg-chest');
    const input = baseInput({ defs, touchedMgs: new Set(['mg-chest']) });
    const cards = buildAchievementPanelCards(input, 'mg');
    expect(cards.every((c) => c.entryBadge === false)).toBe(true);
  });
});

describe('all 4 categories represented in the panel', () => {
  it("'all' filter yields mg + bucket + first_combo-driven bucket + milestone cards", () => {
    const fc = firstCombo('mg-back', 'hypertrophy');
    const defs = [
      ...mgLadder('mg-chest'),
      fc,
      ...bucketLadder('hypertrophy'),
      ...sessionLadder(),
    ];
    const input = baseInput({
      defs,
      touchedMgs: new Set(['mg-chest']), // pr_per_mg
      touchedBuckets: new Set<string>(), // bucket shown only via first_combo
      unlockedIds: new Set([fc.id]), // first_combo entry badge
      totalSessionCount: 7, // session_count milestone
    });
    const cards = buildAchievementPanelCards(input, 'all');
    const kinds = new Set(cards.map((c) => c.kind));
    // mg + bucket + milestone kinds all present.
    expect(kinds).toEqual(new Set(['mg', 'bucket', 'milestone']));
    // The bucket card is present BECAUSE of the unlocked first_combo
    // (touchedBuckets is empty) → its entryBadge is lit, covering the
    // first_combo category surface.
    const bucketCard = cards.find((c) => c.kind === 'bucket')!;
    expect(bucketCard.entryBadge).toBe(true);
    // Milestone reflects the session_count category.
    const milestone = cards.find((c) => c.kind === 'milestone')!;
    expect(milestone.currentCount).toBe(7);
    expect(milestone.currentTier).toBe(2); // cleared 1 + 5, next 10
    expect(milestone.nextThreshold).toBe(10);
  });
});

describe('volume vs weight cards are distinct per group', () => {
  it('the same group produces independent weight + volume cards with independent tier state', () => {
    const defs = mgLadder('mg-chest');
    const input = baseInput({
      defs,
      touchedMgs: new Set(['mg-chest']),
      perMg: new Map([['mg-chest', { weight: 35, volume: 1 }]]),
    });
    const cards = buildAchievementPanelCards(input, 'mg');
    const weight = cards.find((c) => c.prType === 'weight')!;
    const volume = cards.find((c) => c.prType === 'volume')!;
    // Weight: 35 → cleared 1,10,20,30 = tier 4, next 40.
    expect(weight.currentTier).toBe(4);
    expect(weight.nextThreshold).toBe(40);
    // Volume: 1 → cleared only the first rung = tier 1, next 10.
    expect(volume.currentTier).toBe(1);
    expect(volume.nextThreshold).toBe(10);
    // Distinct stable keys for list rendering.
    expect(weight.key).not.toBe(volume.key);
    expect(weight.key).toBe('mg-mg-chest-weight');
    expect(volume.key).toBe('mg-mg-chest-volume');
  });
});

// =====================================================================
// Coverage fill (2026-06-20) — EMPTY-LADDER edge.
//
// `tierState`'s `maxed` flag is guarded by `ladder.length > 0`. Every
// shipped test feeds a non-empty ladder, so the empty-ladder branch — a
// card whose definition rows carry NO thresholds (all `threshold: null`),
// or the milestone filter when zero `session_count` defs were seeded — is
// uncovered. The contract for an empty ladder is "no rungs to reach": tier
// 0, totalTiers 0, nextThreshold null, and — critically — NOT maxed (a
// rungless ladder must never render as a completed/full progress bar).
// =====================================================================
describe('empty-ladder edge (no thresholds → tier 0, never maxed)', () => {
  it('milestone with zero session_count defs → totalTiers 0, next null, NOT maxed', () => {
    // No session_count rows at all (e.g. a DB where the milestone ladder was
    // never seeded). The milestone card is still always returned.
    const cards = buildAchievementPanelCards(
      baseInput({ defs: [], totalSessionCount: 42 }),
      'milestone',
    );
    expect(cards).toHaveLength(1);
    const m = cards[0];
    expect(m.kind).toBe('milestone');
    expect(m.totalTiers).toBe(0);
    expect(m.currentTier).toBe(0);
    expect(m.tierIndex).toBe(0);
    expect(m.reachedThreshold).toBe(0);
    expect(m.nextThreshold).toBeNull();
    // The load-bearing assertion: an empty ladder is NOT maxed, even with a
    // high count. Without the `ladder.length > 0` guard this would be `true`
    // and the bar would render full for a ladder that has no rungs.
    expect(m.maxed).toBe(false);
  });

  it('an mg ladder whose rows all have null thresholds → tier 0, never maxed', () => {
    // pr_per_mg rows exist for the touched group but none carry a threshold
    // (all null) — `ladderThresholds` drops nulls → empty ladder.
    const defs: AchievementDefinitionRow[] = [];
    for (const type of ['weight', 'volume'] as const) {
      defs.push(
        def({ category: 'pr_per_mg', mg_id: 'mg-chest', pr_type: type, threshold: null }),
      );
    }
    const input = baseInput({
      defs,
      touchedMgs: new Set(['mg-chest']),
      perMg: new Map([['mg-chest', { weight: 999, volume: 999 }]]),
    });
    const cards = buildAchievementPanelCards(input, 'mg');
    expect(cards).toHaveLength(2); // weight + volume cards still produced
    for (const c of cards) {
      expect(c.totalTiers).toBe(0);
      expect(c.currentTier).toBe(0);
      expect(c.nextThreshold).toBeNull();
      expect(c.maxed).toBe(false); // a thresholdless ladder is never "complete"
    }
  });

  it("'all' filter with no defs at all returns just an empty milestone card", () => {
    const cards = buildAchievementPanelCards(baseInput({ defs: [] }), 'all');
    expect(cards).toHaveLength(1);
    expect(cards[0].kind).toBe('milestone');
    expect(cards[0].totalTiers).toBe(0);
    expect(cards[0].maxed).toBe(false);
  });
});
