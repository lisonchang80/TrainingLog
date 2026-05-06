# TrainingLog

iOS 重訓紀錄 App。記錄一次次去健身房的訓練內容，並支援長期訓練計畫與訓練範本。

## Scope

TrainingLog 紀錄 **重訓 (weight training) Sessions only**。有氧、HIIT、跑步等非重訓運動由使用者直接在 Apple 健身 App 執行，本 app **不提供 cardio entry point**，**未來更新也不規劃自建 cardio session schema**（理由：Apple Fitness + Apple Watch 對心率 / GPS / 卡路里整合難以追上；多元運動 schema 會破壞 Set = weight + reps 的乾淨假設；focus 是 v1 核心競爭力）。

Cardio 資料的呈現透過 HealthKit 整合：
- v1：READ Apple Health 的 cardio workouts，在 TrainingLog 顯示摘要（不存獨立資料）
- v1.5+：WRITE TrainingLog Session 回 HealthKit 為 `HKWorkoutType=traditionalStrengthTraining`，讓 Apple Health 活動圓圈紀錄到
- v2+：READ body data（bodyweight、HRV、睡眠等）給訓練 readiness 用、整合智能體脂計 / 體重秤等外部來源（v1 自家 schema 已存 bodyweight / PBF / SMM 純手動，見「Body data」段）
- 詳細 HealthKit 邊界見 Q11

## Language

**Session** (UI: 訓練):
一次完整的健身房進出，從開始紀錄到結束。
_Avoid_: Workout, Training（動詞例外）, 紀錄

**Program** (UI: 計畫，亦稱 **Program 主標籤**):
跨多次 Session 的長期訓練架構，作為 Template 的 **1st-tier 分類**。
例：增肌-Q1、力量-Q2、無（預設）。使用者「+ 新增」自訂命名，從下拉選單選取。（注意：「常設」**不再是 Program**，已重新解釋為 Template 內 Exercise 級的分區，見 Template 章節）
**結構**：Program = 起始日期 + **循環長度**（天，預設 7，範圍 3-14）+ **循環次數**（例 4）+ 一份內部日曆網格。
**日曆網格** = 循環次數 行 × 循環長度 列，每個 cell 可掛 (Template, Program 副標籤)：
- 循環長度 = 7：column 標籤顯示「一二三四五六日」對齊週曆
- 循環長度 ≠ 7：column 標籤顯示「Day 1 / Day 2 / ... / Day N」（不對齊週幾）
- 真實日期由起始日期 + (循環 index, day index) 推導
**填入方式**（fan-out + override）：
- 預設使用者只填**第 1 個循環**的 (Template + 休息日) pattern → 自動複製到所有循環
- 每個循環獨立指定 **Program 副標籤**（這就是「週期化訓練」的實作機制）
- 任一 cell 可手動 override（例：循環 3 Day 4 從「腿日」改「休」做 deload）
**批次套用**：橫框選整列（= 一個循環）一鍵套副標籤；縱框選整行（= 循環中第 N 天）一鍵套 Template。
建立方式：手動排程，或透過 wizard 引導步驟填入（wizard ≠ preset 生成器；它是引導式問卷，把排程決定拆成順序問題例如「循環長度幾天」「循環中哪幾天休息」「每個訓練日排哪個 Template」「每個循環用哪個副標籤」，**內容仍由使用者每步輸入**，wizard 只負責問題順序與最後組裝成日曆 cells）。
Program 分頁 = 預計訓練。對照的「歷史」分頁 = 實際訓練（已完成的 Sessions）。
_Avoid_: Plan, 訓練計畫

**循環** (UI: 循環):
Program 內部的重複訓練單元。一個 Program = N 個（循環次數）等長（循環長度，天）的循環。
例：增肌-Q1 = 4 個循環 × 每循環 7 天 = 總共 28 天。6 天 PPL×2 = 6 天循環 × 3 次 = 18 天。
循環長度預設 7（對應一週），可選 3-14 天以支援非週期訓練。
循環內 pattern（Template + 休息日）預設在所有循環間一致；循環間的差異由每個循環獨立指定 **Program 副標籤** 達成 → 這正是**週期化訓練**的實作機制（例：循環 1 套 12-15RM、循環 2 套 10-12RM、循環 3 套 8-10RM）。
_Avoid_: Cycle 一詞當 Program 同義詞、Microcycle（過硬）、循環訓練 / Circuit Training（不同概念）

**Program 副標籤** (UI: Program 副標籤):
訓練強度 / 模式的 **2nd-tier 分類**，per-cell 套用在 Program 日曆上。
例：12-15RM、10-12RM、8-10RM、6-8RM、無。使用者直接輸入文字命名（free-form），之後可從按鈕重複套用。
**Template 目標依 (Template name, Program, Program 副標籤) 三元組唯一**：同 name 在同 Program 下，因副標籤不同可有不同目標。
例：增肌-Q1 第 1-2 週的「胸日 / 10-12RM」目標 = 60kg×10×3；第 3-4 週的「胸日 / 8-10RM」目標 = 70kg×8×3 → 兩筆獨立 Template entity。
_Avoid_: Tag（過泛）, Phase（暗示時序）, Mode

