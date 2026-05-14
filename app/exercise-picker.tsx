/**
 * Exercise Picker route (ADR-0017 Q15 L2).
 *
 * Sibling stack route to `template/[id]` — pushing here from the Template
 * editor adds a stack frame so `router.back()` from the picker's 完成 / ✕
 * pops back to the editor cleanly. (The library tab inside `(tabs)/` cannot
 * be used directly because pushing into a tab swaps focus to that tab and
 * `router.back()` follows tab history — it would land on Today, not the
 * editor.)
 *
 * Renders the same component as `(tabs)/library.tsx`; the screen reads
 * `mode=picker` from URL params and branches its UI accordingly.
 */
export { default } from './(tabs)/library';
