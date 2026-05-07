export interface SetRow {
  id: string;
  session_id: string;
  exercise_id: string;
  weight_kg: number | null;
  reps: number | null;
  is_skipped: number; // 0/1
  ordering: number;
  created_at: number;
}

/** Input fields a user provides when recording a set. */
export interface RecordSetInput {
  exercise_id: string;
  weight_kg: number;
  reps: number;
}
