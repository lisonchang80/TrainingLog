/**
 * backupPolicy — pure decision logic for the iCloud whole-DB backup
 * (slice 15 C2; ADR-0011 + 2026-06-12 grill amendment).
 *
 * Pure functions only — no I/O, no Date.now(), no adapter imports. Callers
 * (C3 trigger service / C2 adapter) feed in clocks and file listings;
 * everything here is deterministic and jest-covered under node env.
 *
 * Decision sources (grill-locked, do not re-litigate here):
 *   - Q4-B  timestamped file names, keep newest 2 (rotate semantics
 *           unchanged from ADR retention拍板)
 *   - Q5-B  write-then-promote — the rotation PLAN is computed only after
 *           the new file is verified in the cloud folder; deleting the
 *           oldest is the LAST step and non-fatal on failure
 *   - Q6-B  triggers = session finalize + app background (5min debounce)
 *           + cold-start sweep (last success > 24h, auto mode only)
 *   - Q14-B failure escalation is in-app only; thresholds 3 days (auto) /
 *           7 days (manual) of an unhealed failure streak
 */

export type BackupMode = 'auto' | 'manual';

export type BackupTrigger =
  /** Session finalize completed (AFTER the watch reconcile — Q7-B ordering guarantee lives in the C3 call-site, not here). */
  | 'session-finalize'
  /** AppState → background. */
  | 'background'
  /** App cold start (boot sweep, Q6-B). */
  | 'cold-start'
  /** Settings「立即備份」button. */
  | 'manual';

/** Q6: 5-minute debounce between automatic backup attempts. */
export const BACKUP_DEBOUNCE_MS = 5 * 60 * 1000;

/** Q6-B: cold-start sweep fires only when the last success is older than 24h. */
export const COLD_START_STALE_MS = 24 * 60 * 60 * 1000;

/** Q4-B / ADR retention: keep the newest 2 cloud backups. */
export const BACKUP_KEEP_COUNT = 2;

/** Q14-B escalation thresholds (days of unhealed failure). */
export const ESCALATION_DAYS_AUTO = 3;
export const ESCALATION_DAYS_MANUAL = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

const BACKUP_FILE_PREFIX = 'TrainingLog-backup-';
const BACKUP_FILE_SUFFIX = '.sqlite';

/**
 * Q4-B backup file name: `TrainingLog-backup-<ts>.sqlite`.
 *
 * `<ts>` is a FILESYSTEM-SAFE ISO-8601 UTC variant with colons and the
 * milliseconds part stripped (`2026-06-13T013005Z`): colons are illegal /
 * display-mangled on Apple filesystems and the folder is user-visible in
 * iCloud Drive (grill Q4 rationale). Second-level precision is enough —
 * the 5min debounce makes same-second collisions practically impossible,
 * and a collision merely overwrites the identical snapshot generation.
 *
 * Property: lexicographic order == chronological order (fixed-width UTC),
 * which `planBackupRotation` relies on as a tie-break.
 */
export function makeBackupFileName(nowMs: number): string {
  const iso = new Date(nowMs).toISOString(); // 2026-06-13T01:30:05.123Z
  const ts = iso.replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '');
  return `${BACKUP_FILE_PREFIX}${ts}${BACKUP_FILE_SUFFIX}`;
}

/**
 * Inverse of {@link makeBackupFileName}: epoch ms for OUR backup files,
 * null for anything else (foreign files in the user-visible folder, the
 * live db, `.icloud` placeholders…). Rotation and restore-candidate
 * selection both treat "parses" as the membership test — a non-parsing
 * file is NEVER deleted by rotation.
 *
 * Also accepts the `.icloud` placeholder wrapping iOS gives cloud-only
 * items (`.TrainingLog-backup-<ts>.sqlite.icloud`) so a listing taken from
 * a plain directory read still groups correctly — NSMetadataQuery results
 * (the normal path) use the logical name.
 */
export function parseBackupFileName(name: string): number | null {
  let logical = name;
  const placeholder = /^\.(.+)\.icloud$/.exec(name);
  if (placeholder) logical = placeholder[1];

  const m = /^TrainingLog-backup-(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})Z\.sqlite$/.exec(
    logical
  );
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const ms = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s)
  );
  // Reject impossible calendar combos that Date.UTC would silently roll
  // over (e.g. month 13 → next year): round-trip check.
  const rt = new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '');
  if (`${BACKUP_FILE_PREFIX}${rt}${BACKUP_FILE_SUFFIX}` !== logical) return null;
  return ms;
}

export interface ShouldRunBackupInput {
  trigger: BackupTrigger;
  mode: BackupMode;
  nowMs: number;
  /** Last backup ATTEMPT (success or failure), epoch ms; null = never. */
  lastAttemptAtMs: number | null;
  /** Last backup SUCCESS, epoch ms; null = never succeeded. */
  lastSuccessAtMs: number | null;
}

export type SkipReason =
  | 'mode-manual'
  | 'debounced'
  | 'cold-start-fresh';

export type ShouldRunBackupResult =
  | { run: true }
  | { run: false; reason: SkipReason };

