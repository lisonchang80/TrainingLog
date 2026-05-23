/**
 * MuscleBodyTagger — library-based replacement for MuscleDiagramTagged
 * (slice 10c smoke iteration).
 *
 * Mirrors `components/body-heatmap.tsx` (which uses the same
 * `react-native-body-highlighter` package) — the same 14-slug collapsed
 * vocabulary, the same color-override pattern (emit an entry for EVERY slug
 * so the package's hardcoded asset `color: "#3f3f3f"` is suppressed), and the
 * same front+back side-by-side layout.
 *
 * Two modes:
 *   - 'readonly'   : disables onBodyPartPress; pure highlight display.
 *   - 'tap-cycle'  : forwards taps to `onTap(mId)`. The CYCLE LOGIC
 *                    (untagged → primary → secondary → untagged) lives in
 *                    the CALLER, not this component — the caller already
 *                    owns the primary/secondary state and decides the
 *                    promotion / demotion semantics.
 *
 * Color tokens preserve the existing MuscleDiagramTagged palette so the
 * detail page + custom-exercise-form look continues to match:
 *   primary   → #F26B3A (orange)
 *   secondary → #7CB6E0 (blue)
 *
 * When 2+ M_* collapse onto a single slug (e.g. all three deltoid heads →
 * `deltoids`), primary wins over secondary — the visual emphasises the
 * "hottest" role across the group.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Body, { type ExtendedBodyPart, type Slug } from 'react-native-body-highlighter';

import {
  M_ABS,
  M_BACK,
  M_BICEP_LONG,
  M_BICEP_SHORT,
  M_CALF,
  M_FOREARM,
  M_FRONT_DELT,
  M_HAMSTRING,
  M_LOWER_BACK,
  M_LOWER_CHEST,
  M_LOWER_GLUTE,
  M_MID_DELT,
  M_OBLIQUE,
  M_QUAD,
  M_REAR_DELT,
  M_TRAP,
  M_TRICEP,
  M_UPPER_CHEST,
  M_UPPER_GLUTE,
} from '@/src/db/seed/v006ExerciseLibrary';
import type { MuscleRole } from '@/src/domain/exercise/types';
import { t } from '@/src/i18n';

// ---------------------------------------------------------------------------
// Color tokens — preserve existing MuscleDiagramTagged palette
// ---------------------------------------------------------------------------

const COLOR_PRIMARY = '#F26B3A';
const COLOR_SECONDARY = '#7CB6E0';
const COLOR_BODY_BASE = '#FAFAFA';
const COLOR_SKIN = '#E5E5E5';
const COLOR_OUTLINE = '#9CA3AF';

/**
 * Color array fed to the underlying Body component. Index 0 = body base,
 * 1 = primary (orange), 2 = secondary (blue). The `intensity` field on
 * each ExtendedBodyPart picks the index; we still pass `color` explicitly
 * to defeat the package's hardcoded asset `color: "#3f3f3f"`.
 */
const BODY_COLORS: ReadonlyArray<string> = [
  COLOR_BODY_BASE,
  COLOR_PRIMARY,
  COLOR_SECONDARY,
];

// Re-export so callers can keep importing MuscleRole from one place.
export type { MuscleRole };

export interface MuscleBodyTaggerProps {
  /** M_* → role map. Highlighted muscles only. */
  highlight: Map<string, MuscleRole>;
  /** Render mode. Defaults to 'readonly'. */
  mode?: 'readonly' | 'tap-cycle';
  /** Called when user taps a muscle (only fires in tap-cycle mode). */
  onTap?: (mId: string) => void;
}

// ---------------------------------------------------------------------------
// M_* → package Slug mapping (14 unique slugs after collapse)
//
// The package only ships 23 slugs and bundles head-groups (e.g. anterior /
// lateral / posterior deltoid all live under `deltoids`). When 2+ M_*
// constants collapse onto the same slug, the slug's role = whichever role
// wins (primary > secondary > untagged) so the visual surfaces the most
// emphatic tag.
// ---------------------------------------------------------------------------

const M_TO_SLUG: Record<string, Slug> = {
  [M_TRAP]: 'trapezius',
  [M_FRONT_DELT]: 'deltoids',
  [M_MID_DELT]: 'deltoids',
  [M_REAR_DELT]: 'deltoids',
  [M_UPPER_CHEST]: 'chest',
  [M_LOWER_CHEST]: 'chest',
  [M_BICEP_LONG]: 'biceps',
  [M_BICEP_SHORT]: 'biceps',
  [M_TRICEP]: 'triceps',
  [M_FOREARM]: 'forearm',
  [M_ABS]: 'abs',
  [M_OBLIQUE]: 'obliques',
  [M_BACK]: 'upper-back',
  [M_LOWER_BACK]: 'lower-back',
  [M_QUAD]: 'quadriceps',
  [M_HAMSTRING]: 'hamstring',
  [M_UPPER_GLUTE]: 'gluteal',
  [M_LOWER_GLUTE]: 'gluteal',
  [M_CALF]: 'calves',
};

