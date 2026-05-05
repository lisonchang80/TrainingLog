# 0006 — 歷史視圖雙 scope：inline 嚴格 vs 動作歷史頁全展

同一個 Exercise 的歷史在兩個 UI 視圖**刻意採用不同 scope**：

- **Inline 歷史指標**（Session 內 Exercise 卡片動作名下方 3 chip：上次 / 容量峰 / 重量峰）走**嚴格 scope**：
  - **Tier 1**：該 Template entity (三元組嚴格)
  - **Tier 2** (fallback)：(Template name, Program 副標籤) 跨 Program 主標籤（保 rep range 不變）
  - **Tier 3 不啟用**：跨 Program 副標籤對 progressive overload 無意義
  - 三 chip 同步 tier，Tier 1 一旦有任何 Session 就鎖 Tier 1
- **動作歷史頁**（按鈕進入的完整列表頁）走 **Exercise level scope (scope c)**：跨所有 Template、跨所有 Program 副標籤、跨所有 rep range

理由：兩個視圖回答的是**不同問題**，不是同一資料的兩種顯示密度：

- **Inline = 「現在這個三元組要怎麼設今天的重量？」** — 需要的是同 rep range、同三元組身份的精確訊號。混 rep range 會誤導 progressive overload 判讀（看到「容量峰 70×10」但其實來自 12-15RM 紀錄，今天 6-8RM 直接套會 underload 或 overload）。Tier 2 fallback 嚴格保 rep range，只放寬 Program 主標籤是因為週期切換時純嚴格 scope 會讓 chip 全空，使用者體驗斷層
- **動作歷史頁 = 「我這個動作的全時表現如何？跨週期我做到過什麼？」** — 需要的是 cross-RM 比對能力（「我這次 6-8RM 要設多重？看一下上週期 10-12RM 做到 60×10，這次抓 75×6 應該合理」）。這恰恰是 inline 不能給的訊號類型，也是使用者「主動點按鈕進深度頁」的核心動機

把兩個 scope 分配給兩個視圖、不互通也不切換，semantic 上最乾淨：每個視圖回答**自己擅長**的問題。

—— 拒絕的替代方案：

- **兩視圖都用嚴格 scope (a)**：動作歷史頁變成「per Template entity 三元組」，週期切換重置會讓使用者看不到任何跨 RM 比對，無法回答「我這次 6-8RM 要設多重」這個常見決策問題。深度頁失去存在意義
- **兩視圖都用 Exercise level (c)**：inline chip 會混 rep range，3 個小 chip 沒空間做 rep range 視覺編碼（chip 已經要顯示「重量×次數」+ tier 指示 + tooltip），訊號失真且使用者只看到數字無法判讀來源 rep range
- **提供 scope 切換 (toggle)**：inline 空間 3 個 chip 已經很滿放不下 toggle；動作歷史頁加 toggle 又對應分裂兩種 mental model（使用者要記「這頁現在是哪個 scope」），強制單一語意更乾淨
- **動作歷史頁延用 scope a 但加 Tier 3 fallback (跨副標籤)**：fallback 是「本來該嚴格但臨時放寬」的補丁味，與「動作歷史頁的本意就是跨 RM 全展」語意衝突。直接定義為 scope c 才語意乾淨，使用者也不會誤以為「動作歷史頁顯示的數字是嚴格 scope 的 fallback 結果」

—— Consequences：

- **兩條 query 路徑必須各自實作**，不能共用同一個 history fetcher。Tier 判定邏輯（Tier 1 是否有任何 Session）只屬於 inline；scope c 的純粹「by exercise_id」query 只屬於動作歷史頁
- **「容量峰」「重量峰」在兩個視圖會顯示不同數字**：inline 是「Tier 1 / Tier 2 嚴格 scope 內的峰值」、動作歷史頁 header 是「跨 RM 的全時峰值」。UI 必須用文案明示差異，避免使用者誤以為某邊是 bug：
  - inline chip：保留現有「Tier 2 加 ↑ icon + tap tooltip 顯示來源」設計
  - 動作歷史頁 header：「全時最重 / 全時最大容量」加 tooltip「橫跨所有 rep range 紀錄」
- **「↩ 套用此次設定到當前 Session」按鈕只在動作歷史頁出現**：inline chip 是 read-only 提示，不提供操作 affordance；只有展開了具體 Session 的全 sets + 目標對照之後，「套用該次設定」才有明確語意對象
- **文件寫作紀律**：談「歷史 scope」必須**永遠配對視圖**（「inline scope」/「動作歷史頁 scope」），不可孤立講「歷史 scope 是什麼」
- **未來若新增第三個歷史視圖**（例：歷史分頁的 Session timeline、Apple Watch 上的歷史），要刻意決定它走哪個 scope，不能假設「沿用某邊」自然正確

修改此設計的代價：兩視圖的 query 邏輯、UI 文案、互動 affordance（套用按鈕的 entry-point gating）、tooltip 內容、未來新增視圖的 scope 決策框架都要重做。
