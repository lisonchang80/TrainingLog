---
name: Watch view spec freeze into ADR-0019
description: 把 ASCII mock 迭代收斂出來的 Watch view spec 凍結成 ADR-0019 的 section、commit + push。Trigger 詞：「freeze 進 ADR-0019」/「凍結 spec」/「進 ADR」（在 Watch view mock 迭代完成後）。涉及檔案：docs/adr/0019-session-ui-ux-integral-redesign.md
---

# Watch view spec freeze into ADR-0019

當 Watch view 的 ASCII mock iteration（per `feedback_watch_ui_reference.md`）收斂後，user 通常會說「freeze 進 ADR-0019」或「進 ADR」。這個 skill 把對話累積的 spec 一次性凍結成 ADR-0019 結尾的新 section、不需要再多輪 grilling。

## When to trigger

User 明確說：
- 「freeze 進 ADR-0019」
- 「凍結 spec」
- 「進 ADR」/「進 ADR-0019」
- 「進 ADR-0019（仿 D11/D8/D14 模式）」

通常前置條件：
- ≥3 輪 ASCII mock iteration
- 至少 N 條 ambiguity question 已 lock
- User 主動表示收斂（不再 ask 更多）

## When NOT to use

- Spec 還在 iteration 中、user 沒 explicit 收斂
- 非 Watch view（如 iPhone view、ADR 設計決策）— 用 grill-with-docs / feature-decision-sweep 較合適
- 跨多個 view 的 spec（一次只凍結一個 view）

## Recipe

### Step 1 — 確認 spec 完整度

凍結前心裡 checklist（不需要每條都問 user、只是內心過一遍）：
- View 結構（all visual variants 都畫過）
- Interaction rules（gestures / state transitions）
- Edge cases（empty state / error state / loading）
- Excluded 範圍（什麼不做）

如果有明顯漏洞 → 先問 1-2 條補完、不要硬凍結。

### Step 2 — 找 insertion point

ADR-0019 結構：所有 spec freeze section 都 append 在文末、緊接前一個 frozen view section 後面。

```bash
tail -10 docs/adr/0019-session-ui-ux-integral-redesign.md
```

確認上一個 section 結尾、用 Edit 工具 append 新 section（不要用 Write 整檔覆寫）。

### Step 3 — 寫新 section（標準結構模板）

每個 D# section 共用結構（用 markdown level 2 ## header）：

```markdown
---

## Slice 13d D{N} {view 中文名} Spec（凍結 YYYY-MM-DD）

**Status**: Spec frozen — ASCII mock {X} 輪迭代收斂、待 SwiftUI 動工
**Depends on**: D{N-?} ({依賴 spec ✅/⏳}) / ...
**Blocks**: D{N+?} ({下游 view}) impl
**Iteration log**: chat session YYYY-MM-DD、{X} 輪 mock v1→v{X}

### Overview

{1-2 段、view 的目的 + 跟其他 view 的關係 + 關鍵約束}

### View anatomy

#### {Visual variant 1 名稱}

\```
{ASCII mock}
\```

{該 variant 的說明、tile/region 對應}

#### {Visual variant 2 名稱}
...

### Interaction rules

#### {Rule group 1}

| Trigger | Action |
|---|---|
| ... | ... |

#### {Rule group 2}
...

### State transition table（如適用）

| From | Trigger | To | Side effect |
|---|---|---|---|
| ... | ... | ... | ... |

### Excluded（不做）

- ❌ {item 1 + reason}
- ❌ {item 2 + reason}

### Decisions captured（{X} 輪 ASCII mock iteration log）

| 輪次 | 主要決策 |
|---|---|
| v1 | ... |
| v{X} | ... |
| 收尾 | ... |
```

關鍵欄位：
- **Status**: 永遠 `Spec frozen — ASCII mock N 輪迭代收斂、待 SwiftUI 動工`
- **Depends / Blocks**: 標明上下游、用 ✅/⏳ marker
- **Iteration log**: 帶日期 + 輪次
- **Excluded**: 重要、列出 user 明確 reject 或 deferred 的功能、防止下次回來再問

### Step 4 — Commit + Push

Commit message 標準格式：

```
docs(slice-13d): freeze D{N} {view 名} spec — {X}-round ASCII mock iteration

Append § Slice 13d D{N} {view 名} Spec to ADR-0019 (same pattern as
D8/D11/D14). Captures full SwiftUI view spec frozen YYYY-MM-DD over
{X} mock iteration rounds: {one-line summary of main sections}.

Spec frozen before SwiftUI impl. {Relationship to other D specs}.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

`git push` 後回報 SHA + diff size。

### Step 3.5 — Sweep 既有 frozen view / NEW-Q / commit table（freeze D{N} 時順手）

每次 freeze D{N} 時、常常會 trigger 對既有 frozen artifact 的小修補。**這些 sweep 跟 D{N} freeze 是同一個 commit**、不要拆分（D{N} freeze 沒了 sweep 會 doc drift）。

掃 4 類 sweep candidate：

1. **既有 frozen view section sweep**（visual mock 內部加 inline marker）
   - 場景：D{N} freeze 新增了影響既有 frozen view 的視覺元素（e.g. D15 freeze 加 `[⋯]` icon 到 D11 動作卡 header）
   - 改法：在原 frozen `### Visual: {variant}` 段下方加 inline blockquote marker：
     ```markdown
     > **YYYY-MM-DD D{N} freeze sweep**：{一句話描述改動 + 指向新 spec section}
     ```
   - 然後 patch 該 ASCII mock 對應的字元（e.g. header 加 `[⋯]`）
   - **不要** rewrite 整段 — 只動需要動的 row

