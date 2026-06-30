import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import {
  Dimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
  type View,
} from 'react-native';

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
 * A page MAY also register its scroll container via `useCoachScroller()`. When
 * present, the overlay asks the provider to `scrollIntoView(id)` BEFORE
 * measuring each step, so a target below the fold is scrolled into view and
 * spotlighted in place instead of leaving the ring/bubble off-screen (user
 * report 2026-06-30, stats panel). Pages without a registered scroller no-op
 * gracefully.
 *
 * Wrap a page (or the whole app) in `<CoachMarkProvider>`. Pages that only
 * use 'info' help don't need it.
 */
interface Scroller {
  /** Scroll the container to this absolute content offset (y), animated. */
  scrollTo: (y: number) => void;
  /** Current content offset (y), tracked via the ScrollView's onScroll. */
  getOffset: () => number;
}

interface CoachMarkContextValue {
  registerNode: (id: string, node: View | null) => void;
  measure: (id: string) => Promise<Rect | null>;
  registerScroller: (s: Scroller | null) => void;
  /** Scroll the registered container so `id`'s target is comfortably visible. */
  scrollIntoView: (id: string) => Promise<void>;
}

const CoachMarkContext = createContext<CoachMarkContextValue | null>(null);

export function CoachMarkProvider({ children }: { children: ReactNode }) {
  const nodes = useRef<Map<string, View>>(new Map());
  const scrollerRef = useRef<Scroller | null>(null);

  const registerNode = useCallback((id: string, node: View | null) => {
    if (node) nodes.current.set(id, node);
    else nodes.current.delete(id);
  }, []);

  const registerScroller = useCallback((s: Scroller | null) => {
    scrollerRef.current = s;
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

  // Scroll the registered container so the target for `id` sits comfortably in
  // the viewport before the overlay measures + spotlights it. No-op when no
  // scroller is registered (most pages) or the target is already visible. Uses
  // window-coord measurement + the tracked content offset to compute an
  // absolute scroll position, then waits for the scroll to settle so the
  // follow-up measure reads the new (on-screen) frame.
  const scrollIntoView = useCallback(
    async (id: string) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const rect = await measure(id);
      if (!rect) return;
      const screenH = Dimensions.get('window').height;
      const TOP_SAFE = 96; // header / status-bar band to stay clear of
      const BOTTOM_SAFE = 170; // room for the caption bubble below the target
      const targetTop = rect.y;
      const targetBottom = rect.y + rect.height;
      // Already comfortably on-screen → don't scroll.
      if (targetTop >= TOP_SAFE && targetBottom <= screenH - BOTTOM_SAFE) return;
      // Park the target's top ~26% down the screen (leaves room for the bubble).
      const desiredTop = screenH * 0.26;
      const next = Math.max(0, scroller.getOffset() + (targetTop - desiredTop));
      scroller.scrollTo(next);
      await new Promise<void>((resolve) => setTimeout(resolve, 340));
    },
    [measure],
  );

  const value = useMemo<CoachMarkContextValue>(
    () => ({ registerNode, measure, registerScroller, scrollIntoView }),
    [registerNode, measure, registerScroller, scrollIntoView],
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

/**
 * Register a page's scroll container with the coach registry so the overlay can
 * scroll a below-the-fold target into view before spotlighting it. Spread the
 * returned props onto the page's `ScrollView`:
 *
 *   const coachScroll = useCoachScroller();
 *   <ScrollView ref={coachScroll.ref} onScroll={coachScroll.onScroll}
 *               scrollEventThrottle={coachScroll.scrollEventThrottle}> … </ScrollView>
 *
 * Only needed on pages whose coach targets can sit below the fold. Safe with no
 * provider (no-ops). The ScrollView ref is read lazily, so the registered
 * scroller object is stable.
 */
export function useCoachScroller() {
  const registry = useCoachMarkRegistry();
  const ref = useRef<ScrollView | null>(null);
  const offsetRef = useRef(0);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offsetRef.current = e.nativeEvent.contentOffset.y;
  }, []);

  useEffect(() => {
    if (!registry) return;
    registry.registerScroller({
      scrollTo: (y: number) => ref.current?.scrollTo({ y, animated: true }),
      getOffset: () => offsetRef.current,
    });
    return () => registry.registerScroller(null);
  }, [registry]);

  return { ref, onScroll, scrollEventThrottle: 16 };
}

/** Internal — used by CoachMarkOverlay to measure the current step's target. */
export function useCoachMarkMeasure(): (id: string) => Promise<Rect | null> {
  const registry = useCoachMarkRegistry();
  return useCallback(
    (id: string) => registry?.measure(id) ?? Promise.resolve(null),
    [registry],
  );
}

/** Internal — used by CoachMarkOverlay to scroll a step's target into view. */
export function useCoachMarkScrollIntoView(): (id: string) => Promise<void> {
  const registry = useCoachMarkRegistry();
  return useCallback(
    (id: string) => registry?.scrollIntoView(id) ?? Promise.resolve(),
    [registry],
  );
}