/**
 * Single gate for every backup trigger.
 *
 *   - 'manual' (Settings button) ALWAYS runs — explicit user intent
 *     bypasses both the mode toggle and the debounce in either mode.
 *   - any automatic trigger in manual mode → skip (ADR Q14.8: OFF = 純手動).
 *   - debounce: an attempt (success OR failure) within the last 5 minutes
 *     suppresses automatic triggers — covers the ADR's "session 結束緊接著
 *     切 background 連觸發兩次" case; a failed attempt is not retried
 *     inside the window either (failure recovery is the next trigger's /
 *     escalation's job, not a hot retry loop).
 *   - 'cold-start' additionally requires the last SUCCESS to be missing or
 *     older than 24h (Q6-B: boot sweep covers "只改 template/體重、長期不
 *     關 app" drift without backing up on every launch).
 */
export function shouldRunBackup(input: ShouldRunBackupInput): ShouldRunBackupResult {
  const { trigger, mode, nowMs, lastAttemptAtMs, lastSuccessAtMs } = input;

  if (trigger === 'manual') return { run: true };

  if (mode === 'manual') return { run: false, reason: 'mode-manual' };

  if (lastAttemptAtMs != null && nowMs - lastAttemptAtMs < BACKUP_DEBOUNCE_MS) {
    return { run: false, reason: 'debounced' };
  }

  if (trigger === 'cold-start') {
    const fresh =
      lastSuccessAtMs != null && nowMs - lastSuccessAtMs <= COLD_START_STALE_MS;
    if (fresh) return { run: false, reason: 'cold-start-fresh' };
  }

  return { run: true };
}

export interface RotationItem {
  /** File name as listed in the cloud Documents/ folder. */
  name: string;
}

export interface RotationPlan {
  /** Names to KEEP, newest first. */
  keep: string[];
  /** Names to delete (oldest beyond the keep window), oldest first. */
  toDelete: string[];
}

/**
 * Q5-B write-then-promote rotation plan: given the folder listing AFTER
 * the new backup has been written and verified, decide which OLD backups
 * to delete so the newest {@link BACKUP_KEEP_COUNT} survive.
 *
 * Hard safety rules:
 *   - Only files matching {@link parseBackupFileName} participate; foreign
 *     files in the user-visible folder are invisible to the plan and never
 *     deleted.
 *   - The caller must include the just-written file in `items` (the
 *     NSMetadataQuery index may lag a fresh write) — `planBackupRotation`
 *     dedupes by name, so passing it both ways is harmless.
 *   - Ordering: timestamp desc, name desc as tie-break (deterministic).
 */
export function planBackupRotation(
  items: RotationItem[],
  keepCount: number = BACKUP_KEEP_COUNT
): RotationPlan {
  const seen = new Set<string>();
  const parsed: { name: string; ts: number }[] = [];
  for (const item of items) {
    if (seen.has(item.name)) continue;
    seen.add(item.name);
    const ts = parseBackupFileName(item.name);
    if (ts != null) parsed.push({ name: item.name, ts });
  }
  parsed.sort((a, b) => b.ts - a.ts || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  const keep = parsed.slice(0, Math.max(0, keepCount)).map((p) => p.name);
  const toDelete = parsed
    .slice(Math.max(0, keepCount))
    .map((p) => p.name)
    .reverse(); // oldest first — deleting from the back preserves the most recent on partial failure
  return { keep, toDelete };
}

export interface EscalationInput {
  mode: BackupMode;
  nowMs: number;
  /** Last backup SUCCESS, epoch ms; null = never succeeded. */
  lastSuccessAtMs: number | null;
  /** Most recent failure, epoch ms; null = no failure recorded. */
  lastErrorAtMs: number | null;
  /**
   * FIRST failure since the last success (anchor of the current failure
   * streak; cleared on success). Needed for the "never succeeded" case
   * where `lastSuccessAtMs` can't anchor the streak window.
   */
  firstErrorAtMs: number | null;
}

/**
 * Q14-B in-app failure escalation gate: Settings red warning + home banner
 * when an UNHEALED failure streak is at least 3 days (auto) / 7 days
 * (manual) old.
 *
 *   - No failure recorded → never escalate (a stale-but-clean state is the
 *     cold-start sweep's problem, not an error).
 *   - A success NEWER than the last failure heals the streak.
 *   - Streak age = now − (lastSuccessAtMs ?? firstErrorAtMs): "N 天沒成功"
 *     counts from the last success when one exists, else from the first
 *     recorded failure.
 */
export function shouldEscalateBackupFailure(input: EscalationInput): boolean {
  const { mode, nowMs, lastSuccessAtMs, lastErrorAtMs, firstErrorAtMs } = input;

  if (lastErrorAtMs == null) return false;
  if (lastSuccessAtMs != null && lastSuccessAtMs >= lastErrorAtMs) return false; // healed

  const anchor = lastSuccessAtMs ?? firstErrorAtMs;
  if (anchor == null) return false; // inconsistent inputs — fail safe (no banner)

  const thresholdDays = mode === 'auto' ? ESCALATION_DAYS_AUTO : ESCALATION_DAYS_MANUAL;
  return nowMs - anchor >= thresholdDays * DAY_MS;
}
