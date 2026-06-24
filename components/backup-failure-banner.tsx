import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { tBackupEscalationLine } from '@/components/backup-status.behavior';
import { useDatabase } from '@/components/database-provider';
import { useLocale } from '@/src/i18n';
import { getBackupHealth } from '@/src/services/backupService';
import { useTheme, type ThemeTokens } from '@/src/theme';

/**
 * BackupFailureBanner — slice 15 C5 (ADR-0011 Q14.7 + 2026-06-12 grill
 * Q14-B: in-app only escalation, NO push notifications).
 *
 * Renders nothing until the unhealed backup-failure streak crosses the
 * escalation threshold (3 days auto / 7 days manual — `getBackupHealth` →
 * `shouldEscalateBackupFailure`), then shows a red banner on the home
 * screen. Tapping routes to Settings, where the C3 section carries the
 * classified error line + the fix surface (立即備份 / iCloud warning).
 *
 * Re-evaluates on every focus of the host screen — a successful backup
 * (manual or automatic) heals the streak in metadata, so the banner
 * disappears on the next focus without any cross-component wiring.
 * `getBackupHealth` failures degrade to "no banner" (never block the home
 * screen over a readout).
 */
export function BackupFailureBanner() {
  'use no memo'; // React Compiler memoizes tBackupEscalationLine()'s locale read;
  // subscribe to locale so a language switch re-renders this banner live.
  useLocale();
  const db = useDatabase();
  const router = useRouter();
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  const [banner, setBanner] = useState<{ escalated: boolean; days: number | null }>({
    escalated: false,
    days: null,
  });

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      getBackupHealth(db)
        .then((health) => {
          if (!cancelled) {
            setBanner({ escalated: health.escalated, days: health.escalatedDays });
          }
        })
        .catch(() => {
          // metadata unreadable → fail quiet (no banner), C3 readout owns errors
        });
      return () => {
        cancelled = true;
      };
    }, [db])
  );

  if (!banner.escalated) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tBackupEscalationLine(banner.days)}
      onPress={() => router.push('/settings')}
      style={({ pressed }) => [styles.banner, pressed && styles.pressed]}>
      <Text style={styles.text}>⚠️ {tBackupEscalationLine(banner.days)}</Text>
    </Pressable>
  );
}

function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    banner: {
      borderRadius: 10,
      paddingVertical: 10,
      paddingHorizontal: 14,
      backgroundColor: tokens.action.destructive,
      marginBottom: 4,
    },
    text: {
      fontSize: 13,
      fontWeight: '600',
      color: tokens.action.onPrimary,
    },
    pressed: { opacity: 0.85 },
  });
}
