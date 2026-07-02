# 0029 — 新使用者 Onboarding 首啟引導流程

Status: accepted (2026-07-02、設計定案，實作待落地)

關聯：ADR-0026（極簡模式 = 新手推薦目標）、ADR-0011（RestoreGate 首啟關卡 + 還原則跳過 onboarding）、ADR-0008（HealthKit v1 分工：iPhone 只寫 HKWorkout + 讀 HR/kcal、不讀 body）、ADR-0007（body_metric）、ADR-0022（program-wizard「Step N of M」精靈 pattern 參考）。

首次安裝、且無備份可還原時，以一支**專屬全螢幕多步精靈**引導新使用者完成初始設定：**歡迎 → 訓練經驗 → 模式推薦 → 輸入身體數據 → 連結 Apple Health**。核心目標＝把「新手 → 推薦極簡模式」與「連結健康」兩件事，在使用者第一次開 App 時以**低摩擦、誠實、可跳過**的方式帶完；不新增任何領域 schema（除一個 boolean 旗標）。

## Context

動工前 3 個探索 agent 攤出全部相關現況：

- **零 onboarding**：首啟只有 RestoreGate（有備份→問還原／無備份→靜默進訓練 tab）。`app_settings` 無任何 first-run 旗標。
- **極簡模式**（ADR-0026）＝beginner-friendly，但目前**純手動**在設定頁 radio 開，新使用者不會自己發現。預設 `app_mode = 'plan'`（完整版）。
- **HealthKit**（ADR-0008）：iPhone 端只「寫」（結束時寫 HKWorkout，讓 Fitness App 顯示）+「讀」Watch 的 HR/kcal 做詳情頁統計；**完全不讀身體資料**（體重/身高/靜息心率/步數）。設定頁已有「連結 Apple Health」按鈕（`requestHKAuthorization`）+ `hkAuthState` 持久化，權限字串/entitlements 皆齊。
- **身體數據**（體重/體脂/骨骼肌，ADR-0007 `body_metric`）：`insertBodyMetric` 純手動輸入，零 HK。
- App **全無通知功能**（grep 0 命中 `expo-notifications`；休息計時是 app 內 beep+震動）。

需求（使用者 2026-07-02 提出）：新使用者打開 App 的引導，包含 ①連結健康/健身 App ②判斷是否健身新手、是則推薦開啟極簡模式。Grill 過程使用者追加 ③在流程中插入「輸入身體數據」一步。

## Decision

### D1 — 觸發 & 生命週期：新 `onboarding_completed` 旗標，掛在 RestoreGate 之後

- 新增 `app_settings.onboarding_completed`（plain boolean，**無 migration**，讀不到時視為 `false`）。
- 新增 `OnboardingProvider` + `OnboardingGate`（`src/onboarding/` + `components/onboarding/`），掛在 `DatabaseProvider` + `AppModeProvider` + `ThemeProvider` **內**（需讀寫 `app_mode`/旗標、要主題）；`active` 時整頁蓋掉 tab 導覽、**不進 expo-router history**（mirror RestoreGate 的 replace-children 模式，但位置在 provider 內側；RestoreGate 仍在最外層負責「還原 vs 全新」）。
- **觸發判定（純函式 `shouldShowOnboarding`）＝旗標未設 AND DB 無任何 session**。旗標**只在「完成」或「跳過」時寫**；中途崩潰/離開 → 下次重來（5 步成本低，**不做逐步進度持久化**）。
- **`hasAnySession` guard（實作期對純旗標設計的修正）**：原設計「純旗標 + 還原路徑設旗標」有漏洞——(a) **既有使用者升級**到本版：有資料但沒旗標 → 會誤跳 onboarding；(b) 舊備份（本功能前）**還原**後同樣沒旗標。加一次性「DB 有無 session」檢查即可涵蓋兩者：provider 在旗標缺席時查一次 `hasAnySession`，有資料 → 判定 `done` 並**回填旗標 `true`**（之後開機純讀旗標、快、不再查 session），genuinely fresh（0 session）才顯示。
- 這**不重蹈**被否決的「`session_count === 0` 當觸發」：旗標仍是權威（完成/跳過後持久化），清空資料**不會**重跳；session 檢查只在旗標缺席時查一次、當 bypass 用。

