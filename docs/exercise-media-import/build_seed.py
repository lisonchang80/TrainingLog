#!/usr/bin/env python3
"""
One-shot generator: curated-master.json + existing v006 seed → v028 seed TS files.

Emits (into the repo):
  - src/db/seed/v028ExerciseMediaLibrary.ts  (NEW_EXERCISE_SEEDS / MEDIA_UPDATE_EXISTING / ARCHIVE_EXISTING_IDS)
  - src/db/seed/exerciseMediaMap.ts          (EXERCISE_MEDIA require map, 167 real)

And writes i18n splice blocks to /tmp/i18n_zh_block.txt + /tmp/i18n_en_block.txt
for manual insertion into src/i18n/strings.ts (zh.exercise @711 / en.exercise @1499).

Reconciliation (locked 2026-06-24, grill C 折衷 + 只留 3 個獨有):
  - 24 同名 curated→existing: UPDATE media_path on existing id (reuse).
  - 206 curated-only: INSERT new exId(67..272).
  - 39 existing-only: is_archived=1.
  - 3 existing-only KEEP active (no media): 山羊挺身 / 板凳撐體 / 驢式提踵.

Run from repo root:  python3 docs/exercise-media-import/build_seed.py
"""
import json, re, sys, os

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(REPO)

CURATED = 'docs/exercise-media-import/curated-master.json'
SEED_V006 = 'src/db/seed/v006ExerciseLibrary.ts'

PART_TO_MG = {
    '胸': 'mg-chest', '背': 'mg-back', '腿': 'mg-leg', '臀': 'mg-glute',
    '肩': 'mg-shoulder', '斜方': 'mg-trap', '二頭': 'mg-bicep',
    '三頭': 'mg-tricep', '小臂': 'mg-forearm', '小腿': 'mg-calf', '核心': 'mg-core',
}
ENUM = {'槓鈴', '啞鈴', '史密斯機', '滑輪', '固定機械', '自重', '壺鈴', '其他'}
KEEP_ACTIVE = {'山羊挺身', '板凳撐體', '驢式提踵'}  # existing-only, genuinely unique → stay active

