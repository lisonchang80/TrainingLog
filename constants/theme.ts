/**
 * Color theme — ADR-0025 § "Token shape"
 *
 * 21 semantic tokens × 2 modes (light + dark), iOS-HIG-inspired hex palette.
 * Components access tokens via `useTheme()` from `@/src/theme`; never import
 * `Colors` (legacy) for new code — that export is kept ONLY for the few
 * legacy call sites (`app/_layout.tsx`, `app/(tabs)/_layout.tsx`) and will
 * be removed in Wave 2 cleanup.
 *
 * Design notes (see ADR-0025 for full rationale):
 *   - Dark base = `#000` (OLED battery + max contrast depth)
 *   - Light base = `#FFFFFF`; card = `#F2F2F7` (iOS systemGroupedBackground)
 *   - Text uses black/white + alpha (not gray hex) to avoid color cast
 *   - Accent = iOS system blue (`#007AFF` / `#0A84FF`) — middle-of-the-road,
 *     blends with tab bar / keyboard cursor / links
 *   - Tab.* family is independent of content tokens — future tab style
 *     changes won't pollute content
 */

/** Theme tokens for a single resolved mode (light or dark). */
export interface ThemeTokens {
  bg: {
    /** Page / tab content base. */
    base: string;
    /** Card / primary block background. */
    elevated: string;
    /** Card-in-card / input field background. */
    surface: string;
    /** Bottom sheet / action sheet / dialog. */
    modal: string;
  };
  text: {
    /** Primary headings, input text. */
    primary: string;
    /** Body copy, metric labels (e.g. "訓練時間"). */
    secondary: string;
    /** Gray hints, placeholders. */
    tertiary: string;
    /** Disabled state. */
    disabled: string;
  };
  border: {
    /** Default divider / outline. */
    default: string;
    /** Subtle separator inside cards. */
    subtle: string;
  };
  action: {
    /** Primary CTA / active state / focus. */
    primary: string;
    /** Text/icon on top of `action.primary`. */
    onPrimary: string;
    /** Delete / terminate / dangerous. */
    destructive: string;
    /** Complete / PR badge / success. */
    success: string;
    /** Warning / caution. */
    warning: string;
  };
  tab: {
    /** Active tab icon + label. */
    iconActive: string;
    /** Inactive tab icon + label. */
    iconInactive: string;
    /** Tab bar background. */
    background: string;
  };
}

/** Light + dark token tables. */
export const themeTokens: { light: ThemeTokens; dark: ThemeTokens } = {
  light: {
    bg: {
      base: '#FFFFFF',
      elevated: '#F2F2F7',
      surface: '#FFFFFF',
      modal: '#F9F9F9',
    },
    text: {
      primary: '#000000',
      secondary: 'rgba(60,60,67,0.60)',
      tertiary: 'rgba(60,60,67,0.30)',
      disabled: 'rgba(60,60,67,0.18)',
    },
    border: {
      default: '#C6C6C8',
      subtle: '#E5E5EA',
    },
    action: {
      primary: '#007AFF',
      onPrimary: '#FFFFFF',
      destructive: '#FF3B30',
      success: '#34C759',
      warning: '#FF9500',
    },
    tab: {
      iconActive: '#007AFF',
      iconInactive: '#8E8E93',
      background: '#F9F9F9',
    },
  },
  dark: {
    bg: {
      base: '#000000',
      elevated: '#1C1C1E',
      surface: '#2C2C2E',
      modal: '#1C1C1E',
    },
    text: {
      primary: '#FFFFFF',
      secondary: 'rgba(235,235,245,0.60)',
      tertiary: 'rgba(235,235,245,0.30)',
      disabled: 'rgba(235,235,245,0.18)',
    },
    border: {
      default: '#38383A',
      subtle: '#2C2C2E',
    },
    action: {
      primary: '#0A84FF',
      onPrimary: '#FFFFFF',
      destructive: '#FF453A',
      success: '#30D158',
      warning: '#FF9F0A',
    },
    tab: {
      iconActive: '#0A84FF',
      iconInactive: '#8E8E93',
      background: '#1C1C1E',
    },
  },
};

/**
 * Legacy minimal palette — kept ONLY for `app/_layout.tsx` +
 * `app/(tabs)/_layout.tsx` (the two pre-ADR-0025 call sites that already use
 * this shape). Mapped to the new tokens so they stay in sync.
 *
 * REMOVE in Wave 2 cleanup once those two files migrate to `useTheme()`.
 */
export const Colors = {
  light: {
    text: themeTokens.light.text.primary,
    background: themeTokens.light.bg.base,
    tint: themeTokens.light.action.primary,
    icon: themeTokens.light.tab.iconInactive,
    tabIconDefault: themeTokens.light.tab.iconInactive,
    tabIconSelected: themeTokens.light.tab.iconActive,
  },
  dark: {
    text: themeTokens.dark.text.primary,
    background: themeTokens.dark.bg.base,
    tint: themeTokens.dark.action.primary,
    icon: themeTokens.dark.tab.iconInactive,
    tabIconDefault: themeTokens.dark.tab.iconInactive,
    tabIconSelected: themeTokens.dark.tab.iconActive,
  },
};
