# ADR-0018: Session-side cluster grouping schema (v014)

Status: accepted (2026-05-15 grill)

## Context

ADR-0017 (Reusable Superset entity + slice 9.6→9.8c) shipped cluster identity on the **planning side** (`template_exercise.parent_id` v009 + `template_exercise.reusable_superset_id` v013). It left the **session side** untouched: `session_exercise` (v003) has no `parent_id` and no `reusable_superset_id`, and `snapshotForSession` does not copy cluster structure from the source template into the session snapshot.

Three downstream symptoms emerged when the slice 9.8c data layer landed:

1. **Session detail page is cluster-blind** — `app/session/[id].tsx` reads sets via `listSetsBySession()` flat and renders them as a single ordered list. Templated clusters (both RS-explode and ADR-0016 manual) render as two independent solos. The page has been wrong since slice 6 templated cluster shipped, but the regression was invisible until the dedicated RS history page (9.8c) made the inconsistency stark.
2. **`queryReusableSupersetHistory` walks a brittle indirection** — to associate a logged set with the RS it was performed under, it must JOIN `set → session_exercise.template_id → template_exercise WHERE reusable_superset_id = ?`. The function header (`exerciseHistoryRepository.ts:382-403`) self-documents three breakage modes: template edited after snapshot, RS deleted (`ON DELETE SET NULL`), and freestyle sessions (`session_exercise.template_id IS NULL`).
3. **Freestyle / ad-hoc clusters cannot be recorded at all** — the user reported three real situations where they superset exercises without a template path: (i) pure freestyle session, (ii) Session Split's extras-becomes-freestyle flow (ADR-0006), (iii) templated session with on-the-fly cross-pairing. Volume is "偶爾" in all three, but cumulatively non-trivial and unrepresentable today.

The session-side cluster gap is therefore not a freestyle-only concern — it is a **first-class data fidelity gap** that has been silently accumulating since templated clusters shipped.

## Decision

Add `parent_id` and `reusable_superset_id` columns to `session_exercise` (v014), fix `snapshotForSession` to copy cluster structure forward (with `parent_id` remap), backfill historic data with a conservative skip-on-ambiguity rule, and amend `queryReusableSupersetHistory` to consume the new columns with the existing indirection as fallback.

### v014 schema (decision **Z2**)

```sql
ALTER TABLE session_exercise ADD COLUMN parent_id TEXT;
ALTER TABLE session_exercise ADD COLUMN reusable_superset_id TEXT
  REFERENCES superset(id) ON DELETE SET NULL;
```

- `parent_id TEXT NULL` — no FK constraint, matching `template_exercise.parent_id` (v009) convention. Points to another `session_exercise.id` within the same session.
- `reusable_superset_id TEXT NULL` — FK to `superset(id)` with `ON DELETE SET NULL`, matching the v013 pattern on `template_exercise`. NULL = manual / ad-hoc cluster (no RS identity); NOT NULL = cluster sourced from a Reusable Superset (templated explode path). （**2026-05-16 Q7 修訂**：NULL 語意只剩 backfill β'-skipped 場景；ad-hoc cluster 模型撤銷（session 中沒有手動標記 cluster 的 affordance）。見 ADR-0019 § Q7）
- **No index initially**. Read pattern is `listSetsBySession` (bounded N per session) followed by in-memory grouping. Add `idx_session_exercise_rs` only if the `queryReusableSupersetHistory` augment path becomes slow.
- **Idempotency**: `PRAGMA table_info(session_exercise)` introspection before each `ADD COLUMN`, matching the v013 pattern.

### `snapshotForSession` fix (decision **Q4.1**)

`src/domain/template/templateManager.ts:snapshotForSession` currently drops `parent_id`. Replace its single-pass `.map()` with a two-pass remap:

```ts
// Pass 1: allocate new UUIDs, build oldId → newId map, copy non-self-referencing fields
const idMap = new Map<string, string>();
const out: SessionExerciseSnapshot[] = [];
for (const ex of sorted) {
  const newId = args.uuid();
  idMap.set(ex.id, newId);
  out.push({
    id: newId,
    session_id: args.session_id,
    exercise_id: ex.exercise_id,
    ordering: out.length + 1,
    planned_sets: ex.default_sets,
    planned_reps: ex.default_reps,
    planned_weight_kg: ex.default_weight_kg,
    template_id: args.template.id,
    is_evergreen: ex.is_evergreen,
    parent_id: null,                              // resolved in pass 2
    reusable_superset_id: ex.reusable_superset_id ?? null,
  });
}
// Pass 2: resolve parent_id against the new UUID space
for (let i = 0; i < sorted.length; i++) {
  const oldParent = sorted[i].parent_id;
  if (oldParent === null) continue;
  const newParent = idMap.get(oldParent);
  if (!newParent) {
    throw new Error(
      `snapshotForSession: dangling parent_id ${oldParent} in template ${args.template.id}`
    );
  }
  out[i].parent_id = newParent;
}
return out;
```

