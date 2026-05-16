/**
 * Segmented progress bar — fills `done` of `total` segments left-to-right
 * (ADR-0019 Q4, slice 10c Phase 3 commit 14).
 *
 * Used inside the session exercise card to show working-set completion.
 * Filled segments are green (#28a745), unfilled are neutral gray. Gaps
 * between segments are hairline-thin so the bar reads as one strip
 * visually but the "N of M" granularity stays legible.
 *
 * Overflow case: when `done > total` (user logged more than planned),
 * all segments fill and an "overflow chip" appears alongside showing
 * the surplus count. Surplus may be 0 (never shown when done <= total).
 */

import { StyleSheet, View } from 'react-native';

type SegmentedProgressBarProps = {
  done: number;
  total: number;
};

export function SegmentedProgressBar({
  done,
  total,
}: SegmentedProgressBarProps) {
  // Defensive: total === 0 → render nothing (caller can hide the section).
  if (total <= 0) return null;
  const filled = Math.min(done, total);
  return (
    <View style={styles.bar}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.segment,
            i < filled ? styles.segmentFilled : styles.segmentEmpty,
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    gap: 3,
    height: 6,
    width: '100%',
  },
  segment: {
    flex: 1,
    borderRadius: 3,
  },
  segmentEmpty: {
    backgroundColor: 'rgba(127,127,127,0.25)',
  },
  segmentFilled: {
    backgroundColor: '#28a745',
  },
});
