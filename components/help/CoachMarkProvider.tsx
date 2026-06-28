import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import type { View } from 'react-native';

import type { Rect } from './types';

/**
 * Registry that lets a CoachMarkOverlay locate the on-screen elements its
 * steps point at. Each highlightable element calls `useCoachMarkTarget(id)`
 * and spreads the returned `ref` onto a `View`; the provider keeps the live
 * node handle and measures it (in window coordinates) on demand when the
 * overlay opens a step.
 *
 * Window coordinates are required because the overlay renders inside a
 * full-screen `Modal` — `measureInWindow` is independent of any parent
 * scroll/layout offset, so the spotlight lands on the real element even after
 * the page has scrolled.
 *
 * Wrap a page (or the whole app) in `<CoachMarkProvider>`. Pages that only
 * use 'info' help don't need it.
 */
interface CoachMarkContextValue {
  registerNode: (id: string, node: View | null) => void;
  measure: (id: string) => Promise<Rect | null>;
}

const CoachMarkContext = createContext<CoachMarkContextValue | null>(null);

export function CoachMarkProvider({ children }: { children: ReactNode }) {
  const nodes = useRef<Map<string, View>>(new Map());

  const registerNode = useCallback((id: string, node: View | null) => {
    if (node) nodes.current.set(id, node);
    else nodes.current.delete(id);
  }, []);

  const measure = useCallback(
    (id: string) =>
      new Promise<Rect | null>((resolve) => {
        const node = nodes.current.get(id);
        if (!node) {
          resolve(null);
          return;
        }
        // measureInWindow is async (next layout pass). Guard against the
        // "0,0,0,0" result RN returns for a not-yet-laid-out / unmounted node.
        node.measureInWindow((x, y, width, height) => {
          if (
            [x, y, width, height].some(
              (v) => v == null || Number.isNaN(v),
            ) ||
            width <= 0 ||
            height <= 0
          ) {
            resolve(null);
          } else {
            resolve({ x, y, width, height });
          }
        });
      }),
    [],
  );

  const value = useMemo<CoachMarkContextValue>(
    () => ({ registerNode, measure }),
    [registerNode, measure],
  );

  return (
    <CoachMarkContext.Provider value={value}>{children}</CoachMarkContext.Provider>
  );
}

/**
 * Read the coach-mark registry. Returns `null` when no provider is present
 * (so `useCoachMarkTarget` can no-op gracefully on pages that don't host a
 * tour).
 */
function useCoachMarkRegistry(): CoachMarkContextValue | null {
  return useContext(CoachMarkContext);
}

/**
 * Mark an element as the target of a coach step. Spread the returned `ref`
 * onto the `View` you want highlighted:
 *
 *   const target = useCoachMarkTarget('today.checkmark');
 *   <View ref={target.ref}>…</View>
 *
 * The `id` must match a `CoachStep.targetId`. Safe to call even when no
 * `CoachMarkProvider` is mounted — it simply won't register (the step then
 * degrades to a centred caption).
 */
export function useCoachMarkTarget(id: string): {
  ref: (node: View | null) => void;
} {
  const registry = useCoachMarkRegistry();
  const ref = useCallback(
    (node: View | null) => {
      registry?.registerNode(id, node);
    },
    [registry, id],
  );
  return { ref };
}

/** Internal — used by CoachMarkOverlay to measure the current step's target. */
export function useCoachMarkMeasure(): (id: string) => Promise<Rect | null> {
  const registry = useCoachMarkRegistry();
  return useCallback(
    (id: string) => registry?.measure(id) ?? Promise.resolve(null),
    [registry],
  );
}
