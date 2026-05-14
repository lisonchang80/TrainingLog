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
 * Wraps the LibraryScreen component so expo-router sees a distinct screen
 * identity from `(tabs)/library` (re-exporting the default conflated them
 * and `router.back()` still followed tab history). The wrapped LibraryScreen
 * reads `mode=picker` from URL params the same way.
 */
import LibraryScreen from './(tabs)/library';

export default function ExercisePickerScreen() {
  return <LibraryScreen />;
}
