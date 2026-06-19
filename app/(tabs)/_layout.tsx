import { Tabs } from 'expo-router';
import React from 'react';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAppMode } from '@/src/app-mode';
import { t } from '@/src/i18n';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  // ADR-0026 D1 — 極簡模式隱藏 Programs (計劃) 分頁。`href: null` 把 tab 從 bar
  // 移除但保留 route 註冊（內部任何殘留導向不會 404），切回計劃模式立即恢復。
  const { isMinimal } = useAppMode();

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
          title: t('tabs', 'training'),
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="figure.run" color={color} />
          ),
        }}
      />
      {/* ADR-0024 § 1 — Templates tab 砍除；list + start flow 移入訓練 tab 的「模板訓練」區塊。 */}
      <Tabs.Screen
        name="programs"
        options={{
          // ADR-0026 D1 — href:null removes the 計劃 tab in 極簡模式 while keeping
          // the route registered (reversible — switching back restores it).
          href: isMinimal ? null : undefined,
          title: t('tabs', 'programs'),
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="calendar" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: t('tabs', 'library'),
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="dumbbell" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: t('tabs', 'history'),
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="list.bullet" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('tabs', 'settings'),
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="gearshape.fill" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
