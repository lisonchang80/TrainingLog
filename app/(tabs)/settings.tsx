import Constants from 'expo-constants';
import { randomUUID } from 'expo-crypto';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useDatabase, useSuspendForRestore } from '@/components/database-provider';
import {
  tBackupErrorLine,
  tBackupEscalationLine,
  tBackupICloudUnavailableLine,
  tBackupLastLine,
  uploadStateFromItem,
} from '@/components/backup-status.behavior';
import {
  primaryRejectReason,
  tRestoreBackupDateLine,
  tRestorePreviewLine,
  tRestoreRejectReason,
} from '@/components/restore-gate.behavior';
import {
  getAuthorizationState,
  requestHKAuthorization,
  type HKPermissionState,
} from '@/src/adapters/healthkit';
import { insertBodyMetric } from '@/src/adapters/sqlite/bodyMetricRepository';
import { getActiveSession } from '@/src/adapters/sqlite/sessionRepository';
import {
  discoverBackupCandidates,
  executeRestore,
  getRestoreDeps,
  pickRestorableCandidate,
  type RestoreOutcome,
  type RestorePreview,
  type RestoreServiceDeps,
} from '@/src/services/restoreService';
import {
  getAutoPopupRestTimer,
  getUnitPreference,
  setAutoPopupRestTimer,
  setBackupMode,
  setUnitPreference,
} from '@/src/adapters/sqlite/settingsRepository';
import {
  getBackupHealth,
  runBackup,
  type BackupHealth,
} from '@/src/services/backupService';
import { buildJsonExport, writeJsonExport } from '@/src/services/jsonExport';
import { getLatestCloudBackup } from '@/src/adapters/backup/icloudBackupAdapter';
import type { ICloudBackupItem } from '@/modules/icloud-backup';
import type { UnitPreference } from '@/src/domain/body/types';
import { parseWeightInput } from '@/src/domain/body/unitConversion';
import { t, tBodyweightWithUnit, tSaveOrSaving } from '@/src/i18n';
import {
  loadStoredLocale,
  resolveLocale,
  saveStoredLocale,
  type StoredLocaleValue,
} from '@/src/i18n/locale-persist';
import { setLocale } from '@/src/i18n/strings';
import { useTheme, type ThemeTokens, type StoredThemeValue } from '@/src/theme';

/**
 * Settings tab — slice 7 ships the unit preference toggle.
 * Slice 15 (Backup) brings backup mode + export / restore.
 *
 * ADR-0025 — every color comes from `useTheme().tokens`. No `#hex` literals
 * here; if you need a new color, add a token to `constants/theme.ts` first.
 */
