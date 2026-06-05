import type { HRSample } from '../../../components/session/hr-zone-chart.behavior';

/**
 * HealthKit data reader — slice 13c Phase B (C1, reader adapter).
 *
 * Two thin wrappers over Kingstinct's `queryQuantitySamples`:
 *   - `queryHeartRateSamples` for the session detail HR zone chart
 *   - `aggregateActiveEnergyBurned` for the kcal tile + on-finish session.kcal
 *
 * Both functions live under a strict no-throw contract because every caller is
 * a render-blocking `useEffect` on the session detail page. A native rejection
 * from HK (permission denied silently, simulator missing entitlement, samples
 * deleted mid-query, etc.) MUST NOT propagate as an exception or the detail
 * page would crash. We swallow → console.warn → fall back to a "no data"
 * sentinel ([] for HR, null for kcal).
 *
 * Per ADR-0019 § Slice 13c Q2 (ratified 2026-05-26): we do NOT cache. Each
 * detail-page open triggers a fresh query. HK is the source of truth; we only
 * persist the kcal aggregate at session-finish time (session.kcal column,
 * Agent B writer territory).
 */

/**
 * Lazily imported so jest can `jest.mock('@kingstinct/react-native-healthkit')`
 * per-test. Pattern mirrors `permission.ts`'s `getNativeRequestAuthorization`.
 *
 * Kingstinct's `queryQuantitySamples(identifier, options)`:
 *   - identifier: `'HKQuantityTypeIdentifierHeartRate'` | `'HKQuantityTypeIdentifierActiveEnergyBurned'` | ...
 *   - options: `{ filter?: { date?: { startDate, endDate } }, limit, ascending?, unit? }`
 *   - returns: `Promise<readonly { quantity: number; startDate: Date; endDate: Date; ... }[]>`
 */
function getNativeQueryQuantitySamples(): (
  identifier: string,
  options: {
    readonly filter?: {
      readonly date?: { readonly startDate?: Date; readonly endDate?: Date };
    };
    readonly limit: number;
    readonly ascending?: boolean;
    readonly unit?: string;
  }
) => Promise<
  readonly {
    quantity: number;
    startDate: Date;
    endDate: Date;
    // Kingstinct attaches the writing device's revision to every sample
    // (Shared.d.ts QuantitySample). `productType` is the device model code
    // ("Watch6,1" / "iPhone14,2"); used to attribute active energy to the
    // Apple Watch only (kcal source filter, grill 2026-06-05 Q4).
    sourceRevision?: { productType?: string | null } | null;
  }[]
> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@kingstinct/react-native-healthkit');
  return mod.queryQuantitySamples;
}

/**
 * True when a sample's `sourceRevision.productType` identifies an Apple Watch
 * (device model codes start with "Watch", e.g. "Watch6,1"). Grill 2026-06-05
 * Q4 — only Watch-written ActiveEnergyBurned is attributed to a strength
 * workout; iPhone motion estimates + third-party apps in the same wall-clock
 * window are excluded to stop kcal over-counting. Exact productType strings to
 * be confirmed on device.
 */
function isAppleWatchSource(productType: string | null | undefined): boolean {
  return typeof productType === 'string' && productType.startsWith('Watch');
}

/**
 * Build the `[startMs, endMs]` filter wrapper for a HK query. HK uses Date
 * objects (not epoch ms), so we convert at the boundary.
 */
function buildDateFilter(startMs: number, endMs: number) {
  return {
    filter: {
      date: {
        startDate: new Date(startMs),
        endDate: new Date(endMs),
      },
    },
    limit: 0, // 0 / negative = unlimited per Kingstinct's GenericQueryOptions JSDoc
    ascending: true,
  } as const;
}

/**
 * Query HR samples from HealthKit in the [startMs, endMs] window (epoch ms,
 * inclusive). Returns samples chronologically sorted (oldest first); each
 * sample's `ts` is the midpoint of the HK sample's [startDate, endDate] in
 * epoch ms — Apple Watch typically reports HR as a tiny interval (~1s), so
 * midpoint vs startDate is mostly cosmetic.
 *
 * Returns `[]` on ANY failure (no samples, permission denied, HK unavailable,
 * native error). NEVER throws — wraps all native I/O in try/catch.
 *
 * Even though we pass `ascending: true` to Kingstinct, we defensively re-sort
 * client-side. Some HK source revisions (third-party apps writing into HK)
 * have been observed to ignore sort hints on the native side.
 */
export async function queryHeartRateSamples(
  startMs: number,
  endMs: number
): Promise<HRSample[]> {
  try {
    const queryQuantitySamples = getNativeQueryQuantitySamples();
    const samples = await queryQuantitySamples(
      'HKQuantityTypeIdentifierHeartRate',
      { ...buildDateFilter(startMs, endMs), unit: 'count/min' }
    );

    const mapped: HRSample[] = samples.map((s) => ({
      ts: (new Date(s.startDate).getTime() + new Date(s.endDate).getTime()) / 2,
      bpm: s.quantity,
    }));

    mapped.sort((a, b) => a.ts - b.ts);
    return mapped;
  } catch (err) {
    console.warn('[healthkit.reader] queryHeartRateSamples failed:', err);
    return [];
  }
}

/**
 * Sum `HKQuantityTypeIdentifierActiveEnergyBurned` (kcal) in [startMs, endMs],
 * counting ONLY Apple Watch-written samples (grill 2026-06-05 Q4).
 *
 * Before this, the aggregate summed EVERY source in the wall-clock window —
 * iPhone motion estimates, third-party fitness apps, and Watch all double-
 * counted into the workout's totalEnergyBurned (灌水 into Apple Health's Move
 * ring). For strength training the only trustworthy active-energy figure is the
 * Watch's, so we attribute Watch-sourced samples only.
 *
 * Returns:
 *   - `number` — sum of Watch-sourced active energy when ≥1 Watch sample is in
 *     the window.
 *   - `null` — no Watch samples (iPhone-only session: the Watch measured
 *     nothing, so kcal is genuinely "unknown" → detail page shows "—" rather
 *     than a misleading "0"), OR permission denied / HK unavailable / any
 *     throw.
 *
 * NEVER throws.
 */
export async function aggregateActiveEnergyBurned(
  startMs: number,
  endMs: number
): Promise<number | null> {
  try {
    const queryQuantitySamples = getNativeQueryQuantitySamples();
    const samples = await queryQuantitySamples(
      'HKQuantityTypeIdentifierActiveEnergyBurned',
      { ...buildDateFilter(startMs, endMs), unit: 'kcal' }
    );

    let sum = 0;
    let watchSamples = 0;
    for (const s of samples) {
      if (!isAppleWatchSource(s.sourceRevision?.productType)) continue;
      if (Number.isFinite(s.quantity)) sum += s.quantity;
      watchSamples += 1;
    }
    // No Watch-attributed energy → unknown, not zero (see contract above).
    return watchSamples === 0 ? null : sum;
  } catch (err) {
    console.warn('[healthkit.reader] aggregateActiveEnergyBurned failed:', err);
    return null;
  }
}