- `reusable_superset_id` is a foreign id pointing to `superset.id` — no remap, direct copy from `template_exercise`.
- **`throw` on dangling parent_id** rather than silently falling back to `null`. A dangling reference is a data-integrity violation; the snapshot path must scream rather than emit half-broken cluster structure that future readers will trust.

### v014 backfill (decision **β'** — skip-on-ambiguity)

Backfill historic sessions in the same migration. For every `session_exercise` row whose `template_id` is not NULL, copy `parent_id` (via two-step remap) and `reusable_superset_id` from the matching `template_exercise`. **Skip entire templates that have ambiguous mapping** — defined as any template where a single `exercise_id` appears in more than one `template_exercise` row.

```sql
-- Step 0: identify ambiguous templates (skip these from backfill entirely)
WITH ambiguous_templates AS (
  SELECT template_id
  FROM template_exercise
  GROUP BY template_id, exercise_id
  HAVING COUNT(*) > 1
)
-- Step 1: backfill reusable_superset_id (no remap; foreign id)
UPDATE session_exercise AS se
SET reusable_superset_id = (
  SELECT te.reusable_superset_id
  FROM template_exercise te
  WHERE te.template_id = se.template_id
    AND te.exercise_id = se.exercise_id
  ORDER BY te.ordering ASC
  LIMIT 1
)
WHERE se.template_id IS NOT NULL
  AND se.template_id NOT IN (SELECT template_id FROM ambiguous_templates);

-- Step 2: backfill parent_id (remap te.parent_id → session-side se.id)
UPDATE session_exercise AS se
SET parent_id = (
  SELECT se_parent.id
  FROM template_exercise te_self
  JOIN template_exercise te_parent ON te_parent.id = te_self.parent_id
  JOIN session_exercise se_parent
    ON se_parent.session_id = se.session_id
   AND se_parent.exercise_id = te_parent.exercise_id
  WHERE te_self.template_id = se.template_id
    AND te_self.exercise_id = se.exercise_id
  ORDER BY te_self.ordering ASC
  LIMIT 1
)
WHERE se.template_id IS NOT NULL
  AND se.template_id NOT IN (SELECT template_id FROM ambiguous_templates);
```

**Failure mode contract**:
- Templates with a duplicate `exercise_id` row (rare; happens when a user adds the same exercise twice to one template) → all sessions sourced from those templates keep `parent_id = NULL`, `reusable_superset_id = NULL` → render flat in session detail and fall through to the indirection path on `queryReusableSupersetHistory`.
- This is **strictly preferable to mislabeling**: a `LIMIT 1` strategy would have copied the cluster's RS id onto a second, unrelated occurrence of the same exercise, producing a phantom cluster that never existed.
- Failure is silent (no `console.warn`; migration runs at app start with no UI surface). The indirection fallback covers the read path.

### `queryReusableSupersetHistory` augment with fallback (decision **Q7.2 option (2)**)

Replace the single-path indirection query with a `UNION` of two paths:

```
Primary path (post-v014):
  set → session_exercise WHERE reusable_superset_id = ?

Fallback path (β'-skipped sessions and pre-backfill data integrity):
  set → session_exercise WHERE reusable_superset_id IS NULL
                          AND template_id IS NOT NULL
       → template_exercise WHERE reusable_superset_id = ?
```

The fallback covers exactly the rows that backfill skipped (ambiguous templates) — those sessions still surface on the RS history page via the legacy indirection. The dual-track exists in one read function only and naturally decays as user behavior moves forward (no new ambiguous templates produced).

### Session detail render invariants (decision **Q5 I1–I6**)

This ADR does **not** specify pixel-level UI — that is deferred to the upcoming session UI/UX redesign grill. However, six invariants are locked here so that any future UI work cannot accidentally regress v014's data model:

| # | Invariant |
|---|---|
| I1 | Cluster is visually distinct from adjacent solos (concrete means — border, tint, divider — left to UI grill) |
| I2 | Cluster A side and B side render as vertical 2-column (consistent with `/superset-history/[id]` shipped in 9.8c) |
| I3 | Pairing semantics: A.set[i] visually pairs B.set[i] (per-side ordering index — matches ADR-0017 cluster B3 / ADR-0016 cluster memory pre-fill) |
| I4 | Asymmetric set counts render as-is — no padding, no truncation |
| I5 | Each side's `load_type` is rendered independently (loaded vs bodyweight need different cells) |
| I6 | `reusable_superset_id NOT NULL` → cluster uses RS color + name; `reusable_superset_id IS NULL` → neutral "Superset" label + default color (ad-hoc) |

