/**
 * App-wide ErrorBoundary — pure-logic unit tests.
 *
 * The boundary's `.tsx` is JSX/RN-wrapped and this project's tsconfig sets
 * `jsx: "react-native"` (JSX preserved, not transformed), so ts-jest can't
 * load any `.tsx` under `testEnvironment: node`. Following the house pattern
 * (`components/session/*.behavior.ts`), the boundary's pure state logic lives
 * in `components/error-boundary.behavior.ts` and is tested here. The class's
 * `static getDerivedStateFromError` and `reset()` delegate directly to these
 * functions, so this fully covers the error → fallback → retry transition.
 */
import {
  deriveErrorState,
  resetState,
} from '../../components/error-boundary.behavior';

describe('deriveErrorState (backs getDerivedStateFromError)', () => {
  it('maps a thrown error to { hasError: true, error }', () => {
    const err = new Error('boom');
    expect(deriveErrorState(err)).toEqual({ hasError: true, error: err });
  });

  it('preserves the exact error reference (for logging / display)', () => {
    const err = new Error('corrupt row');
    const next = deriveErrorState(err);
    expect(next.hasError).toBe(true);
    expect(next.error).toBe(err);
  });
});

describe('resetState (backs reset())', () => {
  it('returns a clean state with no error', () => {
    expect(resetState()).toEqual({ hasError: false, error: undefined });
  });

  it('error state → reset → clean state round-trips', () => {
    const errState = deriveErrorState(new Error('x'));
    expect(errState.hasError).toBe(true);

    const cleared = resetState();
    expect(cleared.hasError).toBe(false);
    expect(cleared.error).toBeUndefined();
  });
});