# English names for the 63 placeholder entries (no Free-Exercise-DB photo → no DB
# `en`). Without these, en-locale tExercise falls back to the zh name → 中英混雜
# in the library grid. Standard gym terminology; keep in sync with curated-master.
PLACEHOLDER_EN = {
    '暫停臥推': 'Paused Bench Press',
    '雙槓臂屈伸（輔助）': 'Assisted Chest Dip',
    '雙槓臂屈伸（負重）': 'Weighted Chest Dip',
    '蝴蝶機夾胸（上胸）': 'Incline Pec Deck Fly',
    '潘德雷划船': 'Pendlay Row',
    '機械高位划船（反握）': 'Underhand Machine High Row',
    '機械單側高位划船': 'Single-Arm Machine High Row',
    '機械單側高位划船（反握）': 'Underhand Single-Arm Machine High Row',
    '機械單側划船': 'Single-Arm Machine Row',
    '對握滑輪下拉': 'Neutral-Grip Lat Pulldown',
    '單臂直臂下壓': 'Single-Arm Straight-Arm Pulldown',
    '坐姿划船（寬握）': 'Wide-Grip Seated Cable Row',
    '六角槓划船': 'Trap Bar Row',
    '架上深蹲': 'Pin Squat',
    '槓鈴單腿硬舉': 'Barbell Single-Leg Deadlift',
    '槓鈴分腿硬舉': 'Barbell Split-Stance Deadlift',
    'SSB深蹲': 'Safety Bar Squat',
    'SSB箱蹲': 'Safety Bar Box Squat',
    '槓鈴分腿蹲': 'Barbell Split Squat',
    'SSB分腿蹲': 'Safety Bar Split Squat',
    '史密斯澤奇深蹲': 'Smith Machine Zercher Squat',
    '史密斯硬舉': 'Smith Machine Deadlift',
    '史密斯單腿硬舉': 'Smith Machine Single-Leg Deadlift',
    '史密斯分腿硬舉': 'Smith Machine Split-Stance Deadlift',
    '史密斯羅馬尼亞硬舉': 'Smith Machine Romanian Deadlift',
    '史密斯弓箭步': 'Smith Machine Lunge',
    '腿推（單腿）': 'Single-Leg Leg Press',
    '俯臥腿彎舉（單腿）': 'Single-Leg Lying Leg Curl',
    '坐姿腿彎舉（單腿）': 'Single-Leg Seated Leg Curl',
    '啞鈴高腳杯深蹲': 'Dumbbell Goblet Squat',
    '啞鈴羅馬尼亞硬舉': 'Dumbbell Romanian Deadlift',
    '啞鈴單腿硬舉': 'Dumbbell Single-Leg Deadlift',
    '啞鈴分腿硬舉': 'Dumbbell Split-Stance Deadlift',
    '地雷管硬舉': 'Landmine Deadlift',
    '地雷管羅馬尼亞硬舉': 'Landmine Romanian Deadlift',
    '地雷管單腿硬舉': 'Landmine Single-Leg Deadlift',
    '地雷管分腿硬舉': 'Landmine Split-Stance Deadlift',
    '六角槓深蹲': 'Trap Bar Squat',
    '六角槓箭步走': 'Trap Bar Walking Lunge',
    '啞鈴臀推': 'Dumbbell Hip Thrust',
    '啞鈴單腿臀推': 'Dumbbell Single-Leg Hip Thrust',
    '滑輪側踢腿': 'Cable Hip Abduction',
    '機械後踢腿': 'Machine Glute Kickback',
    '機械側踢腿': 'Machine Hip Abduction',
    '啞鈴側弓箭步': 'Dumbbell Lateral Lunge',
    '啞鈴單側跪姿肩推': 'Half-Kneeling Single-Arm Dumbbell Press',
    '槓片單側跪姿肩推': 'Half-Kneeling Single-Arm Plate Press',
    '槓鈴暫停肩推': 'Paused Barbell Shoulder Press',
    '槓鈴架上肩推': 'Barbell Pin Press',
    '站姿滑輪側平舉': 'Standing Cable Lateral Raise',
    '滑輪單邊後束飛鳥': 'Single-Arm Cable Rear Delt Fly',
    '機械側平舉': 'Machine Lateral Raise',
    '坐姿啞鈴前平舉': 'Seated Dumbbell Front Raise',
    '啞鈴單邊後束肩旋': 'Single-Arm Dumbbell Rear Delt Raise',
    '半俯身側平舉': 'Leaning Dumbbell Lateral Raise',
    '蝴蝶機單側後束飛鳥': 'Single-Arm Reverse Pec Deck Fly',
    '單側繩索三頭下壓': 'Single-Arm Cable Tricep Pushdown',
    '單側三頭下壓': 'Single-Arm Tricep Pushdown',
    '單側繩索過頭臂屈伸': 'Single-Arm Overhead Cable Tricep Extension',
    '單臂手提箱深蹲': 'Single-Arm Suitcase Squat',
    '懸掛抬腿（負重）': 'Weighted Hanging Leg Raise',
    '機械側捲腹': 'Machine Oblique Crunch',
    '坐姿槓片提踵': 'Seated Plate Calf Raise',
}

