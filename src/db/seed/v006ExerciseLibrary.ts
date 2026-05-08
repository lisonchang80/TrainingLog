/**
 * v006 seed data — 11 muscle_group + 19 muscle + 66 built-in exercise.
 *
 * Lives outside the migration file so unit tests can `import` the same
 * constants and assert on them (per ADR-0010 acceptance criterion: muscle
 * mapping correctness + load_type coverage).
 *
 * IDs:
 *   - muscle_group: slug like 'mg-chest' (stable, human-readable)
 *   - muscle:       slug like 'm-upper-chest'
 *   - exercise:     UUID v4 with hand-chosen low-bit pattern
 *                   '00000000-0000-4000-8000-0000000000XX' so tests can match
 *                   on stable IDs and we don't risk collision with future
 *                   user-generated UUIDs.
 *
 * Existing v001 / v002 exercise IDs (01-07) are preserved here so the
 * migration's INSERT OR IGNORE no-ops the row body but the follow-up
 * UPDATE backfills `muscle_group_id`.
 */

// ---------- Muscle Group IDs ----------
export const MG_CHEST = 'mg-chest';
export const MG_BACK = 'mg-back';
export const MG_LEG = 'mg-leg';
export const MG_GLUTE = 'mg-glute';
export const MG_SHOULDER = 'mg-shoulder';
export const MG_TRAP = 'mg-trap';
export const MG_BICEP = 'mg-bicep';
export const MG_TRICEP = 'mg-tricep';
export const MG_CALF = 'mg-calf';
export const MG_FOREARM = 'mg-forearm';
export const MG_CORE = 'mg-core';

// ---------- Muscle IDs (19 anatomical muscles per ADR-0010) ----------
export const M_UPPER_CHEST = 'm-upper-chest';      // 上胸
export const M_LOWER_CHEST = 'm-lower-chest';      // 中下胸
export const M_BACK = 'm-back';                    // 背部
export const M_LOWER_BACK = 'm-lower-back';        // 下背
export const M_QUAD = 'm-quad';                    // 股四
export const M_HAMSTRING = 'm-hamstring';          // 膕繩
export const M_UPPER_GLUTE = 'm-upper-glute';      // 上臀部
export const M_LOWER_GLUTE = 'm-lower-glute';      // 下臀部
export const M_FRONT_DELT = 'm-front-delt';        // 前束
export const M_MID_DELT = 'm-mid-delt';            // 中束
export const M_REAR_DELT = 'm-rear-delt';          // 後束
export const M_TRAP = 'm-trap';                    // 斜方肌
export const M_BICEP_LONG = 'm-bicep-long';        // 二頭長頭
export const M_BICEP_SHORT = 'm-bicep-short';      // 二頭短頭
export const M_TRICEP = 'm-tricep';                // 三頭
export const M_CALF = 'm-calf';                    // 小腿
export const M_FOREARM = 'm-forearm';              // 前臂
export const M_OBLIQUE = 'm-oblique';              // 側腹
export const M_ABS = 'm-abs';                      // 腹肌

export interface MuscleGroupSeed {
  id: string;
  name: string;
  display_order: number;
}

export interface MuscleSeed {
  id: string;
  name: string;
  mg_id: string;
  display_order: number;
}

export type LoadType = 'loaded' | 'bodyweight' | 'assisted';

export interface ExerciseLibrarySeed {
  id: string;
  name: string;
  load_type: LoadType;
  muscle_group_id: string;
  primary: string[];
  secondary: string[];
}

// ---------- Muscle Group Seeds ----------
export const MUSCLE_GROUP_SEEDS: MuscleGroupSeed[] = [
  { id: MG_CHEST, name: '胸', display_order: 1 },
  { id: MG_BACK, name: '背', display_order: 2 },
  { id: MG_LEG, name: '腿', display_order: 3 },
  { id: MG_GLUTE, name: '臀', display_order: 4 },
  { id: MG_SHOULDER, name: '肩', display_order: 5 },
  { id: MG_TRAP, name: '斜方肌', display_order: 6 },
  { id: MG_BICEP, name: '二頭', display_order: 7 },
  { id: MG_TRICEP, name: '三頭', display_order: 8 },
  { id: MG_CALF, name: '小腿', display_order: 9 },
  { id: MG_FOREARM, name: '前臂', display_order: 10 },
  { id: MG_CORE, name: '核心', display_order: 11 },
];

