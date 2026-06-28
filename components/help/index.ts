/**
 * Page help overlay — public surface.
 *
 * See `.claude/skills/page-help-overlay` for the full recipe (decision rubric,
 * wiring steps, screenshot pipeline) and `components/help/content/_example.ts`
 * for an authored-content template.
 */

export { HelpButton } from './HelpButton';
export { InfoModal } from './InfoModal';
export { CoachMarkOverlay } from './CoachMarkOverlay';
export { CoachMarkProvider, useCoachMarkTarget } from './CoachMarkProvider';
export { PageHelpHost } from './PageHelpHost';
export { usePageHelp, type PageHelpHandle } from './usePageHelp';
export { getHelpSeen, markHelpSeen, helpSeenKey } from './helpFlags';
export { pickCoachPlacement, clamp } from './coachMarkLayout';
export type {
  HelpStyle,
  InfoSection,
  InfoImage,
  InfoContent,
  CoachStep,
  PageHelpContent,
  LocalizedPageHelp,
  Rect,
  Screen,
} from './types';