export default function SettingsScreen() {
  const db = useDatabase();
  const router = useRouter();
  const { tokens, stored: themePref, setStored: setThemePref } = useTheme();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  const [unit, setUnit] = useState<UnitPreference>('kg');
  /**
   * Rest timer auto-popup toggle (ADR-0019 § slice 10d S1).
   *
   * Backed by `app_settings.auto_popup_rest_timer` (v016 seed default `1`).
   * Read on focus, persisted optimistically on toggle. `null` = loading.
   */
  const [autoPopup, setAutoPopup] = useState<boolean | null>(null);
  /**
   * Slice 13b — HealthKit permission state. `null` = loading.
   * `'never'` → show "Connect Apple Health" CTA.
   * `'requested'` → show "已連結 Apple Health" + "Open System Settings"
   * shortcut (iOS won't re-show the OS dialog after first ask).
   */
  const [hkAuthState, setHkAuthState] = useState<HKPermissionState | null>(null);
  /** Guard so double-tap on Connect doesn't fire two `initHealthKit` calls. */
  const [hkConnecting, setHkConnecting] = useState(false);
  /**
   * Phase 5 — locale preference. `'auto'` follows device locale, `'zh'` /
   * `'en'` are explicit overrides. Backed by AsyncStorage via
   * `locale-persist.ts`. `null` while loading (renders a default snapshot).
   */
  const [localePref, setLocalePref] = useState<StoredLocaleValue | null>(null);
  /**
   * ADR-0024 § 5 — 體重 row mini sheet state.
   *   - `bwSheetOpen`: modal visibility
   *   - `bwInput`: current TextInput value (raw string, parsed on save)
   *   - `bwBusy`: insert-in-flight guard
   */
  const [bwSheetOpen, setBwSheetOpen] = useState(false);
  const [bwInput, setBwInput] = useState('');
  const [bwBusy, setBwBusy] = useState(false);
  /**
   * Slice 15 C4 — minimal restore entry (grill Q8-C entry B; the full
   * backup section — auto-backup toggle / 立即備份 / status readout — is
   * C3's scope). `hasActiveSession` gates the entry per the locked spec:
   * restoring mid-session would close the DB under the session's feet.
   * `restoreBusy` guards double-taps through the multi-Alert flow.
   */
  const [hasActiveSession, setHasActiveSession] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const suspendForRestore = useSuspendForRestore();
  /**
   * Slice 15 C3/C5 — backup half of the 備份 / 還原 section.
   *   - `backupHealth`: metadata + escalation verdict + iCloud availability
   *     (`getBackupHealth`); `null` while loading. The auto-backup Switch
   *     reads `metadata.mode` straight from it (optimistic flip on toggle).
   *   - `latestCloudItem`: newest cloud backup with NSMetadataQuery upload
   *     state — feeds the R2「已上傳✓/上傳中…」readout suffix.
   *   - `backupBusy`: 立即備份 in-flight guard (spinner + disable).
   */
  const [backupHealth, setBackupHealth] = useState<BackupHealth | null>(null);
  const [latestCloudItem, setLatestCloudItem] = useState<ICloudBackupItem | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  /** Slice 15b C6 — 匯出資料 (JSON) in-flight guard (spinner + disable). */
  const [exportBusy, setExportBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [u, popup, loc, hkState, activeSession] = await Promise.all([
      getUnitPreference(db),
      getAutoPopupRestTimer(db),
      loadStoredLocale(),
      getAuthorizationState(db),
      getActiveSession(db),
    ]);
    setUnit(u);
    setAutoPopup(popup);
    setLocalePref(loc);
    setHkAuthState(hkState);
    setHasActiveSession(activeSession != null);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  /**
   * Slice 15 C3 — backup readout refresh, separate from `refresh` so the
   * (potentially slow, NSMetadataQuery-backed) cloud listing never delays
   * the rest of the screen. Re-runs on every focus: an automatic backup may
   * have completed while the user was on another tab.
   */
  const refreshBackup = useCallback(async () => {
    const [health, latest] = await Promise.all([
      getBackupHealth(db),
      getLatestCloudBackup(),
    ]);
    setBackupHealth(health);
    setLatestCloudItem(latest);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void refreshBackup();
    }, [refreshBackup])
  );

  const onSet = async (next: UnitPreference) => {
    if (next === unit) return;
    setUnit(next);
    await setUnitPreference(db, next);
  };

  const onToggleAutoPopup = async (next: boolean) => {
    // Optimistic — UI updates first so the Switch feels snappy. DB write
    // races against the next render but Switch is idempotent (write the
    // same boolean twice = no-op).
    setAutoPopup(next);
    await setAutoPopupRestTimer(db, next);
  };

  /** Slice 15 C3 — 自動備份 toggle (ADR-0011 Q14.8: default ON; OFF = 純手動
   * + escalation threshold 3→7 天, both enforced downstream by backupPolicy). */
  const onToggleAutoBackup = async (next: boolean) => {
    // Optimistic, same pattern as onToggleAutoPopup.
    setBackupHealth((h) =>
      h ? { ...h, metadata: { ...h.metadata, mode: next ? 'auto' : 'manual' } } : h
    );
    await setBackupMode(db, next ? 'auto' : 'manual');
  };

  /** Slice 15 C3 — 立即備份. `runBackup('manual')` bypasses mode + debounce
   * (explicit user intent) and never throws; failures come back classified
   * (C5) and are ALSO persisted to metadata, so the readout below stays in
   * sync after `refreshBackup`. */
  const onBackupNow = async () => {
    if (backupBusy) return;
    setBackupBusy(true);
    try {
      const outcome = await runBackup(db, 'manual');
      if (outcome.status === 'failed') {
        Alert.alert(t('alert', 'backupFailed'), tBackupErrorLine(outcome.kind));
      }
      await refreshBackup();
    } finally {
      setBackupBusy(false);
    }
  };

  /**
   * Slice 15b C6 — 匯出資料 (JSON). Builds a full self-describing JSON dump of
   * the whole DB (ADR-0011 §5; export-only v1) and writes it to a timestamped
   * file in the document directory, then shows the resulting path. The iOS
   * Share Sheet (AirDrop / Mail / Files) is DEFERRED — it needs `expo-sharing`
   * (not installed; a native dep that requires a device build). For now the
   * user gets a file on disk + its path. `buildJsonExport` is pure and takes
   * the caller's clock/appVersion so the timestamp is stamped exactly once.
   */
  const onExportJson = async () => {
    if (exportBusy) return;
    setExportBusy(true);
    try {
      const nowMs = Date.now();
      const json = await buildJsonExport(db, {
        appVersion: Constants.expoConfig?.version ?? 'unknown',
        exportedAt: new Date(nowMs).toISOString(),
      });
      const uri = writeJsonExport(json, nowMs);
      Alert.alert(t('alert', 'exportJsonDone'), `${t('alert', 'exportJsonDoneBody')}\n${uri}`);
    } catch (e) {
      Alert.alert(t('alert', 'exportJsonFailed'), e instanceof Error ? e.message : String(e));
    } finally {
      setExportBusy(false);
    }
  };

  /**
   * Slice 13b — trigger HealthKit OS permission dialog (first call) or
   * no-op (subsequent calls; iOS won't re-show the dialog from initHealthKit).
   *
   * On success → mark `'requested'` so the UI flips to the "已連結" state +
   * the "Open System Settings" shortcut.
   * On error → leave `hkAuthState` unchanged (the user might tap again);
   * surface error via Alert so they know to retry / file an issue.
   */
  const onConnectAppleHealth = async () => {
    if (hkConnecting) return;
    setHkConnecting(true);
    try {
      await requestHKAuthorization(db);
      setHkAuthState('requested');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert(t('page', 'appleHealthSection'), message);
    } finally {
      setHkConnecting(false);
    }
  };

  /**
   * Slice 13b — open the iOS Settings → Privacy → Health → TrainingLog page
   * so the user can change their per-scope answer. iOS deep-link URL is
   * supported on iOS 14+; fall back to plain `app-settings:` (TrainingLog's
   * own settings page) if the deep link is blocked by the OS version.
   */
  const onOpenSystemSettings = async () => {
    const deepLink = 'App-Prefs:Privacy&path=HEALTH';
    const canOpen = await Linking.canOpenURL(deepLink).catch(() => false);
    await Linking.openURL(canOpen ? deepLink : 'app-settings:');
  };

  /**
   * Phase 5 — apply locale change.
   *   1. Persist to AsyncStorage.
   *   2. Push resolved locale into the module-level i18n state so subsequent
   *      `t(...)` calls return the new language.
   *   3. Local state bump forces this screen to re-render with new labels.
   * Re-rendering the rest of the app happens lazily as other screens mount /
   * focus — module-level locale is read at every `t(...)` call.
   */
  const onPickLocale = async (next: StoredLocaleValue) => {
    if (next === localePref) return;
    setLocalePref(next);
    await saveStoredLocale(next);
    setLocale(resolveLocale(next));
  };

  /**
   * ADR-0025 — apply theme change. `setStored` already persists to
   * AsyncStorage and re-resolves tokens via Context; this screen re-renders
   * automatically via the Context subscription.
   */
  const onPickTheme = async (next: StoredThemeValue) => {
    if (next === themePref) return;
    await setThemePref(next);
  };

  // ADR-0024 § 5 — 體重 mini sheet handlers.
  const onOpenBwSheet = () => {
    setBwInput('');
    setBwSheetOpen(true);
  };

  const onSaveBw = async () => {
    const bwKg = parseWeightInput(bwInput, unit);
    if (bwKg == null || bwKg <= 0 || bwKg > 500) {
      Alert.alert('體重輸入無效', '請輸入 0–500 之間的正數');
      return;
    }
    setBwBusy(true);
    try {
      await insertBodyMetric(
        db,
        {
          recorded_at: Date.now(),
          bodyweight_kg: bwKg,
          pbf: null,
          smm_kg: null,
        },
        randomUUID,
      );
      setBwSheetOpen(false);
      setBwInput('');
    } catch (e) {
      Alert.alert(t('alert', 'saveFailed'), e instanceof Error ? e.message : String(e));
    } finally {
      setBwBusy(false);
    }
  };

  /**
   * Slice 15 C4 — run the swap inside the provider's suspend-runner
   * (Q12-A): the consumer tree (this screen included) unmounts while the
   * file is swapped, so no mounted component can touch the closed/old DB
   * instance (R9). The async continuation here still runs after reopen;
   * Alert.alert is imperative and survives the unmount.
   */
  const performRestore = async (deps: RestoreServiceDeps, preview: RestorePreview) => {
    // Audit R-03: this owns releasing restoreBusy — onRestorePress hands the
    // flag off to the confirm Alert's buttons instead of releasing in its
    // finally (Alert.alert is non-blocking, so a finally there re-enables
    // the row WHILE the dialog is still open → double-tap could run two
    // executeRestore concurrently over the same files).
    try {
      // TOCTOU re-check — the row disable is render-time only; a session
      // could have started (e.g. from the Watch) since the last focus.
      const active = await getActiveSession(db);
      if (active) {
        Alert.alert(t('button', 'restoreBackup'), t('status', 'restoreActiveSessionBlocked'));
        return;
      }
      let outcome: RestoreOutcome | null = null;
      await suspendForRestore(async () => {
        outcome = await executeRestore(deps, preview);
      });
      const result: RestoreOutcome = outcome ?? {
        ok: false,
        step: 'reopen',
        message: 'unknown',
        rolledBack: false,
      };
      if (result.ok) {
        Alert.alert(t('alert', 'restoreDone'), t('alert', 'restoreDoneBody'));
      } else {
        Alert.alert(
          t('alert', 'restoreFailed'),
          result.rolledBack
            ? `${result.message}\n${t('status', 'restoreRolledBackNote')}`
            : result.message
        );
      }
    } finally {
      setRestoreBusy(false);
    }
  };

  /** Discovery → pick → confirm Alert. Re-entrant via the 重新檢查 button
   * in the not-found Alert (Q18-A's manual escape hatch).
   *
   * Audit R-03 busy hand-off: on the confirm path the flag is NOT released
   * here — ownership transfers to the Alert buttons (Cancel releases,
   * 還原 → performRestore's finally releases). Terminal paths (not-found /
   * rejected / throw) release via the local finally as before. */
  const onRestorePress = async () => {
    const deps = getRestoreDeps();
    if (!deps || restoreBusy) return;
    setRestoreBusy(true);
    let handedOff = false;
    try {
      const discovery = await discoverBackupCandidates(deps);
      if (discovery.status !== 'found') {
        Alert.alert(t('alert', 'noBackupFound'), t('alert', 'noBackupFoundBody'), [
          { text: t('common', 'cancel'), style: 'cancel' },
          { text: t('button', 'recheckBackups'), onPress: () => void onRestorePress() },
        ]);
        return;
      }
      const pick = await pickRestorableCandidate(deps, discovery.items);
      if (!pick.ok) {
        Alert.alert(
          t('button', 'restoreBackup'),
          tRestoreRejectReason(primaryRejectReason(pick.rejected.map((r) => r.reason)))
        );
        return;
      }
      const { preview } = pick;
      handedOff = true;
      Alert.alert(
        t('page', 'restoreGateTitle'),
        `${tRestorePreviewLine(preview.sessionCount, preview.lastSessionAt)}\n` +
          `${tRestoreBackupDateLine(preview.item.modifiedAt)}\n\n` +
          t('alert', 'restoreConfirmQ'),
        [
          {
            text: t('common', 'cancel'),
            style: 'cancel',
            onPress: () => setRestoreBusy(false),
          },
          {
            text: t('button', 'restoreBackup'),
            style: 'destructive',
            onPress: () => void performRestore(deps, preview),
          },
        ]
      );
    } finally {
      if (!handedOff) setRestoreBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.heading}>{t('page', 'settings')}</Text>

        <Text style={styles.section}>{t('page', 'unitPreferenceSection')}</Text>
        <View style={styles.toggleRow}>
          <UnitOption
            label="kg"
            active={unit === 'kg'}
            onPress={() => onSet('kg')}
            styles={styles}
            tokens={tokens}
          />
          <UnitOption
            label="lb"
            active={unit === 'lb'}
            onPress={() => onSet('lb')}
            styles={styles}
            tokens={tokens}
          />
        </View>
        <Text style={styles.hint}>{t('page', 'unitPreferenceHint')}</Text>

        {/* ADR-0024 § 5 — 體重 row。位於單位偏好之下、訓練偏好之上。
            Quick capture via mini sheet → insertBodyMetric. History list /
            chart 仍走既有「資料 → 體重資料」路徑（下方 linkRow）。 */}
        <Text style={styles.section}>體重</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="紀錄體重"
          onPress={onOpenBwSheet}
          style={({ pressed }) => [
            styles.bwRow,
            pressed && styles.btnPressed,
          ]}>
          <Text style={styles.bwRowLabel}>＋ 紀錄體重</Text>
          <Text style={styles.bwRowHint}>單位依上方偏好（{unit}）</Text>
        </Pressable>

        <Text style={styles.section}>{t('domain', 'trainingPreferences')}</Text>
        <View style={styles.switchRow}>
          <View style={styles.switchLabelGroup}>
            <Text style={styles.switchLabel}>{t('status', 'autoShowRestCountdown')}</Text>
            <Text style={styles.hint}>{t('page', 'autoPopupRestTimerHint')}</Text>
          </View>
          <Switch
            value={autoPopup ?? true}
            onValueChange={onToggleAutoPopup}
            disabled={autoPopup === null}
          />
        </View>

        {/* ADR-0025 — Color theme section. Placed above 語言 because visual
            preference is more impactful than text language. Same 3-radio
            pattern as 語言 for consistency. */}
        <Text style={styles.section}>{t('page', 'colorThemeSection')}</Text>
        <View style={styles.langGroup}>
          <RadioRow
            label={t('status', 'themeSystem')}
            active={themePref === 'system'}
            onPress={() => onPickTheme('system')}
            styles={styles}
          />
          <RadioRow
            label={t('status', 'themeLight')}
            active={themePref === 'light'}
            onPress={() => onPickTheme('light')}
            styles={styles}
          />
          <RadioRow
            label={t('status', 'themeDark')}
            active={themePref === 'dark'}
            onPress={() => onPickTheme('dark')}
            styles={styles}
          />
        </View>

        <Text style={styles.section}>{t('page', 'languageSection')}</Text>
        <View style={styles.langGroup}>
          <RadioRow
            label={t('status', 'languageAuto')}
            active={localePref === 'auto'}
            disabled={localePref === null}
            onPress={() => onPickLocale('auto')}
            styles={styles}
          />
          <RadioRow
            label={t('status', 'languageZh')}
            active={localePref === 'zh'}
            disabled={localePref === null}
            onPress={() => onPickLocale('zh')}
            styles={styles}
          />
          <RadioRow
            label={t('status', 'languageEn')}
            active={localePref === 'en'}
            disabled={localePref === null}
            onPress={() => onPickLocale('en')}
            styles={styles}
          />
        </View>

        <Text style={styles.section}>{t('domain', 'data')}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/body')}
          style={({ pressed }) => [
            styles.linkRow,
            pressed && styles.btnPressed,
          ]}>
          <Text style={styles.linkLabel}>{t('page', 'bodyMetrics')}</Text>
          <Text style={styles.linkChevron}>›</Text>
        </Pressable>
        <Text style={styles.hint}>{t('page', 'bodyMetricsHint')}</Text>

        <Text style={styles.section}>{t('page', 'backupRestore')}</Text>

        {/* Slice 15 C3/C5 — backup half of the section: Q15-A permanent red
            when iCloud is off, auto-backup toggle (Q14.8), 立即備份 button,
            last-backup readout (R2 upload state), and the C5 red error /
            escalation lines. All copy comes from backup-status.behavior. */}
        {backupHealth != null && !backupHealth.iCloudAvailable ? (
          <Text style={styles.backupWarn}>{tBackupICloudUnavailableLine()}</Text>
        ) : null}
        <View style={styles.switchRow}>
          <View style={styles.switchLabelGroup}>
            <Text style={styles.switchLabel}>{t('status', 'autoBackupLabel')}</Text>
            <Text style={styles.hint}>{t('page', 'autoBackupHint')}</Text>
          </View>
          <Switch
            value={(backupHealth?.metadata.mode ?? 'auto') === 'auto'}
            onValueChange={onToggleAutoBackup}
            disabled={backupHealth === null}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => void onBackupNow()}
          disabled={backupBusy}
          style={({ pressed }) => [
            styles.linkRow,
            backupBusy && styles.btnDisabled,
            pressed && styles.btnPressed,
          ]}>
          <Text style={styles.linkLabel}>
            {backupBusy ? t('status', 'backupRunning') : t('button', 'backupNow')}
          </Text>
          {backupBusy ? (
            <ActivityIndicator size="small" />
          ) : (
            <Text style={styles.linkChevron}>›</Text>
          )}
        </Pressable>
        {backupHealth != null ? (
          <Text style={styles.hint}>
            {tBackupLastLine({
              lastSuccessAtMs: backupHealth.metadata.lastSuccessAtMs,
              sizeBytes: backupHealth.metadata.lastSizeBytes,
              uploadState: uploadStateFromItem(latestCloudItem),
            })}
          </Text>
        ) : null}
        {backupHealth?.metadata.lastError ? (
          <Text style={styles.backupWarn}>
            {tBackupErrorLine(backupHealth.metadata.lastError.kind)}
          </Text>
        ) : null}
        {backupHealth?.escalated ? (
          <Text style={styles.backupWarn}>
            {tBackupEscalationLine(backupHealth.escalatedDays)}
          </Text>
        ) : null}

        {/* Slice 15b C6 — 匯出資料 (JSON). Writes a full DB dump to a file +
            shows the path. iOS Share Sheet deferred (needs expo-sharing). */}
        <Pressable
          accessibilityRole="button"
          onPress={() => void onExportJson()}
          disabled={exportBusy}
          style={({ pressed }) => [
            styles.linkRow,
            exportBusy && styles.btnDisabled,
            pressed && styles.btnPressed,
          ]}>
          <Text style={styles.linkLabel}>
            {exportBusy ? t('status', 'exporting') : t('button', 'exportJson')}
          </Text>
          {exportBusy ? (
            <ActivityIndicator size="small" />
          ) : (
            <Text style={styles.linkChevron}>›</Text>
          )}
        </Pressable>

        {/* Slice 15 C4 — minimal restore entry (Q8-C entry B). Until the
            morning integration wires setRestoreDeps(...) the registry is
            null and the pre-slice-15 placeholder stays. */}
        {getRestoreDeps() === null ? (
          <Text style={styles.placeholder}>{t('status', 'backupComingSlice15')}</Text>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              onPress={() => void onRestorePress()}
              disabled={hasActiveSession || restoreBusy}
              style={({ pressed }) => [
                styles.linkRow,
                (hasActiveSession || restoreBusy) && styles.btnDisabled,
                pressed && styles.btnPressed,
              ]}>
              <Text style={styles.linkLabel}>
                {restoreBusy
                  ? t('status', 'restoreChecking')
                  : t('button', 'restoreBackup')}
              </Text>
              <Text style={styles.linkChevron}>›</Text>
            </Pressable>
            {hasActiveSession ? (
              <Text style={styles.hint}>{t('status', 'restoreActiveSessionBlocked')}</Text>
            ) : null}
          </>
        )}

        {/* Slice 13b — Apple Health 整合 section. iOS one-shot dialog quirk
            means the UI flips state-permanently on first tap (per Q6 grill).
            Beyond first ask, only Settings.app deep link can change the per-
            scope answer. */}
        <Text style={styles.section}>{t('page', 'appleHealthSection')}</Text>
        <Text style={styles.hint}>{t('status', 'appleHealthIntro')}</Text>
        {hkAuthState === 'requested' ? (
          <>
            <Text style={styles.linkLabel}>
              ✓ {t('status', 'appleHealthConnected')}
            </Text>
            <Text style={styles.hint}>{t('status', 'managePermissionHint')}</Text>
            <Pressable
              onPress={onOpenSystemSettings}
              style={({ pressed }) => [
                styles.linkRow,
                pressed && styles.btnPressed,
              ]}>
              <Text style={styles.linkLabel}>
                {t('button', 'openSystemSettings')}
              </Text>
              <Text style={styles.linkChevron}>›</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            onPress={onConnectAppleHealth}
            disabled={hkAuthState === null || hkConnecting}
            style={({ pressed }) => [
              styles.linkRow,
              (hkAuthState === null || hkConnecting) && styles.btnDisabled,
              pressed && styles.btnPressed,
            ]}>
            <Text style={styles.linkLabel}>
              {t('button', 'connectAppleHealth')}
            </Text>
            <Text style={styles.linkChevron}>›</Text>
          </Pressable>
        )}

      </ScrollView>

      {/* ADR-0024 § 5 — 體重 mini sheet (modal). 單一 TextInput + 儲存。 */}
      <Modal
        visible={bwSheetOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setBwSheetOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalHeading}>紀錄體重</Text>
            <Text style={styles.modalLabel}>{tBodyweightWithUnit(unit)}</Text>
            <TextInput
              style={styles.modalInput}
              keyboardType="decimal-pad"
              selectTextOnFocus
              value={bwInput}
              onChangeText={setBwInput}
              placeholder={unit === 'kg' ? '70.0' : '154.0'}
              placeholderTextColor={tokens.text.tertiary}
              autoFocus
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setBwSheetOpen(false)}
                disabled={bwBusy}
                style={({ pressed }) => [
                  styles.modalSecondaryBtn,
                  bwBusy && styles.btnDisabled,
                  pressed && styles.btnPressed,
                ]}>
                <Text style={styles.modalSecondaryText}>{t('common', 'cancel')}</Text>
              </Pressable>
              <Pressable
                onPress={onSaveBw}
                disabled={bwBusy}
                style={({ pressed }) => [
                  styles.modalPrimaryBtn,
                  bwBusy && styles.btnDisabled,
                  pressed && styles.btnPressed,
                ]}>
                <Text style={styles.modalPrimaryText}>
                  {tSaveOrSaving(bwBusy)}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