2. **NEW-Q row patch**（既有 NEW-Q 拍板退場 / 修訂）
   - 場景：D{N} freeze grill 過程發現某 NEW-Q row 跟其他 ADR 拍板矛盾（e.g. D16 grill 發現 NEW-Q39 chip 跟 slice 10d X1 chip retract 矛盾）
   - 改法：line 1178 該 NEW-Q row 內 inline strikethrough：
     ```
     ~~原值~~ → **新值** per YYYY-MM-DD D{N} freeze、{原因}、見 D{N} spec section
     ```

3. **Commit table 描述 sweep**（line 1249+ 28-commit chain table）
   - 場景：D{N} commit description 跟新 freeze spec 不一致（e.g. D16 description 寫「per-session 套用」但 freeze 拍 global persistent）
   - 改法：line `| D{N} | ... | description |` 第三欄改寫對齊新 spec、可加「YYYY-MM-DD freeze; 詳見 D{N} spec section」尾巴

4. **D{N-?} Settings dependency / cross-ref**
   - 場景：D{N} 新 spec 跟既有 D{M} spec 內某 section 同主題（e.g. D16 「輸入方式」 picker 對應 D11 line 1597 「Input mode toggle」 settings dependency）
   - 改法：在 D{M} 對應 section 加 inline blockquote marker 指向 D{N}：
     ```markdown
     > **YYYY-MM-DD D{N} freeze sweep**：{對應映射、e.g.「⚙ pane 完整 spec 在 D{N}、本條等同 D{N} 第 X 項」}
     ```

5. **翻盤 ledger row（必加）**
   - 把上述 1-4 所有 sweep + D{N} freeze 自身寫成**一筆** ledger row prepend 在 ledger top（newest first）
   - 涵蓋欄位：日期 / 翻盤項（D{N} freeze + sweep 列表）/ 原拍板（被改的那些）/ 新拍板（D{N} 新增 + sweep 後）/ 觸發 / 關聯 commit（本 commit）

**Sweep 時序**：先 Edit 1-4 個 sweep target、再 Edit D{N} spec section append、最後 Edit ledger row prepend；commit 一次 push 一次。

**Sweep 完整度 self-check**：commit 前心裡過一遍「D{N} freeze 拍板的 X 條 lock、有沒有任一條跟既有 ADR 行不一致？」找到就 sweep、找不到就略。

### Step 5 — 報告

格式：
```
Done @ {sha}、已 push。

```
{sha} docs(slice-13d): freeze D{N} ... spec
 docs/adr/0019-...md | +{N} lines
```

main HEAD: {sha}。
```

如果這是某個 view triad 完成（如 D8/D11/D14 = Watch session lifecycle 三大 view），可額外列 triad 表確認狀態。

## Past invocations

- 2026-05-28 D11 set logger spec frozen @ `c4d1b9c` (+256 lines、8-round)
- 2026-05-28 D8 Watch picker spec frozen @ `b656a55` (+155 lines、5-round) + empty state @ `36405ad` (+28)
- 2026-05-28 D14 Watch 完成頁 spec frozen @ `9d522e7` (+154 lines、3-round)
- 2026-05-28 D15 ⋯ menu spec frozen @ `9360638` (+281 lines、3-round) + D11 visual sweep (solo card [⋯] / superset header 3-line) + NEW-Q48 i18n cross-cutting 新增 — 首次套用 Step 3.5 sweep
- 2026-05-28 D16 ⚙ settings spec frozen @ `5f6c5c8` (+278 lines、2-round) + NEW-Q39 chip retract + D11 line 1597 cross-ref + D16 commit table sweep — 第 2 次套用 Step 3.5 sweep
- **Quintet 全 frozen**：D8 + D11 + D14 + D15 + D16、合計 21 mock rounds / +1152 lines / 5 commits、Watch session lifecycle 完整 spec'd

## Anti-patterns

- ❌ 用 Write 整檔覆寫 ADR-0019（1500+ 行、會破壞既有結構）— 必須用 Edit append
- ❌ 把多個 view spec 塞同一 commit（D8 + D11 一起 commit）— 拆分；但 **D{N} freeze + 其 sweep 是同一 commit、不要拆**（D11 sweep 沒了 D15 freeze 就 doc drift；判別：sweep 是 D{N} freeze 的 derivative 而不是 independent unit）
- ❌ 把 Excluded section 省略 — 這是防 user 6 週後問同問題的關鍵
- ❌ Decisions log 寫太細（每輪都列 ambiguity 答案）— 只列「主要決策」一行
- ❌ 沒有 Iteration log 帶日期 + 輪次 — future grep 找不到 context
- ❌ **freeze D{N} 時忘了 sweep 既有 frozen view / NEW-Q row / commit table**（Step 3.5）— commit 前 self-check「D{N} 拍板有沒有跟既有 ADR 行衝突」、找到就 sweep、不要 defer 到 future doc QC commit
- ❌ **sweep 寫成獨立 commit**（D{N} freeze 一個 commit、sweep 另一個 commit）— 兩 commit 拆開等於宣告 freeze 跟 sweep 是兩件事、會誘導未來 reviewer 用「只看 freeze commit」理解；要 atomic

## Cross-references

- `~/.claude/projects/-Users-hao800922/memory/feedback_watch_ui_reference.md` — 上游 skill、ASCII mock iteration discipline（凍結前的對話階段）
- `docs/adr/0019-session-ui-ux-integral-redesign.md` — master ADR、所有 D# spec frozen 都在文末
- `grill-with-docs` skill — 比較重的設計 grilling（適用於還沒 mock 過的 architectural decision）