// ---------- Muscle Seeds ----------
export const MUSCLE_SEEDS: MuscleSeed[] = [
  // 胸 (2)
  { id: M_UPPER_CHEST, name: '上胸', mg_id: MG_CHEST, display_order: 1 },
  { id: M_LOWER_CHEST, name: '中下胸', mg_id: MG_CHEST, display_order: 2 },
  // 背 (2)
  { id: M_BACK, name: '背部', mg_id: MG_BACK, display_order: 1 },
  { id: M_LOWER_BACK, name: '下背', mg_id: MG_BACK, display_order: 2 },
  // 腿 (2)
  { id: M_QUAD, name: '股四', mg_id: MG_LEG, display_order: 1 },
  { id: M_HAMSTRING, name: '膕繩', mg_id: MG_LEG, display_order: 2 },
  // 臀 (2)
  { id: M_UPPER_GLUTE, name: '上臀部', mg_id: MG_GLUTE, display_order: 1 },
  { id: M_LOWER_GLUTE, name: '下臀部', mg_id: MG_GLUTE, display_order: 2 },
  // 肩 (3)
  { id: M_FRONT_DELT, name: '前束', mg_id: MG_SHOULDER, display_order: 1 },
  { id: M_MID_DELT, name: '中束', mg_id: MG_SHOULDER, display_order: 2 },
  { id: M_REAR_DELT, name: '後束', mg_id: MG_SHOULDER, display_order: 3 },
  // 斜方肌 (1)
  { id: M_TRAP, name: '斜方肌', mg_id: MG_TRAP, display_order: 1 },
  // 二頭 (2)
  { id: M_BICEP_LONG, name: '二頭長頭', mg_id: MG_BICEP, display_order: 1 },
  { id: M_BICEP_SHORT, name: '二頭短頭', mg_id: MG_BICEP, display_order: 2 },
  // 三頭 (1)
  { id: M_TRICEP, name: '三頭', mg_id: MG_TRICEP, display_order: 1 },
  // 小腿 (1)
  { id: M_CALF, name: '小腿', mg_id: MG_CALF, display_order: 1 },
  // 前臂 (1)
  { id: M_FOREARM, name: '前臂', mg_id: MG_FOREARM, display_order: 1 },
  // 核心 (2)
  { id: M_OBLIQUE, name: '側腹', mg_id: MG_CORE, display_order: 1 },
  { id: M_ABS, name: '腹肌', mg_id: MG_CORE, display_order: 2 },
];

// ---------- Stable exercise UUID helper ----------
const exId = (n: number): string => {
  const hex = n.toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
};

