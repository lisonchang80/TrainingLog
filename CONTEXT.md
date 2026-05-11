# TrainingLog

iOS 重訓紀錄 App。記錄一次次去健身房的訓練內容，並支援長期訓練計畫與訓練範本。

## Scope

TrainingLog 紀錄 **重訓 (weight training) Sessions only**。有氧、HIIT、跑步等非重訓運動由使用者直接在 Apple 健身 App 執行，本 app **不提供 cardio entry point**，**未來更新也不規劃自建 cardio session schema**（理由：Apple Fitness + Apple Watch 對心率 / GPS / 卡路里整合難以追上；多元運動 schema 會破壞 Set = weight + reps 的乾淨假設；focus 是 v1 核心競爭力）。

HealthKit 整合（v1 / v1.5+ / v2+ 三階）：
- **v1**（提前）：WRITE TrainingLog Session 回 HealthKit `HKWorkoutType=traditionalStrengthTraining`（由 Watch 端 `HKWorkoutSession` 寫入；含 duration / 卡路里 / 平均+max HR / custom `trainingLogSessionUUID`），iPhone 端 READ 回拿 HKWorkout.UUID + 4 metric 進 `session.healthkit_workout_uuid`
- **v1.5+**：READ Apple Health 的 cardio workouts（有氧 / HIIT / 跑步等）→ TrainingLog 顯示摘要（不存獨立資料）
- **v2+**：READ body data（bodyweight、HRV、睡眠等）給訓練 readiness 用、整合智能體脂計 / 體重秤等外部來源（v1 自家 schema 已存 bodyweight / PBF / SMM 純手動，見「Body data」段）
- 詳細 HealthKit 邊界 + Watch 整合見 ADR-0008；剩餘 Q11 v2+ body data READ 細節未定

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

**Muscle** (UI: 部位細分) (ADR-0010 — 取代既有「Sub-Group」)：
Muscle Group 下的解剖學細分，**19 個 muscle**，每個 muscle 屬於 exactly 1 MG。Exercise 透過 `exercise_muscle` m:n 表關聯多個 muscle 並標 role（primary / secondary），給 Exercise 詳情頁人體圖與部位活化視覺化使用。

| Muscle Group | Muscles |
|---|---|
| 胸 (2) | 上胸 / 中下胸 |
| 背 (2) | 背部 / 下背 |
| 腿 (2) | 股四 / 膕繩 |
| 臀 (2) | 上臀部 / 下臀部 |
| 肩 (3) | 前束 / 中束 / 後束 |
| 斜方肌 (1) | 斜方肌 |
| 二頭 (2) | 二頭長頭 / 二頭短頭 |
| 三頭 (1) | 三頭 |
| 小腿 (1) | 小腿 |
| 前臂 (1) | 前臂 |
| 核心 (2) | 側腹 / 腹肌 |

合計 **19 muscle**。命名採解剖學標準（二頭長頭/短頭）+ 訓練圈口語（上下胸、上下臀、股四/膕繩、側腹/腹肌）混搭：單字優先標準、多字優先口語。

**Exercise → muscle mapping**（透過 `exercise_muscle` 表）：
- **primary** = 1-3 個 muscle（核心活化、訓練動量主要承擔）
- **secondary** = 0-N 個 muscle（協同 / 穩定）
- 一個 exercise 最少 1 個 primary muscle；secondary 可空
- `exercise.muscle_group_id` 仍保留為「主要 MG 分類」單一 FK（filter / 統計頁各部位容量 / 獎章 first_combo / pr_per_mg 用），v1 手動指定不自動推算

例：
- 平板槓鈴臥推 → primary: 中下胸 / 三頭 / 前束；secondary: 上胸 / 前臂 / 核心
- T-bar row → primary: 背部 / 下背 / 二頭長頭 / 二頭短頭；secondary: 後束 / 前臂 / 核心
- 深蹲 → primary: 股四 / 上臀部 / 下臀部；secondary: 膕繩 / 下背 / 核心 / 小腿

ADR-0010 局部 reverse ADR-0002：**僅**反轉「背的 SG = 水平/垂直」這一條（改為 背部 / 下背 解剖切）；其他 ADR-0002 結論（11 MG 列表、腹歸核心、臀獨立、腿前/後切分精神）全部保留。

**體圖 asset**：前後身兩張 SVG（CC0 / Wikimedia Commons 解剖圖作參考、自製）；19 muscle 各自獨立 path with unique id；統計頁 heatmap (by 11 MG aggregate) + Exercise 詳情頁 (by 19 muscle individual highlight) **共用同一個 SVG**，省一張資產。男女不分（v1.5+ 加切換）。

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
- `1-3` 最大力量
- `4-6` 力量
- `7-10` 增肌
- `11-15` 肌耐力
- `16+` 耐力

bucket 命名修正紀錄（ADR-0009）：原命名「純力量 / 增肌耐力 / 純耐力」中的「純」字奇怪；「增肌耐力」實為「增肌+耐力 crossover」但需要解釋 = 命名失敗。新命名 5 桶各自獨立、自我解釋；「肌耐力」（局部肌肉抗疲勞）vs「耐力」（全身代謝耐力）刻意區分。


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

**歷史頁三 sub-tab**（UI: 歷史 / 統計 / 獎章）（ADR-0009）：

歷史 tab 升級為三 sub-tab 結構，sub-tab 切換以頂部 segmented control 呈現：

- **歷史**：既有 Session list（按日期倒序，沿用 ADR-0006 / Q6.3）
- **統計**：訓練部位概況（人體圖）+ 各部位容量 + 運動時長；頂部時間選擇器（年/月/日/自選）
- **獎章**：解鎖中獎章 grid + 未解鎖灰階預告 + 進度條；分類 tab `[全部] [部位] [訓練目的] [里程碑]`

**統計頁** (UI: 統計)：

頂部 segmented control `[年] [月] [日] [自選]`，自選展開 date range picker；所有統計區段的數值依當前選擇期間動態重算。

- **訓練部位概況**：人體部位圖（前後身兩張、11 MG path），用 **per-Session 次數**（不是容量）著色 — Session 含 ≥1 set `is_done=true` 屬於 MG_X → 該 Session 對 MG_X 計 +1。理由：容量會讓腿 / 背天然壓垮所有部位，無法回答「balance check」本意。顏色 = 期間內 11 MG 次數分布算 5 階分位數（Q20/Q40/Q60/Q80/Q100）冷藍 → 暖紅 gradient；0 次 = 灰；tap MG path 顯示「胸 · 5 次」氣泡。v1 自畫 SVG，男女不分（neutral / male body asset），v1.5+ 加性別切換。
- **各部位容量**：each MG → 期間內容量加總（沿用 ADR-0007 load_type 三類規則），bar chart desc。
- **運動時長**：總時長 + 平均單次 + 最長單次三指標。資料來源優先序：(1) 自家 `session.ended_at - session.started_at` 為主、(2) HKWorkout.duration 為 fallback。理由：started_at / ended_at 在 iPhone SQLite 即時可用；HKWorkout 由 Watch 端寫可能延遲到帳。Schema 加 `session.ended_at TIMESTAMP NULL`，in-session pause 不算結束（pause 期間仍累計時長）。

