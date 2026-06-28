'use no memo';

/**
 * CastLockOverlay — the iPhone "鎖定視窗" for the cast edit-token lock (ADR-0028).
 *
 * Rendered over the in-session content while this side is LOCKED / REQUESTING /
 * OFFERING (`isLockedOut`). A semi-transparent touch-capturing scrim is the
 * single choke point that blocks EVERY edit interaction at once (taps, swipes,
 * the ⋯ menu, 結束) — the live read-only mirror shows through the dim (Q3), and
 * the only interactive control is the unlock button on top. Three states:
 *   - locked      → 🔒 Apple Watch 編輯中 + [解除鎖定]
 *   - requesting  → ⏳ 取得編輯權中… + spinner (button hidden)
 *   - timed out   → 對方沒有回應 + [強制取得控制權] / [保留鎖定]
 *
 * 'use no memo' + useLocale so the strings re-render live on a locale switch
 * (per the project React-Compiler i18n gotcha).
 */

import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { t } from '@/src/i18n';
import { useLocale } from '@/src/i18n/useLocale';
import { useTheme, type ThemeTokens } from '@/src/theme';
import type { EditLockState } from '@/src/adapters/watch';

export interface CastLockOverlayProps {
  lock: EditLockState;
  onUnlock: () => void;
  onForceTake: () => void;
  onKeepLock: () => void;
}

export function CastLockOverlay({
  lock,
  onUnlock,
  onForceTake,
  onKeepLock,
}: CastLockOverlayProps) {
  useLocale(); // re-render on locale switch
  const { tokens } = useTheme();
  const styles = makeStyles(tokens);

  const requesting = lock.status === 'requesting' || lock.status === 'offering';
  const timedOut = lock.requestTimedOut;

  return (
    // Absolute-fill scrim. Default pointerEvents='auto' = captures ALL touches
    // → blocks every edit interaction underneath; the card's buttons sit on top
    // and receive their own taps.
    <View style={styles.scrim} accessibilityViewIsModal>
      <View style={styles.card}>
        {timedOut ? (
          <>
            <Text style={styles.title}>{t('status', 'lockTimeoutTitle')}</Text>
            <Text style={styles.body}>{t('status', 'lockTimeoutBody')}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={onForceTake}
              style={({ pressed }) => [
                styles.btn,
                styles.btnDanger,
                pressed && styles.btnPressed,
              ]}>
              <Text style={styles.btnDangerText}>
                {t('status', 'lockForceTake')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={onKeepLock}
              style={({ pressed }) => [
                styles.btn,
                styles.btnGhost,
                pressed && styles.btnPressed,
              ]}>
              <Text style={styles.btnGhostText}>
                {t('status', 'lockKeepLock')}
              </Text>
            </Pressable>
          </>
        ) : requesting ? (
          <>
            <Text style={styles.title}>{t('status', 'lockRequesting')}</Text>
            <ActivityIndicator color={tokens.action.primary} style={styles.spinner} />
          </>
        ) : (
          <>
            <Text style={styles.title}>{t('status', 'lockEditingOnWatch')}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={onUnlock}
              style={({ pressed }) => [
                styles.btn,
                styles.btnPrimary,
                pressed && styles.btnPressed,
              ]}>
              <Text style={styles.btnPrimaryText}>
                {t('status', 'lockUnlock')}
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    scrim: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      zIndex: 50,
    },
    card: {
      width: '100%',
      maxWidth: 340,
      backgroundColor: tokens.bg.surface,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tokens.border.default,
      paddingVertical: 24,
      paddingHorizontal: 20,
      alignItems: 'center',
      gap: 12,
    },
    title: {
      fontSize: 18,
      fontWeight: '700' as const,
      color: tokens.text.primary,
      textAlign: 'center' as const,
    },
    body: {
      fontSize: 14,
      color: tokens.text.secondary,
      textAlign: 'center' as const,
    },
    spinner: { marginTop: 4 },
    btn: {
      width: '100%',
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center' as const,
    },
    btnPressed: { opacity: 0.7 },
    btnPrimary: { backgroundColor: tokens.action.primary },
    btnPrimaryText: {
      color: tokens.action.onPrimary,
      fontSize: 16,
      fontWeight: '700' as const,
    },
    btnDanger: { backgroundColor: tokens.action.destructive },
    btnDangerText: {
      color: tokens.action.onPrimary,
      fontSize: 16,
      fontWeight: '700' as const,
    },
    btnGhost: {
      backgroundColor: 'transparent',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tokens.border.default,
    },
    btnGhostText: {
      color: tokens.text.primary,
      fontSize: 16,
      fontWeight: '600' as const,
    },
  });
}
