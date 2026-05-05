# TrainingLog

iOS 重訓紀錄 App。記錄一次次去健身房的訓練內容，並支援長期訓練計畫與訓練範本。

## Scope

TrainingLog 紀錄 **重訓 (weight training) Sessions only**。有氧、HIIT、跑步等非重訓運動由使用者直接在 Apple 健身 App 執行，本 app **不提供 cardio entry point**，**未來更新也不規劃自建 cardio session schema**（理由：Apple Fitness + Apple Watch 對心率 / GPS / 卡路里整合難以追上；多元運動 schema 會破壞 Set = weight + reps 的乾淨假設；focus 是 v1 核心競爭力）。

Cardio 資料的呈現透過 HealthKit 整合：
- v1：READ Apple Health 的 cardio workouts，在 TrainingLog 顯示摘要（不存獨立資料）
- v1.5+：WRITE TrainingLog Session 回 HealthKit 為 `HKWorkoutType=traditionalStrengthTraining`，讓 Apple Health 活動圓圈紀錄到
- v2+：READ body data（bodyweight、HRV、睡眠等）給訓練 readiness 用
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
**Template 處方依 (Template name, Program, Program 副標籤) 三元組唯一**：同 name 在同 Program 下，因副標籤不同可有不同處方。
例：增肌-Q1 第 1-2 週的「胸日 / 10-12RM」處方 = 60kg×10×3；第 3-4 週的「胸日 / 8-10RM」處方 = 70kg×8×3 → 兩筆獨立 Template entity。
_Avoid_: Tag（過泛）, Phase（暗示時序）, Mode

**Template** (UI: 課表):
單次訓練的範本（例：「胸日」、「腿日」），用來生出 Session。**儲存完整處方**：有序的 Exercise 清單（含 SetGroup 結構）+ 每個 Exercise 的組數、目標重量、目標 reps。
**Identity = (name, Program, Program 副標籤) 三元組**。同 name 配不同 (Program, 副標籤) 組合視為不同 Template entity（例：「胸日 (增肌-Q1, 10-12RM)」、「胸日 (增肌-Q1, 8-10RM)」、「胸日 (力量-Q2, 6RM)」為三個獨立 Template）。
**「Template」= entity（三元組整體）**；**「Template name」= 字串 label**（例：「胸日」這個字串本身）。同 name 的多個 Template 是獨立的 sibling entities，**不是「1 個 Template 的多個版本」**。schema / ADR / 處方 / Snapshot / Save-back / 歷史指標 scope 一律以 Template entity 為單位；UI 顯示用「name (主標籤, 副標籤)」格式（例：「胸日 (增肌-Q1, 10-12RM)」）。
**Exercise 清單分兩區**：
- **一般動作區**：處方 per `(name, Program, 副標籤)` 三元組獨立，跟著週期化變化
- **常設動作區**：處方 per `name` **共享**（同 name 的所有 sibling Templates 共用同一份處方）。新建三元組時**自動繼承**同 name 已有的常設動作池（含處方）
動作可在 Template 編輯頁透過動作右上設置「設為常設運動」/「設為一般運動」在兩區之間移動。
UI 上 Template 清單以 **Template name** 分組顯示，使用者點 name 後再選 (Program, 副標籤) 組合即定位到具體 Template。
_Avoid_: Routine, Workout template, 模板, 範本; 「Template instance」（避免 instance / entity 雙詞混用，一律稱 Template 或 sibling Templates）

**常設動作** (UI: 常設運動):
Template 內的 Exercise 分區之一（對 vs 一般動作）。處方 per Template name 共享，跨同 name 的所有 sibling Templates 不變。
**設計目的**：讓 finisher / 收操 / 暖身 / 不參與週期化進展的動作能維持單一處方源 — 修改一處同步到所有 sibling Templates，避免人工同步。
**舉例**：「胸日」這個 Template name 有三個 sibling Templates（10-12RM / 8-10RM / 6-8RM），蝴蝶機作為 finisher 屬於常設動作 → 三個 sibling Templates 都顯示同一筆「蝴蝶機 30kg×15×2」，改其中一個就改全部。
_Avoid_: 永久動作、固定動作、Evergreen exercise（內部 codename 可用）

**Snapshot semantics**:
Session 由 Template 生出時，**複製** Template 當下的完整處方（Exercise 清單 + 組數/目標重量/目標 reps + Program + Program 副標籤）到 Session，**包含一般動作區 + 常設動作區的所有 Exercises**。
之後 Template 被修改不會影響歷史 Session。

**Save-back semantics** (Session → Template 反向更新):
Session 結束時，若實際組數/重量/次數與 snapshot 處方不同，跳「是否同意修改模板？」dialog。同意則依動作所屬分區決定傳播範圍：
- **一般動作的修改**：只更新本次 Session 對應的 (Template name, **這個** Program, **這個** 副標籤) 三元組的 Template 處方（其他 sibling Templates 不動）
- **常設動作的修改**：更新該 Template name 下**所有** sibling Templates 的 Template 處方（因為常設動作的處方是 name-level 共享）
拒絕則：本次 Session 內仍保留實際數據（不影響歷史紀錄），Template 處方不動。
_儲存實作（每個 Template 各存一份 + propagate vs 抽出 common 表 + JOIN 渲染）留 ADR 決定，CONTEXT.md 只鎖 semantics。_