**獎章頁** (UI: 獎章) (ADR-0009)：

四類獎章，總計 **255 個 achievement_definition**（系統 seed，使用者不可刪減；v1.5+ 評估自訂）：

| 類別 | 維度 | 階梯 | 數量 |
|---|---|---|---|
| **第一次 (部位, 訓練目的)** | 笛卡爾積：11 MG × 5 bucket | n/a (1 次性) | 55 |
| **各部位 N 次 PR** | 11 MG × 6 階段 × 2 PR 類型 (重量/容量) | 等差 1/10/20/30/40/50 | 132 |
| **各訓練目的 N 次 PR** | 5 bucket × 6 階段 × 2 PR 類型 | 等差 1/10/20/30/40/50 | 60 |
| **N 次重訓**（全 app Session 計數） | 1 條 progression | 等比 1/5/10/25/50/100/250/500 | 8 |

**計數規則**：
- 第一次 (部位, 訓練目的)：Session 中至少 1 set `is_done=true`、(MG, bucket) tuple 之前未組合解鎖過；一個 Session 可一次解鎖多個（例：胸日 / 8-10RM 做胸 + 三頭 → 解鎖兩個）；bucket 由 set 的 reps 推算，warmup set 也算
- N 次 PR：重量 PR 與容量 PR 分開計數；同一個 PR 同時推進「該 MG 計數」+「該 bucket 計數」兩條（v1 兩維度互補設計，不笛卡爾積避免 660 獎章爆炸）；純徒手 (weight=0) set 跳過 PR check（沿用 ADR-0006）
- N 次重訓：全 app Session 計數，不分 MG / bucket；條件 = ended_at 寫入 + ≥1 set `is_done=true`（純空 Session 不算）

**觸發時機**：Session 結束 summary 計算時統一檢查（不在 in-session 即時觸發，避免打斷組間呼吸）。Watch v1 結束 summary 卡片**不**顯示獎章（避免 Watch 端 query achievement state；獎章 unlock 計算與顯示**只在 iPhone**）；使用者結束訓練後拿手機看獎章 sub-tab 會看到本次解鎖。

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

**Pre-session 階段鎖定（ADR-0008 補丁，Watch α 模型專用）**：bw_snapshot 在 iPhone 算 Stage 2 prefetch payload 時就鎖入並推給 Watch，**不是** in-session 點「開始訓練」按鈕那一刻 — 因為 in-session 時 iPhone 可能已不在 BLE 範圍（i 場景：放包包鎖屏；ii 場景：留車上 / 家裡）。pre-session 後再量體重的情境罕見，v1 接受此 trade-off。

**「動作 mechanics 是否改變」分割原則**（承襲 ADR-0001 器械分割精神）：
- **不改 mechanics 的加重** = 同一 Exercise，weight 欄位記加重值（例：徒手引體 ↔ 腰掛 10kg 引體）
- **改變 mechanics 的加重** = 不同 Exercise（例：徒手單腿蹲 ↔ 啞鈴單腿蹲 ↔ 壺鈴單腿蹲 ↔ 槓鈴單腿蹲，4 個獨立 Exercise）
- 灰色 case（半輔助 / 離心 only / 異速組）v1 不建模，使用者用備註欄記

_Avoid_: 把 bodyweight 與 Set 的 weight 混為一談；用 lean body mass 取代 SMM；體脂率存成小數 `0.185`（v1 統一用百分比數字 `18.5`）；對 B 類動作把 bodyweight 加進負荷計算（違反 lifting 慣例，且打亂 Q8 PR 演算法）

**Backup / Sync** (UI: 備份):
TrainingLog 的資料保護策略。v1 scope = **(a) 換手機 + (b) 災難恢復 + (d) JSON export**；**(c) 多裝置即時 sync 排除**（自用 + 沒 iPad app + Watch 已透過 ADR-0008 處理）。

**Mechanism**：iCloud Drive 自動備份整個 SQLite 檔（不採 CloudKit row-level — c 排除即 overkill）。App 在 iCloud ubiquity container 開「TrainingLog」folder，內含 `backup.sqlite`（最新）+ `backup.previous.sqlite`（上一份 rotate）。User 在 iCloud Drive 看得到該 folder + 兩個 .sqlite 檔，可手動下載 / share。

**觸發 + 保留**：
- 觸發點 = Session 結束 + App 進 background（兩者皆觸發，5min debounce 避免重複）
- 保留策略 = 最新 + 上一份 = 2 份 atomic rotate（rename `backup.sqlite` → `backup.previous.sqlite` 後寫新 `backup.sqlite`）

**Restore UX**：第一次啟動 detect 到 iCloud 有備份 → 跳確認框（含日期 + 內容預覽，例「142 個 Session、最後一筆 2026-04-30」）→ user 二選「還原 / 全新開始」。Restore 完成 = skip onboarding 直接進主畫面。沒登 iCloud → 警告但允許進 app + Settings 永久紅警示「未啟用 iCloud 備份」。

**Settings 搬進 SQLite**：新增 `app_settings(key TEXT PK, value TEXT)` 表收所有偏好（unit_preference / dark mode / 預設休息時間 / `backup_mode` 等），跟 SQLite 一起被涵蓋。**AsyncStorage 不適合 user-facing 偏好**（restore 後跟 SQLite 反同步，user 慣 lb 變 kg 會炸）。

**Watch sync vs Backup 順序保證**：iPhone 維護 `pending_watch_sync: bool` 旗標。Backup callback 時若 flag clean → 立即執行（95% 場景）；若 dirty → 延遲到 sync 完，**最多等 5 分鐘**force backup（escape hatch；避免 Watch 出 BLE 範圍永遠等不到）。新增 `session.last_watch_sync_at TIMESTAMP NULL` 紀錄完整度。Force backup 缺漏時 Settings 顯示警告。

**Backup mode toggle**：Settings 提供「自動備份 ON / OFF」（預設 ON）。OFF = 純手動（只有「立即備份」按鈕觸發）。Manual 模式下 b1 escalation threshold 從 3 → 7 天（手動是 expected behavior）。