**Template** (UI: 課表):
單次訓練的範本（例：「胸日」、「腿日」），用來生出 Session。**儲存完整目標**：有序的 Exercise 清單（含 SetGroup 結構）+ 每個 Exercise 的組數、目標重量、目標 reps。
**Identity = (name, Program, Program 副標籤) 三元組**。同 name 配不同 (Program, 副標籤) 組合視為不同 Template entity（例：「胸日 (增肌-Q1, 10-12RM)」、「胸日 (增肌-Q1, 8-10RM)」、「胸日 (力量-Q2, 6RM)」為三個獨立 Template）。
**「Template」= entity（三元組整體）**；**「Template name」= 字串 label**（例：「胸日」這個字串本身）。同 name 的多個 Template 是獨立的 sibling entities，**不是「1 個 Template 的多個版本」**。schema / ADR / 目標 / Snapshot / Save-back / 歷史指標 scope 一律以 Template entity 為單位；UI 顯示用「name (主標籤, 副標籤)」格式（例：「胸日 (增肌-Q1, 10-12RM)」）。
**Exercise 清單分兩區**：
- **一般動作區**：目標 per `(name, Program, 副標籤)` 三元組獨立，跟著週期化變化
- **常設動作區**：目標 per `name` **共享**（同 name 的所有 sibling Templates 共用同一份目標）。新建三元組時**自動繼承**同 name 已有的常設動作池（含目標）
動作可在 Template 編輯頁透過動作右上設置「設為常設運動」/「設為一般運動」在兩區之間移動。
UI 上 Template 清單以 **Template name** 分組顯示，使用者點 name 後再選 (Program, 副標籤) 組合即定位到具體 Template。
_Avoid_: Routine, Workout template, 模板, 範本; 「Template instance」（避免 instance / entity 雙詞混用，一律稱 Template 或 sibling Templates）

**常設動作** (UI: 常設運動):
Template 內的 Exercise 分區之一（對 vs 一般動作）。目標 per Template name 共享，跨同 name 的所有 sibling Templates 不變。
**設計目的**：讓 finisher / 收操 / 暖身 / 不參與週期化進展的動作能維持單一目標來源 — 修改一處同步到所有 sibling Templates，避免人工同步。
**舉例**：「胸日」這個 Template name 有三個 sibling Templates（10-12RM / 8-10RM / 6-8RM），蝴蝶機作為 finisher 屬於常設動作 → 三個 sibling Templates 都顯示同一筆「蝴蝶機 30kg×15×2」，改其中一個就改全部。
_Avoid_: 永久動作、固定動作、Evergreen exercise（內部 codename 可用）

**目標** (UI: 目標):
Template 內每個 Exercise 儲存的計畫值 bundle = **組數 + 目標重量 + 目標 reps**。
Session 由 Template 生出時 snapshot 整份目標；Session 內 input 預填值來自目標；Session 結束時實際 vs 目標對照可觸發 Save-back dialog；歷史指標、Volume 進度、動作歷史頁的「目標 vs 實績對照」都圍繞這個 bundle 運作。
_Avoid_: 處方（舊稱，醫療口吻；已棄用）

**Snapshot semantics**:
Session 由 Template 生出時，**複製** Template 當下的完整目標（Exercise 清單 + 組數/目標重量/目標 reps + Program + Program 副標籤）到 Session，**包含一般動作區 + 常設動作區的所有 Exercises**。
之後 Template 被修改不會影響歷史 Session。

**Save-back semantics** (Session → Template 反向更新):
Session 結束時，若實際組數/重量/次數與 snapshot 目標不同，跳「是否同意修改模板？」dialog。同意則依動作所屬分區決定傳播範圍：
- **一般動作的修改**：只更新本次 Session 對應的 (Template name, **這個** Program, **這個** 副標籤) 三元組的 Template 目標（其他 sibling Templates 不動）
- **常設動作的修改**：更新該 Template name 下**所有** sibling Templates 的 Template 目標（因為常設動作的目標是 name-level 共享）
拒絕則：本次 Session 內仍保留實際數據（不影響歷史紀錄），Template 目標不動。
_儲存實作（每個 Template 各存一份 + propagate vs 抽出 common 表 + JOIN 渲染）留 ADR 決定，CONTEXT.md 只鎖 semantics。_

**Autofill** (UI: 自動帶入):
Session 開始時，每個 Exercise 的組數 + 目標重量 + 目標 reps **直接從 Template 目標帶入**（即 snapshot 內容）。**歷史 Sessions 不影響 input 預填值** — 上次實績、最大容量、最大重量等資訊以「歷史指標」形式 inline 顯示在動作名旁，由使用者自行決定要否手動覆寫 input（不自動覆寫，避免破壞 Template 目標語意）。

**Extra Exercise** (UI: 額外動作):
Session 中**不在**所選 Template 裡、臨時加做的動作。Session end 時可被 Split 出去。
_Avoid_: 加練、額外、Bonus

**Session Split** (UI: 拆成另一次訓練):
Session 結束時的選擇性操作 — 把勾選的 Extra Exercises 從本 Session 切走，產生一個新的 Session（freestyle，無 Template）。原 Session 只留 Template 相關動作。
_Avoid_: Fork, Branch, 分割

**Exercise** (UI: 動作):
單一可被紀錄的訓練動作（例：「平板槓鈴臥推」）。**器械變體即獨立 Exercise**：平板槓鈴臥推、上斜啞鈴臥推、史密斯臥推算三個不同 Exercise，因為使用重量不同、PR 必須分開統計。
_Avoid_: Movement, Lift, 招式

**Built-in Exercise** vs **Custom Exercise**:
內建動作由 App 提供，display name 不可改；自訂動作由使用者建立，可隨時編輯。

