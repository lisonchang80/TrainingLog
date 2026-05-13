/**
 * v010 seed — Equipment classification for 66 built-in exercises (ADR-0017 Q6).
 *
 * Lives outside the migration file so unit tests can `import` the same map
 * and assert coverage (66 entries, all 8 enum values represented or missing
 * intentionally).
 *
 * Enum (ADR-0017 Q6, CONTEXT.md Equipment 段):
 *   '槓鈴' / '啞鈴' / '史密斯機' / '滑輪' / '固定機械' / '自重' / '壺鈴' / '其他'
 *
 * Naming alignment:
 *   - 自重 (formerly 徒手 in CONTEXT.md, renamed per Q6)
 *   - 史密斯機 / 壺鈴 not present in v006 library (zero built-in seeds);
 *     reserved enum slots for user-created Custom exercises.
 */

import { type Equipment } from '../../domain/exercise/types';

/**
 * Map from exercise id → equipment string.
 * Covers all 66 v006 built-in exercises.
 *
 * Categorisation rules:
 *   - Name starts with "Barbell" / "Front Squat" / "Back Squat" / "Deadlift" /
 *     "Overhead Press" / similar compound free-weight → 槓鈴
 *   - Name starts with "Dumbbell" / "Goblet" / "Lateral Raise" / "Front Raise" /
 *     "Rear Delt Fly" / "Arnold" → 啞鈴
 *   - Name contains "Cable" / "Pulldown" / "Pushdown" / "Face Pull" → 滑輪
 *   - Name contains "Machine" / "Leg Press" / "Leg Extension" / "Leg Curl" /
 *     "Calf Raise" / "Assisted" → 固定機械
 *   - "Pull-up" / "Push-up" / "Chin-up" / "Dip" / "Plank" / "Crunch" /
 *     "Hanging Leg Raise" / "Hyperextension" / "Bench Dip" → 自重
 *   - "Hip Thrust" / "Glute Bridge" / "Rack Pull" / "Sumo DL" / "RDL" /
 *     "Skull Crusher" / "Close-grip Bench" / "Upright Row" / "Shrug" /
 *     "Curl" (barbell context) → 槓鈴
 *   - "Russian Twist" / "Wrist Curl" / "Reverse Wrist Curl" / "Lunge" /
 *     "Bulgarian Split Squat" / "Overhead Tricep Extension" → 啞鈴
 */