### Out of scope (deferred to session UI/UX grill — Q6 DEFERRED)

> **2026-05-16 Q7 修訂**：6 條 deferred 在 ADR-0019 § Q7 拍板後從 6 → 3 條。每條翻盤後狀態 marker 如下。詳見 ADR-0019 § Q7。

- ✗ Session logger affordance to mark an ad-hoc cluster mid-session (gesture / picker / multi-select) — **移除**（cluster 來源唯一性：只能從動作庫 RS picker 來，沒有 mid-session 把兩 solo 標 cluster 的 affordance）
- Cluster block tap target / interaction inside the logger — **仍需設計**（per ADR-0019 § Q3 collapsed/expanded 模型，整 cluster block 視為單一卡）
- Cluster header position (banner / vertical label) — **仍需設計**（ADR-0019 § Q8 H1：縱條 RS 色 + 上方 banner「動作 A · 動作 B」）
- ✗ Affordance to promote an ad-hoc cluster into a saved RS — **移除**（沒有 ad-hoc cluster 存在可 promote）
- Asymmetric set-count visual highlight (I4 says as-is; UI grill can decide if a highlight is helpful) — **仍需設計**（ADR-0019 § Q8 AS1：B 側「—」灰字 placeholder，不加 highlight）
- ✗ Cluster un-marking (user cancels superset intent) — **移除**（取消 cluster = ⚙️「🗑️ 刪除動作」整卡砍，無獨立「拆」操作）

These items are tracked in the post-grill handoff list and must be addressed before v014's session-logger write path lands. Until then, the **read path** (session detail + RS history) is fully functional; the **write path** for ad-hoc clusters has no UI entry yet, so ad-hoc clusters cannot be produced (only consumed if any pre-existed via developer testing). （**2026-05-16 Q7 修訂**：ad-hoc cluster write path 撤銷後永遠不需要實作；session 內想配對只能從 RS picker，沒有 ad-hoc 產生路徑。見 ADR-0019 § Q7）

## Considered alternatives (rejected)

**Z1 — `parent_id` only, no `reusable_superset_id`** — leaves RS history page on the brittle indirection forever. Marginal column cost is trivial; rejecting it sacrifices the slice 9.8c known fragility fix for no real saving.

**α — no backfill** — historic templated cluster sessions stay flat. Inconsistent with the Cd-B reframe ("fix session-side cluster blindness") that motivated the v014 scope expansion.

**β — backfill with `LIMIT 1` deterministic rule** — mislabels session_exercise rows when a template has the same exercise twice. False clusters > missing clusters by user-trust calculus; β' (skip ambiguous) wins.

**γ — keep permanent dual-path query** — `COALESCE(rs_id, indirection)` everywhere becomes tech debt scattered across all read functions. β' confines the dual-path to one function and lets it decay as user data moves forward.

**Option (1) — full rewrite of `queryReusableSupersetHistory` removing indirection** — drops β'-skipped sessions from the RS history page. Inconsistent with β'-skip's "don't lie, but don't lose" philosophy.

