/**
 * Structural invariants for EVERY authored page-help content module
 * (`components/help/content/*.ts`).
 *
 * Each page authors a `LocalizedPageHelp` = `{ zh, en }` of `PageHelpContent`
 * (see `components/help/types.ts`). The runtime (`usePageHelp` → `InfoModal` /
 * `CoachMarkOverlay`) trusts these shapes without validating them; a malformed
 * step — a coach step with BOTH `targetId` and `image`, an image step missing
 * `aspectRatio`, an empty `title`, or a zh/en step-count mismatch — silently
 * renders wrong (blank card, un-spotlit step, one locale short) instead of
 * throwing. These tests are the guardrail.
 *
 * The list is explicit (jest-expo can't cheaply glob-`require` the .ts modules)
 * — add a new content export here when you author one. `_example.ts` is the
 * authoring template and is intentionally NOT wired to any page, so it is
 * excluded.
 */
import type {
  LocalizedPageHelp,
  PageHelpContent,
  CoachStep,
  InfoBlock,
} from '../../components/help/types';

import { bodyHelp } from '../../components/help/content/body';
import { exerciseChartHelp, exerciseChartHelpMinimal } from '../../components/help/content/exercise-chart';
import { exerciseDetailHelp } from '../../components/help/content/exercise-detail';
import { exerciseHistoryHelp, exerciseHistoryHelpMinimal } from '../../components/help/content/exercise-history';
import { achievementsHelp } from '../../components/help/content/history-achievements';
import { statsHelp } from '../../components/help/content/history-stats';
import { historyHelp, historyHelpMinimal } from '../../components/help/content/history';
import { libraryHelp } from '../../components/help/content/library';
import { programsHelp } from '../../components/help/content/programs';
import { sessionDetailHelp } from '../../components/help/content/session-detail';
import { supersetDetailHelp } from '../../components/help/content/superset-detail';
import { supersetNewHelp } from '../../components/help/content/superset-new';
import { templateEditorHelp } from '../../components/help/content/template-editor';
import { todayMinimalHelp } from '../../components/help/content/today-minimal';
import { todayPlanHelp } from '../../components/help/content/today-plan';
import { todaySessionHelp } from '../../components/help/content/today-session';

/** Every authored, page-wired content module (NOT `_example`). */
const ALL_CONTENT: ReadonlyArray<readonly [string, LocalizedPageHelp]> = [
  ['body', bodyHelp],
  ['exercise-chart', exerciseChartHelp],
  ['exercise-chart (minimal)', exerciseChartHelpMinimal],
  ['exercise-detail', exerciseDetailHelp],
  ['exercise-history', exerciseHistoryHelp],
  ['exercise-history (minimal)', exerciseHistoryHelpMinimal],
  ['history-achievements', achievementsHelp],
  ['history-stats', statsHelp],
  ['history', historyHelp],
  ['history (minimal)', historyHelpMinimal],
  ['library', libraryHelp],
  ['programs', programsHelp],
  ['session-detail', sessionDetailHelp],
  ['superset-detail', supersetDetailHelp],
  ['superset-new', supersetNewHelp],
  ['template-editor', templateEditorHelp],
  ['today-minimal', todayMinimalHelp],
  ['today-plan', todayPlanHelp],
  ['today-session', todaySessionHelp],
];

const LOCALES = ['zh', 'en'] as const;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function isPositiveFinite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function assertCoachStep(step: CoachStep, label: string): void {
  // XOR: exactly one of targetId / image.
  const hasTarget = step.targetId != null;
  const hasImage = step.image != null;
  expect(`${label}: xor(target,image)=${hasTarget !== hasImage}`).toBe(
    `${label}: xor(target,image)=true`,
  );

  if (hasTarget) {
    expect(isNonEmptyString(step.targetId)).toBe(true);
  }
  if (hasImage) {
    // require()'d asset ids are numbers (Metro asset id).
    expect(typeof step.image).toBe('number');
    // Image steps size themselves via aspectRatio; when present it must be
    // a positive finite ratio (the type defaults it to 16/9 when omitted).
    if (step.aspectRatio !== undefined) {
      expect(isPositiveFinite(step.aspectRatio)).toBe(true);
    }
  }

  expect(isNonEmptyString(step.title)).toBe(true);
  expect(isNonEmptyString(step.body)).toBe(true);
}

