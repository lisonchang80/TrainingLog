/**
 * Page help overlay — shared types (see `.claude/skills/page-help-overlay`).
 *
 * Two presentation styles per the design rubric:
 *   - 'info'  → 說明視窗 (InfoModal): a centred modal with screenshot(s) +
 *               text sections. For pages whose difficulty is *interpretation*
 *               ("what am I looking at / how do I read this number").
 *   - 'coach' → 引導遮罩 (CoachMarkOverlay): a spotlight tour that highlights
 *               UI elements one step at a time with a caption + arrow. For
 *               pages whose difficulty is *discoverability of interaction*
 *               ("what hidden gestures live here / how do I do X step by step").
 *   - 'mixed' → both: the InfoModal opens first and offers a「操作教學 →」
 *               button that hands off to the coach tour.
 *
 * Content is authored per-page as a `LocalizedPageHelp` ({ zh, en }) and
 * lives in its own file under `components/help/content/<pageId>.ts`. It is
 * NOT added to the central `src/i18n/strings.ts` — that file is type-locked
 * for flat `t('ns','key')` lookups and editing it from many parallel agents
 * causes merge collisions (see overnight-parallel-agents rules #17/#18).
 */

export type HelpStyle = 'info' | 'coach' | 'mixed';

/** A window-coordinate rectangle (from `View.measureInWindow`). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Screen dimensions (from `Dimensions.get('window')`). */
export interface Screen {
  width: number;
  height: number;
}

/** One text block inside an InfoModal. */
export interface InfoSection {
  /** Optional bold sub-heading above the body. */
  heading?: string;
  /** Body copy. Plain text; `\n` for line breaks. */
  body: string;
}

/**
 * Optional screenshot inside an InfoModal. `source` is the result of a
 * `require('@/assets/help/<pageId>/<name>.png')` (a Metro asset id, typed as
 * `number`) so the image is bundled. NEVER reference a path that doesn't yet
 * exist on disk — a `require()` of a missing asset breaks the Metro bundler.
 */
export interface InfoImage {
  source: number;
  /** Caption shown under the image. */
  caption?: string;
  /** width / height — used to size the image box. Defaults to 16/9. */
  aspectRatio?: number;
}

/**
 * One ordered block of a 說明視窗 — either a text section or a screenshot.
 * Use `blocks` (instead of `sections` + `images`) when the page needs the
 * two interleaved — e.g. a「動作卡」heading + its screenshot, then a「組」
 * heading + its screenshot. `sections`/`images` always render text-then-images
 * with no interleaving, which detaches a screenshot from the heading it
 * illustrates; `blocks` keeps them adjacent.
 */
export type InfoBlock =
  | ({ kind: 'text' } & InfoSection)
  | ({ kind: 'image' } & InfoImage);

/** The 說明視窗 content. */
export interface InfoContent {
  title: string;
  /**
   * Text sections. Optional when `blocks` is used instead. When both are
   * present, `blocks` wins and these are ignored.
   */
  sections?: InfoSection[];
  /** Zero or more screenshots, rendered in order AFTER all `sections`. */
  images?: InfoImage[];
  /**
   * Ordered, interleaved text + image blocks. When present, the InfoModal
   * renders these in order and ignores `sections`/`images`. Preferred for any
   * "illustrated procedure" where a screenshot must sit next to its heading.
   */
  blocks?: InfoBlock[];
}

/**
 * One step of a 引導遮罩 tour. A step is EITHER a spotlight (set `targetId`)
 * or a screenshot card (set `image`) — interleave the two in one sequence:
 * spotlight the real on-screen elements, and use a screenshot card for the
 * steps a ring can't frame (pop-up menus, swipe/long-press gestures, anything
 * that needs the page in a different state). See `.claude/skills/page-help-overlay`.
 */
export interface CoachStep {
  /**
   * Spotlight step: matches the `id` passed to `useCoachMarkTarget(id)` on the
   * element this step highlights. If the target isn't mounted (off-screen or
   * conditionally rendered), the step degrades to a centred caption — never a
   * crash. Omit for a screenshot-card step (set `image` instead).
   */
  targetId?: string;
  title: string;
  body: string;
  /**
   * Screenshot-card step: a `require()`'d asset id. When set, the overlay shows
   * a centred card with the FULL image (`contain`, never cropped) + the caption
   * text, instead of spotlighting a target. Keep these to ≤3 per tour.
   */
  image?: number;
  /** Image width / height for the card (defaults to 16/9). */
  aspectRatio?: number;
}

/** Fully-resolved help content for one page in one locale. */
export interface PageHelpContent {
  style: HelpStyle;
  /** Present when style is 'info' or 'mixed'. */
  info?: InfoContent;
  /** Present when style is 'coach' or 'mixed'. */
  coach?: CoachStep[];
  /**
   * When the coach steps form a sequential procedure (do 1 → 2 → 3), set this
   * so the overlay numbers each step with a badge. Leave unset for parallel /
   * alternative targets (e.g. the Today tab's three independent start methods,
   * which are choices, not ordered steps).
   */
  coachNumbered?: boolean;
}

/** Per-page help content, both locales. Resolved by `usePageHelp` via `useLocale()`. */
export interface LocalizedPageHelp {
  zh: PageHelpContent;
  en: PageHelpContent;
}
