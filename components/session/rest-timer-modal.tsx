import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import {
  AppState,
  type AppStateStatus,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  formatRestRemaining,
  startTimer,
  tickTimer,
  type RestTimerState,
} from '@/src/domain/session/restTimer';

/**
 * Rest timer modal (ADR-0019 Q2 R1 v1, slice 10c — Agent C).
 *
 * Shows a centred Modal with the big countdown, a [跳過] (skip) button,
 * and a [取消] (close) button. Triggered by the Today tap-✓ handler
 * whenever:
 *   - user is_logged-toggling a set TO 1, AND
 *   - the `auto_popup_rest_timer` app setting is on (default ON per
 *     v016 seed).
 *
 * Behaviour:
 *   - 1-second tick re-derives remaining_ms from the wall clock
 *     (`tickTimer` is robust to event-loop jitter).
 *   - On finished transition (now >= end_at): fire a Haptics notification
 *     once + auto-dismiss after a brief flash (300ms). The "短音" half of
 *     Q2.3 (c) F1 is deferred — expo-av integration not in this slice's
 *     scope. Documented as a slice 10d / 13 follow-up.
 *   - User re-tap ✓ on the same set or different set → parent re-calls
 *     `<RestTimerModal restSec={...}` with a fresh trigger key`. We
 *     restart with the new value (Q2.3 (b) M1).
 *   - User re-taps ✓ to UN-log a set → parent calls cancel → component
 *     becomes hidden + state resets to idle (Q2.3 (d) Y2).
 *
 * Re-trigger model: this component is hidden when `visible=false`. To
 * reset a running countdown without flicker, the parent should toggle
 * the `triggerKey` prop on the same `visible=true` cycle — we listen
 * to triggerKey changes and call startTimer fresh.
 */
interface RestTimerModalProps {
  visible: boolean;
  /**
   * Initial rest_sec to count down from. Effective value of 0 / null
   * is treated as 60 by the underlying state machine (system default).
   */
  rest_sec: number;
  /**
   * Bumped by parent each time the timer should reset to a fresh
   * countdown (typical: a new ✓-tap on a different set, or a re-tap on
   * the same set per Q2.3 (b) M1). Component compares to the prior
   * value via ref to detect the edge.
   */
  triggerKey: number;
  /** Exercise name to show in the modal header — optional, defaults to "休息中". */
  exerciseName?: string;
  /** Skip button — closes the modal early without firing the finish haptic. */
  onSkip: () => void;
  /** Background tap / dismiss — same as skip; parent treats both as "cancel". */
  onCancel: () => void;
}

export function RestTimerModal({
  visible,
  rest_sec,
  triggerKey,
  exerciseName,
  onSkip,
  onCancel,
}: RestTimerModalProps) {
  const [state, setState] = useState<RestTimerState>(() =>
    startTimer(rest_sec, Date.now()),
  );
  const lastTriggerRef = useRef<number>(triggerKey);
  const firedFinishHapticRef = useRef<boolean>(false);

  // Reset timer when the trigger key changes (parent says "this is a
  // new ✓-tap event, restart"). We compare via a ref so a re-render
  // from props changing rest_sec alone doesn't restart.
  useEffect(() => {
    if (triggerKey !== lastTriggerRef.current) {
      lastTriggerRef.current = triggerKey;
      firedFinishHapticRef.current = false;
      setState(startTimer(rest_sec, Date.now()));
    }
  }, [triggerKey, rest_sec]);

  // Also restart on first mount / when the modal opens fresh after
  // having been closed.
  useEffect(() => {
    if (visible) {
      firedFinishHapticRef.current = false;
      setState(startTimer(rest_sec, Date.now()));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // 1-second tick + finished-edge detection.
  useEffect(() => {
    if (!visible || state.status !== 'running') return;
    const id = setInterval(() => {
      setState((s) => tickTimer(s, Date.now()));
    }, 1000);
    return () => clearInterval(id);
  }, [visible, state.status]);

  // BG2 (ADR-0019 § slice 10d Q4): wall-clock self-correct on app
  // foreground. iOS suspends JS setInterval while the app is backgrounded,
  // so the running modal's countdown freezes from the user's perspective.
  // When the app returns to 'active', we re-derive `remaining_ms` against
  // the wall clock — if the deadline already passed, tickTimer transitions
  // to 'finished' on the spot (which then fires the haptic + auto-dismiss
  // via the existing effect below).
  //
  // Known v1 limitation (slice 13+ may revisit): if iOS hard-kills the app
  // (low-memory background eviction) the modal's React state is lost
  // entirely. No local notification fallback ships in slice 10d — Q2.3 (c)
  // F1 '短音' is also deferred there.
  useEffect(() => {
    if (!visible) return;
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        setState((s) => tickTimer(s, Date.now()));
      }
    });
    return () => sub.remove();
  }, [visible]);

  // Fire haptic on the running → finished edge (once).
  useEffect(() => {
    if (state.status === 'finished' && !firedFinishHapticRef.current) {
      firedFinishHapticRef.current = true;
      // Fire-and-forget — expo-haptics resolves on iOS, no-ops gracefully.
      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {
        /* swallow — haptic failure must not break the modal */
      });
      // Auto-dismiss after a brief flash so the user sees "00:00" land.
      const id = setTimeout(() => {
        onSkip();
      }, 400);
      return () => clearTimeout(id);
    }
  }, [state.status, onSkip]);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable
          style={styles.card}
          onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>
            ⏱️ 休息中{exerciseName ? ` · ${exerciseName}` : ''}
          </Text>
          <Text style={styles.countdown}>
            {formatRestRemaining(state.remaining_ms)}
          </Text>
          <Text style={styles.sub}>
            {state.status === 'finished' ? '時間到 — 再來一組 💪' : '把握短暫的休息'}
          </Text>
          <View style={styles.actions}>
            <Pressable
              onPress={onSkip}
              style={({ pressed }) => [
                styles.btn,
                styles.btnPrimary,
                pressed && styles.btnPressed,
              ]}>
              <Text style={styles.btnPrimaryText}>跳過</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    width: '76%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 24,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: '#555',
    marginBottom: 8,
  },
  countdown: {
    fontSize: 64,
    fontWeight: '700',
    color: '#1A1A1A',
    fontVariant: ['tabular-nums'],
    letterSpacing: 1,
  },
  sub: {
    fontSize: 13,
    color: '#777',
    marginTop: 6,
  },
  actions: {
    flexDirection: 'row',
    marginTop: 20,
    gap: 12,
  },
  btn: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 999,
  },
  btnPrimary: {
    backgroundColor: '#1A1A1A',
  },
  btnPrimaryText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  btnPressed: {
    opacity: 0.7,
  },
});
