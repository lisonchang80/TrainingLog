/**
 * BucketRangesHydrator — slice 17 / ADR-0027 boot hydration.
 *
 * Reads the user's saved rep-bucket boundaries from `app_settings.bucket_ranges`
 * once on mount and applies them to the in-memory `BUCKETS` cache
 * (`applyBucketRanges`). Mount once INSIDE <DatabaseProvider> (needs the DB
 * open), alongside <BackupTriggers/>. Renders nothing.
 *
 * WHY a component (not a context): the bucket cache is a plain module var read
 * at call time by ~18 consumers; it does not need to push React re-renders.
 * Screens reload their data on focus (useFocusEffect), so a range edit in
 * Settings is reflected the next time any screen reads the cache — no relaunch,
 * no Provider. Settings applies edits to the cache itself on each change; this
 * hydrator only covers the cold-boot path (cache starts at DEFAULT_BUCKETS,
 * then this swaps in the saved ranges before the user navigates anywhere).
 */
import { useEffect } from 'react';

import { useDatabase } from '@/components/database-provider';
import { getBucketRanges } from '@/src/adapters/sqlite/settingsRepository';
import { applyBucketRanges } from '@/src/domain/pr/buckets';

export function BucketRangesHydrator() {
  const db = useDatabase();
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const saved = await getBucketRanges(db);
        // null = unset/invalid → keep DEFAULT_BUCKETS already in the cache.
        if (mounted && saved) applyBucketRanges(saved);
      } catch {
        // Defensive — defaults already in place; a settings read error must
        // never block boot or leave classification broken.
      }
    })();
    return () => {
      mounted = false;
    };
  }, [db]);
  return null;
}
