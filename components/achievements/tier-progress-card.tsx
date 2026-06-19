/**
 * TierProgressCard — one collapsed (group × type) ladder card for the
 * achievements panel (ADR-0009 Slice 17 amendment).
 *
 * Shows: title (localised group + PR type / "Sessions"), current tier badge
 * coloured by tier index, an optional level-0「入門」entry badge (bucket cards),
 * a progress bar, and the numerator/denominator "X / Y" (or 滿級 at top tier).
 *
 * Structure colours flow from useTheme().tokens (ADR-0025). The TIER ACCENT
 * palette below is a hardcoded SEMANTIC-ACCENT constant — like PR / chart
 * colours, it is exempt from the token rule: a bronze→diamond medal ramp has
 * fixed meaning that must read the same in light and dark mode.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { getLocale, t } from '@/src/i18n';
import { useTheme, type ThemeTokens } from '@/src/theme';
import type { TierCardVM } from '@/src/domain/achievement/achievementPanelModel';

/** "第 N 級" / "Lv N" — inline locale helper (panel-only, like tUnlockedRatio). */
function tTierLabel(tier: number): string {
  return getLocale() === 'en' ? `Lv ${tier}` : `第 ${tier} 級`;
}

/**
 * Semantic-accent tier ramp: index 0 = "no tier yet" (neutral grey), then
 * 銅→銀→金→白金→鑽 for tiers 1..6. session_count uses up to 8 tiers, so the
 * top two reuse the diamond accent (highest is still visually "max").
 */
const TIER_ACCENTS: readonly string[] = [
  '#9AA0A6', // 0 — none yet (neutral)
  '#CD7F32', // 1 — 銅 bronze
  '#B8BEC6', // 2 — 銀 silver
  '#E8B923', // 3 — 金 gold
  '#7FBFD6', // 4 — 白金 platinum
  '#6FD6C2', // 5 — 鑽 diamond
  '#A88BEB', // 6 — beyond-diamond (amethyst) for 6+ ladders
];

function tierAccent(tierIndex: number): string {
  if (tierIndex <= 0) return TIER_ACCENTS[0];
  const i = Math.min(tierIndex, TIER_ACCENTS.length - 1);
  return TIER_ACCENTS[i];
}

/** Build the card title from the VM + a localised group-label resolver. */
function cardTitle(card: TierCardVM, resolveGroupLabel: (key: string) => string): string {
  if (card.kind === 'milestone') return t('status', 'achievementSessionCount');
  const typeLabel =
    card.prType === 'weight'
      ? t('status', 'achievementWeightPr')
      : t('status', 'achievementVolumePr');
  const group = card.groupLabelKey != null ? resolveGroupLabel(card.groupLabelKey) : '';
  return `${group} · ${typeLabel}`;
}

interface Props {
  card: TierCardVM;
  /** Resolve a groupLabelKey (mg_id OR bucket key) to a localised label. */
  resolveGroupLabel: (key: string) => string;
}

export function TierProgressCard({ card, resolveGroupLabel }: Props) {
  const { tokens } = useTheme();
  const styles = React.useMemo(() => makeStyles(tokens), [tokens]);

  const accent = tierAccent(card.tierIndex);
  const title = cardTitle(card, resolveGroupLabel);

  // Progress fraction within the CURRENT rung→next rung span. At tier 0 the
  // span is 0→firstThreshold; maxed → full bar.
  const denom = card.nextThreshold ?? card.reachedThreshold;
  const lower = card.reachedThreshold;
  const fraction = card.maxed
    ? 1
    : denom > lower
      ? Math.max(0, Math.min(1, (card.currentCount - lower) / (denom - lower)))
      : 0;

  const tierLabel = card.currentTier > 0 ? tTierLabel(card.currentTier) : null;

  return (
    <View style={[styles.card, { borderColor: accent }]}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {card.entryBadge ? (
          <View style={[styles.entryBadge, { borderColor: accent }]}>
            <Text style={[styles.entryBadgeText, { color: accent }]}>
              {t('status', 'achievementEntryBadge')}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.tierRow}>
        {tierLabel ? (
          <View style={[styles.tierPill, { backgroundColor: accent }]}>
            <Text style={styles.tierPillText}>{tierLabel}</Text>
          </View>
        ) : (
          <View style={[styles.tierPill, styles.tierPillEmpty]}>
            <Text style={styles.tierPillEmptyText}>{tTierLabel(0)}</Text>
          </View>
        )}
        <Text style={styles.ratio}>
          {card.maxed ? t('status', 'achievementMaxed') : `${card.currentCount} / ${card.nextThreshold}`}
        </Text>
      </View>

      <View
        style={styles.progressTrack}
        accessible
        accessibilityRole="image"
        accessibilityLabel={`${t('button', 'a11yTierProgress')} ${Math.round(fraction * 100)}%`}>
        <View
          style={[
            styles.progressFill,
            { width: `${Math.round(fraction * 100)}%`, backgroundColor: accent },
          ]}
        />
      </View>
    </View>
  );
}

function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    card: {
      backgroundColor: tokens.bg.elevated,
      borderRadius: 12,
      borderWidth: 1.5,
      padding: 12,
      gap: 8,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    title: { flex: 1, fontSize: 14, fontWeight: '700', color: tokens.text.primary },
    entryBadge: {
      borderWidth: 1,
      borderRadius: 6,
      paddingHorizontal: 6,
      paddingVertical: 1,
    },
    entryBadgeText: { fontSize: 10, fontWeight: '700' },
    tierRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    tierPill: {
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 3,
    },
    tierPillText: { fontSize: 12, fontWeight: '800', color: '#FFFFFF' },
    tierPillEmpty: { backgroundColor: tokens.bg.surface },
    tierPillEmptyText: { fontSize: 12, fontWeight: '700', color: tokens.text.tertiary },
    ratio: { fontSize: 13, fontWeight: '600', color: tokens.text.secondary },
    progressTrack: {
      height: 8,
      borderRadius: 4,
      backgroundColor: tokens.bg.surface,
      overflow: 'hidden',
    },
    progressFill: { height: '100%', borderRadius: 4 },
  });
}
