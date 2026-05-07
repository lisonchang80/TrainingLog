import type { RecordSetInput } from './types';

/**
 * Pure validation of user-entered set fields.
 * Returns null if valid, or a human-readable error message string.
 *
 * Kept here (not in the repository) so it can be unit-tested without SQLite
 * and reused from the UI for live feedback.
 */
export function validateRecordSet(input: RecordSetInput): string | null {
  if (!input.exercise_id) return 'Exercise is required';
  if (!Number.isFinite(input.weight_kg) || input.weight_kg < 0) {
    return 'Weight must be a non-negative number';
  }
  if (!Number.isInteger(input.reps) || input.reps <= 0) {
    return 'Reps must be a positive integer';
  }
  return null;
}