/**
 * Reverse index: slug → all M_* ids that collapse onto it. Used by the
 * tap handler so a single tap on the (collapsed) `deltoids` slug can
 * forward tap events for each of the three deltoid M_* ids — the caller
 * then decides what to do with the group (typical: cycle all three in
 * lock-step, matching what the legacy SVG already did via per-head
 * buttons that happened to share visuals).
 */
const SLUG_TO_M_IDS: Map<Slug, string[]> = (() => {
  const out = new Map<Slug, string[]>();
  for (const [m, slug] of Object.entries(M_TO_SLUG)) {
    const arr = out.get(slug);
    if (arr) arr.push(m);
    else out.set(slug, [m]);
  }
  return out;
})();

/**
 * All slugs rendered by the package (across front + back assets). Used to
 * force-override every part's `color` since the package's asset data ships
 * with a baked-in `color: "#3f3f3f"` per part that takes precedence over
 * the component's `defaultFill` prop. Mirrors the list in body-heatmap.tsx.
 */
const ALL_SLUGS: ReadonlyArray<Slug> = [
  'abs', 'adductors', 'ankles', 'biceps', 'calves', 'chest', 'deltoids',
  'feet', 'forearm', 'gluteal', 'hamstring', 'hands', 'hair', 'head',
  'knees', 'lower-back', 'neck', 'obliques', 'quadriceps', 'tibialis',
  'trapezius', 'triceps', 'upper-back',
];

const SKIN_SLUGS: ReadonlySet<Slug> = new Set<Slug>(['head', 'hair', 'hands', 'feet']);

/**
 * Map a hex color back to an `intensity` index understood by the Body
 * component. Index alignment: 0 = body base, 1 = primary, 2 = secondary.
 */
function colorToIntensity(color: string): number {
  if (color === COLOR_PRIMARY) return 1;
  if (color === COLOR_SECONDARY) return 2;
  return 0;
}

/**
 * Collapse the 19 M_* roles onto the package's slug vocabulary
 * (primary > secondary tiebreak), then emit an entry for EVERY slug —
 * highlighted ones get the role color, the rest get the light body base
 * (or skin-tone for head/hair/hands/feet).
 */
function buildData(highlight: Map<string, MuscleRole>): ExtendedBodyPart[] {
  const slugRole = new Map<Slug, MuscleRole>();
  for (const [m, slug] of Object.entries(M_TO_SLUG)) {
    const role = highlight.get(m);
    if (!role) continue;
    const prev = slugRole.get(slug);
    // primary wins over secondary, secondary wins over untagged.
    if (!prev || role === 'primary') slugRole.set(slug, role);
  }
  const out: ExtendedBodyPart[] = [];
  for (const slug of ALL_SLUGS) {
    const role = slugRole.get(slug);
    if (role) {
      const color = role === 'primary' ? COLOR_PRIMARY : COLOR_SECONDARY;
      out.push({ slug, color, intensity: colorToIntensity(color) });
    } else {
      const fill = SKIN_SLUGS.has(slug) ? COLOR_SKIN : COLOR_BODY_BASE;
      out.push({ slug, color: fill });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

export function MuscleBodyTagger({
  highlight,
  mode = 'readonly',
  onTap,
}: MuscleBodyTaggerProps): React.JSX.Element {
  const data = React.useMemo(() => buildData(highlight), [highlight]);

  const handlePress = React.useCallback(
    (part: ExtendedBodyPart) => {
      if (mode !== 'tap-cycle' || !onTap) return;
      const slug = part.slug;
      if (!slug) return;
      const mIds = SLUG_TO_M_IDS.get(slug);
      if (!mIds) return; // slug not part of our tagging vocab (e.g. head)
      for (const mId of mIds) onTap(mId);
    },
    [mode, onTap]
  );

  const bodyProps = mode === 'tap-cycle' ? { onBodyPartPress: handlePress } : {};

  return (
    <View>
      <View style={styles.row}>
        <View style={styles.column}>
          <Text style={styles.label}>{t('page', 'bodyFront')}</Text>
          <Body
            side="front"
            gender="male"
            data={data}
            colors={BODY_COLORS}
            scale={0.8}
            border={COLOR_OUTLINE}
            defaultFill={COLOR_BODY_BASE}
            defaultStroke={COLOR_OUTLINE}
            {...bodyProps}
          />
        </View>
        <View style={styles.column}>
          <Text style={styles.label}>{t('page', 'bodyBack')}</Text>
          <Body
            side="back"
            gender="male"
            data={data}
            colors={BODY_COLORS}
            scale={0.8}
            border={COLOR_OUTLINE}
            defaultFill={COLOR_BODY_BASE}
            defaultStroke={COLOR_OUTLINE}
            {...bodyProps}
          />
        </View>
      </View>
      <View style={styles.legendRow}>
        <LegendItem color={COLOR_PRIMARY} label={t('status', 'muscleRolePrimary')} />
        <LegendItem color={COLOR_SECONDARY} label={t('status', 'muscleRoleSecondary')} />
      </View>
    </View>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  column: {
    alignItems: 'center',
  },
  label: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 4,
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginTop: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  swatch: {
    width: 12,
    height: 12,
    borderRadius: 3,
  },
  legendText: {
    fontSize: 12,
    color: '#374151',
  },
});
