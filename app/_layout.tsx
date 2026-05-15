import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';

import { DatabaseProvider } from '@/components/database-provider';
import { useColorScheme } from '@/hooks/use-color-scheme';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
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
          <Stack.Screen
            name="exercise-history/[id]"
            options={{ presentation: 'modal', title: '動作歷史' }}
          />
          <Stack.Screen
            name="exercise-chart/[id]"
            options={{ presentation: 'modal', title: '動作圖表' }}
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
          <Stack.Screen
            name="superset-history/[id]"
            options={{ presentation: 'modal', title: '超級組歷史' }}
          />
          <Stack.Screen
            name="superset-chart/[id]"
            options={{ presentation: 'modal', title: '超級組圖表' }}
          />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </DatabaseProvider>
  );
}
