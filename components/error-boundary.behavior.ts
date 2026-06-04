/**
 * Pure state logic for the app-wide ErrorBoundary.
 *
 * Split out of `error-boundary.tsx` so it can be unit-tested under jest's
 * `testEnvironment: node`. The `.tsx` file imports react-native JSX, and this
 * project's tsconfig sets `jsx: "react-native"` (JSX is *preserved*, not
 * transformed), so ts-jest can't load any `.tsx` in node — the established
 * house pattern is a `*.behavior.ts` split (see `components/session/`).
 */

/** Error-boundary render state. */
export interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

/**
 * Maps a render-phase throw to error state. Backs the class's
 * `static getDerivedStateFromError`.
 */
export function deriveErrorState(error: Error): ErrorBoundaryState {
  return { hasError: true, error };
}

/**
 * The state to apply on Retry — clears the error so the child subtree
 * re-mounts. Backs the class's `reset()` instance method.
 */
export function resetState(): ErrorBoundaryState {
  return { hasError: false, error: undefined };
}
