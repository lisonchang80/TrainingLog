import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';

import { t } from '@/src/i18n';
import {
  discoverBackupCandidates,
  executeRestore,
  getRestoreDeps,
  pickRestorableCandidate,
  recoverInterruptedRestore,
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

  // The gate renders ABOVE ThemeProvider (see header doc), so it can't read
  // app theme tokens. Follow the OS appearance directly — otherwise the
  // default-black text on a transparent bg renders black-on-black on a
  // dark-mode fresh install (slice 15 device smoke 2026-06-14).
  const pal = useColorScheme() === 'dark' ? GATE_PALETTE.dark : GATE_PALETTE.light;

  // Mount probe: deps-wired → sentinel → DB-file existence → discovery.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const deps = getRestoreDeps();

      // 🟠-1: an interrupted restore (process killed between delete-live and
      // copy-in) leaves a crash-recovery marker + NO live DB. RestoreGate
      // mounts ABOVE DatabaseProvider, so DatabaseProvider's self-heal is
      // shadowed here — without this the gate sees "no live DB" and prompts as
      // if it were a fresh install (device smoke 2026-06-19). Run the heal
      // FIRST: marker + live-missing → restore live from the marker, so the
      // dbExists probe below sees the recovered DB and the gate skips (silent
      // recovery, as 🟠-1 intends). Best-effort — never holds boot hostage.
      if (deps) {
        try {
          await recoverInterruptedRestore(deps);
        } catch {
          /* recovery hiccup must not block boot */
        }
      }

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
      <View style={[styles.center, { backgroundColor: pal.bg }]}>
        <ActivityIndicator size="large" color={pal.text} />
        <Text style={[styles.statusText, { color: pal.text }]}>
          {phase.kind === 'checking'
            ? t('status', 'restoreChecking')
            : t('status', 'restoreRestoring')}
        </Text>
      </View>
    );
  }

  if (phase.kind === 'prompt') {
    return (
      <View style={[styles.center, { backgroundColor: pal.bg }]}>
        <Text style={[styles.title, { color: pal.text }]}>{t('page', 'restoreGateTitle')}</Text>
        <Text style={[styles.body, { color: pal.text }]}>
          {tRestorePreviewLine(phase.preview.sessionCount, phase.preview.lastSessionAt)}
        </Text>
        <Text style={[styles.hint, { color: pal.text }]}>
          {tRestoreBackupDateLine(phase.preview.item.modifiedAt)}
        </Text>
        <GateButton
          label={t('button', 'restoreBackup')}
          primary
          pal={pal}
          onPress={() => dispatch({ type: 'PRESS_RESTORE' })}
        />
        <GateButton label={t('button', 'startFresh')} pal={pal} onPress={onStartFresh} />
      </View>
    );
  }

  if (phase.kind === 'blocked') {
    return (
      <View style={[styles.center, { backgroundColor: pal.bg }]}>
        <Text style={[styles.title, { color: pal.text }]}>{t('page', 'restoreGateTitle')}</Text>
        <Text style={[styles.body, { color: pal.text }]}>{tRestoreRejectReason(phase.reason)}</Text>
        <Text style={[styles.hint, { color: pal.text }]}>{t('status', 'restoreFreshLaterHint')}</Text>
        <GateButton label={t('button', 'startFresh')} primary pal={pal} onPress={onStartFresh} />
      </View>
    );
  }

  // phase.kind === 'error'
  return (
    <View style={[styles.center, { backgroundColor: pal.bg }]}>
      <Text style={[styles.title, { color: pal.text }]}>{t('alert', 'restoreFailed')}</Text>
      <Text style={[styles.body, { color: pal.text }]}>{phase.message}</Text>
      <GateButton
        label={t('button', 'retryRestore')}
        primary
        pal={pal}
        onPress={() => dispatch({ type: 'PRESS_RETRY' })}
      />
      <GateButton label={t('button', 'startFresh')} pal={pal} onPress={onStartFresh} />
    </View>
  );
}

type GatePalette = { bg: string; text: string; border: string };

// Outside ThemeProvider — mirror the OS appearance (see RestoreGate doc).
const GATE_PALETTE: { light: GatePalette; dark: GatePalette } = {
  light: { bg: '#ffffff', text: '#000000', border: '#c6c6c8' },
  dark: { bg: '#000000', text: '#ffffff', border: '#48484a' },
};

function GateButton({
  label,
  primary,
  pal,
  onPress,
}: {
  label: string;
  primary?: boolean;
  pal: GatePalette;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { borderColor: pal.border },
        primary && [styles.buttonPrimary, { borderColor: pal.text }],
        pressed && styles.buttonPressed,
      ]}>
      <Text style={[styles.buttonLabel, { color: pal.text }, primary && styles.buttonLabelPrimary]}>
        {label}
      </Text>
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
