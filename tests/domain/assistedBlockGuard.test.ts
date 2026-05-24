import { needsBwSnapshotForAppend } from '../../src/domain/session/assistedBlockGuard';

/**
 * ADR-0024 § 4 — assisted modal blocks ONLY when (load_type === 'assisted'
 * AND snapshot is null). Every other combo proceeds without prompting.
 */
describe('needsBwSnapshotForAppend (ADR-0024 § 4)', () => {
  it('blocks for assisted + null snapshot', () => {
    expect(
      needsBwSnapshotForAppend({ load_type: 'assisted', snapshot_kg: null })
    ).toBe(true);
  });

  it('does NOT block when assisted but snapshot already locked', () => {
    expect(
      needsBwSnapshotForAppend({ load_type: 'assisted', snapshot_kg: 70 })
    ).toBe(false);
  });

  it('never blocks for loaded exercises, regardless of snapshot', () => {
    expect(
      needsBwSnapshotForAppend({ load_type: 'loaded', snapshot_kg: null })
    ).toBe(false);
    expect(
      needsBwSnapshotForAppend({ load_type: 'loaded', snapshot_kg: 72 })
    ).toBe(false);
  });

  it('never blocks for bodyweight exercises, regardless of snapshot', () => {
    expect(
      needsBwSnapshotForAppend({ load_type: 'bodyweight', snapshot_kg: null })
    ).toBe(false);
    expect(
      needsBwSnapshotForAppend({ load_type: 'bodyweight', snapshot_kg: 72 })
    ).toBe(false);
  });
});
