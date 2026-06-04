/**
 * Theme barrel export — ADR-0025.
 *
 * Standard import pattern:
 *   import { useTheme } from '@/src/theme';
 *
 * Components should not import directly from `./theme-persist` or
 * `./ThemeContext` — go through this barrel.
 */
export { ThemeProvider, useTheme } from './ThemeContext';
export {
  loadStoredTheme,
  saveStoredTheme,
  resolveTheme,
  type StoredThemeValue,
  type ResolvedTheme,
} from './theme-persist';
export { themeTokens, type ThemeTokens } from '@/constants/theme';
export {
  interactiveCardBg,
  dragActiveRowStyle,
  swipeActionColors,
} from './cardStyles';
