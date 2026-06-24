import { Tabs } from 'expo-router';
import React from 'react';
import { StyleSheet, Text } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { t, useLocale } from '@/src/i18n';

type TabKey = 'training' | 'programs' | 'library' | 'history' | 'settings';

/**
 * Locale-reactive tab bar label.
 *
 * Two compounding reasons the tab labels used to freeze at the boot language
 * until an app restart — both fixed here:
 *
 * 1. expo-router applies `<Tabs.Screen>` `options` (incl. a static `title`)
 *    ONCE at mount and never re-pushes them when the parent `TabLayout`
 *    re-renders, so a `title: t('tabs', …)` string was captured at boot. Other
 *    screens appear to update only because navigating to them remounts them and
 *    re-runs `t(...)`; the tab bar is always mounted, so it never refreshed.
 *    Fix: render the label through a render-prop component that calls
 *    `useLocale()` — its `useSyncExternalStore` subscription re-renders THIS
 *    component the instant `setLocale()` fires, independent of the navigator.
 *
 * 2. React Compiler is enabled app-wide (`experiments.reactCompiler` in
 *    app.json). It memoizes render output by the deps it can statically see,
 *    but `t('tabs', tabKey)` reads the i18n layer's module-level mutable locale
 *    singleton — invisible to the compiler — so it would happily reuse the
 *    cached boot-language label even after a re-render. `'use no memo'` opts
 *    this component out of compiler memoization so each re-render re-reads the
 *    live language. (Scoped to the label on purpose: opting `useLocale` itself
 *    out would unfreeze the root `<Stack key={locale}>` and remount the whole
 *    tree on every switch — out of scope here.)
 *
 * `color` is handed in by the tab bar (active tint vs inactive gray), so
 * selected/unselected appearance matches the native label automatically;
 * `fontSize`/`fontWeight` mirror the default React Navigation tab label.
 */
function TabLabel({ tabKey, color }: { tabKey: TabKey; color: string }) {
  'use no memo';
  useLocale(); // subscribe: re-render on language change (value read via t() below)
  return (
    <Text numberOfLines={1} style={[styles.label, { color }]}>
      {t('tabs', tabKey)}
    </Text>
  );
}

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
        headerShown: false,
        tabBarButton: HapticTab,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          // ADR-0024 § 1 — Today → 訓練 (i18n via tabs.training); icon
          // 'figure.run' (mapped to MaterialIcons 'directions-run' on
          // Android/web in components/ui/icon-symbol.tsx).
          // `tabBarLabel` render-prop (not `title`) so the label re-renders on
          // a language switch — see TabLabel above.
          tabBarLabel: ({ color }) => <TabLabel tabKey="training" color={color} />,
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="figure.run" color={color} />
          ),
        }}
      />
      {/* ADR-0024 § 1 — Templates tab 砍除；list + start flow 移入訓練 tab 的「模板訓練」區塊。 */}
      <Tabs.Screen
        name="programs"
        options={{
          tabBarLabel: ({ color }) => <TabLabel tabKey="programs" color={color} />,
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="calendar" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          tabBarLabel: ({ color }) => <TabLabel tabKey="library" color={color} />,
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="dumbbell" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          tabBarLabel: ({ color }) => <TabLabel tabKey="history" color={color} />,
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="list.bullet" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          tabBarLabel: ({ color }) => <TabLabel tabKey="settings" color={color} />,
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="gearshape.fill" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 10,
    fontWeight: '500',
    textAlign: 'center',
  },
});
