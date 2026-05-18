---
name: simulator-db-query
description: Directly query iOS Simulator's SQLite file to diagnose UI vs DB state mismatch. Use when user reports a UI bug that might actually be data state issue (e.g. "X 應該顯示 Y 卻顯示 Z", "資料消失了", "兩個地方顯示不一致"), or when verifying a schema migration / backfill landed correctly on user's real DB before launching code-fix overnight.
---

# Simulator DB Query — TrainingLog iOS dev DB direct access

當用戶報告「UI 顯示不對」、「資料不見」、「兩處顯示不一致」時，**先直接 query simulator 的 SQLite 檔對比實際資料**，再決定是 code bug、UI 沒 refresh 還是 user data issue。**比讀 code 推測快 10×**。

## When to use

- 用戶 smoke test 報「歷史/列表/卡片顯示異常」
- 用戶說「資料消失」、「count 不對」、「兩個地方對同 entity 給不同數字」
- 你剛改 schema (migration vN) → 想驗 user's real DB 是否正確 migrate / backfill
- 你 spec 寫的 query 是否真的會回對的結果（拿 production data 跑一次比寫 test fixture 還快）

## When NOT to use

- 純 logic bug、UI render 問題（純 React state）— 沒 DB 的事
- 用戶在 production device（不是 simulator）— 拿不到 DB 檔
- 用戶用 expo-go fresh install — DB 是空的、查不出東西

## Step 1 — 找 DB 檔

iOS Simulator app 沙箱路徑（Expo 開發環境）：

```bash
find ~/Library/Developer/CoreSimulator/Devices \
  -path "*ExponentExperienceData/@anonymous/TrainingLog*" \
  -name "traininglog.db" 2>/dev/null
```

通常有多個（不同 device UUID）。看 `ls -la` 的修改時間挑最新的那個 — 就是用戶當前在用的 simulator。

固定 export 成 env var 方便後續：
```bash
DB="/Users/.../SQLite/traininglog.db"
```

## Step 2 — 對症下藥的查法

### 對「count 不對」/「兩處顯示不一致」

對比兩個 repo 的 query：
```bash
# 假設 UI 顯示 N，找出兩個 query 的差異
echo "=== A query (e.g. library count) ==="
sqlite3 "$DB" "SELECT COUNT(DISTINCT session_id) FROM \"set\" WHERE exercise_id = '...' AND is_skipped = 0;"
echo "=== B query (e.g. history header) ==="
sqlite3 "$DB" "SELECT COUNT(DISTINCT session_id) FROM \"set\" WHERE exercise_id = '...' AND is_skipped = 0 AND is_logged = 1;"
```

→ 若兩 query 結果不同 → 是 spec 不一致 bug（兩個 repo 對「次數」定義不同），不是 stale state。

### 對「資料消失」

```bash
echo "=== 該 entity 在 DB 還在嗎 ==="
sqlite3 "$DB" "SELECT * FROM session WHERE id = '...';"
# 若 row 沒了 → 被 delete/cascade 了，不是 UI 沒 refresh
```

### 對「migration 是否正確 apply」

```bash
echo "=== schema version ==="
sqlite3 "$DB" "PRAGMA user_version;"
echo "=== table 該欄位是否存在 ==="
sqlite3 "$DB" "PRAGMA table_info(\"set\");"
echo "=== backfill 結果驗證 ==="
sqlite3 "$DB" "SELECT COUNT(*) FROM \"set\" WHERE session_exercise_id IS NULL;"
```

### 對「UI render 邏輯有沒有 bug」

跑 page 實際用的 SQL（複製 repo function 的 SQL 直接執行），對比 UI 顯示：
- SQL 結果 ≠ UI → page 內 React/filter 邏輯 bug
- SQL 結果 = UI → query 本身或 spec 問題

## Step 3 — 直接 backfill / fix DB（小心）

如果 user 同意「動 simulator DB 修 test data」：

```bash
sqlite3 "$DB" "UPDATE \"set\" SET is_logged = 1
  WHERE is_skipped = 0
    AND is_logged = 0
    AND session_id IN (SELECT id FROM session WHERE ended_at IS NOT NULL);"
```

**規則**：
- **永遠**先跑 SELECT 看「即將 UPDATE 多少 row」
- **永遠** WHERE clause 排除 active session（`ended_at IS NULL`）— 不要動用戶 in-progress 的資料
- backfill 後再跑 SELECT 確認生效
- 告訴用戶 reload simulator 才會看到效果（expo-sqlite cache 一輪）

## 常見 schema 速查

- **`set` table**: `(id, session_id, exercise_id, weight_kg, reps, is_skipped, ordering, created_at, set_kind, parent_set_id, is_logged, notes, session_exercise_id)` — v019 加 session_exercise_id (slice 10c #17 isolation)
- **`session` table**: `(id, started_at, ended_at, bodyweight_snapshot_kg, healthkit_workout_uuid, avg_hr_bpm, kcal)` — `ended_at IS NULL` = active session
- **`session_exercise` table**: `(id, session_id, exercise_id, ordering, planned_sets, ..., parent_id, reusable_superset_id, rest_sec)` — parent_id 非 NULL = cluster B side
- **`exercise` table**: seed UUIDs 是 `00000000-0000-4000-8000-...` pattern；user-created 用 random UUID

## Anti-patterns

- ❌ 沒查 DB 直接讀 code 推測「為什麼 UI 顯示 0」 → 浪費 15-30 min 抓不到 root cause
- ❌ 改 simulator DB 沒先告訴用戶 → 用戶 reload 後看到「莫名變化」會懷疑 code bug
- ❌ UPDATE 沒排 active session → 把用戶當前 ✓ 進度搞亂
- ❌ 把 simulator DB diagnostic 結果當「production 真實情況」報給用戶 → simulator data 是 test fixture，跟 user 真實使用無關
- ❌ 沒記 device UUID 直接查所有 .db 檔 → 撈到 stale 的不正確結論

## Related skills

- `diagnose` (Matt Pocock's, generic) — meta 層的 debugging discipline；本 skill 是 TrainingLog-specific 的 step 1「build a feedback loop」實作之一
- `polish-loop` (project) — overnight wave 流程；本 skill 通常在 polish-loop 的 round 2-3「Quick explore」階段啟用