REJECT「用 `session_count === 0` 當主觸發」：清空資料/刪光 session 會重跳，且無法區分「看過但略過」與「還沒建資料」。REJECT「單靠 RestoreGate 的『DB 本次才新建』信號」：該信號在後續 launch 就消失，仍需旗標避免中途崩潰重跳，等於旗標方案的不完整子集。

### D2 — 形態：專屬全螢幕多步精靈，本身即引導、不疊 coach

鏡射 program-wizard 的「Step N of M」風格（ADR-0022）。onboarding 要**收使用者輸入**（問經驗、按連結），不是解釋既有畫面，故 coach-mark 聚光式不適用（那是拿來解釋現成 UI）。精靈本身即引導 → **不加 ⓘ / coach overlay**（對齊 `feedback_help_no_overlay_on_wizards`）。

### D3 — 5 步流程

| # | 步驟 | 內容 |
|---|---|---|
| 1 | 歡迎 | App 一句話定位 +「開始設定」 |
| 2 | 訓練經驗 | 「你有重量訓練經驗嗎?」→ 新手／有經驗（見 D4） |
| 3 | 模式推薦 | 兩選 radio，依 Step2 預選 + 一句說明極簡隱藏什麼（見 D5） |
| 4 | 輸入身體數據 | 純手動，重用 `insertBodyMetric`；體重必填、體脂/骨骼肌選填（見 D6） |
| 5 | 連結 Apple Health | 誠實限定文案 +「連結」/「稍後」；完成 → 進訓練 tab（見 D7） |

順序理由：②經驗問題必須排在③模式推薦前（推薦依答案預選）；④身體數據緊鄰⑤健康（同屬「你的身體」動線自然）；健康權限類步驟擺最後（走完核心設定再要系統權限）。**完成 CTA ＝「完成」→ 落地訓練 tab**（已套好推薦模式），不強迫立即開訓練。

### D4 — 新手偵測：一次性提問，**不**落成領域欄位

首啟無任何訓練資料，「偵測新手」＝**直接問**。單一問題、2 選（新手／有經驗）。答案**只**用來預選 Step3 模式，**不新增任何 schema**（不存 experience level）——理由：目前「新手」概念在 App 內**唯一消費者就是模式推薦**，存一個沒人讀的等級是投機（YAGNI）。唯一被持久化的結果 = `app_mode`。日後若有 adaptive 功能要用經驗等級，再加不遲。

### D5 — 模式推薦：opt-in 智慧預選

兩選 radio，依 Step2 預選：**新手 → 極簡（標「推薦」）**；**有經驗 → 計劃**。附一句說明極簡會隱藏什麼（計劃/強度、專注記錄）。**opt-in**：預選可改，按「下一步」才把選中值寫入 `app_mode`。此設計同時滿足②「推薦開啟極簡」的意圖、又保留使用者控制權、最低驚訝。

REJECT「新手自動開極簡（opt-out）」：少一次點擊但較 surprise。REJECT「只說明、導去設定自己開」：等於沒完成②的「推薦開啟」意圖。

### D6 — 身體數據：純手動，重用既有

重用 `body.tsx` / `insertBodyMetric` 既有欄位：**體重必填、體脂(pbf)/骨骼肌(smm)選填**。零新 native 工作。

REJECT「手動 + 試讀 HealthKit 體重」：需新寫 iPhone 端讀 `HKQuantityTypeIdentifierBodyMass`（App 目前完全不讀 body 資料），範圍變大且需 device 驗；「連健康後自動帶入體重預填」列為 backlog。

