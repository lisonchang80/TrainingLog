/**
 * Shared "interactive set / cluster card" styling — SINGLE SOURCE OF TRUTH for
 * the three screens that render the same conceptual UI (an exercise card with
 * draggable set rows, swipe actions, a ✓ toggle, footer buttons):
 *
 *   - app/(tabs)/index.tsx                                — in-progress session (REFERENCE look)
 *   - app/session/[id].tsx                                — history session edit mode
 *   - components/template-editor/template-editor-view.tsx — template editor
 *   - components/session/cluster-card.tsx                 — superset cluster card
 *
 * Their styling had drifted (different drag-active highlights, hardcoded swipe
 * hex on the session screen, an expanded card that vanished in light mode).
 * Everything visually-shared now derives from the helpers below, so changing a
 * colour / shape HERE updates every screen at once (ADR-0025 theme system).
 *
 * See skill `unified-card-interaction` for the rationale + the full
 * can / can't-unify matrix and the canonical token values for the parts that
 * are aligned per-file (✓ toggle, footer buttons, section / empty font sizes).
 */
import type { ViewStyle } from 'react-native';

import type { ThemeTokens } from '@/constants/theme';

/**
 * A — interactive card background (collapsed AND expanded).
 *
 * Uses `bg.elevated` so the card stays visibly distinct from the page
 * (`bg.base`). In light mode `bg.surface` === the page colour (#FFFFFF), so an
 * expanded card painted with `bg.surface` disappears — the regression behind
 * 「淺色動作卡展開看不到背景」. Always elevated → always visible, both modes.
 */
export function interactiveCardBg(tokens: ThemeTokens): string {
  return tokens.bg.elevated;
}

/**
 * F — drag-active (long-press → reorder) row highlight.
 *
 * The grabbed row lifts to the brightest surface + a 1px accent border + drop
 * shadow, reading as "picked up" above the elevated card in both light & dark.
 * This is the unified「藍框」look (was: session/cluster = elevated+border,
 * history = elevated/no-border, template = #ffffff/no-border).
 */
export function dragActiveRowStyle(tokens: ThemeTokens): ViewStyle {
  return {
    backgroundColor: tokens.bg.surface,
    borderWidth: 1,
    borderColor: tokens.action.primary,
    borderRadius: 8,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
  };
}

/**
 * H / I — swipe-action colours. Semantic tokens, never hardcoded hex (the
 * in-progress session screen used raw #dc3545 / #28a745 / #007AFF — those are
 * replaced by these so a theme change propagates everywhere).
 */
export function swipeActionColors(tokens: ThemeTokens): {
  remove: string;
  add: string;
  note: string;
} {
  return {
    remove: tokens.action.destructive,
    add: tokens.action.success,
    note: tokens.action.primary,
  };
}

/**
 * J — shared `#` set-kind button on superset/cluster rows (28×22, 3D bevel).
 * Rendered by BOTH the session cluster card and the template editor's
 * superset rows; the template copy had drifted to hardcoded light-palette hex
 * (#fafafa / #e5e7eb …) and showed as a white brick in dark mode
 * (2026-06-11 device screenshot). Single source here — geometry + colours.
 */
export function sharedLabelBtnStyle(tokens: ThemeTokens): ViewStyle {
  return {
    width: 28,
    height: 22,
    borderRadius: 4,
    backgroundColor: tokens.bg.surface,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 2,
    borderTopColor: tokens.border.subtle,
    borderLeftColor: tokens.border.default,
    borderRightColor: tokens.border.default,
    borderBottomColor: tokens.text.tertiary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 1.5,
    elevation: 2,
  };
}

/** J — pressed state of the shared `#` button (bevel inverts, sinks 1px). */
export function sharedLabelBtnPressedStyle(tokens: ThemeTokens): ViewStyle {
  return {
    backgroundColor: tokens.bg.elevated,
    borderTopWidth: 2,
    borderBottomWidth: 1,
    borderTopColor: tokens.text.tertiary,
    borderLeftColor: tokens.border.default,
    borderRightColor: tokens.border.default,
    borderBottomColor: tokens.border.subtle,
    shadowOpacity: 0,
    elevation: 0,
    transform: [{ translateY: 1 }],
  };
}
