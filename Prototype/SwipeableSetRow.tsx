import { useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';

export type SwipeAction = {
  key: string;
  label: string;
  color: string;
  onPress: () => void;
};

type SwipeableSetRowProps = {
  children: React.ReactNode;
  swipeLeftActions?: SwipeAction[];
  swipeRightActions?: SwipeAction[];
  onLongPress?: () => void;
  enabled?: boolean;
};

const ACTION_WIDTH = 72;

export function SwipeableSetRow({
  children,
  swipeLeftActions = [],
  swipeRightActions = [],
  onLongPress,
  enabled = true,
}: SwipeableSetRowProps) {
  const swipeableRef = useRef<Swipeable>(null);
  const [capturedDragX, setCapturedDragX] = useState<
    Animated.AnimatedInterpolation<number> | null
  >(null);
  const [touching, setTouching] = useState(false);

  if (!enabled) {
    return <View>{children}</View>;
  }

  const renderActions = (actions: SwipeAction[], side: 'left' | 'right') => {
    if (actions.length === 0) return undefined;
    const totalWidth = ACTION_WIDTH * actions.length;
    return (
      _progress: Animated.AnimatedInterpolation<number>,
      dragX: Animated.AnimatedInterpolation<number>,
    ) => {
      if (capturedDragX === null) {
        requestAnimationFrame(() => setCapturedDragX(dragX));
      }
      const translateX =
        side === 'right'
          ? dragX.interpolate({
              inputRange: [-totalWidth, 0],
              outputRange: [0, totalWidth],
              extrapolate: 'clamp',
            })
          : dragX.interpolate({
              inputRange: [0, totalWidth],
              outputRange: [-totalWidth, 0],
              extrapolate: 'clamp',
            });
      return (
        <Animated.View
          style={[
            styles.actionsRow,
            side === 'right' && styles.actionsRowReverse,
            { width: totalWidth, transform: [{ translateX }] },
          ]}
        >
          {actions.map((a) => (
            <Pressable
              key={a.key}
              onPress={() => {
                swipeableRef.current?.close();
                a.onPress();
              }}
              style={[styles.actionBtn, { backgroundColor: a.color }]}
            >
              <Text style={styles.actionLabel}>{a.label}</Text>
            </Pressable>
          ))}
        </Animated.View>
      );
    };
  };

  return (
    <Swipeable
      ref={swipeableRef}
      renderLeftActions={renderActions(swipeRightActions, 'left')}
      renderRightActions={renderActions(swipeLeftActions, 'right')}
      friction={2}
      leftThreshold={40}
      rightThreshold={40}
      overshootLeft={false}
      overshootRight={false}
    >
      <Animated.View
        style={[
          styles.rowSurface,
          capturedDragX
            ? {
                backgroundColor: capturedDragX.interpolate({
                  inputRange: [-200, -4, 0, 4, 200],
                  outputRange: [
                    'rgba(0,0,0,0.12)',
                    'rgba(0,0,0,0.12)',
                    'rgba(0,0,0,0)',
                    'rgba(0,0,0,0.12)',
                    'rgba(0,0,0,0.12)',
                  ],
                  extrapolate: 'clamp',
                }),
              }
            : null,
          touching && styles.rowSurfaceTouch,
        ]}
        onTouchStart={() => setTouching(true)}
        onTouchEnd={() => setTouching(false)}
        onTouchCancel={() => setTouching(false)}>
        <Pressable
          onLongPress={onLongPress}
          delayLongPress={350}
          android_disableSound
        >
          {children}
        </Pressable>
      </Animated.View>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  rowSurface: {},
  rowSurfaceTouch: {
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  actionsRow: {
    flexDirection: 'row',
  },
  actionsRowReverse: {
    flexDirection: 'row-reverse',
  },
  actionBtn: {
    width: ACTION_WIDTH,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionLabel: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
