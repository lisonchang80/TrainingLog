export type LoadType = 'loaded' | 'bodyweight' | 'assisted';

export interface Exercise {
  id: string;
  name: string;
  load_type: LoadType;
  is_builtin: number; // SQLite stores 0/1
  is_archived: number;
}
