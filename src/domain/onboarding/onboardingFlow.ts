/**
 * Onboarding flow — pure decision logic (ADR-0029).
 *
 * Kept adapter-free + UI-free so it's jest-covered without a DB or React.
 * The OnboardingProvider (gate) and the wizard screens consume these.
 */

/** Step 2 answer — the only「beginner detection」signal (a one-shot question,
 * NOT a persisted domain field per ADR-0029 D4). */
export type ExperienceAnswer = 'beginner' | 'experienced';

/** Mirrors `AppMode` from settingsRepository (`'plan' | 'minimal'`); duplicated
 * as a literal here to keep this domain module free of an adapter import. */
export type RecommendedMode = 'plan' | 'minimal';

/**
 * Step 3 pre-selection: a beginner is recommended 極簡 (minimal), an
 * experienced lifter 計劃 (plan). This only PRE-SELECTS the radio — the user
 * can still change it before it's written (opt-in, ADR-0029 D5).
 */
export function recommendAppMode(experience: ExperienceAnswer): RecommendedMode {
  return experience === 'beginner' ? 'minimal' : 'plan';
}

/**
 * Gate trigger (ADR-0029 D1): show the wizard only on a genuinely fresh
 * install — the flag is unset AND the DB has no user-created data.
 *
 * The `hasAnySession` guard is what makes this safe (and is why the ADR's
 * pure-flag design was refined during implementation): an EXISTING user
 * upgrading to this build, or a RESTORED backup, has data but may have no
 * `onboarding_completed` row → without the guard they'd wrongly see onboarding.
 * With it, the provider back-fills the flag `true` for them and skips.
 *
 * This does NOT reintroduce the rejected「session_count===0 as the trigger」
 * (ADR-0029 D1): the flag remains the authority (persisted after the first
 * finish/skip), so clearing data later never re-shows the wizard. The
 * session check is consulted ONCE, only when the flag is absent.
 */
export function shouldShowOnboarding(args: {
  completed: boolean;
  hasAnySession: boolean;
}): boolean {
  return !args.completed && !args.hasAnySession;
}