**Short Name** (UI: 簡稱):
每個 Exercise 額外的短名（例：「平板臥推」→「平推」），給 Apple Watch 小螢幕用。**內建動作的 display name 鎖定，但 short name 可編輯。**

**Muscle Group** (UI: 部位):
Exercise 的主要訓練部位，第一層分類。共 11 類：
胸、背、腿、臀、肩、斜方肌、二頭、三頭、小腿、前臂、核心。
_Avoid_: Body part, 肌群（口語可，schema 用 MuscleGroup）

**Sub-Group** (UI: 細部位):
Muscle Group 下的細分（optional，部分 MG 才有）。Exercise 可選擇性地 tag 一個 Sub-Group。

| Muscle Group | Sub-Groups |
|---|---|
| 胸 | 上胸 / 中下胸 |
| 背 | 水平 / 垂直 _（功能分類：拉的方向）_ |
| 腿 | 腿前 / 腿後 |
| 臀 | 上臀 / 下臀 |
| 肩 | 前束 / 中束 / 後束 |
| 二頭 | 內側頭 / 外側頭 _（口語，解剖學名為短頭 / 長頭）_ |
| 斜方肌、三頭、小腿、前臂、核心 | _無 SG_ |

**Equipment** (UI: 器材):
Exercise 使用的器械類型，第二層分類。共 8 類：
槓鈴、啞鈴、史密斯機、滑輪、固定機械、徒手、壺鈴、其他。
_Avoid_: Gear, 器械（口語可）

**Set** (UI: 組):
紀錄的最小單位 — 一次完整的舉起/放下動作序列。必填：**weight + reps**。
**完成標記** (`is_done`)：per-set 勾選欄位，標示該組是否實際做完。Volume 進度與 PR 判定僅計入 `is_done = true` 的 sets。
**Set type**：暖身組（warmup） / 正式組（working set）。UI 顯示時暖身組以「熱」label 取代序號，**正式組編號從 1 起算（不含暖身組）**（例：2 暖身 + 3 正式 = 列表顯示「熱 / 熱 / 1 / 2 / 3」，**不採訓記式的「熱 / 熱 / 3 / 4 / 5」**）。
選填（UI 預設折疊）：RPE、組間休息、備註。
_Avoid_: Rep（rep 是 set 內的次數，不是同義詞）；**weight ≠ bodyweight**（Set 的 weight = 每組負重，個人體重見「Body data」段）

**SetGroup**:
把多個 Set 組成一個訓練單元。v1 支援兩種型態：
- **Superset**（超級組）：多個不同 Exercise 的 Set 交替執行、組間無休息
- **Drop Set**（遞減組）：同一 Exercise，一組做完立刻降重續做（schema 上是多個 Set 共享同一 SetGroup）
其他進階組型（rest-pause、AMRAP、cluster、giant set）v1 暫不建模，使用者用備註欄記。
_Avoid_: Set Block, Cluster（cluster 是另一種特定組型）

**Exercise 備註** (UI: per-Exercise 備註):
Session 中每個 Exercise 的自由文字 textarea。獨立於 Set-level 備註。例：「左肩有點緊」「換到 squat rack #3」。

**容量** (UI: 容量):
**容量 = weight × reps**（per-set 級單位）。per-Exercise 容量 = sum(每組 weight × reps for `is_done` sets)；Session 容量 = sum(該 Session 全部 Exercises 的容量)。
**注意**：未來改用 1RM-based 量化或 effective volume 時這個定義要重看。
_Avoid_: Volume（中英混用會混淆）、Tonnage（口語不直覺）

**Volume 進度** (UI: 已完成 / 計畫總量):
即時顯示 (累計實際容量) / (Template 目標計畫容量)。per-Exercise（例：0.0/2080.0）+ per-Session 兩級。
計畫容量 = sum(目標每組 weight × reps × sets)。

**歷史指標** (UI: 動作名下方 inline reference 一列 3 chip):
Session 內 Exercise 卡片在動作名下方排一列 3 個 chip。三個指標：
- **上次**：最近一個 Session 中**容量最大那組**的 weight × reps
- **容量峰**：全歷史 Sessions 中**容量最大那組**的 weight × reps
- **重量峰**：全歷史 Sessions 中**重量最大那組**的 weight × reps

**Scope 與 Fallback 規則（兩階）**：
- **Tier 1**（嚴格 scope）：該 Template entity (三元組) 的歷史 Sessions
- **Tier 2**（fallback）：(Template name, Program 副標籤) 跨 Program 主標籤的歷史 Sessions（保 rep range 不變）
- **Tier 3 不啟用**：跨 Program 副標籤 (rep range) 的歷史對 progressive overload 無意義，不退此階
- **三 chip 同步 tier**：要嘛全 Tier 1（無 ↑）、要嘛全 Tier 2（全 ↑）、要嘛全「—」。Tier 1 entity 一旦有任何 Session 就鎖 Tier 1（即使 Tier 2 數字更高），保 scope 純度與使用者心智模型一致

**視覺規則**：
- Tier 1：chip 顯示純數字，例：`[上次 85×8]`；tap 跳 tooltip：「本 slot (`name (主, 副)`) 歷史最佳」 — 用以區別這是 slot scope 而非 PR（PR 走 (Exercise, bucket) 跨 Template scope）
- Tier 2：chip 加淡色 ↑ icon，例：`[上次 85×8 ↑]`；tap chip 跳 tooltip 顯示「來自 *其他 Template* `name (Program 主, 副標籤)`」+ 該 Session 日期
- 全空：chip 灰底顯示「—」，例：`[上次 —]`，tap 不展開

