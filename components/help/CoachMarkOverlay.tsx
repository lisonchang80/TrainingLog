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

import { t } from '@/src/i18n';
import { useTheme, type ThemeTokens } from '@/src/theme';

import { pickCoachPlacement } from './coachMarkLayout';
import { useCoachMarkMeasure } from './CoachMarkProvider';
import type { CoachStep, Rect } from './types';

const SCRIM = 'rgba(0,0,0,0.62)';
const RING_PAD = 6; // px the highlight ring grows past the target
const GAP = 10; // px between target and the caption arrow
const ARROW = 9; // half-width / height of the caption arrow

/**
 * 引導遮罩 — a step-by-step spotlight tour. For each step it measures the
 * element registered under `step.targetId` (via `useCoachMarkTarget`), dims
 * everything except that element with four scrim rectangles, draws a
 * highlight ring around it, and floats a caption bubble (with an arrow) above
 * or below it per `pickCoachPlacement`.
 *
 * Requires a `<CoachMarkProvider>` ancestor. If a step's target isn't mounted
 * the step degrades to a full-dim screen with a centred caption — never a
 * crash. Tapping the dim area advances to the next step.
 */
interface CoachMarkOverlayProps {
  visible: boolean;
  steps: CoachStep[];
  /** Called when the user finishes the last step or taps 略過. */
  onClose: () => void;
}

export function CoachMarkOverlay({ visible, steps, onClose }: CoachMarkOverlayProps) {
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const measure = useCoachMarkMeasure();

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
  // Re-measure on a microtask delay so a freshly-opened Modal has laid out.
  useEffect(() => {
    let cancelled = false;
    if (!visible || !step) {
      setRect(null);
      return;
    }
    setRect(null);
    const id = setTimeout(() => {
      void measure(step.targetId).then((r) => {
        if (!cancelled) setRect(r);
      });
    }, 60);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [visible, step, measure]);

  if (!step) return null;

  const next = () => {
    if (isLast) onClose();
    else setIndex((i) => i + 1);
  };
  const prev = () => setIndex((i) => Math.max(0, i - 1));

  const placement = pickCoachPlacement(rect, screen);

  // Padded hole around the target (visual only — the Modal intercepts touches).
  const hole = rect
    ? {
        x: rect.x - RING_PAD,
        y: rect.y - RING_PAD,
        w: rect.width + RING_PAD * 2,
        h: rect.height + RING_PAD * 2,
      }
    : null;

  // Caption bubble + arrow absolute positions.
  let bubbleStyle: ViewStyle;
  let arrowStyle: ViewStyle | null = null;
  if (hole && placement.placement === 'below') {
    bubbleStyle = { top: hole.y + hole.h + GAP + ARROW, left: 16, right: 16 };
    arrowStyle = {
      top: hole.y + hole.h + GAP,
      left: placement.arrowCenterX - ARROW,
      borderLeftWidth: ARROW,
      borderRightWidth: ARROW,
      borderBottomWidth: ARROW,
      borderBottomColor: tokens.bg.modal,
    };
  } else if (hole && placement.placement === 'above') {
    bubbleStyle = {
      bottom: screen.height - (hole.y - GAP - ARROW),
      left: 16,
      right: 16,
    };
    arrowStyle = {
      top: hole.y - GAP - ARROW,
      left: placement.arrowCenterX - ARROW,
      borderLeftWidth: ARROW,
      borderRightWidth: ARROW,
      borderTopWidth: ARROW,
      borderTopColor: tokens.bg.modal,
    };
  } else {
    bubbleStyle = { top: screen.height * 0.4, left: 16, right: 16 };
  }

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      {/* Tapping the dim area advances. */}
      <Pressable style={styles.fill} onPress={next} accessibilityLabel={step.title}>
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

        {arrowStyle ? <View pointerEvents="none" style={[styles.arrow, arrowStyle]} /> : null}

        {/* Bubble swallows taps so its buttons work without advancing. */}
        <Pressable style={[styles.bubble, bubbleStyle]} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.bubbleTitle}>{step.title}</Text>
          <Text style={styles.bubbleBody}>{step.body}</Text>

          <View style={styles.controls}>
            <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button">
              <Text style={styles.skip}>{t('common', 'skip')}</Text>
            </Pressable>

            <View style={styles.dots}>
              {steps.map((_, i) => (
                <View
                  key={i}
                  style={[styles.dot, i === index ? styles.dotActive : null]}
                />
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
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    fill: {
      flex: 1,
    },
    scrim: {
      position: 'absolute',
      backgroundColor: SCRIM,
    },
    ring: {
      position: 'absolute',
      borderRadius: 12,
      borderWidth: 2,
      borderColor: tokens.action.primary,
    },
    arrow: {
      position: 'absolute',
      width: 0,
      height: 0,
      borderLeftColor: 'transparent',
      borderRightColor: 'transparent',
    },
    bubble: {
      position: 'absolute',
      backgroundColor: tokens.bg.modal,
      borderRadius: 14,
      padding: 16,
    },
    bubbleTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: tokens.text.primary,
      marginBottom: 6,
    },
    bubbleBody: {
      fontSize: 14,
      lineHeight: 20,
      color: tokens.text.secondary,
    },
    controls: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 16,
    },
    skip: {
      fontSize: 14,
      color: tokens.text.tertiary,
    },
    dots: {
      flexDirection: 'row',
      gap: 5,
    },
    dot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: tokens.border.default,
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
      color: tokens.action.primary,
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
