import {
  discoveryOutcomeToEvent,
  gateSkipReason,
  nextGatePhase,
  primaryRejectReason,
  tRestorePreviewLine,
  tRestoreRejectReason,
  type GatePhase,
} from '../../components/restore-gate.behavior';
import { setLocale } from '../../src/i18n/strings';
import type { BackupItem } from '../../src/domain/backup/restoreRules';
import type { RestorePreview } from '../../src/services/restoreService';

/**
 * Slice 15 C4 — RestoreGate four-state machine coverage (behavior-split
 * pattern; the .tsx is a thin shell over these decisions).
 */

const itemFixture: BackupItem = {
  name: 'TrainingLog-backup-2026-06-12T0830.sqlite',
  sizeBytes: 4096,
  modifiedAt: 1_765_000_000_000,
  isUploaded: true,
  isDownloaded: true,
};

const preview: RestorePreview = {
  item: itemFixture,
  localPath: '/icloud/container/Documents/TrainingLog-backup-2026-06-12T0830.sqlite',
  userVersion: 26,
  sessionCount: 142,
  lastSessionAt: Date.UTC(2026, 3, 30, 12), // 2026-04-30 noon UTC
};

const checking: GatePhase = { kind: 'checking' };

describe('nextGatePhase — four-state machine', () => {
  it('checking → proceed(skipped) on SKIP (sentinel / db-exists / not wired)', () => {
    expect(nextGatePhase(checking, { type: 'SKIP' })).toEqual({
      kind: 'proceed',
      mode: 'skipped',
    });
  });

  it('checking → proceed(fresh) on NO_BACKUP (Q18-A timeout path: never blocks)', () => {
    expect(nextGatePhase(checking, { type: 'NO_BACKUP' })).toEqual({
      kind: 'proceed',
      mode: 'fresh',
    });
  });

  it('checking → prompt on FOUND, carrying the preview', () => {
    expect(nextGatePhase(checking, { type: 'FOUND', preview })).toEqual({
      kind: 'prompt',
      preview,
    });
  });

  it('checking → blocked when every copy was rejected', () => {
    expect(nextGatePhase(checking, { type: 'ALL_REJECTED', reason: 'version-too-new' })).toEqual({
      kind: 'blocked',
      reason: 'version-too-new',
    });
  });

  it('prompt → restoring / proceed(fresh) on the two user choices', () => {
    const prompt: GatePhase = { kind: 'prompt', preview };
    expect(nextGatePhase(prompt, { type: 'PRESS_RESTORE' })).toEqual({
      kind: 'restoring',
      preview,
    });
    expect(nextGatePhase(prompt, { type: 'PRESS_FRESH' })).toEqual({
      kind: 'proceed',
      mode: 'fresh',
    });
  });

  it('restoring → proceed(restored) on success, → error (with preview kept) on failure', () => {
    const restoring: GatePhase = { kind: 'restoring', preview };
    expect(nextGatePhase(restoring, { type: 'RESTORE_OK' })).toEqual({
      kind: 'proceed',
      mode: 'restored',
    });
    expect(nextGatePhase(restoring, { type: 'RESTORE_FAIL', message: 'disk full' })).toEqual({
      kind: 'error',
      message: 'disk full',
      preview,
    });
  });

  it('error → restoring on retry (same preview), → proceed(fresh) on giving up', () => {
    const error: GatePhase = { kind: 'error', message: 'disk full', preview };
    expect(nextGatePhase(error, { type: 'PRESS_RETRY' })).toEqual({
      kind: 'restoring',
      preview,
    });
    expect(nextGatePhase(error, { type: 'PRESS_FRESH' })).toEqual({
      kind: 'proceed',
      mode: 'fresh',
    });
  });

  it('proceed is terminal and invalid combos leave the phase unchanged', () => {
    const proceeded: GatePhase = { kind: 'proceed', mode: 'fresh' };
    expect(nextGatePhase(proceeded, { type: 'FOUND', preview })).toBe(proceeded);
    // Late discovery result after the user already proceeded must not
    // resurrect the gate; same for stray presses while checking.
    expect(nextGatePhase(checking, { type: 'PRESS_RESTORE' })).toBe(checking);
    expect(nextGatePhase({ kind: 'prompt', preview }, { type: 'RESTORE_OK' })).toEqual({
      kind: 'prompt',
      preview,
    });
  });
});

