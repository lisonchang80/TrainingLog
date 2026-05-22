import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LogBox } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { DatabaseProvider } from '@/components/database-provider';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { t } from '@/src/i18n';

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

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <DatabaseProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
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
        <StatusBar style="auto" />
      </ThemeProvider>
    </DatabaseProvider>
    </GestureHandlerRootView>
  );
}