**注意**：「容量峰 / 重量峰」chip ≠ PR。chip 走 inline scope（Tier 1/2，本 slot 嚴格）；PR 走 (Exercise, bucket) cross-Template scope。同一動作可能 chip 顯示「重量峰 80×8」、動作歷史頁 header 顯示「全時 PR：重量 95×6」 — 兩者都對，服務不同決策問題（chip = 「本 slot 該推多重」、PR = 「我這動作整體做到哪」）。

**範例**：`深蹲` <br> `[上次 85×8] [容量峰 80×10] [重量峰 100×3]`

**重要**：歷史指標**不**自動覆寫 Session 開始的 input 預填值（input 始終是 Template 目標），只是讓使用者**看到**參考數字以利 progressive overload 判讀。覆寫由使用者手動操作。

**Personal Record / PR** (UI: PR / 個人紀錄):
某 Exercise 的最佳成績紀錄。**Identity = (Exercise, rep bucket)**：每個動作在每個 rep bucket 內各有獨立 PR（per Exercise 不分 reps 太粗、per exact rep count 太細）。
**Bucket 邊界（v1 system-fixed，v1.5+ 開放自訂；schema 留口不 hardcode）**：
- `1-3` 純力量
- `4-6` 力量
- `7-10` 增肌
- `11-15` 增肌耐力
- `16+` 純耐力


PR 類型（per bucket 各自獨立，v1 兩種；E1RM PR 不在 v1）：
- **重量 PR**：該 bucket 內所有 Sessions 中 weight 最大的 set（reps 落在該 bucket 範圍內）
- **容量 PR**：該 bucket 內單一 set 容量（weight × reps）最大值
- 同一個 set 同時打破兩種 PR 時，UI 合併為一次慶祝（標示「重量 + 容量雙 PR」），不分兩次彈出

**與 inline chip 「容量峰 / 重量峰」的關係**：兩者**重疊但不等價**。
- chip 走 inline scope（Tier 1 嚴格 / Tier 2 fallback；per Template entity 三元組層）
- PR 走 (Exercise, bucket) cross-Template scope（跨所有 Template、跨所有副標籤、依 reps 數分桶）
- 同一動作同一 chip 文字「重量峰」可能顯示 80×8（slot 內）、而動作歷史頁 header 同一動作的「全時 PR」顯示 95×6（cross-Template）— 兩者都對，**服務不同決策問題**：chip = 「本 slot 該推多重」、PR = 「我這動作整體做到哪」
- 動作歷史頁 header 用「全時 PR」字眼、inline chip 用「峰」字眼，文案上明確區隔
**Bucket 邊界 / 是否可自訂 / 觸發條件 / 慶祝 UX → 待 grill**。
**注意**：inline 歷史指標的「容量峰 / 重量峰」chip 與 PR 概念**重疊但不等價** — chip 受 inline scope (Tier 1/2) 限制且不分 rep bucket；PR 走 bucket-based 全時 scope。Q8 收尾時要決定 chip 顯示是否改對齊 PR 定義。
_Avoid_: 個人最佳（口語可，schema/UI 用 PR 或個人紀錄）

**動作歷史頁** (UI: 動作歷史)：
per-Exercise「動作歷史」按鈕開啟完整列表頁。
**Scope = Exercise level，跨所有 Template、跨所有 Program 副標籤**（與 inline 歷史指標的 Tier 1/2 嚴格 scope **刻意不一致**）。
理由：使用者點進這頁就是要做**跨 rep range 比對**以決定當前重量（例：「我這次 6-8RM 要設多重？看一下上週期 10-12RM 做到哪」）。inline 已負責「同 scope 的快速答案」，這頁負責「跨 scope 的深度查詢」。
**結構**：
- **頂部 header**（一行統計）：`動作名 · 共 N 次 Session` + **全時 PR：重量 X×Y** + **容量 X×Y** + 最近 7 天次數。用「PR」字眼明示這是 (Exercise, bucket) cross-Template scope 的概念，與 inline chip 的 slot-bound「容量峰 / 重量峰」區隔
- **Filter chip 列**：`[全部] [10-12RM] [8-10RM] [6-8RM] ...`，預設全部開啟，可 toggle 收斂到單一副標籤
- **時間軸**（日期倒序）：每筆 row = 日期 + rep range chip + top set (容量最大組) + 組數 + 總容量。tap 切換展開全 sets + 「目標 vs 實績」對照
- **展開區塊底部**：`↩ 套用此次設定到當前 Session` 按鈕。啟用條件：有進行中 Session 且該 Session 含此 Exercise；否則灰掉
**進入路徑**：(1) Session 內 per-Exercise「動作歷史」按鈕、(2) 歷史分頁某 Session 內 per-Exercise、(3) Exercise library / 動作管理頁（後者 v1 尚未 spec）。三入口共用同一頁
**空狀態**：「還沒有此動作的歷史紀錄。完成第 1 次 Session 後就會出現。」

**Body data** (UI: 身體數據):
個人身體狀態的時序紀錄，與訓練 entity（Session / Exercise / Set）獨立。v1 三個 metric：
- **bodyweight** (體重，kg)：必填
- **PBF** (體脂率，% 數字如 `18.5` 表示 18.5%)：選填
- **SMM** (骨骼肌重，kg)：選填，取 InBody / Tanita 體組成計的 skeletal muscle mass，**非 lean body mass**（HealthKit 兩者不同欄位，不可混）

**頻率**：一天可多筆（晨/晚體重差異 1-2kg 真實）。`measured_at` 為 timestamp 不是 date。