// ---------- Exercise Library Seed (66 exercises) ----------
export const EXERCISE_LIBRARY_SEEDS: ExerciseLibrarySeed[] = [
  // === 胸 (9) ===
  // ids 1, 7 are pre-existing from v001/v002 — included here for muscle mapping.
  {
    id: exId(1),
    name: 'Bench Press',
    load_type: 'loaded',
    muscle_group_id: MG_CHEST,
    primary: [M_LOWER_CHEST, M_TRICEP, M_FRONT_DELT],
    secondary: [M_UPPER_CHEST, M_FOREARM, M_ABS],
  },
  {
    id: exId(7),
    name: 'Push-up',
    load_type: 'bodyweight',
    muscle_group_id: MG_CHEST,
    primary: [M_LOWER_CHEST, M_TRICEP, M_FRONT_DELT],
    secondary: [M_UPPER_CHEST, M_ABS],
  },
  {
    id: exId(8),
    name: 'Incline Bench Press',
    load_type: 'loaded',
    muscle_group_id: MG_CHEST,
    primary: [M_UPPER_CHEST, M_FRONT_DELT, M_TRICEP],
    secondary: [M_LOWER_CHEST, M_FOREARM],
  },
  {
    id: exId(9),
    name: 'Decline Bench Press',
    load_type: 'loaded',
    muscle_group_id: MG_CHEST,
    primary: [M_LOWER_CHEST, M_TRICEP, M_FRONT_DELT],
    secondary: [M_ABS],
  },
  {
    id: exId(10),
    name: 'Dumbbell Bench Press',
    load_type: 'loaded',
    muscle_group_id: MG_CHEST,
    primary: [M_LOWER_CHEST, M_TRICEP, M_FRONT_DELT],
    secondary: [M_UPPER_CHEST, M_FOREARM],
  },
  {
    id: exId(11),
    name: 'Incline Dumbbell Press',
    load_type: 'loaded',
    muscle_group_id: MG_CHEST,
    primary: [M_UPPER_CHEST, M_FRONT_DELT],
    secondary: [M_TRICEP, M_FOREARM],
  },
  {
    id: exId(12),
    name: 'Cable Crossover',
    load_type: 'loaded',
    muscle_group_id: MG_CHEST,
    primary: [M_LOWER_CHEST],
    secondary: [M_UPPER_CHEST, M_FRONT_DELT],
  },
  {
    id: exId(13),
    name: 'Dumbbell Fly',
    load_type: 'loaded',
    muscle_group_id: MG_CHEST,
    primary: [M_LOWER_CHEST],
    secondary: [M_UPPER_CHEST, M_FRONT_DELT],
  },
  {
    id: exId(14),
    name: 'Chest Dip',
    load_type: 'bodyweight',
    muscle_group_id: MG_CHEST,
    primary: [M_LOWER_CHEST, M_TRICEP],
    secondary: [M_FRONT_DELT],
  },
  {
    id: exId(15),
    name: 'Machine Chest Press',
    load_type: 'loaded',
    muscle_group_id: MG_CHEST,
    primary: [M_LOWER_CHEST, M_FRONT_DELT, M_TRICEP],
    secondary: [M_UPPER_CHEST],
  },
  {
    id: exId(16),
    name: 'Assisted Dip',
    load_type: 'assisted',
    muscle_group_id: MG_CHEST,
    primary: [M_LOWER_CHEST, M_TRICEP],
    secondary: [M_FRONT_DELT],
  },

  // === 背 (11) ===
  {
    id: exId(3),
    name: 'Deadlift',
    load_type: 'loaded',
    muscle_group_id: MG_BACK,
    primary: [M_LOWER_BACK, M_HAMSTRING, M_UPPER_GLUTE, M_LOWER_GLUTE],
    secondary: [M_BACK, M_TRAP, M_FOREARM, M_ABS],
  },
  {
    id: exId(5),
    name: 'Barbell Row',
    load_type: 'loaded',
    muscle_group_id: MG_BACK,
    primary: [M_BACK, M_BICEP_LONG, M_BICEP_SHORT],
    secondary: [M_REAR_DELT, M_LOWER_BACK, M_FOREARM],
  },
  {
    id: exId(6),
    name: 'Pull-up',
    load_type: 'bodyweight',
    muscle_group_id: MG_BACK,
    primary: [M_BACK, M_BICEP_LONG, M_BICEP_SHORT],
    secondary: [M_REAR_DELT, M_FOREARM, M_ABS],
  },
  {
    id: exId(17),
    name: 'Lat Pulldown',
    load_type: 'loaded',
    muscle_group_id: MG_BACK,
    primary: [M_BACK, M_BICEP_LONG, M_BICEP_SHORT],
    secondary: [M_REAR_DELT, M_FOREARM],
  },
  {
    id: exId(18),
    name: 'Seated Cable Row',
    load_type: 'loaded',
    muscle_group_id: MG_BACK,
    primary: [M_BACK, M_REAR_DELT],
    secondary: [M_BICEP_LONG, M_BICEP_SHORT, M_TRAP],
  },
  {
    id: exId(19),
    name: 'T-bar Row',
    load_type: 'loaded',
    muscle_group_id: MG_BACK,
    primary: [M_BACK, M_BICEP_LONG, M_BICEP_SHORT],
    secondary: [M_REAR_DELT, M_LOWER_BACK, M_FOREARM],
  },
  {
    id: exId(20),
    name: 'Dumbbell Row',
    load_type: 'loaded',
    muscle_group_id: MG_BACK,
    primary: [M_BACK, M_BICEP_LONG, M_BICEP_SHORT],
    secondary: [M_REAR_DELT, M_FOREARM],
  },
  {
    id: exId(21),
    name: 'Chin-up',
    load_type: 'bodyweight',
    muscle_group_id: MG_BACK,
    primary: [M_BACK, M_BICEP_LONG, M_BICEP_SHORT],
    secondary: [M_REAR_DELT, M_FOREARM, M_ABS],
  },
  {
    id: exId(22),
    name: 'Rack Pull',
    load_type: 'loaded',
    muscle_group_id: MG_BACK,
    primary: [M_BACK, M_TRAP],
    secondary: [M_LOWER_BACK, M_FOREARM],
  },
  {
    id: exId(23),
    name: 'Hyperextension',
    load_type: 'bodyweight',
    muscle_group_id: MG_BACK,
    primary: [M_LOWER_BACK],
    secondary: [M_UPPER_GLUTE, M_HAMSTRING],
  },
  {
    id: exId(24),
    name: 'Assisted Pull-up',
    load_type: 'assisted',
    muscle_group_id: MG_BACK,
    primary: [M_BACK, M_BICEP_LONG, M_BICEP_SHORT],
    secondary: [M_REAR_DELT, M_FOREARM],
  },

  // === 腿 (8) ===
  {
    id: exId(2),
    name: 'Back Squat',
    load_type: 'loaded',
    muscle_group_id: MG_LEG,
    primary: [M_QUAD, M_UPPER_GLUTE, M_LOWER_GLUTE],
    secondary: [M_HAMSTRING, M_LOWER_BACK, M_ABS, M_CALF],
  },
  {
    id: exId(25),
    name: 'Front Squat',
    load_type: 'loaded',
    muscle_group_id: MG_LEG,
    primary: [M_QUAD, M_UPPER_GLUTE],
    secondary: [M_HAMSTRING, M_LOWER_GLUTE, M_ABS, M_CALF],
  },
  {
    id: exId(26),
    name: 'Bulgarian Split Squat',
    load_type: 'loaded',
    muscle_group_id: MG_LEG,
    primary: [M_QUAD, M_UPPER_GLUTE, M_LOWER_GLUTE],
    secondary: [M_HAMSTRING, M_ABS],
  },
  {
    id: exId(27),
    name: 'Leg Press',
    load_type: 'loaded',
    muscle_group_id: MG_LEG,
    primary: [M_QUAD, M_UPPER_GLUTE],
    secondary: [M_HAMSTRING, M_LOWER_GLUTE],
  },
  {
    id: exId(28),
    name: 'Leg Extension',
    load_type: 'loaded',
    muscle_group_id: MG_LEG,
    primary: [M_QUAD],
    secondary: [],
  },
  {
    id: exId(29),
    name: 'Leg Curl',
    load_type: 'loaded',
    muscle_group_id: MG_LEG,
    primary: [M_HAMSTRING],
    secondary: [M_CALF],
  },
  {
    id: exId(30),
    name: 'Lunge',
    load_type: 'loaded',
    muscle_group_id: MG_LEG,
    primary: [M_QUAD, M_UPPER_GLUTE, M_LOWER_GLUTE],
    secondary: [M_HAMSTRING, M_ABS],
  },
  {
    id: exId(31),
    name: 'Goblet Squat',
    load_type: 'loaded',
    muscle_group_id: MG_LEG,
    primary: [M_QUAD, M_UPPER_GLUTE],
    secondary: [M_HAMSTRING, M_LOWER_GLUTE, M_ABS, M_CALF],
  },

  // === 臀 (5) ===
  {
    id: exId(32),
    name: 'Hip Thrust',
    load_type: 'loaded',
    muscle_group_id: MG_GLUTE,
    primary: [M_UPPER_GLUTE, M_LOWER_GLUTE],
    secondary: [M_HAMSTRING, M_ABS],
  },
  {
    id: exId(33),
    name: 'Glute Bridge',
    load_type: 'loaded',
    muscle_group_id: MG_GLUTE,
    primary: [M_UPPER_GLUTE, M_LOWER_GLUTE],
    secondary: [M_HAMSTRING],
  },
  {
    id: exId(34),
    name: 'Cable Kickback',
    load_type: 'loaded',
    muscle_group_id: MG_GLUTE,
    primary: [M_UPPER_GLUTE, M_LOWER_GLUTE],
    secondary: [M_HAMSTRING],
  },
  {
    id: exId(35),
    name: 'Sumo Deadlift',
    load_type: 'loaded',
    muscle_group_id: MG_GLUTE,
    primary: [M_UPPER_GLUTE, M_LOWER_GLUTE, M_HAMSTRING],
    secondary: [M_QUAD, M_LOWER_BACK, M_TRAP, M_FOREARM],
  },
  {
    id: exId(36),
    name: 'Romanian Deadlift',
    load_type: 'loaded',
    muscle_group_id: MG_GLUTE,
    primary: [M_HAMSTRING, M_UPPER_GLUTE, M_LOWER_GLUTE],
    secondary: [M_LOWER_BACK, M_BACK, M_FOREARM],
  },

  // === 肩 (7) ===
  {
    id: exId(4),
    name: 'Overhead Press',
    load_type: 'loaded',
    muscle_group_id: MG_SHOULDER,
    primary: [M_FRONT_DELT, M_MID_DELT, M_TRICEP],
    secondary: [M_UPPER_CHEST, M_TRAP, M_ABS],
  },
  {
    id: exId(37),
    name: 'Dumbbell Shoulder Press',
    load_type: 'loaded',
    muscle_group_id: MG_SHOULDER,
    primary: [M_FRONT_DELT, M_MID_DELT, M_TRICEP],
    secondary: [M_TRAP, M_UPPER_CHEST],
  },
  {
    id: exId(38),
    name: 'Lateral Raise',
    load_type: 'loaded',
    muscle_group_id: MG_SHOULDER,
    primary: [M_MID_DELT],
    secondary: [M_FRONT_DELT, M_TRAP],
  },
  {
    id: exId(39),
    name: 'Front Raise',
    load_type: 'loaded',
    muscle_group_id: MG_SHOULDER,
    primary: [M_FRONT_DELT],
    secondary: [M_UPPER_CHEST],
  },
  {
    id: exId(40),
    name: 'Rear Delt Fly',
    load_type: 'loaded',
    muscle_group_id: MG_SHOULDER,
    primary: [M_REAR_DELT],
    secondary: [M_TRAP, M_BACK],
  },
  {
    id: exId(41),
    name: 'Arnold Press',
    load_type: 'loaded',
    muscle_group_id: MG_SHOULDER,
    primary: [M_FRONT_DELT, M_MID_DELT],
    secondary: [M_TRICEP, M_TRAP],
  },
  {
    id: exId(42),
    name: 'Upright Row',
    load_type: 'loaded',
    muscle_group_id: MG_SHOULDER,
    primary: [M_MID_DELT, M_TRAP],
    secondary: [M_BICEP_SHORT, M_FOREARM],
  },

  // === 斜方肌 (3) ===
  {
    id: exId(43),
    name: 'Barbell Shrug',
    load_type: 'loaded',
    muscle_group_id: MG_TRAP,
    primary: [M_TRAP],
    secondary: [M_FOREARM],
  },
  {
    id: exId(44),
    name: 'Dumbbell Shrug',
    load_type: 'loaded',
    muscle_group_id: MG_TRAP,
    primary: [M_TRAP],
    secondary: [M_FOREARM],
  },
  {
    id: exId(45),
    name: 'Face Pull',
    load_type: 'loaded',
    muscle_group_id: MG_TRAP,
    primary: [M_REAR_DELT, M_TRAP],
    secondary: [M_BACK],
  },

  // === 二頭 (5) ===
  {
    id: exId(46),
    name: 'Barbell Curl',
    load_type: 'loaded',
    muscle_group_id: MG_BICEP,
    primary: [M_BICEP_LONG, M_BICEP_SHORT],
    secondary: [M_FOREARM],
  },
  {
    id: exId(47),
    name: 'Dumbbell Curl',
    load_type: 'loaded',
    muscle_group_id: MG_BICEP,
    primary: [M_BICEP_LONG, M_BICEP_SHORT],
    secondary: [M_FOREARM],
  },
  {
    id: exId(48),
    name: 'Hammer Curl',
    load_type: 'loaded',
    muscle_group_id: MG_BICEP,
    primary: [M_BICEP_LONG, M_FOREARM],
    secondary: [M_BICEP_SHORT],
  },
  {
    id: exId(49),
    name: 'Preacher Curl',
    load_type: 'loaded',
    muscle_group_id: MG_BICEP,
    primary: [M_BICEP_SHORT, M_BICEP_LONG],
    secondary: [M_FOREARM],
  },
  {
    id: exId(50),
    name: 'Cable Curl',
    load_type: 'loaded',
    muscle_group_id: MG_BICEP,
    primary: [M_BICEP_LONG, M_BICEP_SHORT],
    secondary: [M_FOREARM],
  },

  // === 三頭 (5) ===
  {
    id: exId(51),
    name: 'Tricep Pushdown',
    load_type: 'loaded',
    muscle_group_id: MG_TRICEP,
    primary: [M_TRICEP],
    secondary: [],
  },
  {
    id: exId(52),
    name: 'Skull Crusher',
    load_type: 'loaded',
    muscle_group_id: MG_TRICEP,
    primary: [M_TRICEP],
    secondary: [M_FOREARM],
  },
  {
    id: exId(53),
    name: 'Overhead Tricep Extension',
    load_type: 'loaded',
    muscle_group_id: MG_TRICEP,
    primary: [M_TRICEP],
    secondary: [],
  },
  {
    id: exId(54),
    name: 'Close-grip Bench Press',
    load_type: 'loaded',
    muscle_group_id: MG_TRICEP,
    primary: [M_TRICEP, M_LOWER_CHEST],
    secondary: [M_FRONT_DELT, M_FOREARM],
  },
  {
    id: exId(55),
    name: 'Bench Dip',
    load_type: 'bodyweight',
    muscle_group_id: MG_TRICEP,
    primary: [M_TRICEP],
    secondary: [M_LOWER_CHEST, M_FRONT_DELT],
  },

  // === 小腿 (3) ===
  {
    id: exId(56),
    name: 'Standing Calf Raise',
    load_type: 'loaded',
    muscle_group_id: MG_CALF,
    primary: [M_CALF],
    secondary: [],
  },
  {
    id: exId(57),
    name: 'Seated Calf Raise',
    load_type: 'loaded',
    muscle_group_id: MG_CALF,
    primary: [M_CALF],
    secondary: [],
  },
  {
    id: exId(58),
    name: 'Donkey Calf Raise',
    load_type: 'loaded',
    muscle_group_id: MG_CALF,
    primary: [M_CALF],
    secondary: [],
  },

  // === 前臂 (2) ===
  {
    id: exId(59),
    name: 'Wrist Curl',
    load_type: 'loaded',
    muscle_group_id: MG_FOREARM,
    primary: [M_FOREARM],
    secondary: [],
  },
  {
    id: exId(60),
    name: 'Reverse Wrist Curl',
    load_type: 'loaded',
    muscle_group_id: MG_FOREARM,
    primary: [M_FOREARM],
    secondary: [],
  },

  // === 核心 (6) ===
  {
    id: exId(61),
    name: 'Plank',
    load_type: 'bodyweight',
    muscle_group_id: MG_CORE,
    primary: [M_ABS, M_OBLIQUE],
    secondary: [M_LOWER_BACK],
  },
  {
    id: exId(62),
    name: 'Crunch',
    load_type: 'bodyweight',
    muscle_group_id: MG_CORE,
    primary: [M_ABS],
    secondary: [M_OBLIQUE],
  },
  {
    id: exId(63),
    name: 'Hanging Leg Raise',
    load_type: 'bodyweight',
    muscle_group_id: MG_CORE,
    primary: [M_ABS],
    secondary: [M_OBLIQUE, M_FOREARM],
  },
  {
    id: exId(64),
    name: 'Russian Twist',
    load_type: 'loaded',
    muscle_group_id: MG_CORE,
    primary: [M_OBLIQUE],
    secondary: [M_ABS],
  },
  {
    id: exId(65),
    name: 'Cable Wood Chop',
    load_type: 'loaded',
    muscle_group_id: MG_CORE,
    primary: [M_OBLIQUE],
    secondary: [M_ABS],
  },
  {
    id: exId(66),
    name: 'Pallof Press',
    load_type: 'loaded',
    muscle_group_id: MG_CORE,
    primary: [M_OBLIQUE],
    secondary: [M_ABS],
  },
];
