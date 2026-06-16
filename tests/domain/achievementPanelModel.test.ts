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
