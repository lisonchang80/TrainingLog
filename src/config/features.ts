/**
 * Build-time feature flags.
 *
 * These flags gate user-facing affordances that depend on slices not yet
 * shipped. The default is **always the conservative path** — no false
 * promises in the UI. Flip to `true` only when the underlying capability
 * actually ships.
 *
 * Each flag's comment explains:
 *   - What it gates
 *   - Which slice / ADR will land the real capability
 *   - What the UI does when the flag is `false`
 *
 * Importing this module is side-effect-free; bundlers can constant-fold
 * branches where the flag value is `false` (tree-shake the gated UI code
 * + i18n strings if needed in production builds).
 */

/**
 * Watch handoff `[傳至手錶 ⌚]` button on Today bottom sticky bar.
 *
 * - **Gates**: the Pressable in `app/(tabs)/index.tsx` bottom-bar that
 *   currently shows an informational "coming in slice 13" Alert on tap.
 * - **Real capability lands in**: slice 11+ Watch scaffold (per ADR-0008
 *   multi-device strategy v1) + slice 13 HealthKit / WatchConnectivity.
 *   At that point the button will trigger a real WCSession message
 *   handing the in-progress session to the paired Watch.
 * - **When `false` (default)**: button is not rendered. Today bottom bar
 *   shows only `[+ 動作]` + `[手動計時]`.
 * - **When `true`**: button renders. Until WatchConnectivity lands, tap
 *   still shows the placeholder Alert (acceptable for dev / preview
 *   builds, NOT for production App Store builds).
 *
 * Rationale (per Agent E slice-10e research bundle 3 + ADR-0008): a
 * placeholder button with an informational Alert is a poor UX signal for
 * App Store users who don't know the "slice 13" vocabulary; they'll
 * read it as a broken feature. The conservative default is to hide the
 * affordance entirely until the real handoff ships.
 */
export const FEATURE_WATCH_HANDOFF = false;