# existing 66 en→zh (from src/i18n/strings.ts zh.exercise)
EXISTING_EN_ZH = {
 'Bench Press':'槓鈴臥推','Push-up':'伏地挺身','Incline Bench Press':'上斜槓鈴臥推','Decline Bench Press':'下斜槓鈴臥推',
 'Dumbbell Bench Press':'啞鈴臥推','Incline Dumbbell Press':'上斜啞鈴臥推','Cable Crossover':'繩索夾胸','Dumbbell Fly':'啞鈴飛鳥',
 'Chest Dip':'雙槓臂屈伸','Machine Chest Press':'機械臥推','Assisted Dip':'輔助雙槓臂屈伸','Deadlift':'硬舉',
 'Barbell Row':'槓鈴划船','Pull-up':'引體向上','Lat Pulldown':'滑輪下拉','Seated Cable Row':'坐姿划船','T-bar Row':'T 槓划船',
 'Dumbbell Row':'啞鈴划船','Chin-up':'反握引體向上','Rack Pull':'架上拉','Hyperextension':'山羊挺身','Assisted Pull-up':'輔助引體向上',
 'Back Squat':'槓鈴深蹲','Front Squat':'前蹲','Bulgarian Split Squat':'保加利亞分腿蹲','Leg Press':'腿推機','Leg Extension':'腿伸展',
 'Leg Curl':'腿彎舉','Lunge':'弓箭步','Goblet Squat':'高腳杯深蹲','Hip Thrust':'臀推','Glute Bridge':'臀橋','Cable Kickback':'繩索後踢腿',
 'Sumo Deadlift':'相撲硬舉','Romanian Deadlift':'羅馬尼亞硬舉','Overhead Press':'肩推','Dumbbell Shoulder Press':'啞鈴肩推',
 'Lateral Raise':'側平舉','Front Raise':'前平舉','Rear Delt Fly':'後束飛鳥','Arnold Press':'阿諾推舉','Upright Row':'直立划船',
 'Barbell Shrug':'槓鈴聳肩','Dumbbell Shrug':'啞鈴聳肩','Face Pull':'面拉','Barbell Curl':'槓鈴彎舉','Dumbbell Curl':'啞鈴彎舉',
 'Hammer Curl':'錘式彎舉','Preacher Curl':'牧師椅彎舉','Cable Curl':'繩索彎舉','Tricep Pushdown':'三頭下壓','Skull Crusher':'仰卧臂屈伸',
 'Overhead Tricep Extension':'過頭三頭伸展','Close-grip Bench Press':'窄握臥推','Bench Dip':'板凳撐體','Standing Calf Raise':'站姿提踵',
 'Seated Calf Raise':'坐姿提踵','Donkey Calf Raise':'驢式提踵','Wrist Curl':'腕屈','Reverse Wrist Curl':'反向腕屈','Plank':'棒式',
 'Crunch':'捲腹','Hanging Leg Raise':'懸吊舉腿','Russian Twist':'俄羅斯轉體','Cable Wood Chop':'繩索斜砍','Pallof Press':'帕洛夫推',
}


def ex_id(n: int) -> str:
    return f"00000000-0000-4000-8000-{n:012x}"


def existing_en_to_id():
    src = open(SEED_V006, encoding='utf-8').read()
    pairs = re.findall(r"exId\((\d+)\),\s*name:\s*'([^']+)'", src)
    return {name: ex_id(int(n)) for n, name in pairs}


def load_type_of(e):
    if e.get('load_type'):
        return e['load_type']
    zh = e['zh']
    if '（輔助）' in zh:
        return 'assisted'
    if '（負重）' in zh:
        return 'loaded'
    if '（自重）' in zh:
        return 'bodyweight'
    if e['equip_zh'] == '自重':
        return 'bodyweight'
    return 'loaded'


