# TrainingLog

iOS 重訓紀錄 App。記錄一次次去健身房的訓練內容，並支援長期訓練計畫與訓練範本。

## Language

**Session** (UI: 訓練):
一次完整的健身房進出，從開始紀錄到結束。
_Avoid_: Workout, Training（動詞例外）, 紀錄

**Program** (UI: 計畫，亦稱 **Program 主標籤**):
跨多次 Session 的長期訓練架構，作為 Template 的 **1st-tier 分類**。
例：增肌-Q1、力量-Q2、常設、無（預設）。使用者「+ 新增」自訂命名，從下拉選單選取。
內容包含一個有序的「預計訓練」日曆 — 以日期為單位的網格，每個 cell 可掛 (Template, Program 副標籤)。
日曆 UI 支援批次套用：橫框選整週 → 一鍵套副標籤；縱框選週幾 → 一鍵套 Template。
建立方式：手動排程，或透過 wizard 一鍵生成（例：「4 週循環」wizard）。
Program 分頁 = 預計訓練。對照的「歷史」分頁 = 實際訓練（已完成的 Sessions）。
_Avoid_: Plan, Cycle（cycle 是 program 內部結構，不是同義詞）, 訓練計畫

**Program 副標籤** (UI: Program 副標籤):
訓練強度 / 模式的 **2nd-tier 分類**，per-cell 套用在 Program 日曆上。
例：12-15RM、10-12RM、8-10RM、6-8RM、無。使用者直接輸入文字命名（free-form），之後可從按鈕重複套用。
**Template 處方依 (Template name, Program, Program 副標籤) 三元組唯一**：同 name 在同 Program 下，因副標籤不同可有不同處方。
例：增肌-Q1 第 1-2 週的「胸日 / 10-12RM」處方 = 60kg×10×3；第 3-4 週的「胸日 / 8-10RM」處方 = 70kg×8×3 → 兩筆獨立 Template entity。
_Avoid_: Tag（過泛）, Phase（暗示時序）, Mode

**Template** (UI: 課表):
單次訓練的範本（例：「胸日」、「腿日」），用來生出 Session。**儲存完整處方**：有序的 Exercise 清單（含 SetGroup 結構）+ 每個 Exercise 的組數、目標重量、目標 reps。
**Identity = (name, Program, Program 副標籤) 三元組**。同 name 配不同 (Program, 副標籤) 組合視為不同 Template entity（例：「胸日 (增肌-Q1, 10-12RM)」、「胸日 (增肌-Q1, 8-10RM)」、「胸日 (力量-Q2, 6RM)」為三個獨立 Template）。
UI 上 Template 清單以 name 分組顯示，使用者點 name 後再選 (Program, 副標籤) 組合即定位到具體 Template。
_Avoid_: Routine, Workout template, 模板, 範本

**Snapshot semantics**:
Session 由 Template 生出時，**複製** Template 當下的完整處方（Exercise 清單 + 組數/目標重量/目標 reps + Program + Program 副標籤）到 Session。
之後 Template 被修改不會影響歷史 Session。

**Autofill** (UI: 自動帶入):
Session 開始時，每個 Exercise 的組數 + 目標重量 + 目標 reps **直接從 Template 處方帶入**（即 snapshot 內容）。
_待 Q6.3 釐清：當有同 Template 的歷史 Session 時，是否覆寫或對照「上次實際達成」（progressive overload 場景）？_

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
選填（UI 預設折疊）：RPE、組間休息、備註、是否暖身組。
_Avoid_: Rep（rep 是 set 內的次數，不是同義詞）

**SetGroup**:
把多個 Set 組成一個訓練單元。v1 支援兩種型態：
- **Superset**（超級組）：多個不同 Exercise 的 Set 交替執行、組間無休息
- **Drop Set**（遞減組）：同一 Exercise，一組做完立刻降重續做（schema 上是多個 Set 共享同一 SetGroup）
其他進階組型（rest-pause、AMRAP、cluster、giant set）v1 暫不建模，使用者用備註欄記。
_Avoid_: Set Block, Cluster（cluster 是另一種特定組型）

