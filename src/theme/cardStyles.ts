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
