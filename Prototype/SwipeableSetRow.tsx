import { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';

export type SwipeAction = {
  key: string;
  label: string;
  color: string;
  onPress: () => void;
};

type SwipeableSetRowProps = {
  children: React.ReactNode;
  leftActions?: SwipeAction[];
  rightActions?: SwipeAction[];
  onLongPress?: () => void;
  enabled?: boolean;
};

const ACTION_WIDTH = 72;

export function SwipeableSetRow({
  children,
  leftActions = [],
  rightActions = [],
  onLongPress,
  enabled = true,
}: SwipeableSetRowProps) {
  const swipeableRef = useRef<Swipeable>(null);

  if (!enabled) {
    return <View>{children}</View>;
  }

  const renderActions = (actions: SwipeAction[], side: 'left' | 'right') => {
    if (actions.length === 0) return undefined;
    return () => (
      <View
        style={[
          styles.actionsRow,
          side === 'right' && styles.actionsRowReverse,
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
      </View>
    );
  };

  return (
    <Swipeable
      ref={swipeableRef}
      renderLeftActions={renderActions(leftActions, 'left')}
      renderRightActions={renderActions(rightActions, 'right')}
      friction={2}
      leftThreshold={40}
      rightThreshold={40}
      overshootLeft={false}
      overshootRight={false}
    >
      <Pressable
        onLongPress={onLongPress}
        delayLongPress={350}
        android_disableSound
      >
        {children}
      </Pressable>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
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
