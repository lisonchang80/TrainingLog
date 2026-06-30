import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { t } from '@/src/i18n';
import { useTheme, type ResolvedTheme, type ThemeTokens } from '@/src/theme';

import { pickCoachPlacement, resolveCoachBubbleAnchor } from './coachMarkLayout';
import {
  useCoachMarkMeasure,
  useCoachMarkScrollIntoView,
  useCoachMarkScrollToTop,
} from './CoachMarkProvider';
import type { CoachStep, Rect } from './types';

// 遮罩 (scrim) always darkens toward black, never a theme surface token. Dark
// mode goes deeper (user feedback 2026-06-29) so the spotlight reads against a
// dim OLED page; light mode keeps the lighter dim.
const SCRIM_DARK = 'rgba(0,0,0,0.82)';
const SCRIM_LIGHT = 'rgba(0,0,0,0.62)';

// 字卡 (caption bubble) is a fixed near-black card with white text in BOTH
// modes — the coach-mark convention (a dark bubble floats clearly over any
// page) and the user's「黑底白字」ask. Self-contained palette so contrast never
// depends on the resolved theme; only the accent stays on-brand via tokens.
const BUBBLE_BG = '#15171C';
const BUBBLE_TITLE = '#FFFFFF';
const BUBBLE_BODY = 'rgba(255,255,255,0.84)';
const BUBBLE_MUTED = 'rgba(255,255,255,0.55)';
const DOT_IDLE = 'rgba(255,255,255,0.28)';

const RING_PAD = 6; // px the highlight ring grows past the target
const GAP = 12; // px between the target and the caption bubble

/**
 * 引導遮罩 — a step-by-step spotlight tour. For each step it measures the
 * element registered under `step.targetId` (via `useCoachMarkTarget`), dims
 * everything except that element with four scrim rectangles, draws a rounded
 * highlight ring around it, and floats a rounded dark caption bubble just above
 * or below it per `pickCoachPlacement`. No arrow (per 2026-06-29 feedback — the
 * triangle was the only sharp 銳角; the ring already points at the target).
 *
 * Requires a `<CoachMarkProvider>` ancestor. If a step's target isn't mounted
 * the step degrades to a full-dim screen with a centred caption — never a
 * crash. Tapping the dim area advances to the next step. Set `numbered` for
 * procedural 1→2→3 flows; leave it off for parallel/alternative targets.
 */
interface CoachMarkOverlayProps {
  visible: boolean;
  steps: CoachStep[];
  /** Number each step with a badge (procedural flows only). */
  numbered?: boolean;
  /**
   * Set when the host page is presented as an iOS `presentation: 'modal'`
   * route (e.g. `superset/new`). Such a route's content sits inside the modal
   * sheet's container, so `measureInWindow` on its targets reports Y relative
   * to that container — short of true window Y by the top safe-area inset.
   * This overlay's own Modal IS window-anchored (origin at the device top), so
   * for a modal host we add the inset back. Card-presented routes (the default
   * — template editor, session, the tabs, every exercise/history/chart page)
   * already measure in true window coords, so they must NOT be compensated or
   * the spotlight is pushed `insets.top` (~62pt) too low. See 2026-06-30 note
   * below. Default false.
   */
  modalHost?: boolean;
  /** Called when the user finishes the last step or taps 略過. */
  onClose: () => void;
}

