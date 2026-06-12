import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { t } from '@/src/i18n';
import {
  discoverBackupCandidates,
  executeRestore,
  getRestoreDeps,
  pickRestorableCandidate,
} from '@/src/services/restoreService';
import {
  RESTORE_DECLINED_SENTINEL_KEY,
  discoveryOutcomeToEvent,
  gateSkipReason,
  nextGatePhase,
  tRestoreBackupDateLine,
  tRestorePreviewLine,
  tRestoreRejectReason,
  type GateEvent,
  type GatePhase,
} from './restore-gate.behavior';

/**
 * First-launch restore gate — slice 15 C4 (ADR-0011 §4 + 2026-06-12
 * amendment; grill Q8-C entry A / Q9-A / Q18-A).
 *
 * Mounts ABOVE `<DatabaseProvider>` (see app/_layout.tsx): the fresh-install
 * signal is «the DB FILE does not exist yet», and DatabaseProvider's
 * `openDatabase()` would create the file and destroy that signal. While the
 * gate is non-terminal nothing below it renders, so SQLite is guaranteed
 * untouched until the user picks 還原 / 全新開始 (or the gate skips).
 *
 * All decisions live in restore-gate.behavior.ts (jest-covered); this shell
 * only wires effects + renders the four states. Like DatabaseProvider's
 * loading/error screens this renders OUTSIDE ThemeProvider, so it uses
 * plain default-styled views (no theme tokens available yet — same
 * precedent as the boot spinner).
 *
 * Until the morning integration calls `setRestoreDeps(...)` the registry is
 * null and the gate is a transparent pass-through (SKIP on mount).
 */
export function RestoreGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<GatePhase>({ kind: 'checking' });

  const dispatch = (event: GateEvent) =>
    setPhase((current) => nextGatePhase(current, event));

  // Mount probe: deps-wired → sentinel → DB-file existence → discovery.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const deps = getRestoreDeps();

      let declinedSentinel = false;
      if (deps) {
        try {
          declinedSentinel =
            (await AsyncStorage.getItem(RESTORE_DECLINED_SENTINEL_KEY)) === 'true';
        } catch {
          declinedSentinel = false; // unreadable sentinel → fall through to db check
        }
      }

      let dbExists = false;
      if (deps && !declinedSentinel) {
        try {
          dbExists = await deps.fileOps.exists(deps.paths.liveDbPath);
        } catch {
          // Can't verify → assume NOT fresh. Never hold a working install
          // hostage at boot over a file-stat failure.
          dbExists = true;
        }
      }

      const skip = gateSkipReason({ depsWired: deps != null, declinedSentinel, dbExists });
      if (cancelled) return;
      if (skip !== null || !deps) {
        dispatch({ type: 'SKIP' });
        return;
      }

      // Fresh install — bounded discovery (Q18-A: the service owns the
      // timeout; no path leaves the user on an endless spinner).
      const discovery = await discoverBackupCandidates(deps);
      const pick =
        discovery.status === 'found'
          ? await pickRestorableCandidate(deps, discovery.items)
          : null;
      if (cancelled) return;
      dispatch(discoveryOutcomeToEvent(discovery, pick));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Restore executor — runs each time the machine (re-)enters 'restoring'
  // (initial press and error-retry both produce a fresh phase object).
  useEffect(() => {
    if (phase.kind !== 'restoring') return;
    let cancelled = false;
    (async () => {
      const deps = getRestoreDeps();
      if (!deps) {
        dispatch({ type: 'RESTORE_FAIL', message: 'restore deps not wired' });
        return;
      }
      const outcome = await executeRestore(deps, phase.preview);
      if (cancelled) return;
      if (outcome.ok) dispatch({ type: 'RESTORE_OK' });
      else dispatch({ type: 'RESTORE_FAIL', message: outcome.message });
    })();
    return () => {
      cancelled = true;
    };
  }, [phase]);

  /** 全新開始 — persist the Q9-A declined sentinel (device-local, NOT in the
   * DB) so later boots never re-prompt, then let the app boot fresh. */
  const onStartFresh = () => {
    AsyncStorage.setItem(RESTORE_DECLINED_SENTINEL_KEY, 'true').catch(() => undefined);
    dispatch({ type: 'PRESS_FRESH' });
  };

  if (phase.kind === 'proceed') {
    return <>{children}</>;
  }

  if (phase.kind === 'checking' || phase.kind === 'restoring') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
        <Text style={styles.statusText}>
          {phase.kind === 'checking'
            ? t('status', 'restoreChecking')
            : t('status', 'restoreRestoring')}
        </Text>
      </View>
    );
  }

  if (phase.kind === 'prompt') {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>{t('page', 'restoreGateTitle')}</Text>
        <Text style={styles.body}>
          {tRestorePreviewLine(phase.preview.sessionCount, phase.preview.lastSessionAt)}
        </Text>
        <Text style={styles.hint}>{tRestoreBackupDateLine(phase.preview.item.modifiedAt)}</Text>
        <GateButton
          label={t('button', 'restoreBackup')}
          primary
          onPress={() => dispatch({ type: 'PRESS_RESTORE' })}
        />
        <GateButton label={t('button', 'startFresh')} onPress={onStartFresh} />
      </View>
    );
  }

  if (phase.kind === 'blocked') {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>{t('page', 'restoreGateTitle')}</Text>
        <Text style={styles.body}>{tRestoreRejectReason(phase.reason)}</Text>
        <Text style={styles.hint}>{t('status', 'restoreFreshLaterHint')}</Text>
        <GateButton label={t('button', 'startFresh')} primary onPress={onStartFresh} />
      </View>
    );
  }

  // phase.kind === 'error'
  return (
    <View style={styles.center}>
      <Text style={styles.title}>{t('alert', 'restoreFailed')}</Text>
      <Text style={styles.body}>{phase.message}</Text>
      <GateButton
        label={t('button', 'retryRestore')}
        primary
        onPress={() => dispatch({ type: 'PRESS_RETRY' })}
      />
      <GateButton label={t('button', 'startFresh')} onPress={onStartFresh} />
    </View>
  );
}

function GateButton({
  label,
  primary,
  onPress,
}: {
  label: string;
  primary?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        primary && styles.buttonPrimary,
        pressed && styles.buttonPressed,
      ]}>
      <Text style={[styles.buttonLabel, primary && styles.buttonLabelPrimary]}>{label}</Text>
    </Pressable>
  );
}

// Outside ThemeProvider — default-styled like DatabaseProvider's boot
// screens (no theme tokens, no hardcoded brand colors).
const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  statusText: { fontSize: 14, opacity: 0.8 },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  body: { fontSize: 15, textAlign: 'center' },
  hint: { fontSize: 12, opacity: 0.6, textAlign: 'center', marginBottom: 8 },
  button: {
    alignSelf: 'stretch',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  buttonPrimary: { borderWidth: 2 },
  buttonPressed: { opacity: 0.6 },
  buttonLabel: { fontSize: 16, fontWeight: '500' },
  buttonLabelPrimary: { fontWeight: '700' },
});