**儲存**：一張表 `body_metric`，三欄合一筆（一次量測 = 一筆 row）。InBody 一次出三值 → 一筆完整 row；單獨用體重秤 → 一筆 bodyweight 有值、pbf / smm 為 NULL。NULL 在 SQLite 幾乎零成本，不需拆三張表。`source` 欄位 v1 永遠 `'manual'`，v2+ HealthKit READ 整合時新增 `'healthkit'`。

**單位 (kg ↔ lb)**：schema 一律存 kg / %（**不存 unit 欄位**）。kg/lb 顯示切換在 Settings 層處理 = `unit_preference: 'kg' | 'lb'`，影響 UI 顯示與 input field 的轉換規則；趨勢圖、容量計算、PR 比對全部用 kg 算保持一致。**同一個 unit_preference 同步影響 Set 的 weight 顯示與輸入**（不分兩個設定）。

**v1 資料來源**：純手動輸入。schema 預留 `source` 欄位讓 v2+ HealthKit READ 零 migration 成本介接；v1 不開 Apple Health body data 整合戰線（避免一次撞上 Expo Dev Build / 雙來源衝突解 / source-of-truth 三件事）。

**與訓練的耦合（load_type 三類）**：Exercise 帶 `load_type ∈ {loaded, bodyweight, assisted}`。v1 容量 / PR 計算規則：
- **A. loaded**（槓鈴/啞鈴/史密斯/滑輪/固定機械）：`weight × reps`，bodyweight 不進
- **B. bodyweight**（徒手 / 加重引體 / 加重 dip 等）：`weight × reps`，bodyweight 不進。**守 lifting community 紀錄慣例**「+10kg 引體」非「83kg 引體」。純徒手 set (`weight=0`) 跳過 PR check（避免 weight=0 PR 無意義）。動作歷史頁可顯示「當天 bw 73」純 context label
- **C. assisted**（助力機 / 阻力帶輔助引體・dip）：`(bw_snapshot − weight) × reps`，**bodyweight 進計算**。asymmetry 理由：C 類 user 幾乎都是新手轉接期，UX 服務「離徒手目標還差多遠」的進步追蹤比慣例優先；B 類 user profile 跨度大（新手到加掛 50kg 進階者），守慣例優先

**Session 開始時 snapshot bodyweight**：query body_metric 取 `measured_at <= session.start_time` 最新一筆，鎖進 `session.bodyweight_snapshot_kg REAL NULL`。後續所有 C 類 set 共用同一 snapshot 值（一次 Session 內不變）。**無 snapshot 時 fallback**：C 類容量 / PR 顯示「—」+ 提示「未紀錄當天體重」；A / B 類照常運作。

**「動作 mechanics 是否改變」分割原則**（承襲 ADR-0001 器械分割精神）：
- **不改 mechanics 的加重** = 同一 Exercise，weight 欄位記加重值（例：徒手引體 ↔ 腰掛 10kg 引體）
- **改變 mechanics 的加重** = 不同 Exercise（例：徒手單腿蹲 ↔ 啞鈴單腿蹲 ↔ 壺鈴單腿蹲 ↔ 槓鈴單腿蹲，4 個獨立 Exercise）
- 灰色 case（半輔助 / 離心 only / 異速組）v1 不建模，使用者用備註欄記

_Avoid_: 把 bodyweight 與 Set 的 weight 混為一談；用 lean body mass 取代 SMM；體脂率存成小數 `0.185`（v1 統一用百分比數字 `18.5`）；對 B 類動作把 bodyweight 加進負荷計算（違反 lifting 慣例，且打亂 Q8 PR 演算法）

## Relationships

- 一個 **Program** = 起始日期 + 循環長度 + 循環次數 + 日曆網格。包含 N 個 **循環**（N = 循環次數），每個循環長 D 天（D = 循環長度）。日曆網格 = N × D 個 cells，每個 cell = (循環 index, day index, Date, Template, Program 副標籤)
- **任何時刻最多 1 個 active Program**：schedule-bearing Programs 的 [起始日期, 結束日期] 不允許重疊；建立時 hard block + smart suggest 自動建議銜接日（既有 Program 結束日 + 1）
- **Active 判定純日期推算**：今日 ∈ [起始日期, 結束日期] = active；超出範圍 = 排定中 / 已結束
- 預設循環間 pattern（Template + 休息日）一致（fan-out from 循環 1）；任一 cell 可手動 override
- 一個 **Template** 必綁定 1 個 **Program**（含預設「無」= 無 Program 隸屬的 freestyle Template，不出現在任何 Program 日曆）+ 1 個 **Program 副標籤**（含「無」）
- **Template identity = (name, Program, Program 副標籤) 三元組**：name 相同但 (Program, 副標籤) 不同 → 不同 Template entity
- 一個 **Template** 內 Exercise 清單分 **一般動作區** + **常設動作區**：一般動作目標 per 三元組獨立；常設動作目標 per name 共享（同 name 所有 sibling Templates 共用），新建三元組時自動繼承同 name 的常設動作池
- 一個 **Template** 可生出 0..N 個 **Sessions**
- 一個 **Session** 可選擇性地參考 0..1 個 **Template**（freestyle Session 沒有）
- **Session → Template Save-back 傳播**：Session 結束時若實際數據與目標不同 → 「同意修改？」dialog；同意則一般動作只更新本三元組、常設動作更新該 name 下所有 sibling Templates
- **Session 與 Program 日曆 cell 對應 by date**（display time 比對，不需要 persistent FK，進入路徑不影響；單 active Program 限制下，每個 Session 最多 overlay 1 個 Program 的 cell）
- cell 顯示規則：
  - 計畫 + 同日 Session 匹配 (Template + 副標籤一致) → **✅**
  - 計畫 + 同日 Session 不匹配（含「計畫休但練了」、「計畫練但休了」、「選了非該 Program 的 Template」、「Template 對但副標籤不符」）→ **⚠️**
  - 計畫 + 無同日 Session → 維持 planned 顯示
