import { FEATURE_WATCH_HANDOFF } from '../../src/config/features';

/**
 * Slice 10e bundle 3 — feature flag default invariant.
 *
 * `FEATURE_WATCH_HANDOFF` MUST default to `false` until WatchConnectivity
 * lands in slice 11+. A passing `true` slipping into a release would
 * surface the placeholder `[傳至手錶 ⌚]` button on App Store builds, where
 * tap → informational Alert about "slice 13" looks like a broken feature
 * to end users.
 *
 * If you intentionally flipped this to `true` (e.g. dev build to preview
 * the bottom-bar layout with the button visible), gate that change at the
 * commit level — do NOT ship the flip to a release branch without also
 * removing this test or amending it to reflect a real capability ship.
 */
describe('features.ts default values', () => {
  it('FEATURE_WATCH_HANDOFF defaults to false (Watch handoff not yet shipped)', () => {
    expect(FEATURE_WATCH_HANDOFF).toBe(false);
  });
});