**Failure escalation**：
- iCloud 寫入失敗（容量滿 / 網路錯誤）：Settings 紅警示 + push notification
- 連續 3 天（auto）/ 7 天（manual）沒成功：push + Settings + 主畫面 banner
- Restore 時 `backup.sqlite` 壞 → 自動 fallback `backup.previous.sqlite`（兩份都壞 → JSON export 手動 recovery）
- iCloud Drive 不可用 / 換 Apple ID → 啟動 detect + Settings 永久紅警示 + 一次 alert

**JSON Export (d)**：完整 dump（Exercise / Template / Session / Set / body_metric / app_settings 全表）→ JSON format → iOS Share Sheet（AirDrop / Mail / Files / Notes）。v1 export only，import 延 v1.5+。不加密（自用無個資；要加密 user 自己用 7zip 包）。

_Avoid_: CloudKit row-level sync（c 已排除即 overkill）；純 manual export 無 auto cloud（user 必然忘）；依賴 iOS 系統 iCloud Backup（不可靠）；Settings 留 AsyncStorage（restore 後反同步）；JSON v1 雙向 import（跟 A 方案 SQLite restore 衝突，UX 兩條路混亂）。詳見 ADR-0011。

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
- **Q10 Multi-device 策略 + Watch v1 範圍**（ADR-0008 已釘）：
  - ✅ **Q10.1** 多裝置情境 = iPhone (RN/Expo) + Apple Watch (SwiftUI)，v1 一起做（Mac mini M4 Pro 環境就位後解鎖 watchOS dev，原本「Watch deferred」決策推翻）
  - ✅ **Q10.1.1** Watch 角色 = α 簡易（完整 Session UI 但功能受限）+ c (HKWorkoutSession 心率+卡路里+workout 寫入)
  - ✅ **Q10.2** 主從關係 = α（Watch 主），訓練全程 iPhone 不掏（i 主：iPhone 在包包/置物櫃 BLE 範圍；ii 偶爾：留車上 / 家裡）
  - ✅ **Q10.2.5** Sync 路徑 = C（prefetch + event queue）。**iPhone = SQLite source of truth；Watch = in-memory + UserDefaults backup（不做 Watch 端 SQLite）**
    - Stage 1（app launch）：iPhone push 所有 Template metadata + active Program + unit_preference 用 `updateApplicationContext`
    - Stage 2（pre-session）：iPhone push 該 Template 完整結構 + chip 預計算 + bw_snapshot 用 `sendMessage`
    - Watch → iPhone events：`transferUserInfo` OS-managed reliable delivery（iPhone 不在範圍時 cache，連上自動補送）
    - Conflict 模型 = 架構上不存在 conflict（Watch 只新增 Set）
  - ✅ **Q10.2.6** Active Program 期間 manual flow = 選 name 自動套**當期副標籤** 1-tap；找不到對應三元組則 fallback Layer 2 顯示該 name 所有 sibling 組合（edge case 規則）
  - ✅ **Pre-session vs in-session 兩態**：
    - Pre-session：選定 Template → ▶ 開始訓練按鈕；HKWorkoutSession 未啟、Session row 未創建
    - In-session：點按鈕 → 原子操作 ① `HKWorkoutSession.start()` ② Session row 創建 (UUID + bw_snapshot + started_at) ③ 計時開跑
  - ✅ **bw_snapshot 鎖定時機補丁**：在 pre-session 階段（iPhone 算 Stage 2 payload 時）鎖入；補丁進 Q9.2.d-i 上方 Body data 段
  - ✅ **Schema 影響（最小）**：
    - UUID 主鍵範圍 = 僅 Session / Set / body_metric 三張表（兩端都新增的 entity）；其他表保留 autoincrement int
    - 新增 `set.is_skipped BOOLEAN DEFAULT FALSE`（Watch #11 跳過 Exercise UI）
    - 新增 `session.healthkit_workout_uuid TEXT NULL`（HKWorkout link）
    - **不需要** updated_at / last_modified_device 欄位
  - ✅ **Q10.5** Pre-session payload **永不過期**（transient state；cancel 重 prefetch 是 1~2 tap 自助）
  - ✅ **Q10.6 Watch v1 功能 17 條** + 主畫面 list view 一路排下去 + 水平 swipe 3 分頁 (list ↔ NowPlaying ↔ metrics) + #11 跳過 Exercise collapse 成「動作名（跳過）」一行
  - ✅ **Complication** = a 簡單版（app icon, 1-tap 啟動）；進階版（顯示今日排程）延 v1.5+
  - ✅ **Watch Settings** = 不做（unit_preference 由 prefetch 帶；其他由 watchOS system 管）
  - ✅ **HealthKit 整合**（v1 提前）：HKWorkoutType=`traditionalStrengthTraining`；Watch 寫 metadata duration/卡路里/平均+max HR + custom `trainingLogSessionUUID`；iPhone READ 4 metric + HKWorkout.UUID 進 `session.healthkit_workout_uuid`
  - ✅ **Engineering**：Monorepo（現有 TrainingLog repo + watchOS target 進 ios/ 資料夾，CONTEXT.md / ADR 維持單一 source）；SwiftUI native + WatchConnectivity；schema TS+Swift 雙寫，ADR/CONTEXT 當 source of truth
  - ✅ **時程 + ADP**：v1 ship 預估 26 週，30+ hrs/週投入；Apple Developer Program v1 day 1 買 ($99/年)，365 天涵蓋整個 26 週開發 + ship 後 26 週 polish / TestFlight
  - ✅ **拒絕的替代方案**：路徑 B (Watch 端完整 SQLite + bidirectional sync) / 路徑 A (純 push) / Watch 角色 b/c-only/d / Pre-session payload TTL / Complication 進階版 / Watch Settings 頁 / Watch 端輸入 body data / Set note 文字 / Template-Program-Exercise 編輯
  - ✅ **ADR-0008**：Multi-device strategy + Watch v1 scope — 已寫入 `docs/adr/0008-multi-device-strategy-and-watch-v1-scope.md`
- **Q11 HealthKit 整合邊界（剩餘部分）**：
  - ~~v1：Apple Health cardio workouts READ~~ → **延 v1.5+**（先 ship v1 再做）
  - ~~v1.5+：TrainingLog Session WRITE 回 HealthKit~~ → **已提前到 v1**（Q10 / ADR-0008，由 Watch 端 HKWorkoutSession 寫入）
  - **READ** v2+：bodyweight、HRV、睡眠等 body data
  - HealthKit Permission UX（v1）：app 第一次啟動時系統 dialog 請求 `HKWorkoutType` + `HKQuantityTypeIdentifier.heartRate` 兩個 scope
