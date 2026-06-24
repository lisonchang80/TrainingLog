import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { resolveExerciseMedia } from '@/src/db/seed/exerciseMediaMap';

/**
 * ADR-0017 Q8 — exercise media showcase: a Free-Exercise-DB photo pair
 * (start frame `0.jpg` / end frame `1.jpg`) crossfading back and forth to
 * approximate a looping demo GIF. Used on the exercise DETAIL page only; the
 * library grid renders the static start frame (no timers across 167 cards).
 *
 * `mediaKey` is the value stored in `exercise.media_path` (a key into the
 * bundled EXERCISE_MEDIA require map). Renders nothing when the exercise has
 * no bundled media (placeholder exercises) — caller decides any fallback.
 */
const FRAME_INTERVAL_MS = 900;

export function ExerciseMediaFrames({
  mediaKey,
  style,
}: {
  mediaKey: string | null | undefined;
  style?: StyleProp<ViewStyle>;
}) {
  const pair = resolveExerciseMedia(mediaKey);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!pair) return;
    const timer = setInterval(
      () => setFrame((f) => (f === 0 ? 1 : 0)),
      FRAME_INTERVAL_MS
    );
    return () => clearInterval(timer);
  }, [pair]);

  if (!pair) return null;

  return (
    <View style={style}>
      <Image
        source={pair[frame]}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={250}
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}
