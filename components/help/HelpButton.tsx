import { useMemo } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';
import { t } from '@/src/i18n';
import { useTheme, type ThemeTokens } from '@/src/theme';

/**
 * The ⓘ help button placed in a difficult page's top-right corner. Tapping
 * it opens that page's help (InfoModal or CoachMarkOverlay) — wire `onPress`
 * to the `open` returned by `usePageHelp`.
 *
 * Renders an SF Symbol (`info.circle`) tinted with the action colour, sized
 * for a comfortable 44pt tap target. Drop it into a header row / Stack.Screen
 * `headerRight`, or absolutely-position it over a custom header.
 */
interface HelpButtonProps {
  onPress: () => void;
  /** Override the glyph (e.g. 'questionmark.circle' for an FAQ flavour). */
  symbol?: string;
  /** Glyph size in pt. Default 22. */
  size?: number;
  /** Extra style for the pressable hit area (e.g. margins). */
  style?: StyleProp<ViewStyle>;
}

export function HelpButton({
  onPress,
  symbol = 'info.circle',
  size = 22,
  style,
}: HelpButtonProps) {
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('help', 'button')}
      hitSlop={8}
      style={({ pressed }) => [styles.hit, pressed && styles.pressed, style]}>
      <IconSymbol name={symbol as never} size={size} color={tokens.action.primary} />
    </Pressable>
  );
}

function makeStyles(_tokens: ThemeTokens) {
  return StyleSheet.create({
    hit: {
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pressed: {
      opacity: 0.5,
    },
  });
}
