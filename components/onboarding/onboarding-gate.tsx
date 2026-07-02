/**
 * OnboardingGate — ADR-0029. Renders the wizard, the app, or a neutral frame
 * based on the OnboardingProvider status. Mounts INSIDE ThemeProvider +
 * AppModeProvider + DatabaseProvider (the wizard uses all three), wrapping the
 * router Stack (mirrors RestoreGate's replace-children shape).
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';

import { useOnboarding } from '@/src/onboarding';
import { useTheme } from '@/src/theme';
import { OnboardingWizard } from './onboarding-wizard';

export function OnboardingGate({ children }: { children: ReactNode }) {
  const { status } = useOnboarding();
  const { tokens } = useTheme();

  // Hydrating (a few ms of local SQLite read). A solid themed frame avoids
  // flashing either the app or the wizard before the decision resolves.
  if (status === 'loading') {
    return <View style={{ flex: 1, backgroundColor: tokens.bg.base }} />;
  }
  if (status === 'active') {
    return <OnboardingWizard />;
  }
  return <>{children}</>;
}