- **Q12 歷史頁三 sub-tab + 成就系統 + 統計頁**（ADR-0009 已釘）：
  - ✅ **Q12.1** PR bucket 命名修正：`最大力量 / 力量 / 增肌 / 肌耐力 / 耐力`（取代「純力量 / 力量 / 增肌 / 增肌耐力 / 純耐力」）
  - ✅ **Q12.2** 歷史頁分三 sub-tab：歷史 / 統計 / 獎章（segmented control 切換）
  - ✅ **Q12.3** 統計頁時間選擇 = 年/月/日/自選（segmented control + date range picker）
  - ✅ **Q12.4** 訓練部位概況人體圖：用 **per-Session 次數**著色（不是容量；容量會讓腿/背天然壓垮）；11 MG 5 階分位數冷藍 → 暖紅 gradient；v1 自畫 SVG / 男女不分；tap MG 顯示氣泡
  - ✅ **Q12.5** 各部位容量 = bar chart desc（沿用 ADR-0007 load_type 三類規則）
  - ✅ **Q12.6** 運動時長：自家 `session.ended_at - session.started_at` 為主、HKWorkout.duration fallback；新增 `session.ended_at TIMESTAMP NULL` 欄位；in-session pause 不算結束
  - ✅ **Q12.7** 獎章 4 類別 / 255 個 achievement_definition：第一次 (MG, bucket) 笛卡爾積 55 + 各部位 N 次 PR 132 + 各訓練目的 N 次 PR 60 + N 次重訓 8
  - ✅ **Q12.8** N 次 PR 維度 = v1 兩維度獨立（per MG + per bucket 互補，不笛卡爾積避免 660 獎章爆炸）；重量 / 容量分開計數
  - ✅ **Q12.9** 觸發時機 = Session 結束 summary 統一檢查；Watch v1 結束 summary 卡片不顯示獎章（避免 Watch query achievement state）；獎章 unlock 計算與顯示**只在 iPhone**
  - ✅ **Q12.10** Schema：新增 `achievement_definition` (255 系統 seed) + `achievement_unlock` (使用者解鎖紀錄，autoincrement int 主鍵) + `session.ended_at` 欄位
  - ✅ **拒絕的替代方案**：人體圖容量上色 / per-Set / per-Exercise 計數 / 獎章動態 derive / in-session 即時觸發 / Watch 端顯示獎章 / N 次 PR 笛卡爾積 (660 個) / N 次 PR 全 app 一條計數 (12 個) / 獎章 v1 自訂 / HKWorkout.duration 為主 / 訓記式階梯 (7/30/100/365) / bucket 簡化命名 (C 案) / bucket 訓記/Strong 命名 (B 案)
  - ✅ **ADR-0009**：歷史頁三 sub-tab + 成就系統 + 統計頁 — 已寫入 `docs/adr/0009-history-page-three-sub-tabs-and-achievement-system.md`
- **Q13 Anatomical muscle layer + Exercise primary/secondary mapping**（ADR-0010 已釘）：
  - ✅ **Q13.1** Sub-Group 升級為 anatomical muscle layer（19 muscle，每個 muscle 屬於 exactly 1 MG）
  - ✅ **Q13.2** 19 muscle 列表：胸(上胸/中下胸) + 背(背部/下背) + 腿(股四/膕繩) + 臀(上臀部/下臀部) + 肩(前束/中束/後束) + 斜方肌 + 二頭(二頭長頭/二頭短頭) + 三頭 + 小腿 + 前臂 + 核心(側腹/腹肌)
  - ✅ **Q13.3** Exercise → muscle m:n with role ∈ {primary, secondary}；primary 1-3 個 + secondary 0-N 個；Custom Exercise 允許 mapping 為空
  - ✅ **Q13.4** ADR-0002 局部反轉：**僅**反轉「背 SG = 水平/垂直」→「背部 / 下背」解剖切；其他 ADR-0002 結論全保留
  - ✅ **Q13.5** 二頭命名修正：「內側頭 / 外側頭」→「二頭長頭 / 二頭短頭」（解剖學標準，配合 ADR-0009 命名 pattern）
  - ✅ **Q13.6** Schema：DROP TABLE sub_group + DROP exercise.sub_group_id；CREATE TABLE muscle (id / name / mg_id / display_order) + exercise_muscle (m:n with role)；exercise.muscle_group_id 保留
  - ✅ **Q13.7** 體圖 asset 來源 = CC0 / Wikimedia Commons 解剖圖 → 自製 SVG（前後身兩張 + 19 muscle path）；統計頁 heatmap (by 11 MG) + Exercise 詳情頁 (by 19 muscle) 共用同一 SVG；男女不分，v1.5+ 加切換
  - ✅ **Q13.8** 動圖 / 示意圖 / 文字說明 v1 全延 v1.5+（自製成本太高、版權風險、內建動作 lifter 都熟）
  - ✅ **拒絕的替代方案**：完整解剖 muscle (30-40 個) / 完整 reverse ADR-0002 / 三級 mapping (primary/synergist/stabilizer) / 連續強度 0-100% / 請插畫家 / AI 生成 / 用 lib / 三層階層 (MG → SG → muscle) / 維持二頭口語命名 / Custom Exercise 強制 mapping
  - ✅ **ADR-0010**：Anatomical muscle layer + Exercise primary/secondary mapping — 已寫入 `docs/adr/0010-anatomical-muscle-layer-and-exercise-mapping.md`
