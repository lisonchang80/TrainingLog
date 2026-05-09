/**
 * Module #9 — Achievement Engine.
 *
 * `evaluate(input)` returns the list of newly-unlocked definitions for the
 * Session being closed. Pure logic — caller persists to achievement_unlock.
 *
 * Categories:
 *   first_combo   : (mg_id, bucket) tuple unlocked once ever, on first logged set
 *   pr_per_mg     : threshold ladder of cumulative weight / volume PRs by MG
 *   pr_per_bucket : threshold ladder by rep bucket
 *   session_count : threshold ladder by total logged sessions
 *
 * ADR-0009 § 成就系統設計.
 */

import type { BucketKey } from '../pr/types';
import type {
  AchievementDefinitionRow,
  EvaluateInput,
  NewUnlock,
} from './types';

const PR_TYPES = ['weight', 'volume'] as const;

export function evaluate(input: EvaluateInput): NewUnlock[] {
  const { session, defs, unlockedIds, cumulativePRCounts, totalSessionCount } = input;
  const out: NewUnlock[] = [];

  // ---- 1. first_combo ----
  // First logged set in each (mg, bucket) tuple anchors the unlock to that set.
  const firstSetByCombo = new Map<string, string>();
  for (const s of session.sets) {
    if (!s.is_logged || s.mg_id == null || s.bucket == null) continue;
    const k = `${s.mg_id}__${s.bucket}`;
    if (!firstSetByCombo.has(k)) firstSetByCombo.set(k, s.set_id);
  }
  for (const [combo, setId] of firstSetByCombo) {
    const [mg, bucket] = combo.split('__');
    const def = findDef(defs, (d) =>
      d.category === 'first_combo' && d.mg_id === mg && d.bucket_id === bucket
    );
    if (def && !unlockedIds.has(def.id)) {
      out.push({ definition_id: def.id, session_id: session.session_id, set_id: setId });
    }
  }

  // ---- 2. pr_per_mg ----
  // Track first set in this session that broke a weight / volume PR per MG.
  const mgFirstPRSet = new Map<string, { weight: string | null; volume: string | null }>();
  const bucketFirstPRSet = new Map<BucketKey, { weight: string | null; volume: string | null }>();
  for (const s of session.sets) {
    if (!s.is_logged) continue;
    if (s.weight_pr_broken) {
      if (s.mg_id != null) {
        const mr = mgFirstPRSet.get(s.mg_id) ?? { weight: null, volume: null };
        if (mr.weight == null) mr.weight = s.set_id;
        mgFirstPRSet.set(s.mg_id, mr);
      }
      if (s.bucket != null) {
        const br = bucketFirstPRSet.get(s.bucket) ?? { weight: null, volume: null };
        if (br.weight == null) br.weight = s.set_id;
        bucketFirstPRSet.set(s.bucket, br);
      }
    }
    if (s.volume_pr_broken) {
      if (s.mg_id != null) {
        const mr = mgFirstPRSet.get(s.mg_id) ?? { weight: null, volume: null };
        if (mr.volume == null) mr.volume = s.set_id;
        mgFirstPRSet.set(s.mg_id, mr);
      }
      if (s.bucket != null) {
        const br = bucketFirstPRSet.get(s.bucket) ?? { weight: null, volume: null };
        if (br.volume == null) br.volume = s.set_id;
        bucketFirstPRSet.set(s.bucket, br);
      }
    }
  }

  for (const [mg, types] of mgFirstPRSet) {
    for (const t of PR_TYPES) {
      const setId = types[t];
      if (setId == null) continue;
      const cumul = cumulativePRCounts.per_mg.get(mg)?.[t] ?? 0;
      const candidates = defs.filter(
        (d) => d.category === 'pr_per_mg' && d.mg_id === mg && d.pr_type === t && d.threshold != null
      );
      for (const def of candidates) {
        if (cumul >= (def.threshold ?? 0) && !unlockedIds.has(def.id)) {
          out.push({ definition_id: def.id, session_id: session.session_id, set_id: setId });
        }
      }
    }
  }

  // ---- 3. pr_per_bucket ----
  for (const [bucket, types] of bucketFirstPRSet) {
    for (const t of PR_TYPES) {
      const setId = types[t];
      if (setId == null) continue;
      const cumul = cumulativePRCounts.per_bucket.get(bucket)?.[t] ?? 0;
      const candidates = defs.filter(
        (d) =>
          d.category === 'pr_per_bucket' &&
          d.bucket_id === bucket &&
          d.pr_type === t &&
          d.threshold != null
      );
      for (const def of candidates) {
        if (cumul >= (def.threshold ?? 0) && !unlockedIds.has(def.id)) {
          out.push({ definition_id: def.id, session_id: session.session_id, set_id: setId });
        }
      }
    }
  }

  // ---- 4. session_count ----
  // Empty session (no logged sets) doesn't count toward the ladder.
  const hasLogged = session.sets.some((s) => s.is_logged);
  if (hasLogged) {
    const candidates = defs.filter((d) => d.category === 'session_count' && d.threshold != null);
    for (const def of candidates) {
      if (totalSessionCount >= (def.threshold ?? 0) && !unlockedIds.has(def.id)) {
        out.push({ definition_id: def.id, session_id: session.session_id, set_id: null });
      }
    }
  }

  return out;
}

function findDef(
  defs: readonly AchievementDefinitionRow[],
  pred: (d: AchievementDefinitionRow) => boolean
): AchievementDefinitionRow | undefined {
  return defs.find(pred);
}