- 一個 **Session** 中的動作分兩類：來自 Template 的 + **Extra Exercises**
- **Session Split** 把 Extra Exercises 拆成另一個 freestyle Session
- 一個 **Exercise** 屬於一個 **Muscle Group** + 一個 **Equipment**
- **Session** 紀錄的是 (Exercise, Set) 的實際執行（並 snapshot 自 Template 目標）
- **歷史分頁** 顯示所有已完成的 Sessions（不限 Program；Program 分頁是 derived view，不存獨立 link）

## Example dialogue

> **使用者：** 「我選了『胸 A』課表，做完之後又加了硬舉。」
> **App：** 「Session 結束。要把硬舉拆成另一次訓練嗎？」
> **使用者：** 「拆。」
> _結果：原 Session 保留為「胸 A」紀錄；硬舉變成一個新 freestyle Session。_

## Pending decisions

下次 grill-with-docs session 接續處理：

- **Q6.2 Program 與 Schedule 結構**：
  - ✅ N 個 Program 並存（含已封存）
  - ✅ Template 綁定 1 個 Program + 1 個 Program 副標籤（透過識別三元組）
  - ✅ Program 副標籤是 free-form text，per-cell 套用在 Program 日曆網格上
  - ✅ **Q6.2.C** Session 與 Program 日曆 cell 對應 by date（display time 比對，不靠 persistent FK）：匹配 ✅、不匹配（含計畫休但練了、計畫練但休了）⚠️、無同日 Session 顯示 planned。進入路徑不影響 linkage。歷史分頁顯示全部 Sessions。
  - ✅ **Q6.2.C-i** 多 Program 並存規則：**任何時刻最多 1 個 active Program**（iii）— 不允許 schedule-bearing Programs 的 [起始日期, 結束日期] 範圍重疊。「進行中」純日期推算（x）：今日 ∈ [起始日期, 結束日期]。「常設」概念已從 Program 移除，改解釋為 Template 內 Exercise 級分區。
  - ✅ **Q6.2.C-i-β** Date overlap enforcement = **hard block + smart suggest 組合**（iv）：建立新 Program 時偵測到 [起始日期, 結束日期] 與既有 Program 重疊 → 跳 dialog 擋下，同時自動建議「銜接既有 Program 結束日 + 1」為新起始日期，使用者一鍵採納或手動改其他日期。
  - ✅ **Q6.2.C-i-γ** Active Program 期間使用者選非該 Program 的 Template（包含 Program=無 的 freestyle Template、其他 Program 的 Template）開練 → 當日 active Program 的 cell 顯示 **⚠️**（a）。⚠️ 統一語意 = 「同日有 Session 但與 Program 計畫不匹配」，涵蓋: 休息日練了 / 計畫日練別的 Template / 副標籤不符。不引入額外 icon 避免 cell 顯示規則複雜化。
  - ✅ **Q6.2.D** Wizard 細節：wizard = 引導式問卷（非 preset 生成器）。
    - ✅ **D-i** 進入點：新建 Program default 進 wizard，右上角永遠有「跳過 / 改手動排」按鈕讓熟手脫離
    - ✅ **D-ii.a** 步驟清單：1.名稱 → 2a.循環長度（預設 7）+ 2b.循環次數 + 2c.起始日期（預設今天）→ 3.循環中休息日 → 4.每個訓練日 Template → 5.每循環副標籤 → 6.預覽
    - ✅ **D-ii.a-bis** Q-γ 預設行為：fan-out（填 1 個循環 → 複製到 N 個）+ per-cell override（任一 cell 可手動覆寫）
    - ✅ **D-ii.b** 步驟導航：linear next/back，**只有預覽頁（step 6）才暴露跳轉** — 每個 section 旁有「✏️ 改」按鈕回對應 step。Step 4（每訓練日 Template）允許跳過（cell 顯示 `?` 待補，處理 Templates 還沒建好的 first-run 情境）；step 5（每循環副標籤）必填但「無」是合法選項。
    - ✅ **D-iii** 中途退出 = lossless：「跳過 / 改手動排」按鈕語意是「不要 wizard 牽著走、繼續編這個 Program」→ 已填的全部保留進手動排頁。**schema 含意**：wizard 是 Program record 的 guided editor（不是 staging area）；Program record 在 step 1 名稱完成時即建立，後續所有 step 都是 in-place update。
    - ✅ **D-iv (v1 簡化)** 刪除 Program 流程：wizard 過程中**沒有**「取消 / 捨棄」action（只能上一步往回退）。建好之後在 Program 詳情頁才能刪除。