### D7 — HealthKit：誠實限定文案 + 重用既有連結流程 + 可跳過

- **重用**設定頁既有 `requestHKAuthorization` + `hkAuthState`（零新 HK 管線）；onboarding 只是同一函式的第二個呼叫點。
- **可「稍後」跳過**（權限不能強迫；跳過後仍可從設定頁連結）。
- **誠實限定文案**：「連結後，完成的訓練會寫進 Apple『健康/Fitness』App；搭配 Apple Watch 時也會記錄心率與熱量。」**不提「同步身體數據」**（因 iPhone 端不讀 body）。此文案與現有 Info.plist 權限字串一致。

REJECT「廣義吸引版（連結以同步你的訓練與健康數據）」：誇大（沒讀 body 資料），使用者期待落差 + App Store 審查風險。REJECT「這步整個拿掉」：①「連健康 App」是使用者明列的 onboarding 需求。

### D8 — 全流程可跳過 + 設定頁可重跑

- 每頁角「跳過」＝套預設（`plan` 模式／不建 body_metric／不連 HK）+ 設旗標，直接進 App。
- 設定頁加「重新查看新手引導」入口（清旗標 + push 精靈），**兼作測試/smoke 的 reset 路徑**。**重跑不重置現有設定**——只是再走一次，可再調（模式/HK/身體數據皆已能在設定各自獨立修改）。

### D9 — 不加通知權限步驟（翻盤 ADR-0011 stale-plan-default）

ADR-0011 曾寫「onboarding 階段需請求 push permission」。但 grep 實證 App **全無通知功能**（0 命中 `expo-notifications`／任何 permission 請求）。要一個沒 consumer 的權限＝徒增使用者疑慮 + App Store 審查風險。故**不加**。日後真做休息提醒/備份提醒推播，再於該功能落地時請求。

## Consequences

- 新增：`app_settings.onboarding_completed`（bool）+ `settingsRepository.getOnboardingCompleted / setOnboardingCompleted`。
- 新增：`OnboardingGate` 元件（掛 DatabaseProvider + AppModeProvider 內）+ onboarding 精靈畫面（5 step，鏡射 program-wizard 版面）。
- 改：RestoreGate 的 fresh-start/decline 分支交棒給 OnboardingGate；還原成功路徑設 `onboarding_completed = true`。
- 改：設定頁加「重新查看新手引導」入口。
- 重用（不新增管線）：`requestHKAuthorization` + `hkAuthState`（HealthKit）、`insertBodyMetric`（身體數據）、`setAppMode`（模式）。
- i18n：全 onboarding 文案 zh + en 雙語（App 支援 live 切語言，per ADR-0023）。
- **不動**：既有 HK 讀寫語意、body_metric schema、app_mode 語意、通知（本就無）。
- 測試面：旗標 getter/setter 純邏輯 test；Step2→Step3 預選映射純函式 test；跳過→套預設路徑 test。實機/sim smoke 驗首啟→5 步→旗標寫入→重開不再顯示 + 設定頁重跑。

## Rejected Alternatives（彙整）

1. **觸發**：`session_count===0` 推斷 / 單靠 RestoreGate DB-just-created 信號 — 見 D1。
2. **形態**：bottom-sheet modal 序列（太像散裝提示、進度/返回難表達）；coach-mark 聚光 tour（收不了輸入、是解釋既有 UI 用的）— 見 D2。
3. **新手偵測**：多題小測驗（對個人 app 過重）；存成新領域欄位（無 consumer、投機 schema）— 見 D4。
4. **模式推薦**：opt-out 自動開 / 只說明不動 app_mode — 見 D5。
5. **身體數據**：手動 + 試讀 HealthKit 體重（範圍暴增、需 device 驗）— 見 D6。
6. **HealthKit 文案**：廣義吸引版 / 整步拿掉 — 見 D7。
7. **通知**：加通知權限步驟（無 consumer，翻 ADR-0011）— 見 D9。
