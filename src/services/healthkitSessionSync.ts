/**
 * HealthKit session sync service — slice 13c C3 (extracted slice 13c "tests" pass).
 *
 * Encapsulates the on-finish HealthKit best-effort sync sequence:
 *   1. Read the session row (need started_at / ended_at / title)
 *   2. Aggregate active energy burned in [started_at, ended_at] from HK
 *   3. Save HKWorkout to Apple HealthKit (so it surfaces in Fitness app)
 *   4. Persist (kcal, healthkit_workout_uuid) back to session row
 *
 * Originally inlined inside `app/(tabs)/index.tsx` `finalizeEndAndRoute`; broken
 * out so that:
 *   - the unique behavioural contract ("HK 任何失敗都不可阻擋 finish") gets
 *     proper jest regression coverage (the inline form was only verified by
 *     iPhone smoke); and
 *   - slice 13d's in-session live HR / Watch reconciliation can compose on
 *     top of the same primitive without copy-pasting the try/catch shape.
 *
 * ## Contract (mirrors ADR-0019 § Phase B Q5/Q6/Q7/Q8)
 *   - NEVER throws. Any failure in any step is caught and only logged via
 *     console.warn. The promise always resolves.
 *   - When `session.ended_at == null` (defensive — caller should have already
 *     awaited endSession), the function returns without touching any HK
 *     adapter at all.
 *   - Reader / writer return null on their own internal failures (see
 *     `aggregateActiveEnergyBurned` and `saveTrainingLogWorkout`). We persist
 *     whatever each one returned, even when one of them is null — kcal alone
 *     is still useful (detail page shows the figure even without HKWorkout),
 *     and uuid alone is still useful (Fitness app entry exists even without
 *     a kcal aggregate).
 *
 * ## i18n boundary
 *   - `t(...)` is a React hook scope (`useT`) and cannot be called from a
 *     service module. The caller resolves `t('page', 'sessionTitlePlaceholder')`
 *     up-front and passes it through `deps.fallbackTitle`.
 *   - `session.title` is empty string ('') for freestyle sessions per the DB
 *     convention — the UI renders the placeholder at display time. We resolve
 *     `displayTitle = session.title || fallbackTitle` so HK metadata carries
 *     the user-facing name instead of letting Apple Fitness fall back to the
 *     activityType localized name (「傳統肌力訓練」). Regression on commit 936339b.
 *
 * ## Dependency injection
 *   - `deps` defaults to the production adapters. Tests inject mocks for each
 *     of the 4 collaborators. Keeping the 4 functions individually injectable
 *     (instead of a single "adapter object") lets tests cover partial-failure
 *     matrices cleanly (e.g. reader throws but writer succeeds).
 */

import type { Database } from '../db/types';
import { getSession, setSessionHealthKitData } from '../adapters/sqlite/sessionRepository';
import { aggregateActiveEnergyBurned, saveTrainingLogWorkout } from '../adapters/healthkit';
import type { Session } from '../domain/session/types';

interface HealthKitSessionSyncDeps {
  /** Defaults to {@link getSession}. */
  getSession?: (db: Database, id: string) => Promise<Session | null>;
  /** Defaults to {@link aggregateActiveEnergyBurned}. */
  aggregateActiveEnergyBurned?: (startMs: number, endMs: number) => Promise<number | null>;
  /** Defaults to {@link saveTrainingLogWorkout}. */
  saveTrainingLogWorkout?: (input: {
    startMs: number;
    endMs: number;
    kcal: number | null;
    title: string;
    sessionId: string;
  }) => Promise<string | null>;
  /** Defaults to {@link setSessionHealthKitData}. */
  setSessionHealthKitData?: (
    db: Database,
    args: { id: string; kcal: number | null; healthkit_workout_uuid: string | null }
  ) => Promise<void>;
  /**
   * Used when `session.title` is empty string (freestyle). Required for
   * Apple Fitness to show the user-facing name instead of the localized
   * activityType. Caller (React component) resolves `t('page',
   * 'sessionTitlePlaceholder')` and threads it through.
   *
   * When omitted, freestyle sessions fall back to '' which Apple silently
   * ignores → Fitness shows「傳統肌力訓練」(activityType localized name).
   */
  fallbackTitle?: string;
}

export async function syncSessionWithHealthKit(
  db: Database,
  sessionId: string,
  deps: HealthKitSessionSyncDeps = {}
): Promise<void> {
  const getSessionFn = deps.getSession ?? getSession;
  const aggregateFn = deps.aggregateActiveEnergyBurned ?? aggregateActiveEnergyBurned;
  const saveWorkoutFn = deps.saveTrainingLogWorkout ?? saveTrainingLogWorkout;
  const persistFn = deps.setSessionHealthKitData ?? setSessionHealthKitData;
  const fallbackTitle = deps.fallbackTitle ?? '';

  // Slice 13c C3 — HealthKit sync (Q5 persist kcal + Q6 saveWorkout).
  // Best-effort (Q8): any failure → session DB row still saved, UI silent
  // skip, detail page shows '—' kcal + grey HR overlay. Per Q11, only
  // sessions finished from 13c onwards get this; older sessions stay NULL.
  try {
    const session = await getSessionFn(db, sessionId);
    if (session && session.ended_at != null) {
      const kcal = await aggregateFn(session.started_at, session.ended_at);
      // 2026-05-26 B1 follow-up: session.title is empty string ('') for
      // freestyle sessions (DB convention — UI renders the i18n placeholder
      // at display time). Passing '' as HKWorkoutBrandName makes Apple
      // Fitness silently fall back to the activityType localized name
      // (「傳統肌力訓練」) instead of our intended「空白訓練」. Resolve
      // to the placeholder here so HK metadata carries the user-facing name.
      const displayTitle = session.title || fallbackTitle;
      const uuid = await saveWorkoutFn({
        startMs: session.started_at,
        endMs: session.ended_at,
        kcal,
        title: displayTitle,
        sessionId: session.id,
      });
      await persistFn(db, {
        id: sessionId,
        kcal,
        healthkit_workout_uuid: uuid,
      });
    }
  } catch (e) {
    console.warn('[healthkit] finish sync failed:', e);
  }
}
