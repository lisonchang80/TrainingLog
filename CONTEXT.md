# TrainingLog

iOS 重訓紀錄 App。記錄一次次去健身房的訓練內容，並支援長期訓練計畫與訓練範本。

## Language

**Session** (UI: 訓練):
一次完整的健身房進出，從開始紀錄到結束。
_Avoid_: Workout, Training（動詞例外）, 紀錄

**Program** (UI: 計畫):
跨多次 Session 的長期訓練架構（例：PPL 跑 8 週、5x5）。
_Avoid_: Plan, Cycle, 訓練計畫（口語可，schema 不用）

**Template** (UI: 課表):
單次訓練的範本（例：「胸 A」、「腿日」），用來生出 Session。**只儲存有序的 Exercise 清單（含 SetGroup 結構）**，不儲存組數、目標 reps、目標重量 — 這些都靠 Session 開始時的 autofill 從歷史查。
_Avoid_: Routine, Workout template, 模板, 範本

**Snapshot semantics**:
Session 由 Template 生出時，**複製** Template 當下的 Exercise 清單到 Session。
之後 Template 被修改不會影響歷史 Session。

**Autofill** (UI: 自動帶入):
Session 開始時，每個 Exercise 的組數 + 重量 + reps 從歷史 Session 查出來預填。
_待 Q6 釐清來源優先序（D1 同 Program+同 Template / D3 任何 Session+同 Exercise / fallback 規則）_

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

- 一個 **Program** 包含 0..N 個 **Templates**
- 一個 **Template** 屬於 0..1 個 **Program**（可獨立存在）
- 一個 **Template** 可生出 0..N 個 **Sessions**
- 一個 **Session** 可選擇性地參考 0..1 個 **Template**（freestyle Session 沒有）
- 一個 **Session** 可選擇性地直接歸屬 0..1 個 **Program**（不透過 Template，例：當天偏離計畫但仍算這個計畫的訓練日）
- 一個 **Session** 中的動作分兩類：來自 Template 的 + **Extra Exercises**
- **Session Split** 把 Extra Exercises 拆成另一個 freestyle Session
- 一個 **Exercise** 屬於一個 **Muscle Group** + 一個 **Equipment**
- **Template** 由有序的 **Exercise** 列表組成
- **Session** 紀錄的是 (Exercise, Set) 的實際執行

## Example dialogue

> **使用者：** 「我選了『胸 A』課表，做完之後又加了硬舉。」
> **App：** 「Session 結束。要把硬舉拆成另一次訓練嗎？」
> **使用者：** 「拆。」
> _結果：原 Session 保留為「胸 A」紀錄；硬舉變成一個新 freestyle Session。_

## Pending decisions

下次 grill-with-docs session 接續處理：

- **Q6 收尾**：Autofill 來源優先序（D1 → D3 fallback？）；Template 第一次執行時 UI 顯示 0 row 或 1 空 row
- **Q7 Program 結構**：Program 是否有「週期」實體（Cycle）？還是只是 Templates 的 bag？是否含日曆/排程？
- **Q8 Personal Record (PR) 定義**：PR 是 per Exercise 還是 per (Exercise, rep range)？E1RM 計算法？
- **Q9 Body data**：體重、圍度、進度照片是否進同一個資料庫？跟 HealthKit 怎麼分工？
- **Q10 Sync / multi-device**：純 local-first 還是 iCloud/CloudKit 同步？影響 schema 是否需要 conflict-resolution 欄位
- **Q11 HealthKit 整合邊界**：寫入什麼（workout sample？）、讀取什麼（bodyweight？）、何時同步

## Flagged ambiguities

- 「課表」一詞口語上有時指 Program、有時指 Template — 已固定為 **Template**。Program 改稱「計畫」。
- 「腹部」與「核心」常被當同義詞使用 — 已決定 **不設「腹部」MG**，所有腹直肌/腹斜/腹橫的直接訓練（卷腹、側棒、leg raise）以及抗旋/抗伸穩定訓練（Pallof press, dead bug, bird-dog）都歸入 **核心**。
- 「二頭 → 內側頭 / 外側頭」是口語命名；解剖學正名為 **短頭 / 長頭**（外側頭 = 長頭）。schema/UI 一律用內/外側頭。