**ADR-0017 amendment instead of new ADR** — ADR-0017 already carries 9 amendment blocks across slices 9.6 / 9.7 / 9.8a / 9.8b; adding a 10th for session-side schema work that touches `session_exercise` (not the original ADR's exercise-library scope) muddies the document. New ADR + back-reference is cleaner.

## Consequences

- **Read path migration**: `app/session/[id].tsx` and `summarize()` need to learn cluster grouping (deferred to session UI grill but data shape is fixed by I1–I6).
- **Memory partition semantics**: Per-RS memory lookups (`queryReusableSupersetMemory`) defined in ADR-0017 Q10 amendment now have a second data source on the session side — but their READ pattern (`WHERE reusable_superset_id = ?`) already maps to the new column. The lookup function should be reviewed but is structurally compatible.
- **ADR-0017 amendment**: A pointer block added to ADR-0017 Q16 and Q10 indicating that the indirection-based path described there is superseded for new sessions by ADR-0018 (with `β'` fallback preserving compatibility).
- **CONTEXT.md**: Stale line about `template_exercise.reusable_superset_id` ("不存 FK") was already overturned in slice 9.8b; v014 work caught it. Same paragraph also extended to enumerate **session-side cluster grouping** terminology so the schema is canonicalized.
- **`session_exercise.template_id IS NULL` semantics remain**: freestyle sessions still have NULL template_id. v014 makes them **capable of carrying cluster intent** via `parent_id`, but does not auto-mark anything — the write path comes later.
- **Test coverage**: snapshotForSession 2-pass remap is a pure function, easy to TDD (dangling-parent throw, cluster-preserved, solo-preserved cases). Backfill SQL needs migration-level tests over a seeded fixture (ambiguous template skip, RS-bearing cluster restored, manual cluster restored, solo untouched).

## References

- ADR-0017 Q10 (RS entity), Q16 (RS chart), Q17 (RS detail) — planning side cluster identity
- ADR-0016 (template editor, cluster B3 pairing semantics)
- ADR-0012 (set logger schema, dropset cluster via `parent_set_id` — distinct concept from this ADR's exercise cluster)
- ADR-0013 (per-exercise notes — not directly related but shares the v013 snapshot fix pattern)
- `src/adapters/sqlite/exerciseHistoryRepository.ts:382-403` — self-documented indirection fragility
- `src/domain/template/templateManager.ts:92-111` — `snapshotForSession` to be patched

---

## 2026-05-16 Amendment — ad-hoc cluster 撤銷、cluster 來源唯一性 (ADR-0019 § Q7)

Session UI/UX integral redesign grill 拍板 cluster 來源唯一性 — session 內 cluster 化**只能**透過：(1) Template snapshot 路徑（既有 v014 schema），或 (2) `[⊕ 加動作]` → 動作庫 picker → 挑 RS（含 B1 即時新建 RS）。**Ad-hoc cluster 模型撤銷**。

### 翻盤的既有拍板

- ❌ **§ v014 schema 「NULL = manual / ad-hoc cluster (no RS identity)」語意 retract** — NULL 只剩 backfill β'-skipped 場景（template 有重複 exercise_id 導致 ambiguous mapping 被跳過的歷史 session），不作為 ad-hoc cluster 入口
- ❌ **§ Session detail render invariants I6（line 152）「`reusable_superset_id IS NULL` → neutral 『Superset』label + default color (ad-hoc)」部分翻盤** — backfill β'-skipped 場景下仍用此 fallback；session 新建路徑不再產生此狀態（write path 沒入口）
- ❌ **§ Out of scope 「Session logger affordance to mark an ad-hoc cluster mid-session」retract** — 沒有此 affordance
- ❌ **§ Out of scope 「Affordance to promote an ad-hoc cluster into a saved RS」retract** — 沒有 ad-hoc 存在可 promote
- ❌ **§ Out of scope 「Cluster un-marking」retract** — 沒有獨立「拆 cluster」操作，取消 cluster = ⚙️「🗑️ 刪除動作」整卡砍

### Q6 deferred 6 → 3

ADR-0019 § Q7 拍板後剩 3 條仍需 UI 設計（已在 ADR-0019 § Q3 + § Q8 解答）：

| 原 deferred | 翻盤後狀態 | ADR-0019 解答 |
|---|---|---|
| C-1 cluster 標記入口 | ✗ 移除 | — |
| C-2 cluster block tap target | 仍需設計 | § Q3 動作卡 collapsed/expanded |
| C-3 cluster header 位置 | 仍需設計 | § Q8 H1 縱條色 + banner |
| C-4 promote ad-hoc to RS | ✗ 移除 | — |
| C-5 asymmetric highlight | 仍需設計 | § Q8 AS1 灰字 placeholder |
| C-6 un-cluster | ✗ 移除 | — |

### 不動

- v014 schema 兩欄 (`session_exercise.parent_id` + `reusable_superset_id`) 維持
- `snapshotForSession` 兩 pass remap 維持
- β' backfill skip-on-ambiguity 維持
- `queryReusableSupersetHistory` UNION fallback 維持
- I1-I6 render invariants 維持（I6 fallback 語意僅縮窄到 backfill 場景）

### 新增 cluster 來源唯一性 (ADR-0019 § Q7)

Session 內 cluster 來源**只剩兩條**：

1. **Template snapshot 路徑**（既有）：Template-based session create 時 `snapshotForSession` 複製 cluster 結構（含 `parent_id` + `reusable_superset_id`）
2. **In-session 動作庫 RS picker 路徑**（ADR-0019 新增）：`[⊕ 加動作]` → `/library?mode=picker&targetSessionId=xxx` → 動作庫 K1 Tab 「超級組」→ tap RS card → 整 RS explode 成 2 個 `session_exercise` row 加進當前 session

詳細決策邏輯與拒絕的替代方案見 ADR-0019 § Q7。