- **Q6.3 Autofill 與歷史互動 / 歷史指標**：
  - ✅ **Q6.3-α** Autofill source = Template 目標（snapshot 即填）；歷史不覆寫 input，走 inline 歷史指標路線
  - ✅ **Q6.3-β** 歷史指標 scope = per Template entity (三元組)（scope a）
  - ✅ **Q6.3 baseline UI**：per-set ✓ 完成勾、per-Exercise 備註、per-Exercise volume 進度、熱身組 label「熱」+ 正式組從 1 起、拿掉 per-Exercise 簡單/正常/困難、拿掉 AI 按鈕、Apple Watch 控制（在錶練）deferred
  - ✅ **Q6.3-γ-i** 三指標版面 = 動作名下方一列 3 chip（B 方案）
  - ✅ **Q6.3-γ-ii** 無歷史 fallback = 兩階：Tier 1 entity 嚴格 → Tier 2 (Template name, 副標籤) 跨 Program 主標籤；Tier 3 不啟用；三 chip 同步 tier；Tier 2 chip 加 ↑ icon + tap chip 顯示來源 tooltip
  - ✅ **Q6.3-γ-iii**：「動作歷史」按鈕完整列表頁 UX 全部鎖定
    - ✅ **Scope** = Exercise level 跨所有 Template、跨所有副標籤（B 方案，與 inline 刻意不一致；理由：跨 rep range 比對是決定當前重量的核心場景）
    - ✅ **顯示格式** = 單一時間軸（按日期倒序）+ 頂部 rep range filter chip 群（C 方案）。每筆附 rep range chip 標記；filter chip 預設「全部」開啟，可 toggle 收斂到單一副標籤
    - ✅ **每筆內容** = Top set + 組數 + 總容量為摘要列；tap row 展開顯示全 sets + 「目標 vs 實績」對照（C 方案）。Top set 定義沿用 inline「容量最大那組」
    - ✅ **tap row 行為** = 切換摘要↔展開；展開區塊底部一個 `↩ 套用此次設定到當前 Session` 按鈕，點按後該 Session 的 (組數/重量/reps) 帶入當前 Session 的 input（覆寫 Template 目標的預填值）。不提供「跳到該 Session 詳情」（避免打斷訓練流；深度回顧由歷史分頁負責）（B 方案）
    - ✅ **頂部 header** = 一行統計：`動作名 · 共 N 次 Session` + 全時最重 + 全時最大容量 + 最近 7 天次數。不放 trend chart（v1.5+ 再加）（B 方案）
    - ✅ **進入路徑** = (1) Session 內 per-Exercise「動作歷史」按鈕、(2) 歷史分頁某 Session 內 per-Exercise、(3) Exercise library / 動作管理頁（v1 此頁尚未 spec，但動作歷史頁的入口先承諾）（B+C 方案）。三條入口共用同一頁，差異僅在「↩ 套用」按鈕啟用規則：**有進行中 Session 且該 Session 含此 Exercise 時啟用**，否則灰掉並 tooltip「無進行中 Session 含此動作」
    - ✅ **空狀態**（零筆歷史）= 顯示一句說明引導：「還沒有此動作的歷史紀錄。完成第 1 次 Session 後就會出現。」（B 方案；Template 目標已在當前 Session input field 顯示，header 不重複）
- **Q8 Personal Record (PR) 定義**：
  - ✅ **Q8-α** PR identity = per (Exercise, rep bucket)（B 方案；per Exercise 不分 reps 太粗、per exact rep 太細）
  - ✅ **Q8-β** Bucket 邊界 = 訓練科學常規（A 方案）：`1-3 / 4-6 / 7-10 / 11-15 / 16+`，命名分別對應「純力量 / 力量 / 增肌 / 增肌耐力 / 純耐力」。理由：bucket 服務全訓練光譜，使用者個人副標籤偏細分（6-8RM/8-10RM/10-12RM/12-15RM）是增肌取向的個人習慣，不應主導系統預設
  - ✅ **Q8-γ** v1 system-fixed，v1.5+ 開放自訂（B 方案）。schema 不 hardcode bucket boundaries — 改從常數表讀，v1.5 切自訂只需從靜態常數表轉動態使用者設定
  - ✅ **Q8-δ** PR 類型 = 重量 PR + 容量 PR 兩種，per bucket 各自獨立（B 方案）。不走 E1RM（估算值對自用 + 增肌取向價值有限；schema 不擋未來 v1.5+ 加）。同一 set 同時觸發兩種 PR 時 UI 合併顯示「重量 + 容量雙 PR」一次慶祝
  - ✅ **Q8-ε** 觸發 + 慶祝 = Hybrid（C 方案）：set ✓ 完成立刻判定，達 PR 顯示 1.5 秒小型 toast（不擋互動）；Session 結束跳 summary 頁列出本次打破的所有 PR + 本次 vs 上次對照。同 session 內 PR 被後續 set 蓋過時 toast 自然消失（toast 是過渡視覺、不爭議）；session-end summary 只列「per bucket 本 session 最終最高那筆」（不重複列同 bucket 多筆）
  - ✅ **Q8-ζ** inline chip 維持 inline scope 不對齊 PR（A 方案；遵守 ADR-0006 dual scope 設計）。配套修正：(1) 動作歷史頁 header 改稱「全時 PR：重量 X / 容量 Y」用 PR 字眼明示；(2) inline Tier 1 chip 也加 tap → tooltip「本 slot (`name (主, 副)`) 歷史最佳」；(3) CONTEXT.md 明文記錄 chip 峰值 ≠ PR、各服務不同決策問題