type Styles = ReturnType<typeof makeStyles>;

function UnitOption({
  label,
  active,
  onPress,
  styles,
  tokens,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  styles: Styles;
  tokens: ThemeTokens;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.option,
        active && styles.optionActive,
        pressed && styles.btnPressed,
      ]}>
      <Text
        style={[
          styles.optionLabel,
          { color: active ? tokens.action.onPrimary : tokens.text.primary },
        ]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Phase 5 — single radio-style row, used for both the 語言 (locale) toggle
 * and the ADR-0025 色彩主題 (theme) toggle. List-style (one per row) rather
 * than side-by-side because labels can be long (e.g. "Traditional Chinese")
 * and would wrap awkwardly in a flex-row.
 */
function RadioRow({
  label,
  active,
  disabled,
  onPress,
  styles,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
  styles: Styles;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected: active, disabled: !!disabled }}
      style={({ pressed }) => [
        styles.langRow,
        active && styles.langRowActive,
        pressed && styles.btnPressed,
      ]}>
      <Text style={[styles.langLabel, active && styles.langLabelActive]}>
        {label}
      </Text>
      {active ? <Text style={styles.langCheck}>✓</Text> : null}
    </Pressable>
  );
}

/**
 * ADR-0025 — all colors come from tokens. Layout (flex / padding / radius)
 * stays in StyleSheet for perf; colors are interpolated per-token.
 */
