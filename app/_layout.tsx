import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavigationThemeProvider,
} from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, type ReactNode } from 'react';
import { LogBox } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { DatabaseProvider } from '@/components/database-provider';
import { RestoreGate } from '@/components/restore-gate';
import { t } from '@/src/i18n';
import { setLocale } from '@/src/i18n/strings';
import { loadStoredLocale, resolveLocale } from '@/src/i18n/locale-persist';
import { ThemeProvider, useTheme } from '@/src/theme';
import { initWatchBridge } from '@/src/adapters/watch';

// Suppress benign upstream warning from `react-native-draggable-flatlist@4.0.3`
// `NestableDraggableFlatList` (file: node_modules/react-native-draggable-flatlist/
// src/components/NestableDraggableFlatList.tsx line 60). The lib calls
// `containerRef.current.measureLayout(nodeHandle, ...)` against `Animated.View`
// from reanimated 3 which doesn't expose `measureLayout` directly; RN prints
// the warning but the lib's own `onFail` callback handles the failure path
// (just logs). Drag-and-drop still works correctly. Latest 4.0.3 still hits
// this — no upstream fix available yet.
//
// Two-layer suppression:
//   1. `LogBox.ignoreLogs` filters the in-app LogBox red/yellow overlay.
//   2. Monkey-patch `console.error` filters the Metro/CLI console output.
//      `LogBox.ignoreLogs` does NOT touch Metro console (per RN docs:
//      "ignoreLogs does not affect logs printed to the system console").
const __DRAG_LIST_WARNING_PATTERN =
  'ref.measureLayout must be called with a ref to a native component.';
LogBox.ignoreLogs([__DRAG_LIST_WARNING_PATTERN]);
const __origConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  if (
    typeof args[0] === 'string' &&
    args[0].includes(__DRAG_LIST_WARNING_PATTERN)
  ) {
    return;
  }
  __origConsoleError(...args);
};

export const unstable_settings = {
  anchor: '(tabs)',
};

/**
 * ADR-0025 § "Boot order" — bridge the app-level ThemeProvider's resolved
 * mode into React Navigation's ThemeProvider so navigator chrome (header
 * bars, default backgrounds) follows the user's pick, not just the system
 * scheme. Without this, picking "Light" in Settings while system is dark
 * would leave navigation chrome dark — visible inconsistency.
 *
 * StatusBar lives here too so its tint follows the resolved theme.
 */
function NavThemeBridge({ children }: { children: ReactNode }) {
  const { resolved } = useTheme();
  return (
    <NavigationThemeProvider value={resolved === 'dark' ? DarkTheme : DefaultTheme}>
      {children}
      <StatusBar style={resolved === 'dark' ? 'light' : 'dark'} />
    </NavigationThemeProvider>
  );
}

