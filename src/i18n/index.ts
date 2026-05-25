/**
 * Barrel re-export so callers can do `import { t, tCycleN } from '@/src/i18n'`.
 * Strings and dynamic helpers live in separate files but share `getLocale()`
 * state via the strings module.
 */
export * from './strings';
export * from './dynamic';
