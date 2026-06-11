import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  ToastController,
  type ToastIcon,
} from '@/src/domain/ui/toastController';
import { useTheme, type ThemeTokens } from '@/src/theme';

export { ToastController } from '@/src/domain/ui/toastController';
export type { ShowToastOptions, ToastIcon } from '@/src/domain/ui/toastController';

/**
 * Shared bottom-floating Toast (ADR-0019 Q10 Round F polish).
 *
 * Used by the session detail page's [儲存模板] success feedback (replacing
 * the previous Alert.alert call — see app/session/[id].tsx). Consumers
 * create a long-lived `ToastController` (e.g. via `useRef`) and render
 * `<ToastHost controller={ref.current} />` once at the screen root.
 *
 * Default duration: 2.5s. Icon defaults to a success checkmark — pass
 * `{ icon: 'error' | 'info' | null }` to override.
 *
 * Pure logic (timers, single-slot replacement, subscribe) lives in
 * `src/domain/ui/toastController.ts` and is unit-tested under `tests/domain/`.
 * This component is the React Native view layer only: it subscribes to the
 * controller, drives a fade/translate Animated value, and renders the floating
 * surface. Uses react-native's built-in Animated (no new dependency).
 *
 * ADR-0025 — the toast surface is intentionally a dark scrim in both modes
 * (matches iOS system HUD convention — always dark regardless of light/dark
 * mode). Icon background uses action.* tokens for semantic consistency.
 */

// ─────────────────────────────────────────────────────────────────────────
// Renderer
// ─────────────────────────────────────────────────────────────────────────

export function ToastHost({ controller }: { controller: ToastController }) {
  const { tokens } = useTheme();
  // Mirror controller state into React state so re-renders pick it up.
  // useSyncExternalStore would be cleaner but the controller intentionally
  // emits a new state OBJECT on every change anyway — a simple useEffect
  // subscription is enough and works in older React/RN combos.
  const [state, setState] = useState(controller.getState());
  useEffect(() => {
    const unsub = controller.subscribe(() => setState(controller.getState()));
    return unsub;
  }, [controller]);

  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    if (state.message != null) {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 180,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 180,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 0,
          duration: 160,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 20,
          duration: 160,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [state.id, state.message, opacity, translateY]);

  const onPress = useCallback(() => controller.hide(), [controller]);

  // Keep the host mounted even when hidden so the exit Animated value can run.
  return (
    <SafeAreaView
      pointerEvents="box-none"
      style={styles.host}
      edges={['bottom']}>
      <Animated.View
        pointerEvents={state.message ? 'auto' : 'none'}
        style={[
          styles.toast,
          {
            opacity,
            transform: [{ translateY }],
          },
        ]}>
        <Pressable
          onPress={onPress}
          style={styles.toastInner}
          accessibilityRole="alert">
          {state.icon != null && <ToastIconView icon={state.icon} tokens={tokens} />}
          <Text style={styles.toastText} numberOfLines={2}>
            {state.message ?? ''}
          </Text>
        </Pressable>
      </Animated.View>
    </SafeAreaView>
  );
}

function ToastIconView({ icon, tokens }: { icon: ToastIcon; tokens: ThemeTokens }) {
  if (icon == null) return null;
  const symbol =
    icon === 'success' ? '✓' : icon === 'error' ? '✕' : 'ⓘ';
  const color =
    icon === 'success'
      ? tokens.action.success
      : icon === 'error'
        ? tokens.action.destructive
        : tokens.action.primary;
  return (
    <View style={[styles.iconWrap, { backgroundColor: color }]}>
      <Text style={styles.iconText}>{symbol}</Text>
    </View>
  );
}

/**
 * Static stylesheet — toast surface is intentionally a fixed dark scrim
 * (iOS HUD pattern, both modes). Themed colors are applied inline above
 * (only the icon background varies via action tokens).
 */
const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingBottom: 16,
    paddingHorizontal: 24,
  },
  toast: {
    minWidth: 240,
    maxWidth: 400,
    borderRadius: 14,
    // Fixed dark scrim — iOS system HUD convention, intentional non-token.
    // 2026-06-04: fully opaque + light hairline border so the toast stands out
    // from the (possibly dark) screen behind it — user asked for more contrast.
    backgroundColor: 'rgb(28,28,30)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.22)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 10,
  },
  toastInner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    gap: 12,
  },
  toastText: {
    flex: 1,
    // Always-light text on dark scrim — intentional non-token.
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  iconWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Always-light glyph on colored icon background — intentional non-token.
  iconText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