- **Q9 Body data**：
  - ✅ **Q9.1** v1 scope = bodyweight + PBF + SMM 三個 metric；圍度（多部位）、進度照片（檔案儲存策略 + gallery UI）延到 v2
  - ✅ **Q9.2.a** 命名：bodyweight（體重）/ PBF（體脂率，百分比數字 18.5）/ SMM（skeletal muscle mass，骨骼肌重，非 lean body mass）。明確 disambiguate Set 的 weight ≠ bodyweight
  - ✅ **Q9.2.b** Schema 形狀 = 一張 `body_metric` 表合三欄（option A）；一天多筆（PK = id，欄位 measured_at 為 timestamp）；pbf / smm 可 NULL
  - ✅ **Q9.2.b-bis** 單位：schema 鎖 kg / %（不存 unit 欄位），kg/lb 切換在 Settings 層 `unit_preference`，UI 顯示與輸入時換算；同設定同步影響 Set 的 weight 顯示
  - ✅ **Q9.2.c** v1 資料來源 = 純手動；schema 預留 `source` 欄位（v1 永遠 `'manual'`），v2+ 加 HealthKit READ 零 migration 成本
  - ✅ **Q9.2.d** Exercise 加 `load_type ∈ {loaded, bodyweight, assisted}` 三類分割（依「動作 mechanics 是否改變」原則，承襲 ADR-0001 器械分割精神）。v1 容量/PR 計算規則：
    - **A 類 loaded**（槓鈴/啞鈴/史密斯/滑輪/固定機械）：`weight × reps`（bw 不進）
    - **B 類 bodyweight**（徒手 / 加重引體 / 加重 dip）：`weight × reps`（bw 不進，守 lifting 慣例「+10kg 引體」非「83kg 引體」）；純徒手 set (weight=0) 跳過 PR check
    - **C 類 assisted**（助力機 / 阻力帶輔助引體・dip）：`(bw − weight) × reps`（**asymmetric**：bw 進計算，給新手「離徒手還差多遠」的進步指標）
    - asymmetry 理由：B 類 user profile 跨度大（守訓練圈紀錄慣例優先），C 類專屬新手轉接期（進階者不用助力機，UX 服務新手進步追蹤優先）
  - ✅ **Q9.2.d-i** bodyweight snapshot 來源 = Session 開始時 query body_metric 最新一筆鎖進 Session；schema 加欄位 `session.bodyweight_snapshot_kg REAL NULL`
  - ✅ **Q9.2.d-ii** 無 bw snapshot fallback：C 類容量 / PR 顯示「—」+ 提示「未紀錄當天體重」；A / B 類照常運作不受影響
  - ✅ **Q9.2.d-iii** bodyweight 變動 PR 公平性：v1 接受 noise（新手用助力機週期短，bw 變動 ≤ 2kg 可忽略）；UI 在 PR 觸發時可標示「含 bw 變動」（v1.5+ 再決定要不要顯示，不影響 schema）
  - ✅ **ADR-0007**：Load type taxonomy + bodyweight calculation asymmetry — 已寫入 `docs/adr/0007-load-type-taxonomy-and-bodyweight-asymmetry.md`
  - ✅ **Q9.2.e** 身體數據頁 v1 範圍：
    - **輸入 UI** = α + γ 雙入口：(α) 底部 tab 加「身體」獨立分頁（主入口、看歷史 / 補記）+ (γ) Session 開始前 inline prompt「今天要記體重嗎？」（contextual，降低 C 類動作沒 bw_snapshot 的痛點）
    - **趨勢圖** = 預設三線共圖（bodyweight + SMM 共用左 Y 軸 kg，PBF 用右 Y 軸 %；圖例可 toggle 個別 series）+ 切換按鈕「分視」→ 三張獨立圖縱向 stack
    - **單位 toggle** = Settings 分頁「單位偏好」一個 `unit_preference: 'kg' | 'lb'` toggle，**整 app 同步切換**（影響 Set weight、body_metric bodyweight / SMM、容量顯示，全部走同一 preference）
    - Chart 庫選型 v1 實作時評估（victory-native / react-native-chart-kit / 其他），現在不釘
- **Q10 Sync / multi-device**：純 local-first 還是 iCloud/CloudKit 同步？影響 schema 是否需要 conflict-resolution 欄位
- **Q11 HealthKit 整合邊界**（範圍已擴至 cardio）：
  - **READ** v1：Apple Health 的 cardio workouts（有氧 / HIIT / 跑步等）→ TrainingLog 顯示摘要（不存獨立資料）
  - **WRITE** v1.5+：TrainingLog Session → Apple Health `HKWorkoutType=traditionalStrengthTraining`
  - **READ** v2+：bodyweight、HRV、睡眠等 body data
  - 何時同步、Permission UX、conflict 處理細節未定

## Flagged ambiguities

- 「課表」一詞口語上有時指 Program、有時指 Template — 已固定為 **Template**。Program 改稱「計畫」。
- 「Program」口語可同時指：(1)「訓練計畫 entity」（=「Program 主標籤」，帶日曆）；(2)「Program 副標籤」（per-cell rep range tag）。schema 拆為 **Program** + **Program 副標籤** 兩個 entity；UI 上分別在「Program 分頁」（管理計畫）與「日曆 cell 的副標籤按鈕」呈現。
- 「腹部」與「核心」常被當同義詞使用 — 已決定 **不設「腹部」MG**，所有腹直肌/腹斜/腹橫的直接訓練（卷腹、側棒、leg raise）以及抗旋/抗伸穩定訓練（Pallof press, dead bug, bird-dog）都歸入 **核心**。
- 「二頭 → 內側頭 / 外側頭」是口語命名；解剖學正名為 **短頭 / 長頭**（外側頭 = 長頭）。schema/UI 一律用內/外側頭。
