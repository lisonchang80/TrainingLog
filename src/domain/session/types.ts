export interface Session {
  id: string;
  started_at: number; // unix epoch ms
  ended_at: number | null;
  bodyweight_snapshot_kg: number | null;
}
