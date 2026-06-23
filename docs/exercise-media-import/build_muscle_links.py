#!/usr/bin/env python3
"""
One-shot generator: v028 NEW_EXERCISE_SEEDS + Free-Exercise-DB → v029 muscle links.

The v028 curated library inserted 206 new built-in exercises (exId 67..272)
carrying only `muscle_group_id` — no fine-grained `exercise_muscle` rows. The
detail-page body diagram therefore lights only the whole muscle GROUP for them
(groupFallbackHighlight in src/domain/exercise/exerciseLibrary.ts). This script
back-derives primary/secondary muscle links for those exercises from FE-DB and
emits a v029 DATA seed so the diagram lights the precise muscles instead.

Emits (into the repo):
  - src/db/seed/v029ExerciseMuscleLinks.ts  (EXERCISE_MUSCLE_LINKS)

Join (clean — no curated-master needed):
  NEW_EXERCISE_SEEDS[].media_key IS the FE-DB folder id (= dist/exercises.json
  key `id`). Look up FE-DB by id=media_key → map its primaryMuscles /
  secondaryMuscles to our 19-muscle taxonomy → emit links for seed.id.
  Placeholders (media_key == null) get no links and keep the group fallback.

FE-DB muscle → our 19-muscle taxonomy (one FE-DB muscle may expand to many):
  see FEDB_TO_OURS below. neck / abductors / adductors are UNMAPPED → dropped
  (counted in the run summary).

Rules:
  - primaryMuscles → role 'primary'; secondaryMuscles → role 'secondary'.
  - Primary wins: emit ALL primary links first, then secondary links. The
    migration's INSERT OR IGNORE on PK (exercise_id, muscle_id) keeps the
    primary and silently drops a would-be secondary downgrade (mirrors v006).
  - Dedup identical (exercise_id, muscle_id, role) rows.
  - An exercise whose FE-DB muscles all map to nothing emits zero links and
    keeps the group fallback (counted).

Inputs:
  - src/db/seed/v028ExerciseMediaLibrary.ts  (parse id + media_key pairs)
  - /tmp/fedb-exercises.json  (fetch once:
      curl -sL https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json \
        -o /tmp/fedb-exercises.json)

Pure / deterministic: no clock, no random. Re-running produces byte-identical TS.

Run from repo root:  python3 docs/exercise-media-import/build_muscle_links.py
"""
import json, os, re, sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(REPO)

SEED_V028 = 'src/db/seed/v028ExerciseMediaLibrary.ts'
FEDB = '/tmp/fedb-exercises.json'
OUT = 'src/db/seed/v029ExerciseMuscleLinks.ts'

# FE-DB muscle name → list of our muscle ids (constants from v006ExerciseLibrary.ts).
# UNMAPPED FE-DB muscles map to [] (dropped, counted): neck / abductors / adductors.
FEDB_TO_OURS = {
    'chest':        ['m-upper-chest', 'm-lower-chest'],
    'lats':         ['m-back'],
    'middle back':  ['m-back'],
    'lower back':   ['m-lower-back'],
    'traps':        ['m-trap'],
    'shoulders':    ['m-front-delt', 'm-mid-delt', 'm-rear-delt'],
    'biceps':       ['m-bicep-long', 'm-bicep-short'],
    'triceps':      ['m-tricep'],
    'forearms':     ['m-forearm'],
    'quadriceps':   ['m-quad'],
    'hamstrings':   ['m-hamstring'],
    'glutes':       ['m-upper-glute', 'm-lower-glute'],
    'calves':       ['m-calf'],
    'abdominals':   ['m-abs'],
    'neck':         [],   # UNMAPPED — drop, count
    'abductors':    [],   # UNMAPPED — drop, count
    'adductors':    [],   # UNMAPPED — drop, count
}


def parse_new_seeds():
    """Return [(exercise_id, media_key_or_None)] from the v028 seed TS."""
    ts = open(SEED_V028, encoding='utf-8').read()
    rows = re.findall(
        r"\{ id: '([^']+)', name: '[^']*',.*?media_key: (null|'[^']*') \}", ts
    )
    out = []
    for eid, mk in rows:
        out.append((eid, None if mk == 'null' else mk.strip("'")))
    return out