export const EXERCISE_EQUIPMENT_SEED: ReadonlyArray<readonly [string, Equipment]> = [
  // === 胸 (9) ===
  ['00000000-0000-4000-8000-000000000001', '槓鈴'],       // Bench Press
  ['00000000-0000-4000-8000-000000000007', '自重'],       // Push-up
  ['00000000-0000-4000-8000-000000000008', '槓鈴'],       // Incline Bench Press
  ['00000000-0000-4000-8000-000000000009', '槓鈴'],       // Decline Bench Press
  ['00000000-0000-4000-8000-00000000000a', '啞鈴'],       // Dumbbell Bench Press (10)
  ['00000000-0000-4000-8000-00000000000b', '啞鈴'],       // Incline Dumbbell Press (11)
  ['00000000-0000-4000-8000-00000000000c', '滑輪'],       // Cable Crossover (12)
  ['00000000-0000-4000-8000-00000000000d', '啞鈴'],       // Dumbbell Fly (13)
  ['00000000-0000-4000-8000-00000000000e', '自重'],       // Chest Dip (14)
  ['00000000-0000-4000-8000-00000000000f', '固定機械'],   // Machine Chest Press (15)
  ['00000000-0000-4000-8000-000000000010', '固定機械'],   // Assisted Dip (16)

  // === 背 (11) ===
  ['00000000-0000-4000-8000-000000000003', '槓鈴'],       // Deadlift
  ['00000000-0000-4000-8000-000000000005', '槓鈴'],       // Barbell Row
  ['00000000-0000-4000-8000-000000000006', '自重'],       // Pull-up
  ['00000000-0000-4000-8000-000000000011', '滑輪'],       // Lat Pulldown (17)
  ['00000000-0000-4000-8000-000000000012', '滑輪'],       // Seated Cable Row (18)
  ['00000000-0000-4000-8000-000000000013', '槓鈴'],       // T-bar Row (19)
  ['00000000-0000-4000-8000-000000000014', '啞鈴'],       // Dumbbell Row (20)
  ['00000000-0000-4000-8000-000000000015', '自重'],       // Chin-up (21)
  ['00000000-0000-4000-8000-000000000016', '槓鈴'],       // Rack Pull (22)
  ['00000000-0000-4000-8000-000000000017', '自重'],       // Hyperextension (23)
  ['00000000-0000-4000-8000-000000000018', '固定機械'],   // Assisted Pull-up (24)

  // === 腿 (8) ===
  ['00000000-0000-4000-8000-000000000002', '槓鈴'],       // Back Squat
  ['00000000-0000-4000-8000-000000000019', '槓鈴'],       // Front Squat (25)
  ['00000000-0000-4000-8000-00000000001a', '啞鈴'],       // Bulgarian Split Squat (26)
  ['00000000-0000-4000-8000-00000000001b', '固定機械'],   // Leg Press (27)
  ['00000000-0000-4000-8000-00000000001c', '固定機械'],   // Leg Extension (28)
  ['00000000-0000-4000-8000-00000000001d', '固定機械'],   // Leg Curl (29)
  ['00000000-0000-4000-8000-00000000001e', '啞鈴'],       // Lunge (30)
  ['00000000-0000-4000-8000-00000000001f', '啞鈴'],       // Goblet Squat (31)

  // === 臀 (5) ===
  ['00000000-0000-4000-8000-000000000020', '槓鈴'],       // Hip Thrust (32)
  ['00000000-0000-4000-8000-000000000021', '槓鈴'],       // Glute Bridge (33)
  ['00000000-0000-4000-8000-000000000022', '滑輪'],       // Cable Kickback (34)
  ['00000000-0000-4000-8000-000000000023', '槓鈴'],       // Sumo Deadlift (35)
  ['00000000-0000-4000-8000-000000000024', '槓鈴'],       // Romanian Deadlift (36)

  // === 肩 (7) ===
  ['00000000-0000-4000-8000-000000000004', '槓鈴'],       // Overhead Press (Barbell OHP)
  ['00000000-0000-4000-8000-000000000025', '啞鈴'],       // Dumbbell Shoulder Press (37)
  ['00000000-0000-4000-8000-000000000026', '啞鈴'],       // Lateral Raise (38)
  ['00000000-0000-4000-8000-000000000027', '啞鈴'],       // Front Raise (39)
  ['00000000-0000-4000-8000-000000000028', '啞鈴'],       // Rear Delt Fly (40)
  ['00000000-0000-4000-8000-000000000029', '啞鈴'],       // Arnold Press (41)
  ['00000000-0000-4000-8000-00000000002a', '槓鈴'],       // Upright Row (42)

  // === 斜方肌 (3) ===
  ['00000000-0000-4000-8000-00000000002b', '槓鈴'],       // Barbell Shrug (43)
  ['00000000-0000-4000-8000-00000000002c', '啞鈴'],       // Dumbbell Shrug (44)
  ['00000000-0000-4000-8000-00000000002d', '滑輪'],       // Face Pull (45)

  // === 二頭 (5) ===
  ['00000000-0000-4000-8000-00000000002e', '槓鈴'],       // Barbell Curl (46)
  ['00000000-0000-4000-8000-00000000002f', '啞鈴'],       // Dumbbell Curl (47)
  ['00000000-0000-4000-8000-000000000030', '啞鈴'],       // Hammer Curl (48)
  ['00000000-0000-4000-8000-000000000031', '槓鈴'],       // Preacher Curl (49)
  ['00000000-0000-4000-8000-000000000032', '滑輪'],       // Cable Curl (50)

  // === 三頭 (5) ===
  ['00000000-0000-4000-8000-000000000033', '滑輪'],       // Tricep Pushdown (51)
  ['00000000-0000-4000-8000-000000000034', '槓鈴'],       // Skull Crusher (52)
  ['00000000-0000-4000-8000-000000000035', '啞鈴'],       // Overhead Tricep Extension (53)
  ['00000000-0000-4000-8000-000000000036', '槓鈴'],       // Close-grip Bench Press (54)
  ['00000000-0000-4000-8000-000000000037', '自重'],       // Bench Dip (55)

  // === 小腿 (3) ===
  ['00000000-0000-4000-8000-000000000038', '固定機械'],   // Standing Calf Raise (56)
  ['00000000-0000-4000-8000-000000000039', '固定機械'],   // Seated Calf Raise (57)
  ['00000000-0000-4000-8000-00000000003a', '固定機械'],   // Donkey Calf Raise (58)

  // === 小臂 (2) ===
  ['00000000-0000-4000-8000-00000000003b', '啞鈴'],       // Wrist Curl (59)
  ['00000000-0000-4000-8000-00000000003c', '啞鈴'],       // Reverse Wrist Curl (60)

  // === 核心 (6) ===
  ['00000000-0000-4000-8000-00000000003d', '自重'],       // Plank (61)
  ['00000000-0000-4000-8000-00000000003e', '自重'],       // Crunch (62)
  ['00000000-0000-4000-8000-00000000003f', '自重'],       // Hanging Leg Raise (63)
  ['00000000-0000-4000-8000-000000000040', '啞鈴'],       // Russian Twist (64)
  ['00000000-0000-4000-8000-000000000041', '滑輪'],       // Cable Wood Chop (65)
  ['00000000-0000-4000-8000-000000000042', '滑輪'],       // Pallof Press (66)
];