function makeStyles(tokens: ThemeTokens) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: tokens.bg.base },
    body: { padding: 24, gap: 12 },
    heading: {
      fontSize: 28,
      fontWeight: '700',
      marginBottom: 4,
      color: tokens.text.primary,
    },
    section: {
      fontSize: 16,
      fontWeight: '600',
      marginTop: 12,
      color: tokens.text.primary,
    },
    toggleRow: { flexDirection: 'row', gap: 8 },
    option: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: 10,
      alignItems: 'center',
      backgroundColor: tokens.bg.elevated,
    },
    optionActive: { backgroundColor: tokens.action.primary },
    optionLabel: { fontSize: 18, fontWeight: '600' },
    hint: { fontSize: 12, color: tokens.text.secondary },
    /** Slice 15 C3/C5 — red warning lines in the backup section (Q15-A
     * iCloud-off / C5 last-error / escalation). */
    backupWarn: { fontSize: 12, color: tokens.action.destructive },
    placeholder: { fontSize: 14, color: tokens.text.tertiary },
    btnPressed: { opacity: 0.85 },
    linkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderRadius: 10,
      backgroundColor: tokens.bg.elevated,
    },
    linkLabel: {
      flex: 1,
      fontSize: 16,
      fontWeight: '500',
      color: tokens.text.primary,
    },
    linkChevron: { fontSize: 22, fontWeight: '300', color: tokens.text.tertiary },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 10,
      backgroundColor: tokens.bg.elevated,
      gap: 12,
    },
    switchLabelGroup: { flex: 1, gap: 2 },
    switchLabel: { fontSize: 16, fontWeight: '500', color: tokens.text.primary },
    langGroup: { gap: 8 },
    langRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderRadius: 10,
      backgroundColor: tokens.bg.elevated,
    },
    langRowActive: { backgroundColor: tokens.action.primary },
    langLabel: {
      flex: 1,
      fontSize: 16,
      fontWeight: '500',
      color: tokens.text.primary,
    },
    langLabelActive: { color: tokens.action.onPrimary },
    langCheck: {
      fontSize: 18,
      color: tokens.action.onPrimary,
      fontWeight: '700',
    },
    // ADR-0024 § 5 — 體重 row + mini sheet.
    bwRow: {
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderRadius: 10,
      backgroundColor: tokens.bg.elevated,
      gap: 4,
    },
    bwRowLabel: { fontSize: 16, fontWeight: '600', color: tokens.text.primary },
    bwRowHint: { fontSize: 12, color: tokens.text.secondary },
    btnDisabled: { opacity: 0.5 },
    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      padding: 24,
    },
    modalSheet: {
      backgroundColor: tokens.bg.modal,
      borderRadius: 14,
      padding: 20,
      gap: 12,
    },
    modalHeading: { fontSize: 18, fontWeight: '700', color: tokens.text.primary },
    modalLabel: { fontSize: 13, color: tokens.text.secondary },
    modalInput: {
      paddingVertical: 14,
      paddingHorizontal: 16,
      borderRadius: 10,
      backgroundColor: tokens.bg.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: tokens.border.subtle,
      fontSize: 18,
      color: tokens.text.primary,
    },
    modalActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
    modalPrimaryBtn: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: 12,
      backgroundColor: tokens.action.primary,
      alignItems: 'center',
    },
    modalPrimaryText: {
      color: tokens.action.onPrimary,
      fontSize: 16,
      fontWeight: '700',
    },
    modalSecondaryBtn: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: 12,
      backgroundColor: tokens.bg.elevated,
      alignItems: 'center',
    },
    modalSecondaryText: {
      fontSize: 14,
      fontWeight: '600',
      color: tokens.text.primary,
    },
  });
}