def main():
    if not os.path.exists(FEDB):
        sys.exit(
            f"FATAL: {FEDB} not found. Fetch it first:\n"
            "  curl -sL https://raw.githubusercontent.com/yuhonas/free-exercise-db/"
            "main/dist/exercises.json -o /tmp/fedb-exercises.json"
        )

    seeds = parse_new_seeds()
    assert len(seeds) == 206, f"expected 206 NEW_EXERCISE_SEEDS, got {len(seeds)}"

    fedb = {e['id']: e for e in json.load(open(FEDB, encoding='utf-8'))}

    links = []                 # ordered: all primaries, then all secondaries
    seen = set()               # dedup (exercise_id, muscle_id, role)
    pk_taken = set()           # (exercise_id, muscle_id) — primary already emitted

    n_null = 0                 # media_key == null (placeholder)
    n_no_fedb = 0              # media_key set but absent from FE-DB
    n_zero = 0                 # mapped to zero links (all unmapped)
    n_linked = 0               # got >= 1 link
    no_fedb_keys = []          # media_keys with no FE-DB match
    dropped = {'neck': 0, 'abductors': 0, 'adductors': 0}
    dropped_only_primary = []  # exercises that LOST their sole primary to a drop

    def emit(rows, role):
        for eid, our_ids in rows:
            for mid in our_ids:
                if role == 'secondary' and (eid, mid) in pk_taken:
                    continue   # primary wins (PK collision) — skip downgrade
                key = (eid, mid, role)
                if key in seen:
                    continue
                seen.add(key)
                if role == 'primary':
                    pk_taken.add((eid, mid))
                links.append((eid, mid, role))

    # First pass per exercise: build primary + secondary our-id lists, count drops.
    per_ex = []  # (eid, [primary our ids], [secondary our ids], had_link)
    for eid, mk in seeds:
        if mk is None:
            n_null += 1
            continue
        e = fedb.get(mk)
        if e is None:
            n_no_fedb += 1
            no_fedb_keys.append(mk)
            continue

        prim_fedb = e.get('primaryMuscles', [])
        sec_fedb = e.get('secondaryMuscles', [])

        prim_ours, sec_ours = [], []
        dropped_a_primary = False
        kept_a_primary = False
        for fm in prim_fedb:
            ours = FEDB_TO_OURS.get(fm)
            if ours is None:
                sys.exit(f"FATAL: unknown FE-DB muscle {fm!r} on {mk} — extend FEDB_TO_OURS")
            if not ours:
                dropped[fm] += 1
                dropped_a_primary = True
            else:
                kept_a_primary = True
                prim_ours.extend(ours)
        for fm in sec_fedb:
            ours = FEDB_TO_OURS.get(fm)
            if ours is None:
                sys.exit(f"FATAL: unknown FE-DB muscle {fm!r} on {mk} — extend FEDB_TO_OURS")
            if not ours:
                dropped[fm] += 1
            else:
                sec_ours.extend(ours)

        if dropped_a_primary and not kept_a_primary:
            dropped_only_primary.append((eid, mk))

        per_ex.append((eid, prim_ours, sec_ours))

    # Emit primaries across ALL exercises first, then secondaries (primary-wins).
    emit([(eid, p) for eid, p, _ in per_ex], 'primary')
    emit([(eid, s) for eid, _, s in per_ex], 'secondary')

    # Per-exercise linked / zero tally (an exercise is linked iff it owns >=1 row).
    linked_ex = set(eid for eid, _, _ in links)
    for eid, p, s in per_ex:
        if eid in linked_ex:
            n_linked += 1
        else:
            n_zero += 1

    # ---- emit TS ----
    def s(x):
        return "'" + x.replace("\\", "\\\\").replace("'", "\\'") + "'"

    out = []
    out.append("/**")
    out.append(" * v029 seed — fine-grained exercise_muscle links for the v028 curated library.")
    out.append(" *")
    out.append(" * GENERATED by docs/exercise-media-import/build_muscle_links.py from")
    out.append(" * src/db/seed/v028ExerciseMediaLibrary.ts + Free-Exercise-DB exercises.json.")
    out.append(" * Do not hand-edit; re-run the generator to regenerate.")
    out.append(" *")
    out.append(" * Each NEW_EXERCISE_SEED with a media_key (= FE-DB folder id) gets its FE-DB")
    out.append(" * primary/secondary muscles mapped to our 19-muscle taxonomy. Primary rows")
    out.append(" * come first so the migration's INSERT OR IGNORE (PK exercise_id,muscle_id)")
    out.append(" * keeps primary over a would-be secondary downgrade (mirrors v006).")
    out.append(" */")
    out.append("export interface ExerciseMuscleLinkSeed {")
    out.append("  exercise_id: string;")
    out.append("  muscle_id: string;")
    out.append("  role: 'primary' | 'secondary';")
    out.append("}")
    out.append("")
    out.append("export const EXERCISE_MUSCLE_LINKS: ReadonlyArray<ExerciseMuscleLinkSeed> = [")
    for eid, mid, role in links:
        out.append("  { exercise_id: %s, muscle_id: %s, role: %s }," % (s(eid), s(mid), s(role)))
    out.append("];")
    out.append("")
    open(OUT, 'w', encoding='utf-8').write('\n'.join(out))

    n_primary = sum(1 for _, _, r in links if r == 'primary')
    n_secondary = sum(1 for _, _, r in links if r == 'secondary')

    print("OK ->", OUT)
    print(f"  NEW_EXERCISE_SEEDS         = {len(seeds)} (206: 143 keyed + 63 placeholder)")
    print(f"  exercises with >=1 link    = {n_linked}")
    print(f"  exercises -> group fallback = {n_null + n_no_fedb + n_zero}"
          f"  (null={n_null}, no-FE-DB-match={n_no_fedb}, all-unmapped={n_zero})")
    print(f"  total link rows            = {len(links)}  (primary={n_primary}, secondary={n_secondary})")
    print(f"  dropped unmapped FE-DB muscles = {dropped} (total {sum(dropped.values())})")
    if no_fedb_keys:
        print(f"  media_keys with NO FE-DB match: {no_fedb_keys}")
    if dropped_only_primary:
        print(f"  exercises whose SOLE primary was dropped (now secondary-only or fallback): {dropped_only_primary}")


if __name__ == '__main__':
    main()