**Autofill** (UI: 自動帶入):
Session 開始時，每個 Exercise 的組數 + 目標重量 + 目標 reps **直接從 Template 處方帶入**（即 snapshot 內容）。**歷史 Sessions 不影響 input 預填值** — 上次實績、最大容量、最大重量等資訊以「歷史指標」形式 inline 顯示在動作名旁，由使用者自行決定要否手動覆寫 input（不自動覆寫，避免破壞 Template 處方語意）。

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
_Avoid_: Rep（rep 是 set 內的次數，不是同義詞）

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
即時顯示 (累計實際容量) / (Template 處方計畫容量)。per-Exercise（例：0.0/2080.0）+ per-Session 兩級。
計畫容量 = sum(處方每組 weight × reps × sets)。

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
- Tier 1：chip 顯示純數字，例：`[上次 85×8]`
- Tier 2：chip 加淡色 ↑ icon，例：`[上次 85×8 ↑]`；tap chip 跳 tooltip 顯示「來自 *其他 Template* `name (Program 主, 副標籤)`」+ 該 Session 日期
- 全空：chip 灰底顯示「—」，例：`[上次 —]`，tap 不展開

**範例**：`深蹲` <br> `[上次 85×8] [容量峰 80×10] [重量峰 100×3]`

**重要**：歷史指標**不**自動覆寫 Session 開始的 input 預填值（input 始終是 Template 處方），只是讓使用者**看到**參考數字以利 progressive overload 判讀。覆寫由使用者手動操作。

**歷史頁**：per-Exercise「動作歷史」按鈕開啟完整列表，scope 細節待 Q6.3-γ-iii 確定。

## Relationships

- 一個 **Program** = 起始日期 + 循環長度 + 循環次數 + 日曆網格。包含 N 個 **循環**（N = 循環次數），每個循環長 D 天（D = 循環長度）。日曆網格 = N × D 個 cells，每個 cell = (循環 index, day index, Date, Template, Program 副標籤)
- **任何時刻最多 1 個 active Program**：schedule-bearing Programs 的 [起始日期, 結束日期] 不允許重疊；建立時 hard block + smart suggest 自動建議銜接日（既有 Program 結束日 + 1）
- **Active 判定純日期推算**：今日 ∈ [起始日期, 結束日期] = active；超出範圍 = 排定中 / 已結束
- 預設循環間 pattern（Template + 休息日）一致（fan-out from 循環 1）；任一 cell 可手動 override
- 一個 **Template** 必綁定 1 個 **Program**（含預設「無」= 無 Program 隸屬的 freestyle Template，不出現在任何 Program 日曆）+ 1 個 **Program 副標籤**（含「無」）
- **Template identity = (name, Program, Program 副標籤) 三元組**：name 相同但 (Program, 副標籤) 不同 → 不同 Template entity
- 一個 **Template** 內 Exercise 清單分 **一般動作區** + **常設動作區**：一般動作處方 per 三元組獨立；常設動作處方 per name 共享（同 name 所有 sibling Templates 共用），新建三元組時自動繼承同 name 的常設動作池
- 一個 **Template** 可生出 0..N 個 **Sessions**
- 一個 **Session** 可選擇性地參考 0..1 個 **Template**（freestyle Session 沒有）
- **Session → Template Save-back 傳播**：Session 結束時若實際數據與處方不同 → 「同意修改？」dialog；同意則一般動作只更新本三元組、常設動作更新該 name 下所有 sibling Templates
- **Session 與 Program 日曆 cell 對應 by date**（display time 比對，不需要 persistent FK，進入路徑不影響；單 active Program 限制下，每個 Session 最多 overlay 1 個 Program 的 cell）
- cell 顯示規則：
  - 計畫 + 同日 Session 匹配 (Template + 副標籤一致) → **✅**
  - 計畫 + 同日 Session 不匹配（含「計畫休但練了」、「計畫練但休了」、「選了非該 Program 的 Template」、「Template 對但副標籤不符」）→ **⚠️**
  - 計畫 + 無同日 Session → 維持 planned 顯示
- 一個 **Session** 中的動作分兩類：來自 Template 的 + **Extra Exercises**
- **Session Split** 把 Extra Exercises 拆成另一個 freestyle Session
- 一個 **Exercise** 屬於一個 **Muscle Group** + 一個 **Equipment**
- **Session** 紀錄的是 (Exercise, Set) 的實際執行（並 snapshot 自 Template 處方）
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
  - ✅ **Q6.3-α** Autofill source = Template 處方（snapshot 即填）；歷史不覆寫 input，走 inline 歷史指標路線
  - ✅ **Q6.3-β** 歷史指標 scope = per Template entity (三元組)（scope a）
  - ✅ **Q6.3 baseline UI**：per-set ✓ 完成勾、per-Exercise 備註、per-Exercise volume 進度、熱身組 label「熱」+ 正式組從 1 起、拿掉 per-Exercise 簡單/正常/困難、拿掉 AI 按鈕、Apple Watch 控制（在錶練）deferred
  - ✅ **Q6.3-γ-i** 三指標版面 = 動作名下方一列 3 chip（B 方案）
  - ✅ **Q6.3-γ-ii** 無歷史 fallback = 兩階：Tier 1 entity 嚴格 → Tier 2 (Template name, 副標籤) 跨 Program 主標籤；Tier 3 不啟用；三 chip 同步 tier；Tier 2 chip 加 ↑ icon + tap chip 顯示來源 tooltip
  - ⏳ **Q6.3-γ-iii 待 grill**：「動作歷史」按鈕完整列表頁 UX、scope 是否與 inline 一致 / 是否提供切換 / per-Exercise 還是 per-Template entity 為主軸
- **Q8 Personal Record (PR) 定義**：PR 是 per Exercise 還是 per (Exercise, rep range)？E1RM 計算法？
- **Q9 Body data**：體重、圍度、進度照片是否進同一個資料庫？跟 HealthKit 怎麼分工？
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
