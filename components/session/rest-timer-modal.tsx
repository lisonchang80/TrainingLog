import { useAudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import { t } from '@/src/i18n';
import { useTheme, type ThemeTokens } from '@/src/theme';

import { shouldFireFinishEdge } from './rest-timer-modal.behavior';

/**
 * Slice 13a C7 — rest timer finish-edge sound. 0.3s sine 440Hz beep with
 * 5ms attack/decay envelope, normalised ~-3 dB to avoid clipping. Required
 * once at module-eval via `require()` so Metro bundles the asset and the
 * `useAudioPlayer` hook below resolves synchronously on mount.
 */
const REST_TIMER_DONE_SOUND = require('@/assets/sounds/rest-timer-done.wav');

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
 *   - On finished transition (now >= end_at): fire a Haptics notification +
 *     play a 0.3s sine 440Hz beep (`assets/sounds/rest-timer-done.wav`)
 *     once, then auto-dismiss after a brief flash (400ms). 短音 piece of
 *     Q2.3 (c) F1 — deferred from slice 10d, landed in slice 13a per
 *     ADR-0019 § Phase A Amendment.
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
  const { tokens } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
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

  // Slice 13a C7 — finish-edge sound player. Hook owns lifecycle: source
  // loaded on mount, released automatically on unmount.
  const finishPlayer = useAudioPlayer(REST_TIMER_DONE_SOUND);

  // Bug F7 (slice 13a smoke 2026-05-25): parent (Today / detail page) passes
  // `onSkip` as an inline closure (`onSkip={() => setRestTimerTarget(null)}`),
  // so the prop reference changes every parent re-render. If we put `onSkip`
  // in the finish-edge effect deps, the effect re-runs on every parent render —
  // and on the SECOND ✓-tap cycle there's a window where `state.status` is
  // still stale-`'finished'` (setState from the [triggerKey] / [visible]
  // resets is queued but not yet committed) while `firedFinishHapticRef.current`
  // has just been reset to `false` by those same effects. shouldFireFinishEdge
  // then returns `true` and we fire the haptic + sound IMMEDIATELY on the
  // second cycle, before the countdown even starts.
  //
  // Fix: keep `state.status` as the SOLE dep so the effect only re-runs on
  // genuine running → finished transitions. Read the latest `onSkip` and
  // `finishPlayer` via refs so dep-list churn can't race the predicate.
  const onSkipRef = useRef(onSkip);
  const finishPlayerRef = useRef(finishPlayer);
  useEffect(() => {
    onSkipRef.current = onSkip;
  });
  useEffect(() => {
    finishPlayerRef.current = finishPlayer;
  });

  // Fire haptic + beep on the running → finished edge (once per cycle).
  useEffect(() => {
    if (shouldFireFinishEdge(state.status, firedFinishHapticRef.current)) {
      firedFinishHapticRef.current = true;
      // Fire-and-forget — expo-haptics resolves on iOS, no-ops gracefully.
      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      ).catch(() => {
        /* swallow — haptic failure must not break the modal */
      });
      // Seek to 0 first so consecutive triggers (rare; the modal is one-shot
      // per cycle) replay from the start instead of from the previous play's
      // end position.
      const player = finishPlayerRef.current;
      void player
        .seekTo(0)
        .then(() => player.play())
        .catch(() => {
          /* swallow — sound failure must not break the modal */
        });
      // Auto-dismiss after a brief flash so the user sees "00:00" land.
      const id = setTimeout(() => {
        onSkipRef.current();
      }, 400);
      return () => clearTimeout(id);
    }
  }, [state.status]);

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
            ⏱️ {t('status', 'restingHeader')}{exerciseName ? ` · ${exerciseName}` : ''}
          </Text>
          <Text style={styles.countdown}>
            {formatRestRemaining(state.remaining_ms)}
          </Text>
          <Text style={styles.sub}>
            {state.status === 'finished' ? t('status', 'restFinished') : t('status', 'restRunning')}
          </Text>
          <View style={styles.actions}>
            <Pressable
              onPress={onSkip}
              style={({ pressed }) => [
                styles.btn,
                styles.btnPrimary,
                pressed && styles.btnPressed,
              ]}>
              <Text style={styles.btnPrimaryText}>{t('common', 'skip')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * ADR-0025 — token-driven styles. Backdrop overlay (rgba black) intentionally
 * stays raw — it's a translucent dim layer over a transparent Modal, not a
 * theme surface (same convention as settings.tsx modalBackdrop).
 */
function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    card: {
      width: '76%',
      backgroundColor: tokens.bg.modal,
      borderRadius: 16,
      paddingVertical: 24,
      paddingHorizontal: 20,
      alignItems: 'center',
    },
    title: {
      fontSize: 14,
      fontWeight: '600',
      color: tokens.text.secondary,
      marginBottom: 8,
    },
    countdown: {
      fontSize: 64,
      fontWeight: '700',
      color: tokens.text.primary,
      fontVariant: ['tabular-nums'],
      letterSpacing: 1,
    },
    sub: {
      fontSize: 13,
      color: tokens.text.tertiary,
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
      backgroundColor: tokens.action.primary,
    },
    btnPrimaryText: {
      color: tokens.action.onPrimary,
      fontSize: 15,
      fontWeight: '600',
    },
    btnPressed: {
      opacity: 0.7,
    },
  });
}