## Relationships

- 一個 **Program** 包含一個有序的日曆網格，cells = (Date, Template, Program 副標籤)
- 一個 **Template** 必綁定 1 個 **Program**（含預設「無」）+ 1 個 **Program 副標籤**（含「無」）
- **Template identity = (name, Program, Program 副標籤) 三元組**：name 相同但 (Program, 副標籤) 不同 → 不同 Template entity
- 一個 **Template** 可生出 0..N 個 **Sessions**
- 一個 **Session** 可選擇性地參考 0..1 個 **Template**（freestyle Session 沒有）
- **Session 與 Program 日曆 cell 的對應 by date**（display time 比對，不需要 persistent FK，進入路徑不影響）
- cell 顯示規則：
  - 計畫 + 同日 Session 匹配 (Template + 副標籤一致) → **✅**
  - 計畫 + 同日 Session 不匹配（含「計畫休但練了」、「計畫練但休了」）→ **⚠️**
  - 計畫 + 無同日 Session → 維持 planned 顯示
- **歷史分頁顯示全部 Sessions**（不限 Program；Program 分頁是 derived view，不存獨立 link）
- 一個 **Session** 中的動作分兩類：來自 Template 的 + **Extra Exercises**
- **Session Split** 把 Extra Exercises 拆成另一個 freestyle Session
- 一個 **Exercise** 屬於一個 **Muscle Group** + 一個 **Equipment**
- **Template** 由有序的 **Exercise** 列表 + 處方 + (Program, Program 副標籤) 組成
- **Session** 紀錄的是 (Exercise, Set) 的實際執行（並 snapshot 自 Template 處方）
- **歷史**分頁顯示所有已完成的 Sessions（不限定屬於哪個 Program）

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
  - ⏳ **Q6.2.C-i** 多 Program 並存時，同一 Session 是否在每個「進行中」Program 的 cell 都 overlay？「進行中」如何判定（status 旗標 vs Program 起訖日期）？
  - ⏳ **Q6.2.D** Wizard 範圍：除了「4 週循環」還有哪些 preset？是否支援使用者自訂 wizard？
- **Q6.3 Autofill 與歷史互動**：有歷史 Session 時，是否覆寫 / 對照 Template 處方（progressive overload 場景）？
- **Q8 Personal Record (PR) 定義**：PR 是 per Exercise 還是 per (Exercise, rep range)？E1RM 計算法？
- **Q9 Body data**：體重、圍度、進度照片是否進同一個資料庫？跟 HealthKit 怎麼分工？
- **Q10 Sync / multi-device**：純 local-first 還是 iCloud/CloudKit 同步？影響 schema 是否需要 conflict-resolution 欄位
- **Q11 HealthKit 整合邊界**：寫入什麼（workout sample？）、讀取什麼（bodyweight？）、何時同步

## Flagged ambiguities

- 「課表」一詞口語上有時指 Program、有時指 Template — 已固定為 **Template**。Program 改稱「計畫」。
- 「Program」口語可同時指：(1)「訓練計畫 entity」（=「Program 主標籤」，帶日曆）；(2)「Program 副標籤」（per-cell rep range tag）。schema 拆為 **Program** + **Program 副標籤** 兩個 entity；UI 上分別在「Program 分頁」（管理計畫）與「日曆 cell 的副標籤按鈕」呈現。
- 「腹部」與「核心」常被當同義詞使用 — 已決定 **不設「腹部」MG**，所有腹直肌/腹斜/腹橫的直接訓練（卷腹、側棒、leg raise）以及抗旋/抗伸穩定訓練（Pallof press, dead bug, bird-dog）都歸入 **核心**。
- 「二頭 → 內側頭 / 外側頭」是口語命名；解剖學正名為 **短頭 / 長頭**（外側頭 = 長頭）。schema/UI 一律用內/外側頭。