function assertInfoBlock(block: InfoBlock, label: string): void {
  expect(['text', 'image']).toContain(block.kind);
  if (block.kind === 'text') {
    // heading is optional per the type, but body is always required + non-empty.
    expect(isNonEmptyString(block.body)).toBe(true);
    if (block.heading !== undefined) {
      expect(isNonEmptyString(block.heading)).toBe(true);
    }
  } else {
    expect(block.source).toBeTruthy();
    expect(typeof block.source).toBe('number');
    if (block.aspectRatio !== undefined) {
      expect(isPositiveFinite(block.aspectRatio)).toBe(true);
    }
  }
}

function assertContent(c: PageHelpContent, label: string): void {
  expect(['info', 'coach', 'mixed']).toContain(c.style);

  const wantsCoach = c.style === 'coach' || c.style === 'mixed';
  const wantsInfo = c.style === 'info' || c.style === 'mixed';

  if (wantsCoach) {
    expect(Array.isArray(c.coach)).toBe(true);
    expect(c.coach!.length).toBeGreaterThan(0);
    if (c.coachNumbered !== undefined) {
      expect(typeof c.coachNumbered).toBe('boolean');
    }
    c.coach!.forEach((step, i) => assertCoachStep(step, `${label} coach[${i}]`));
  }

  if (wantsInfo) {
    expect(c.info).toBeDefined();
    expect(isNonEmptyString(c.info!.title)).toBe(true);
    // A page uses EITHER `blocks` (interleaved) or `sections`(+`images`).
    if (c.info!.blocks) {
      expect(c.info!.blocks.length).toBeGreaterThan(0);
      c.info!.blocks.forEach((b, i) =>
        assertInfoBlock(b, `${label} info.blocks[${i}]`),
      );
    }
    if (c.info!.sections) {
      c.info!.sections.forEach((s, i) => {
        expect(isNonEmptyString(s.body)).toBe(true);
        if (s.heading !== undefined) {
          expect(isNonEmptyString(s.heading)).toBe(true);
        }
        void i;
      });
    }
    if (c.info!.images) {
      c.info!.images.forEach((img) => {
        expect(img.source).toBeTruthy();
        if (img.aspectRatio !== undefined) {
          expect(isPositiveFinite(img.aspectRatio)).toBe(true);
        }
      });
    }
  }
}

describe('help content — structural invariants', () => {
  it('covers a non-trivial number of content modules', () => {
    // Guards against the import list silently collapsing to nothing.
    expect(ALL_CONTENT.length).toBeGreaterThanOrEqual(15);
  });

  describe.each(ALL_CONTENT)('%s', (name, content) => {
    it('has both zh + en locales', () => {
      expect(content.zh).toBeDefined();
      expect(content.en).toBeDefined();
    });

    it.each(LOCALES)('%s: valid style + fields', (locale) => {
      assertContent(content[locale], `${name}.${locale}`);
    });

    it('zh + en share the same style', () => {
      expect(content.zh.style).toBe(content.en.style);
    });

    it('zh + en coach step counts match (when coach)', () => {
      if (content.zh.style === 'coach' || content.zh.style === 'mixed') {
        expect(content.zh.coach!.length).toBe(content.en.coach!.length);
      }
    });

    it('zh + en info block counts match (when blocks used)', () => {
      const zhBlocks = content.zh.info?.blocks;
      const enBlocks = content.en.info?.blocks;
      if (zhBlocks || enBlocks) {
        expect(zhBlocks?.length ?? 0).toBe(enBlocks?.length ?? 0);
      }
    });

    it('zh + en coach step KINDS align position-by-position (target vs image)', () => {
      if (content.zh.style === 'coach' || content.zh.style === 'mixed') {
        const zh = content.zh.coach!;
        const en = content.en.coach!;
        zh.forEach((zStep, i) => {
          const eStep = en[i];
          // same step should be a spotlight in both locales, or a card in both.
          expect(zStep.image != null).toBe(eStep.image != null);
          expect(zStep.targetId ?? null).toBe(eStep.targetId ?? null);
        });
      }
    });
  });
});