export default function RootLayout() {
  // Phase 5 — hydrate locale from AsyncStorage on boot. A brief flash with
  // the default ('zh') is acceptable; once resolved, every `t()` call in
  // subsequent renders returns the user's chosen language. The Settings
  // toggle updates module state directly so re-renders pick up the change.
  //
  // ADR-0025 — theme preference is hydrated inside <ThemeProvider> on its
  // own (no useEffect needed here); see src/theme/ThemeContext.tsx.
  useEffect(() => {
    (async () => {
      const stored = await loadStoredLocale();
      const resolved = resolveLocale(stored);
      setLocale(resolved);
    })();
  }, []);

  // #287 Fix C (2026-06-02) — eager-mount the WatchConnectivity native
  // bridge listeners at APP ENTRY, before the home screen mounts.
  //
  // The npm package's iOS module is a singleton RCTEventEmitter TurboModule
  // that buffers inbound WCSession events behind `hasObservers`, which only
  // flips YES once JS calls `addListener` (→ native `startObserving`, which
  // also flushes the buffer). Previously those listeners registered lazily
  // from `(tabs)/index.tsx`'s useEffect — on a Release standalone cold boot
  // the Watch's first envelope could arrive before that screen mounted, get
  // buffered, and never reach JS (works in Debug+Metro because hot-reload
  // runs extra startObserving cycles). Mounting here, at the app root that
  // renders before any tab, closes that race.
  //
  // This mounts only the native subscription (the part that fixes
  // hasObservers + flushes pendingEvents). The per-kind message HANDLERS
  // still register from the home screen once the DB is ready; envelopes that
  // arrive before a handler exists are parked in connectivity.ts's
  // pre-handler replay buffers and replayed on register. `initWatchBridge`
  // touches no DB, never throws, and is idempotent (won't double-subscribe
  // with the home screen's `addXListener` calls). Runs in a layout effect so
  // it fires synchronously after the first commit, ahead of child screens.
  useEffect(() => {
    initWatchBridge();
  }, []);

  // Slice 15 C4 (ADR-0011 grill Q9-A) — RestoreGate MUST wrap
  // DatabaseProvider: the fresh-install signal is the DB file's absence,
  // and DatabaseProvider's openDatabase() would create the file on mount.
  // While the gate is checking/prompting, nothing below renders, so SQLite
  // stays untouched. Boot-order constraints are preserved: locale (above)
  // and theme (inside <ThemeProvider/>) hydrate from AsyncStorage
  // independently of the gate; the ADR-0023/0025 "theme hydrate before
  // SQLite open" ordering is unchanged — the gate only ever DELAYS the
  // SQLite open, never reorders it ahead of hydration.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <RestoreGate>
    <DatabaseProvider>
      <ThemeProvider>
        <NavThemeBridge>
          <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="program-wizard/new"
            options={{ presentation: 'modal', title: 'New Program' }}
          />
          <Stack.Screen
            name="program/[id]"
            options={{ title: 'Program' }}
          />
          <Stack.Screen
            name="exercise/[id]"
            options={{ title: 'Exercise' }}
          />
          <Stack.Screen
            name="exercise/new"
            options={{ presentation: 'modal', title: 'New Exercise' }}
          />
          <Stack.Screen
            name="exercise/edit/[id]"
            options={{ presentation: 'modal', title: 'Edit Exercise' }}
          />
          {/* Slice 10c overnight #16 — exercise-history / exercise-chart
              changed from modal → card (default Stack presentation). Modal's
              bottom-up animation conflicts with the A↔B horizontal paging
              swipe (#16 #2/#3) and made router-replace swaps feel like
              re-launches rather than page flips. */}
          <Stack.Screen
            name="exercise-history/[id]"
            options={{ title: t('page', 'exerciseHistory') }}
          />
          <Stack.Screen
            name="exercise-chart/[id]"
            options={{ title: t('page', 'exerciseChart') }}
          />
          <Stack.Screen
            name="exercise-picker"
            options={{ headerShown: false }}
          />
          {/* Wave 18g smoke fix — template editor route MUST register
              `headerShown: false` statically here rather than inline via
              `<Stack.Screen options={{ headerShown: false }} />` inside
              the component body. The editor renders its own `<View
              style={styles.topBar}>` so the OS Stack header must be off,
              but setting it dynamically from inside the modal-wizard's
              presentation context triggers expo-router's "Dynamically
              changing header's visibility in modals will result in
              remounting the screen" path → infinite remount loop when
              navigated to via `wizard/new ＋新建`. */}
          <Stack.Screen
            name="template/[id]"
            options={{ headerShown: false }}
          />
          {/* Phase 4.5 batch 1 — preventive lift (mirror wave 18g `ce3ca5a`).
              Session detail page renders its own header, so the OS Stack
              header must be off. Previously this was declared inline via
              `<Stack.Screen options={{ headerShown: false }} />` inside the
              component body — same dangerous pattern as the template editor
              fix above. session/[id] is not currently pushed from a modal
              parent, but lifting now removes the latent risk before the
              next routing change accidentally exposes it. */}
          <Stack.Screen
            name="session/[id]"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="superset/new"
            options={{ presentation: 'modal', headerShown: false }}
          />
          <Stack.Screen
            name="superset/[id]"
            options={{ title: t('domain', 'superset') }}
          />
          <Stack.Screen
            name="superset/edit/[id]"
            options={{ presentation: 'modal', title: t('button', 'editSuperset') }}
          />
          {/* Slice 10c — /superset-history and /superset-chart were folded into
              /exercise-history + /exercise-chart with a `clusterMode=cluster_only`
              param (3-段 segmented control replaces the standalone pages). */}
          {/* Slice 10c — body tab moved out of tab bar to a stack route under
              Settings entry. Today 頁 BodyDataSheet 仍是快速輸入入口；
              /body 頁是「看趨勢 / 看歷史」deep dive 入口. */}
          <Stack.Screen
            name="body"
            options={{ title: t('page', 'bodyMetrics') }}
          />
          </Stack>
        </NavThemeBridge>
      </ThemeProvider>
    </DatabaseProvider>
    </RestoreGate>
    </GestureHandlerRootView>
  );
}