export function CoachMarkOverlay({
  visible,
  steps,
  numbered,
  modalHost,
  onClose,
}: CoachMarkOverlayProps) {
  const { tokens, resolved } = useTheme();
  const styles = useMemo(() => makeStyles(tokens, resolved), [tokens, resolved]);
  const measure = useCoachMarkMeasure();
  const scrollIntoView = useCoachMarkScrollIntoView();
  const scrollToTop = useCoachMarkScrollToTop();
  const insets = useSafeAreaInsets();

  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  const screen = Dimensions.get('window');
  const step = steps[index];
  const isLast = index >= steps.length - 1;

  // Reset to the first step each time the tour opens.
  useEffect(() => {
    if (visible) setIndex(0);
  }, [visible]);

  // Measure the current step's target whenever the step or visibility changes.
  // First scroll a below-the-fold target into view (no-op when the page didn't
  // register a scroller, or the target is already visible — see
  // CoachMarkProvider.scrollIntoView), THEN measure on a short delay so the
  // freshly-scrolled / freshly-opened Modal has laid out.
  useEffect(() => {
    let cancelled = false;
    // Screenshot-card steps (step.image) have no target to measure.
    if (!visible || !step || !step.targetId) {
      setRect(null);
      return;
    }
    const targetId = step.targetId;
    setRect(null);
    void (async () => {
      // On the FIRST step, snap a registered scroller back to the top FIRST
      // (instant) so a tour opened on an already-scrolled page starts from a
      // known position — step 1's near-top target then sits within the visible
      // band and `scrollIntoView` is a no-op, instead of yanking the page to
      // re-centre it (the 2026-07-01「step-1 莫名滑動→遮罩跑位」fix). Instant so
      // the measure below doesn't race a top-scroll animation.
      if (index === 0) {
        scrollToTop(false);
        await new Promise<void>((r) => setTimeout(r, 80));
        if (cancelled) return;
      }
      await scrollIntoView(targetId);
      if (cancelled) return;
      await new Promise<void>((r) => setTimeout(r, 60));
      if (cancelled) return;
      const r = await measure(targetId);
      if (!cancelled) setRect(r);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, step, index, measure, scrollIntoView, scrollToTop]);

  if (!step) return null;

  // Reset the page to the top when the tour ends — it may have auto-scrolled
  // down to a below-the-fold target (e.g. the stats panel's duration card).
  const handleClose = () => {
    scrollToTop();
    onClose();
  };
  const next = () => {
    if (isLast) handleClose();
    else setIndex((i) => i + 1);
  };
  const prev = () => setIndex((i) => Math.max(0, i - 1));

  // 2026-06-30: for a `modalHost` page (an iOS `presentation: 'modal'` route),
  // measureInWindow on the underlying page's targets under-reports Y by the top
  // safe-area inset — the modal sheet's content sits in a container the overlay
  // Modal's window space doesn't include, so e.g. the 超級組「選 2 個」row (real
  // y≈122) measured y≈60 and the spotlight ringed the search bar. Add the inset
  // back ONLY for modal hosts. Card-presented routes (the default — template
  // editor, session, every exercise/history/chart page, the tabs) already
  // measure in true window coords; compensating them pushes the spotlight
  // insets.top (~62pt) too low (template editor「加入動作」regression 2026-06-30).
  const measureInsetFix = modalHost ? insets.top : 0;
  const adjustedRect: Rect | null = rect
    ? { ...rect, y: rect.y + measureInsetFix }
    : null;

  const placement = pickCoachPlacement(adjustedRect, screen);

  // Padded hole around the target (visual only — the Modal intercepts touches).
  const hole = adjustedRect
    ? {
        x: adjustedRect.x - RING_PAD,
        y: adjustedRect.y - RING_PAD,
        w: adjustedRect.width + RING_PAD * 2,
        h: adjustedRect.height + RING_PAD * 2,
      }
    : null;

  // Caption bubble position — no arrow, the rounded card sits just past the
  // spotlight with a small gap. resolveCoachBubbleAnchor keeps it on-screen when
  // the target is tall or edge-hugging (e.g. the full-height library sidebar):
  // it overlays a safe band instead of pushing the bubble off the top/bottom.
  const bubbleStyle: ViewStyle = {
    ...resolveCoachBubbleAnchor(hole, placement.placement, screen, { gap: GAP }),
    left: 16,
    right: 16,
  };

  const isImageStep = step.image != null;

  // Title row (numbered badge + title) and the footer controls (skip / dots /
  // back+next) are identical for spotlight and screenshot-card steps.
  const titleRow = (
    <View style={styles.titleRow}>
      {numbered ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{index + 1}</Text>
        </View>
      ) : null}
      <Text style={styles.bubbleTitle}>{step.title}</Text>
    </View>
  );

  const controls = (
    <View style={styles.controls}>
      <Pressable onPress={handleClose} hitSlop={8} accessibilityRole="button">
        <Text style={styles.skip}>{t('common', 'skip')}</Text>
      </Pressable>

      <View style={styles.dots}>
        {steps.map((_, i) => (
          <View key={i} style={[styles.dot, i === index ? styles.dotActive : null]} />
        ))}
      </View>

      <View style={styles.navBtns}>
        {index > 0 ? (
          <Pressable onPress={prev} hitSlop={8} accessibilityRole="button">
            <Text style={styles.navText}>{t('common', 'back')}</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={next}
          accessibilityRole="button"
          style={({ pressed }) => [styles.nextBtn, pressed && styles.pressed]}>
          <Text style={styles.nextText}>
            {isLast ? t('common', 'done') : t('common', 'next')}
          </Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={handleClose}>
      {/* Tapping the dim area advances. */}
      <Pressable style={styles.fill} onPress={next} accessibilityLabel={step.title}>
        {isImageStep ? (
          // Screenshot-card step — full dim + a centred card holding the COMPLETE
          // image (contain, never cropped) with the caption below it. Used for
          // pop-up menus / gestures a spotlight ring can't frame.
          <>
            <View style={[styles.scrim, StyleSheet.absoluteFillObject]} />
            <Pressable style={styles.imageCard} onPress={(e) => e.stopPropagation()}>
              {titleRow}
              <Image
                source={step.image!}
                style={[styles.cardImage, { aspectRatio: step.aspectRatio ?? 16 / 9 }]}
                contentFit="contain"
                transition={120}
                accessibilityIgnoresInvertColors
              />
              <Text style={styles.bubbleBody}>{step.body}</Text>
              {controls}
            </Pressable>
          </>
        ) : (
          // Spotlight step.
          <>
            {hole ? (
              <>
                <View style={[styles.scrim, { top: 0, left: 0, right: 0, height: hole.y }]} />
                <View
                  style={[
                    styles.scrim,
                    { top: hole.y + hole.h, left: 0, right: 0, bottom: 0 },
                  ]}
                />
                <View
                  style={[
                    styles.scrim,
                    { top: hole.y, left: 0, width: hole.x, height: hole.h },
                  ]}
                />
                <View
                  style={[
                    styles.scrim,
                    { top: hole.y, left: hole.x + hole.w, right: 0, height: hole.h },
                  ]}
                />
                <View
                  pointerEvents="none"
                  style={[
                    styles.ring,
                    { top: hole.y, left: hole.x, width: hole.w, height: hole.h },
                  ]}
                />
              </>
            ) : (
              <View style={[styles.scrim, StyleSheet.absoluteFillObject]} />
            )}

            {/* Bubble swallows taps so its buttons work without advancing. */}
            <Pressable style={[styles.bubble, bubbleStyle]} onPress={(e) => e.stopPropagation()}>
              {titleRow}
              <Text style={styles.bubbleBody}>{step.body}</Text>
              {controls}
            </Pressable>
          </>
        )}
      </Pressable>
    </Modal>
  );
}

function makeStyles(tokens: ThemeTokens, resolved: ResolvedTheme) {
  return StyleSheet.create({
    fill: {
      flex: 1,
      // Centres a screenshot-card step; absolute scrim/ring/bubble ignore this.
      alignItems: 'center',
      justifyContent: 'center',
    },
    scrim: {
      position: 'absolute',
      backgroundColor: resolved === 'dark' ? SCRIM_DARK : SCRIM_LIGHT,
    },
    imageCard: {
      width: '90%',
      maxWidth: 360,
      backgroundColor: BUBBLE_BG,
      borderRadius: 16,
      padding: 16,
    },
    cardImage: {
      width: '100%',
      // Tall portrait shots (e.g. an ActionSheet) need headroom so they show
      // full-width instead of letterboxing; the card still fits on screen.
      maxHeight: 520,
      borderRadius: 10,
      marginVertical: 12,
      backgroundColor: 'rgba(255,255,255,0.04)',
    },
    ring: {
      position: 'absolute',
      borderRadius: 12,
      borderWidth: 2,
      borderColor: tokens.action.primary,
    },
    bubble: {
      position: 'absolute',
      backgroundColor: BUBBLE_BG,
      borderRadius: 16,
      padding: 16,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 6,
    },
    badge: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: tokens.action.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: {
      fontSize: 13,
      fontWeight: '700',
      color: tokens.action.onPrimary,
    },
    bubbleTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: BUBBLE_TITLE,
      flexShrink: 1,
    },
    bubbleBody: {
      fontSize: 14,
      lineHeight: 20,
      color: BUBBLE_BODY,
    },
    controls: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 16,
    },
    skip: {
      fontSize: 14,
      color: BUBBLE_MUTED,
    },
    dots: {
      flexDirection: 'row',
      gap: 5,
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: DOT_IDLE,
    },
    dotActive: {
      backgroundColor: tokens.action.primary,
    },
    navBtns: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
    },
    navText: {
      fontSize: 14,
      color: '#FFFFFF',
    },
    nextBtn: {
      backgroundColor: tokens.action.primary,
      paddingVertical: 7,
      paddingHorizontal: 18,
      borderRadius: 999,
    },
    nextText: {
      fontSize: 14,
      fontWeight: '600',
      color: tokens.action.onPrimary,
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