def main():
    m = json.load(open(CURATED, encoding='utf-8'))
    en_to_id = existing_en_to_id()
    assert len(en_to_id) == 66, f"expected 66 existing, got {len(en_to_id)}"
    zh_to_id = {EXISTING_EN_ZH[en]: i for en, i in en_to_id.items()}
    existing_zh = set(zh_to_id)
    cur_zh = set(e['zh'] for e in m)

    # sanity: equipment + part enums
    for e in m:
        assert e['equip_zh'] in ENUM, f"bad equip {e['equip_zh']} on {e['zh']}"
        assert e['part'] in PART_TO_MG, f"bad part {e['part']} on {e['zh']}"

    # classify curated
    new_seeds = []       # 206
    media_update = []     # (id, media_key)  24
    next_id = 67
    for e in m:
        zh = e['zh']
        if zh in existing_zh:  # reuse — update media on existing row
            assert e['img'] == 'real', f"reuse must be real: {zh}"
            media_update.append((zh_to_id[zh], e['id']))
        else:  # new insert
            eid = ex_id(next_id); next_id += 1
            # DB name = zh for ALL new entries (placeholders have no en anyway;
            # using zh uniformly keeps the i18n key Chinese → CANNOT collide with
            # the existing 66's English i18n keys, dodging TS1117 dup-key errors).
            new_seeds.append({
                'id': eid, 'name': zh, 'zh': zh,
                'en_display': e['en'],  # FE-DB English (real) for en.exercise map; None for placeholder
                'load_type': load_type_of(e),
                'muscle_group_id': PART_TO_MG[e['part']],
                'equipment': e['equip_zh'],
                'media_key': e['id'] if e['img'] == 'real' else None,
            })

    # archive = existing-only minus the 3 kept
    existing_only = existing_zh - cur_zh
    archive_zh = sorted(existing_only - KEEP_ACTIVE)
    archive_ids = [zh_to_id[z] for z in archive_zh]

    # require map: all real ids (= 24 reuse + 143 new-real)
    real_keys = [e['id'] for e in m if e['img'] == 'real']

    # ---- asserts ----
    assert len(media_update) == 24, len(media_update)
    assert len(new_seeds) == 206, len(new_seeds)
    assert len(archive_zh) == 39, (len(archive_zh), archive_zh)
    assert len(real_keys) == 167, len(real_keys)
    assert (existing_only & KEEP_ACTIVE) == KEEP_ACTIVE, "kept-3 must be existing-only"
    real_in_new = sum(1 for s in new_seeds if s['media_key'])
    assert real_in_new == 143, real_in_new

    # ---- emit seed TS ----
    def s(x):  # TS string literal
        return "'" + x.replace("\\", "\\\\").replace("'", "\\'") + "'"

    lines = []
    lines.append("/**")
    lines.append(" * v028 seed — Exercise media library bundling (Free Exercise DB curation).")
    lines.append(" *")
    lines.append(" * GENERATED by docs/exercise-media-import/build_seed.py from curated-master.json.")
    lines.append(" * Do not hand-edit; re-run the generator after editing curated-master.json.")
    lines.append(" *")
    lines.append(" * Reconciliation (grill 2026-06-24, C 折衷 + 只留 3 獨有):")
    lines.append(" *   - NEW_EXERCISE_SEEDS    : 206 curated-only → INSERT new exId(67..272).")
    lines.append(" *   - MEDIA_UPDATE_EXISTING : 24 同名 → UPDATE media_path on existing built-in id.")
    lines.append(" *   - ARCHIVE_EXISTING_IDS  : 39 existing-only superseded → is_archived = 1.")
    lines.append(" *   - 3 existing-only kept active (no media): 山羊挺身 / 板凳撐體 / 驢式提踵.")
    lines.append(" *")
    lines.append(" * media_key is the Free-Exercise-DB folder id = key into EXERCISE_MEDIA")
    lines.append(" * (src/db/seed/exerciseMediaMap.ts). NULL = placeholder (hash-color thumb).")
    lines.append(" */")
    lines.append("import { type Equipment } from '../../domain/exercise/types';")
    lines.append("")
    lines.append("export interface ExerciseMediaSeed {")
    lines.append("  id: string;")
    lines.append("  /** zh name (all new entries; en display is resolved via i18n en.exercise). */")
    lines.append("  name: string;")
    lines.append("  load_type: 'loaded' | 'bodyweight' | 'assisted';")
    lines.append("  muscle_group_id: string;")
    lines.append("  equipment: Equipment;")
    lines.append("  /** key into EXERCISE_MEDIA; null = placeholder. */")
    lines.append("  media_key: string | null;")
    lines.append("}")
    lines.append("")
    lines.append("export const NEW_EXERCISE_SEEDS: ReadonlyArray<ExerciseMediaSeed> = [")
    for s_ in new_seeds:
        mk = s(s_['media_key']) if s_['media_key'] else 'null'
        lines.append(
            "  { id: %s, name: %s, load_type: %s, muscle_group_id: %s, equipment: %s, media_key: %s }," % (
                s(s_['id']), s(s_['name']), s(s_['load_type']),
                s(s_['muscle_group_id']), s(s_['equipment']), mk,
            ))
    lines.append("];")
    lines.append("")
    lines.append("/** [existing built-in id, media_key] — give a same-named built-in its real photo. */")
    lines.append("export const MEDIA_UPDATE_EXISTING: ReadonlyArray<readonly [string, string]> = [")
    for eid, key in media_update:
        lines.append("  [%s, %s]," % (s(eid), s(key)))
    lines.append("];")
    lines.append("")
    lines.append("/** existing built-in ids superseded by curated variants → is_archived = 1. */")
    lines.append("export const ARCHIVE_EXISTING_IDS: ReadonlyArray<string> = [")
    for z, eid in zip(archive_zh, archive_ids):
        lines.append("  %s, // %s" % (s(eid), z))
    lines.append("];")
    lines.append("")
    open('src/db/seed/v028ExerciseMediaLibrary.ts', 'w', encoding='utf-8').write('\n'.join(lines))

    # ---- emit require map ----
    rl = []
    rl.append("/**")
    rl.append(" * Static require map for bundled exercise media (Free Exercise DB).")
    rl.append(" * GENERATED by docs/exercise-media-import/build_seed.py.")
    rl.append(" *")
    rl.append(" * Metro cannot dynamic-require — every asset path must be a literal here.")
    rl.append(" * Key = Free-Exercise-DB folder id (= exercise.media_path). Value = [startFrame, endFrame]")
    rl.append(" * (assets/exercise-media/<id>/0.jpg start, 1.jpg end) for the 2-frame crossfade.")
    rl.append(" */")
    rl.append("export type MediaPair = readonly [number, number];")
    rl.append("")
    rl.append("export const EXERCISE_MEDIA: Readonly<Record<string, MediaPair>> = {")
    for k in real_keys:
        rl.append("  %s: [require('../../../assets/exercise-media/%s/0.jpg'), require('../../../assets/exercise-media/%s/1.jpg')]," % (s(k), k, k))
    rl.append("};")
    rl.append("")
    rl.append("/** Resolve a stored media_path key → [startFrame, endFrame] module refs, or null. */")
    rl.append("export function resolveExerciseMedia(key: string | null | undefined): MediaPair | null {")
    rl.append("  if (!key) return null;")
    rl.append("  return EXERCISE_MEDIA[key] ?? null;")
    rl.append("}")
    rl.append("")
    open('src/db/seed/exerciseMediaMap.ts', 'w', encoding='utf-8').write('\n'.join(rl))

    # ---- emit i18n splice blocks (143 real-new) ----
    # DB name = zh. tests/i18n/strings.test.ts asserts zh.exercise keys === en.exercise
    # keys (shape-invariant) → add the SAME 143 zh keys to BOTH maps:
    #   zh.exercise: zh → zh (identity; zh-locale display).
    #   en.exercise: zh → FE-DB English (en-locale display).
    # Keys are Chinese → cannot collide with the existing 66 English keys.
    # Placeholders (63) get NO entry in either map (parity holds) → tExercise
    # fallback returns zh in both locales (acceptable for niche variants).
    zh_block = []
    en_block = []
    for s_ in new_seeds:
        if s_['media_key'] and s_['en_display']:
            zh_block.append("      %s: %s," % (s(s_['zh']), s(s_['zh'])))
            en_block.append("      %s: %s," % (s(s_['zh']), s(s_['en_display'])))
    open('/tmp/i18n_zh_block.txt', 'w', encoding='utf-8').write('\n'.join(zh_block) + '\n')
    open('/tmp/i18n_en_block.txt', 'w', encoding='utf-8').write('\n'.join(en_block) + '\n')

    # Placeholder entries (63): no DB en → hand-mapped PLACEHOLDER_EN so en-locale
    # shows English (not 中英混雜). zh→zh identity + zh→English, both maps (parity).
    ph_zh = sorted(s_['zh'] for s_ in new_seeds if not s_['media_key'])
    missing_en = [z for z in ph_zh if z not in PLACEHOLDER_EN]
    assert not missing_en, f"PLACEHOLDER_EN missing: {missing_en}"
    ph_zh_block = ["      %s: %s," % (s(z), s(z)) for z in ph_zh]
    ph_en_block = ["      %s: %s," % (s(z), s(PLACEHOLDER_EN[z])) for z in ph_zh]
    open('/tmp/i18n_ph_zh.txt', 'w', encoding='utf-8').write('\n'.join(ph_zh_block) + '\n')
    open('/tmp/i18n_ph_en.txt', 'w', encoding='utf-8').write('\n'.join(ph_en_block) + '\n')

    print("OK")
    print(f"  NEW_EXERCISE_SEEDS    = {len(new_seeds)} (143 real + 63 placeholder)")
    print(f"  MEDIA_UPDATE_EXISTING = {len(media_update)}")
    print(f"  ARCHIVE_EXISTING_IDS  = {len(archive_zh)}")
    print(f"  require map keys      = {len(real_keys)}")
    print(f"  i18n real adds        = {len(zh_block)} (→ /tmp/i18n_zh_block.txt + en_block.txt)")
    print(f"  i18n placeholder adds = {len(ph_zh_block)} (→ /tmp/i18n_ph_zh.txt + ph_en.txt)")
    print(f"  exId range new        = {ex_id(67)} .. {ex_id(67+len(new_seeds)-1)}")
    print(f"  KEEP active (no arch) = {sorted(KEEP_ACTIVE)}")


if __name__ == '__main__':
    main()
