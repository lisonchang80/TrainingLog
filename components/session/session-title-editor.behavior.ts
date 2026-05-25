/**
 * SessionTitleEditor pure-logic helpers (extracted from the .tsx so the
 * bug-prone state-transition semantics are unit-testable in the node-env
 * jest setup — the repo has no React Native testing-library installed,
 * and ts-jest cannot transform a TSX file in `testEnvironment: node`
 * without the JSX runtime). Contains zero React imports.
 *
 * Bug F2 (2026-05-25) — two related decisions, both used by the .tsx:
 *
 *   - `nextDraftOnPropSync`: when the parent's `initialTitle` prop
 *     arrives AFTER first mount (e.g. session.title loaded from DB after
 *     the in_progress branch first rendered with title=''), the
 *     component's local `draft` useState was stuck at the stale mount
 *     value and tap-to-edit appeared to "clear" the field. The
 *     `useEffect` sync in the component delegates the decision here.
 *
 *   - `decideCommit`: tap-to-edit then immediate blur must NOT clobber
 *     the persisted title with an empty draft. The decision returns
 *     `shouldPersist=false` when the trimmed draft equals the existing
 *     initialTitle, mirroring the component's `commit` body.
 */

export interface DraftSyncInput {
  /** Latest `initialTitle` from parent. */
  initialTitle: string;
  /** Current local `draft` state. */
  draft: string;
  /** Whether the component is currently in edit mode. */
  editing: boolean;
}

/**
 * Decide whether to overwrite `draft` when `initialTitle` changes.
 *
 * Rules:
 *   - Mid-edit (`editing=true`): NEVER clobber the user's in-flight
 *     keystrokes. Returns `null` (= leave draft alone).
 *   - Out of edit mode: resync to the latest `initialTitle` whenever it
 *     differs from `draft`. This is the fix for F2 (parent's title prop
 *     arrives after first mount; useState initial value was stale).
 *
 * Returns the new draft, or `null` to indicate "no change".
 */
export function nextDraftOnPropSync(input: DraftSyncInput): string | null {
  if (input.editing) return null;
  if (input.draft === input.initialTitle) return null;
  return input.initialTitle;
}

export interface CommitDecisionInput {
  /** Current `draft` (raw — will be trimmed before comparison). */
  draft: string;
  /** Latest `initialTitle` (the value currently persisted in DB). */
  initialTitle: string;
}

export interface CommitDecision {
  /** Trimmed draft, ready to write through to DB / `onUpdated`. */
  next: string;
  /**
   * `false` when the trimmed draft equals `initialTitle` (no-op, e.g. user
   * tapped to edit then immediately blurred). `true` when a write is needed.
   */
  shouldPersist: boolean;
}

/**
 * Compute the commit decision for a blur / submit event.
 *
 * Empty strings are valid persisted values (= freestyle / placeholder),
 * so we trim but do NOT coalesce to anything else; an explicit "" overwrite
 * is a legal way for the user to clear their custom title.
 */
export function decideCommit(input: CommitDecisionInput): CommitDecision {
  const next = input.draft.trim();
  return {
    next,
    shouldPersist: next !== input.initialTitle,
  };
}