describe('gateSkipReason — Q9-A fresh-install short-circuits', () => {
  it('unwired deps skip first (storage never touched)', () => {
    expect(
      gateSkipReason({ depsWired: false, declinedSentinel: true, dbExists: true })
    ).toBe('not-wired');
  });

  it('declined sentinel skips before the db check', () => {
    expect(
      gateSkipReason({ depsWired: true, declinedSentinel: true, dbExists: false })
    ).toBe('declined');
  });

  it('existing DB file = not a fresh install', () => {
    expect(
      gateSkipReason({ depsWired: true, declinedSentinel: false, dbExists: true })
    ).toBe('db-exists');
  });

  it('fresh install → null → discovery runs', () => {
    expect(
      gateSkipReason({ depsWired: true, declinedSentinel: false, dbExists: false })
    ).toBeNull();
  });
});

describe('discoveryOutcomeToEvent', () => {
  it('non-found discovery statuses all collapse to NO_BACKUP', () => {
    for (const discovery of [
      { status: 'unavailable' as const },
      { status: 'timeout' as const },
      { status: 'none' as const },
      { status: 'error' as const, message: 'x' },
    ]) {
      expect(discoveryOutcomeToEvent(discovery, null)).toEqual({ type: 'NO_BACKUP' });
    }
  });

  it('found + successful pick → FOUND with the preview', () => {
    expect(
      discoveryOutcomeToEvent(
        { status: 'found', items: [itemFixture] },
        { ok: true, preview, rejected: [] }
      )
    ).toEqual({ type: 'FOUND', preview });
  });

  it('found + all rejected → ALL_REJECTED with the primary reason', () => {
    expect(
      discoveryOutcomeToEvent(
        { status: 'found', items: [itemFixture] },
        {
          ok: false,
          rejected: [
            { name: 'new.sqlite', reason: 'quick-check-failed' },
            { name: 'old.sqlite', reason: 'version-too-new' },
          ],
        }
      )
    ).toEqual({ type: 'ALL_REJECTED', reason: 'version-too-new' });
  });
});

describe('primaryRejectReason', () => {
  it('version-too-new wins (actionable: update the app)', () => {
    expect(primaryRejectReason(['quick-check-failed', 'version-too-new'])).toBe(
      'version-too-new'
    );
  });

  it('otherwise the newest copy (first in list) wins; empty list degrades safely', () => {
    expect(primaryRejectReason(['not-sqlite', 'quick-check-failed'])).toBe('not-sqlite');
    expect(primaryRejectReason([])).toBe('empty-or-invalid');
  });
});

describe('dynamic i18n helpers', () => {
  afterEach(() => setLocale('zh'));

  it('renders the ADR-0011 §4 preview line in both locales', () => {
    setLocale('zh');
    expect(tRestorePreviewLine(142, preview.lastSessionAt)).toMatch(
      /^備份內含 142 個 Session，最後一筆 2026-04-\d{2}$/
    );
    setLocale('en');
    expect(tRestorePreviewLine(142, preview.lastSessionAt)).toMatch(
      /^Backup contains 142 sessions, last on 2026-04-\d{2}$/
    );
    expect(tRestorePreviewLine(1, null)).toBe('Backup contains 1 session');
  });

  it('uses the Q10-A locked wording for version-too-new', () => {
    setLocale('zh');
    expect(tRestoreRejectReason('version-too-new')).toContain('較新版本的 TrainingLog');
    setLocale('en');
    expect(tRestoreRejectReason('version-too-new')).toContain('newer version of TrainingLog');
  });
});