- **Q14 Backup / Sync 策略**（ADR-0011 已釘）：
  - ✅ **Q14.1** Scope：v1 必做 a (換手機) + b (災難恢復)；v1 加分 d (JSON export)；**c (多裝置即時 sync) 排除**（自用 + 沒 iPad app + Watch 已 ADR-0008 處理）
  - ✅ **Q14.2** Mechanism：A — iCloud Drive 自動備份整個 SQLite 檔（拒 B CloudKit row-level / C 純 manual / D 依賴 iOS 系統備份）；Expo native module 或 react-native-cloud-storage 整合 ubiquity container
  - ✅ **Q14.3** 觸發 + 保留：a3 (Session 結束 + app background, 5min debounce) + b2 (最新 + 上一份 2 份 atomic rotate)
  - ✅ **Q14.4** Restore + 邊界：a2 (確認框含日期 + 內容預覽) + b2 (沒登 iCloud 警告但允許進 app) + c1 (skip onboarding) + s2 (Settings 搬進 SQLite — 新增 `app_settings(key, value)` 表)
  - ✅ **Q14.5** JSON export：a2 完整 dump + b1 JSON + c1 export only (v1) + d1 不加密 + e1 Share Sheet
  - ✅ **Q14.6** Watch sync vs Backup 順序保證：A3 — `pending_watch_sync` 旗標 + 5min timeout escape；新增 `session.last_watch_sync_at TIMESTAMP NULL`；force backup 缺漏時 Settings 顯示警告
  - ✅ **Q14.7** Failure escalation：a1 寫入失敗紅警示 + push / b1 連續 3 天（auto）/ 7 天（manual）escalation / c1 自動 fallback `backup.previous.sqlite` / d1 iCloud 不可用永久紅警示 + 一次 alert
  - ✅ **Q14.8** Mode toggle：B — 預設 auto + Settings「自動備份」toggle 切 manual；OFF = 純手動 + escalation threshold 3 → 7 天
  - ✅ **Schema 影響**：新增 `app_settings(key TEXT PK, value TEXT)` 表 + `session.last_watch_sync_at TIMESTAMP NULL` 欄位 + backup metadata（`backup_log` 表或 `app_settings` key）；不需要 row-level `last_modified` / `soft_delete`（c 排除）
  - ✅ **拒絕的替代方案**：CloudKit row-level / 純 manual export / iOS 系統 iCloud Backup / A1 等 Watch confirm / A2 立即不管 Watch / A4 觸發兩次 / Settings 留 AsyncStorage / JSON v1 雙向 import / Backup encryption / 三段式 mode (auto / manual / disabled) / 多版本保留 (b3 / b4) / 只保留 1 份 (b1) / Force 登 iCloud / Restore 自動執行不問
  - ✅ **ADR-0011**：Backup and Sync Strategy for v1 — 已寫入 `docs/adr/0011-backup-and-sync-strategy.md`
