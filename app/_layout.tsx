import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { DatabaseProvider } from '@/components/database-provider';
import { useColorScheme } from '@/hooks/use-color-scheme';

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
            options={{ title: '動作歷史' }}
          />
          <Stack.Screen
            name="exercise-chart/[id]"
            options={{ title: '動作圖表' }}
          />
          <Stack.Screen
            name="exercise-picker"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="superset/new"
            options={{ presentation: 'modal', headerShown: false }}
          />
          <Stack.Screen
            name="superset/[id]"
            options={{ title: '超級組' }}
          />
          <Stack.Screen
            name="superset/edit/[id]"
            options={{ presentation: 'modal', title: '編輯超級組' }}
          />
          {/* Slice 10c — /superset-history and /superset-chart were folded into
              /exercise-history + /exercise-chart with a `clusterMode=cluster_only`
              param (3-段 segmented control replaces the standalone pages). */}
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </DatabaseProvider>
    </GestureHandlerRootView>
  );
}