- **Q15 Set logger UI redesign**（grill 主結構完，已寫入 `docs/adr/0012-set-logger-redesign-schema-and-affordances.md`）：
  - ✅ **Q15.1** Set 編輯 flow = **inline edit + ✓ 不退**：點 kg / 次 方格 → 方格變可編輯狀態（outline / 變色）+ 鍵盤滑上來；Done 直接寫回，方格收回非編輯狀態；已 ✓ 的 set 改數字時 ✓ 維持，語意 = 「✓ = 這組存在 / 完成」（修正 typo / 微調，非反悔）。破壞性動作（刪除、跳過、複製）走 ⋯ menu。需要 keyboardAvoidingView 把被改的 row scroll 到上半屏避免被軟鍵盤蓋住。**拒絕**：modal sheet（每組多 2 tap + 動畫，set edit 沒 cancel/discard 語意）；點方格自動取消 ✓（95% 是微調而非反悔，每次都重 tap 過勞）
  - ✅ **Q15.2** Set 兩態 + 刪除動作（**Q15.4 修訂**：原三態 ⊘ 跳過剔除）（**Q15.5 修訂**：is_warmup → set_kind enum / 「⋯ menu」字眼全砍改 gesture 群，見 Q15.5 段）：`set.is_logged BOOLEAN` 新增（v008 migration），與「刪除整 row」動作共構出三種使用者意圖 — `◯` 空白 (`is_logged=F`，預填 Template snapshot 值) / `✓` 已完成 (`is_logged=T`) / **刪除 row**（從預建 row 列表整個 DELETE，分子分母都退）；`set.is_skipped` 欄位**不再使用**（v008 不新增；既有 v00x schema 若有則 deprecate，PR / 容量 engine 改成只看 is_logged + is_warmup）。Session 開始時依 Template snapshot **預先 batch insert** N 組 `◯` row，使用者點 ✓ 直接 toggle `is_logged`（E1-α，Q15.4 拍板）而不是新 insert（reference UI「session 開始看到 4 組空格等你填」是預期 flow）。PR / 容量計算規則：**只算 `is_logged=T AND is_warmup=F`** 的 set；既有 PR engine「忽略 `is_skipped`」邏輯改成「忽略 `is_logged=F` OR `is_warmup=T`」。進度 chip `已完成/計劃` 兩維度都能直接 query 同表算出（分子 `SUM(reps×weight) WHERE is_logged=T AND is_warmup=F`、分母 `SUM(reps×weight) WHERE is_warmup=F` — set 表只有一組 reps/weight 欄位，分子分母同欄位用過濾條件區分，見 Q15.5 段 schema model 澄清）。**拒絕**：A 二態（失去「未完成佔位」狀態，進度 chip 0/4 沒法算）；B-2 lazy 建 row（reference UI 強烈暗示預建，inline edit 第 2 組要先 +新增 多一步）；C 無 is_logged（reps/weight NULL 雙用 — 「未建」vs「已跳過」語義重疊）；原 ⊘ 跳過態（保留 row 標記 audit trail — Q15.4 拍板「Session 在運動中編輯，要快速、即時」哲學下 ⊘ 摩擦過大，使用者要撤就直接刪）
  - ✅ **Q15.3** 熱身組 + 動作記憶機制（**Q15.5 修訂**：`set.is_warmup BOOLEAN` → `set.set_kind` enum / 「⋯ menu 切熱身/正式」→ tap label cycle 單向三態，見 Q15.5 段）：
    - **熱身組進 schema** (`set.is_warmup BOOLEAN`, v008)，PR engine 過濾、容量計算過濾、UI 標「熱」label、正式組從 1 起編號；徒手動作 (`load_type='bodyweight'`) 預設 `warmup_set_count=0`，其他預設 `warmup_set_count=1`，使用者可從 ⋯ menu 切換熱身/正式
    - **動作記憶 = derived，不存 Exercise 級欄位**：定義為「該 Exercise 跨**所有 `template_exercise` row**，依 `updated_at` 排序最新的那筆」的 (warmup_set_count, working_set_count, planned_reps, planned_weight)。記憶不是另開冗餘狀態 — 記憶就是「最近被使用者調整過的某 template_exercise row 內容」
    - **Schema 變動 (v008)**：
      - `template_exercise.planned_sets` RENAME → `working_set_count INTEGER NOT NULL`
      - 新增 `template_exercise.warmup_set_count INTEGER NOT NULL DEFAULT 1`
      - 新增 `template_exercise.updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')*1000)`（unix ms）
    - **讀記憶情境**：(1) Template 編輯新增動作 row → query 該 exercise 跨表 updated_at 最新的 template_exercise → 帶 (warmup, working, reps, weight) 預填；(2) Session 內現場加動作（plan 外） → 同上 query；(3) **從 Template start Session 不查記憶** — Set 預填來自該 Template 自身 template_exercise 的當前值（語意：Template 是當前 Session 的計劃，不是「跨 Template 推論」）
    - **寫記憶情境**（更新 template_exercise.updated_at = now()）：(a) **Template 編輯 save**（直接編） / (b) **儲存到原 Template** Save-back Apply (既有 slice 4 流程) / (c) **另存新 Template** — 在 Session 結束 summary 加新動作；從 Session 實打結果建一組新 template + template_exercise rows；**這條是 freestyle Session 唯一的記憶寫入路徑**（freestyle 沒對應 Template 故 a/b 不適用）
    - **Edge cases**：
      - 首次接觸 Exercise（無 template_exercise row）→ fallback 空白 placeholder (warmup=1, working=1, reps=10, weight=0)
      - 「最新」基準 = **`template_exercise.updated_at` 單 row 級時戳**，不是 `template.updated_at`（整 Template 級），不是 `template.created_at`
      - 同 Exercise 跨 N 個 Template 的 row 都納入排序，沒「主 Template」權重；排序純粹比 updated_at 大小
      - Freestyle Session 不走 (c) → 進步永遠不寫進記憶（與 freestyle「臨場 / 不算進度」哲學一致）
    - **拒絕的替代方案**：
      - Exercise 級全域記憶欄位 `exercise.last_*`（冗餘狀態，跟 template_exercise 本身內容重疊）
      - 每 ✓ 打勾即時寫記憶（backoff set 會被當記憶，下次 Session 預填 20kg）
      - Session 結束 mode group aggregateActuals 寫回（雖然複用 slice 4 邏輯，但跟「使用者明示授權更新 (Save-back)」哲學打架）
      - Template snapshot 永遠勝（α 案，把記憶限縮在「新增動作」場景，但 (c) 另存路徑不存在時 freestyle 永遠寫不到記憶 — 此修正版透過 (c) 已解決）
      - 動作記憶永遠勝（β 案，覆蓋掉 Template 既有的「per Template 計劃目標」設計，影響面太大，違反 ADR-0003 三元組身份）
    - **影響的既有 slice**：slice 3 (templateManager) 要更新 `TemplateExerciseSpec`(planned_sets → working_set_count + warmup_set_count + updated_at)；slice 4 (saveBackDiff) 要在 Apply 時 bump updated_at；新動作（c）「另存新 Template」是新功能，排到 set logger redesign slice 內
  - ✅ **Q15.4 容量目標 chip — A 子題（來源 / 計算 / 操作）拍板**（C freestyle / F 歷史顯示 / G 視覺細節留下次 grill）（**Q15.5 修訂**：E2/E3「⋯ menu 刪除」→ 左滑 [刪除] button / E1 ✓ toggle 維持 / A1 分母解讀澄清為 row 級 reactive sum，見 Q15.5 段）：
    - **底層哲學 anchor**：**「Session 在運動中編輯，要快速、即時」** — 任何摩擦（二次確認、多 tap、autosave 之外的明示存檔）都要極力消除。所有 set logger 設計遇到「要不要加確認 / 加步驟」一律對齊這條
    - **B 案：Session 頂層無 chip**（容量 / 組數 / 動作數三條 stats 全剔除，AI 按鈕一併剔除），目標 chip **純存在於 per-exercise card 右上**（reference UI `0.0/3080.0` 形式：`已完成 / 計劃` 容量）
    - **A1 案：目標 source = Template snapshot 預建 row 加總**（不用額外欄位）：
      - 分母 = `Σ (reps × weight) WHERE session_set rows in this exercise AND is_warmup = F`（row 上**當下** reps/weight，不分 planned vs actual）
      - 分子 = `Σ (reps × weight) WHERE is_logged = T AND is_warmup = F`（同欄位加 is_logged 過濾 → 恆 ≤ 分母）
      - 驗算：reference UI 六角杆硬拉 5 row (1 熱 65×12 + 4 working 65×12+65×10+65×10+100×10) → 分母排除熱身 = 780+650+650+1000 = **3080** ✅ 對齊
    - **A1.a-α 新增一組從上一組複製**：使用者按動作卡內「新增一組」action 時，新 row planned 從**上一組（最後一個 working row）**複製 reps/weight，分母即時 +planned。**拒絕** β 新 row planned=NULL（chip 可超 100% 顯示 `4080/3080` 不直觀）/ γ 純 bonus（分子分母都不動，違反「新增一組就是計劃延伸」的直覺）
    - **A1.b N/A**：B 案 collapse 掉 session aggregate 後，「plan 外加新動作」對總分母的問題消失；新動作卡自有 chip
    - **A1.c 熱身組排除分母** ✅：`is_warmup=T` 的 row 不進分母也不進分子，跟 PR engine 過濾條件一致
    - **A1.d 三態重設（Q15.2 連動修訂，見 Q15.2 段）**：移除 ⊘ 跳過態，使用者意圖三層 = ✓ 加分子 / 空白不加分子 / **刪除 row 扣除分母**
    - **Z-β 正式組從 1 起編號** ✅：維持 Q15.3 拍板（圖上 working 編號 2/3/4/5 是 mockup 不準）。row 1 = 熱身（顯「熱」徽章不顯數字），row 2-N = working 從 1 起獨立編號（1/2/3/4...）
    - **E1-α 點 ✓ 框直接 toggle `is_logged`**：一鍵翻 ✓↔空白，不彈 menu 不確認。**拒絕** β 取消要走 ⋯ menu（多 2 tap）/ γ 已 ✓ 取消要長按確認（運動中長按摩擦過大）
    - **E2 刪除 row 走 ⋯ menu，無二次確認**：per-set 右側 ⋯ menu 含「刪除」action，點完直接 DELETE。**拒絕**：刪除按鈕直接出在 row 上（誤觸風險）/ 刪除前彈窗確認（「再次操作確認」就是運動中最不想要的摩擦）
    - **E3 已 ✓ 的 row 可直接刪，無二次確認**：不要求先 unprick 再 delete，⋯ menu 一次砍掉
    - **per-exercise card 內 action 列**（不在底部 session bar）：`新增一組` + `動作歷史`（slice 8 既有 modal）；session 底部 bar 只剩 `加動作` ➕（plan 外加新動作）
    - **per-exercise 備註位置**：動作圖正下方、第一 set 上方，placeholder「點擊輸入備註」（Q15.5 grill 持久化機制）
    - **list view 卡片下方圓點**：`5組` 對應 5 個 row 含熱身（β 規則：list view 顯示總 set 數 = warmup + working）；圓點視覺後續決定（已 ✓ → 實心）
    - **拒絕的替代方案**：A2 Live Template (chip 跟 row 來源不一致)/ A3 每次手填（多餘摩擦）/ A4 歷史推（跟 Template planned 衝突，類設置遞增規則 Q15 已剔除）/ session 頂層 chip（reference UI 明確叉掉）
    - **下次 grill 接續**：C3.1 已拍板（α 顯 0/0，見 Q15.5）；C3.2 / F / G / Q15.5b 全拍板（見 Q15.5b 段）；Q15 主結構完，剩 Backlog 5-11
  - ✅ **Q15.5 Per-row 結構 + Affordance + Dropset Cluster + C3.1 拍板**（2026-05-11；本輪 grill 修訂 Q15.1 / Q15.2 / Q15.3 / Q15.4 多處，整合 reference UI 競品 dropset 模塊）：
    - **底層哲學延伸**：拿掉 per-set ⋯ menu icon — 視覺降噪 + 全 gesture-driven；訓練學語意優先（dropset 重新建模為 cluster 不是 individual rows）
    - **Row 結構**（從左到右）：`[熱/#N/D#] reps weight 📝(備註預覽) ★(破PR) ✓`
      - label tap cycle 單向（熱→#N→D#→熱），3 tap 回原態；切換後整列編號 derived 重算（working 跳過 dropset、dropset 從 D1 起獨立計）
      - 「📝 (備註預覽)」存在 set.notes 才顯，row 下方一行 inline 淡灰小字
      - 「★」破 PR row（slice 8 PR engine 偵測）；多重 PR 顯示細節 leftover
      - ✓ 在最右（高頻、大拇指 reach）
    - **Affordance 5 件**（無 ⋯ icon）：tap label cycle 三態 / tap ✓ toggle / 右滑 → [新增 + 備註] button / 左滑 → [刪除] 紅 button / 長按 → drag-reorder mode
    - **Schema 變動（v008 累加 — 含 Q15.2 / Q15.3 既拍）**：
      - **改** `set.is_warmup BOOLEAN` → `set.set_kind TEXT CHECK (set_kind IN ('warmup','working','dropset')) NOT NULL DEFAULT 'working'`
      - **維持** `set.is_logged BOOLEAN NOT NULL DEFAULT 0`（Q15.2）
      - **新增** `set.notes TEXT NULL`（per-set 備註）
      - **新增** `set.position INTEGER NOT NULL`（顯式排序，migration 依 created_at 補值）
      - **新增** `set.parent_set_id TEXT NULL REFERENCES set(id) ON DELETE CASCADE`（dropset cluster B3）
    - **Dropset Cluster 結構（B3 路徑：parent_set_id 連結，非新表也非 JSON 欄）**：
      - cluster 首 step `parent_set_id=NULL` + set_kind='dropset' + 有 D# label + ✓ button
      - 後續 step `parent_set_id=<root.id>` + set_kind='dropset' + 無 label，行為純 button-driven
      - 後續 step 右側 button (γ)：中間 step 顯 [−]（刪該 step）/ 最末 step 顯 [− +]（− 刪 / + append next step）
      - cluster 內 step 不接受 gesture（左滑 / 右滑 / 長按 對 cluster 內 step 失效，避免跟 row 級語意衝突）
      - `is_logged` 只在 cluster 首 step 有意義（cluster 完成狀態 = root.is_logged）
      - SQL 聚合：`GROUP BY COALESCE(parent_set_id, id)` 取得 cluster grouping
    - **計算規則**（warmup / working / dropset cluster 矩陣）：

      | 規則 | warmup | working | dropset cluster |
      |------|--------|---------|-----------------|
      | 容量 (slice 8 volumeEngine) | ✗ | ✓ | ✓ (cluster ✓ → Σ all steps) |
      | 分母 A1 chip | ✗ | ✓ | ✓ (Σ planned all steps) |
      | PR engine (slice 8) | ✗ | ✓ | ✗ (整 cluster 跳過) |
      | e1RM 顯示 | ✗ | (動作歷史 modal) | ✗ |
    - **Q15.4 A1 分母解讀澄清（重要）— schema model**：set 表只有一組 `reps INTEGER` + `weight REAL` 欄位（**不分 planned vs actual**）。預建 `◯` row 時欄位填 Template snapshot / 動作記憶 / fallback 值；user inline edit 改的就是同一組欄位
      - 分母 = `Σ (reps × weight) WHERE set_kind != 'warmup'`（row 上當下值，不過濾 is_logged）
      - 分子 = `Σ (reps × weight) WHERE is_logged=T AND set_kind != 'warmup'`
      - 同欄位 + 過濾條件 superset → **分子 ≤ 分母恆成立、chip 範圍恆 0-100%，無「超 100%」場景**
      - 之前 Q15.2 / Q15.4 草拍寫的 `planned_reps × planned_weight` 是 sloppy notation；不是兩組獨立欄位
      - inline edit 為何 reactive：user 改數字直接動分子（若 logged）+ 分母（永遠動），同步前進；分子永不超過分母
    - **C3.1 freestyle 首次接觸 chip → α (顯 0/0)**：因分母 reactive 規則，首次接觸 fallback (warmup=1, working=1, reps=10, weight=0) 的 `0/0` 只在 add exercise → user 動 planned 前的瞬態存在；user 一動 planned (例如 inline edit weight=12.5) 立刻變 `0/125` → 正常。**拒絕** β (分母=0 隱藏 chip → 動 planned 後 chip 突現的視覺跳動) / γ (純累積 — freestyle 不再「無目標」此案已 N/A)
    - **PR ★ on row（d-A）**：破 PR row 標 ★（slice 8 engine 已能偵測）；e1RM **不進 row**（slice 8 動作歷史 modal 已有 e1RM 趨勢圖，row 上再放冗餘）；多重 PR 顯示細節（一顆 vs 多顆 / 顏色分桶）leftover
    - **競品 reference UI 剔除清單**（2026-05-11 圖中紅 X）：⋯ icon / + − 加減重量按鈕 / 「記錄左右」toggle / 「每組計時」toggle / 「喵喵 AI」按鈕 / cluster 內 step 的「遞 N」label
    - **翻盤的既有拍板**：
      - Q15.1 「破壞性動作（刪除、跳過、複製）走 ⋯ menu」→ ❌ 全 gesture-driven 取代
      - Q15.3 `set.is_warmup BOOLEAN` → ❌ 改 `set.set_kind` enum；「⋯ menu 切熱身/正式」→ ❌ 改 tap label cycle
      - Q15.4 E2「per-set 右側 ⋯ menu 含『刪除』action」→ ❌ 改左滑 [刪除] button；E3 同理（仍無二次確認）
      - Q15.4 「拒絕：刪除按鈕直接出在 row 上」→ ⚠️ 部分翻盤（左滑後 button 出現，仍要刻意水平滑才見，跟「row 上永遠可見 destructive button」有別）
    - **影響的既有 slice**：
      - slice 8 PR engine 過濾：`is_warmup=T` → `set_kind != 'working'`（同時排 warmup + dropset）
      - slice 8 volumeEngine 過濾：`is_warmup=T` 排除 → `set_kind = 'warmup'` 排除（working + dropset 算容量）
      - slice 8 動作歷史 modal：cluster 渲染要 group by `parent_set_id`，UI 把 cluster step folded under root
      - slice 4 saveBackDiff：cluster aggregate 計算改成 cluster 級（不是 step 級）
    - **leftover 待 grill**：見 Q15.5b 段（Q15.5b / C3.2 / F / G 已拍板）；剩 Backlog 5-11
  - ✅ **Q15.5b Cluster 級 affordance + C3.2 + F + G 拍板**（2026-05-11；Q15.5 leftover 一次清掉，Q15 set logger redesign 主結構全完）：
    - **Q15.5b Cluster 首 step row 三 gesture（全 α）**：
      - **左滑** → [刪除整 cluster] 紅 button：一鍵砍掉首 step + 所有 children；**無二次確認**（哲學一致 — 左滑本身已是刻意 affordance）
      - **長按** → 整 cluster 浮起拖移：children 跟 root 一起移動，cluster 是 reorder 單位（schema 上 parent_set_id 不變、只 position 重編）
      - **右滑** → [新增 + 📝 備註] 兩 button：「新增」= 在當前 cluster 後 append **新 cluster**（D# 編號 derived；planned 從當前 cluster 首 step 複製）；「備註」= 編 `root.notes`（cluster 級備註存 root row）；子 step 雖 schema 允許 notes 但 UI 不暴露編輯入口（dead field for cluster steps）
      - **拒絕**：β 左滑只刪首 step（children parent_set_id dangling 不可行）/ β 長按只移首 step（schema 衝突）/ β 右滑新增 step（重複現有 cluster 內 [+] button）/ γ 不可長按 / γ 右滑隱藏新增（user 無法 append 新 cluster）
    - **C3.2 Freestyle 加動作預建 row → α（預建）**：
      - 加動作後**立刻**依 Q15.3 動作記憶 / fallback batch insert `(warmup_set_count + working_set_count)` 組 ◯ row
      - 有記憶（臥推 1+4×10@60）→ 預建 5 row；首次接觸 fallback (warmup=1, working=1) → 預建 2 row；徒手 fallback (warmup=0, working=1) → 預建 1 row
      - 跟 Template-based session 預建邏輯**同 code path**（Q15.2 既拍）— freestyle 不另開分支
      - 兩種 freestyle 情境共用：(i) Today 直接 Start Session 沒選 Template / (ii) Template-based session 中底部 ➕「加動作」plan 外加
      - **拒絕** β Lazy 建 row（多 tap + code path 分叉 + 分母 0/0 場景擴大）/ γ 混合（記憶帶 warmup + 1 working：無強理由折衷）
    - **F 歷史頁查看舊 Session chip → α（顯示，同 session 進行中 format）**：
      - chip 在 session ended 後仍顯示，分子 / 分母用 immutable 狀態算（row 上當下 reps/weight）
      - 用途：訓練復盤（看哪些 session 沒做完）+ 跨 session 進步對比
      - 適用：slice 9 歷史 sub-tab → session detail view + slice 8 動作歷史 modal（cluster 內 step 仍 fold under root）
      - **拒絕** β 隱藏（失去完成度資訊 + UI 不一致）/ γ 只顯 actual 無分母（失去計劃對比）
    - **G 視覺細節**：
      - **G.1 進度條 → β（文字 + bar）**：chip 數字 `0.0/3080.0` 下方一條**系統主色細 bar** 填充 0-100%；**不顯百分比數字**（chip 數字已能心算 78%）；bar 純色不 by set_kind 著色
      - **G.2 超 100% → N/A**：schema model 下分子 ≤ 分母恆成立（同欄位 + 過濾條件 superset），chip 範圍恆 0-100%；**無「超 100% 視覺處理」需求**
      - **G.3 精度 → α（統一 1 位小數）**：`0.0/3080.0`、`2400.5/3080.0`；對齊 reference UI 風格 + inline edit reactive 變動平滑（避免「0 位 ↔ 1 位」視覺跳動）
    - **下次 grill 接續**：Q15 set logger redesign 主結構**全拍板完**；剩 **Backlog 5-11**（每條獨立 grill 題、可分次處理）：
      - **5.** per-exercise notes 持久化（`session_exercise.notes`？save-back 帶回 Template？）
      - **6.** session 計時暫停 / 繼續（vs Watch v1 #10）
      - **7.** session title 編輯（覆蓋 vs 另存 `session.title`）
      - **8.** 獎章 sub-tab 去哪（頂層 tab? Profile? 剔除?）
      - **9.** 歷史 = 月曆視圖（重設 slice 9 三 sub-tab 範圍）
      - **10.** 訓練類型 label 系統（胸/肩 / 腿(蹲) / 腿(垂直)/肩 / 胸/背(水平) / 腿(拉)） source + 顏色 mapping
      - **11.** **Template 編輯流程 UI redesign**（與「模版配色」+ 動作卡 collapsed/expanded + per-exercise ⚙ menu + 底部 4-action bar 等子題；可能拆獨立 ADR 或併入 ADR-0012）
    - **ADR-0012 已寫入** ✅（2026-05-11，`docs/adr/0012-set-logger-redesign-schema-and-affordances.md`）：整併 Q15.1–Q15.5b 全拍板（schema model + per-row 5 gesture + cluster 3 gesture + 計算規則矩陣 + 37 條拒絕替代方案 + slice 影響清單 + v1 時程 +5 週可吸收）

## Flagged ambiguities

- 「課表」一詞口語上有時指 Program、有時指 Template — 已固定為 **Template**。Program 改稱「計畫」。
- 「Program」口語可同時指：(1)「訓練計畫 entity」（=「Program 主標籤」，帶日曆）；(2)「Program 副標籤」（per-cell rep range tag）。schema 拆為 **Program** + **Program 副標籤** 兩個 entity；UI 上分別在「Program 分頁」（管理計畫）與「日曆 cell 的副標籤按鈕」呈現。
- 「腹部」與「核心」常被當同義詞使用 — 已決定 **不設「腹部」MG**，所有腹直肌/腹斜/腹橫的直接訓練（卷腹、側棒、leg raise）以及抗旋/抗伸穩定訓練（Pallof press, dead bug, bird-dog）都歸入 **核心**。注意：核心 MG 內仍可拆 muscle (側腹 / 腹肌)，這發生在 muscle layer，不違反「11 MG 不設腹部」原則。
- 「二頭 → 內側頭 / 外側頭」原為口語命名，**ADR-0010 已反轉為解剖學標準「二頭長頭 / 二頭短頭」**（外側頭 = 長頭、內側頭 = 短頭）。schema / UI 一律用長/短頭。
