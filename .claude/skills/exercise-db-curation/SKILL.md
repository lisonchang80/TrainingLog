---
name: exercise-db-curation
description: >
  策展 Free Exercise DB 真人照進 TrainingLog 動作庫的逐部位工作流。Trigger：使用者貼「【X部位】增加 …／改名 A→B」清單、「動作庫接 Free Exercise DB」、「策展常見動作」。涉及 docs/exercise-media-import/curated-master.json（機讀 master）、curation-worksheet.md（人讀表）、/tmp/free-exercise-db.json（DB 快取）。每個動作要先對 DB 驗有沒有真照（real）或走 placeholder ①(c)，改名要先確認來源在 master、equip 非 enum 值要先問。
---

# Exercise DB Curation（逐部位策展工作流）

把 [Free Exercise DB](https://github.com/yuhonas/free-exercise-db)（Public Domain、873 動作、每筆**恰 2 張真人照** `0.jpg`/`1.jpg`）的動作策展進 TrainingLog 動作庫。使用者一次給一個部位的「增加 + 改名」清單，逐批處理。

## 來源檔（repo 是真實來源，/tmp 會掉）

- `docs/exercise-media-import/curated-master.json` — **機讀 master**（list）。每筆欄位：
  `part / zh / equip_zh / en / id / images / img('real'|'placeholder') / load_type(null|'bodyweight'|'loaded'|'assisted') / note`
- `docs/exercise-media-import/curation-worksheet.md` — **人讀表**（決策 + 各部位 table + 總覽計數）
- `/tmp/free-exercise-db.json` — DB 快取（873 筆）。**/compact 後可能被清**；不在就先下載：
  `curl -sL https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/exercises.json -o /tmp/free-exercise-db.json`

## ⚠️ 每次 Bash 先 `cd /Users/hao800922/code/TrainingLog`

cwd 在每次 Bash 呼叫之間**會重置**（踩過：`FileNotFoundError: docs/...`）。每個 python heredoc 前都 `cd` 進 repo，或用絕對路徑。

## 部位 → DB primaryMuscle 對照

| TrainingLog part | DB primaryMuscle |
|---|---|
| 胸 | chest | 背 | lats / middle back / lower back |
| 肩 | shoulders | 斜方 | traps |
| 二頭 | biceps | 三頭 | triceps |
| 小臂 | forearms | 腿 | quadriceps/hamstrings/glutes/calves/abductors/adductors |
| 臀 | glutes(+abductors) | 小腿 | calves |
| 核心 | abdominals | | |

## equip 對應（DB equipment → TrainingLog 8-enum）

enum＝`('槓鈴','啞鈴','史密斯機','滑輪','固定機械','自重','壺鈴','其他')`。
`barbell→槓鈴 · dumbbell→啞鈴 · kettlebells→壺鈴 · cable→滑輪 · machine→固定機械 · body only/other(自重類)→自重`；名字含 **Smith→史密斯機**。

**enum 沒有的器材**（地雷管 / 六角槓 / 槓片 / SSB安全槓 …）：**先問使用者**（AskUserQuestion，給「歸槓鈴／歸其他／新增 enum(要 rebuild migration)」三選），名稱保留變體（「地雷管硬舉」不變）。已拍板先例：**地雷管+六角槓→槓鈴、槓片→其他**；SSB 視為槓鈴。

## 逐部位流程

1. **撈現有 + DB 菜單**：python 印出 `curated-master.json` 該 part 既有 entries + DB 該 primaryMuscle 全清單（標 `IMG`/`no`、equipment、name）。
2. **逐一比對增加清單**：
   - DB 有精準對應 → `img='real'`，帶 `id` + `images=[id/0.jpg, id/1.jpg]`（id 從 DB 即時查、勿手拼）。
   - 方向/姿勢含糊（單臂 vs 雙臂、坐姿 vs 站姿、下壓 vs 過頭、反手 supinated vs 正手）→ **讀 `instructions[]` 前 ~180 字確認**再定 real/placeholder。
   - DB 無精準照 → **①(c) placeholder**（`img='placeholder'`、`id/images=null`），note 寫原因 + 可借的近似動作（「DB僅雙臂…可借」）。預設一律先 placeholder，借圖留打包階段。
   - 同一 DB 動作已被既有 entry 佔用 / 兩個新增其實同動作 → 標 🔁，在 table 列出讓使用者決定（別自動塞重複）。
3. **改名**：先確認來源 zh **在 master 裡**（grep）。本功能的改名來源都在 `curated-master.json`、**不是 app 內建 seed**（`src/db/seed/` grep 0 命中）→ 純改 JSON `zh`、零 migration。
4. **（自重）/（負重）標 `load_type`**：自重動作 `bodyweight`、加重 `loaded`，未來 seed 才知道自重組不問重量。
5. **先給可/不可表 + 拍板**（feedback_verify-rootcause-table）：real / placeholder / 🔁 / equip 問題列清楚，**有 equip-enum 或重複爭議先 AskUserQuestion，別跳去 patch**。
6. **套用**：python 改 `curated-master.json`（rename + extend），含 `assert no dup zh`。
7. **同步 worksheet**：regen 該 part section（`### 【X】（n）` 到下一個 `### 【` 或 `## 明天 TODO`，用 `re.sub(..., flags=re.S)`），real 在前 placeholder 在後（按 eqorder 排），更新「## 清單總覽」與「各部位」兩行計數（從 JSON 算、別手算）。
8. **不要 commit**：累積到使用者 `/cp` 一次提交（docs-only、pre-commit 跳 tsc/jest）。

## 打包階段（校對全收口後，會動 .ts，排獨立工作段）✅ 落地 2026-06-24 (v028)

**單一產生器** `docs/exercise-media-import/build_seed.py`（讀 curated-master.json，可重生）→ 一次吐出 4 樣：
1. `src/db/seed/v028ExerciseMediaLibrary.ts`（NEW_EXERCISE_SEEDS / MEDIA_UPDATE_EXISTING / ARCHIVE_EXISTING_IDS）
2. `src/db/seed/exerciseMediaMap.ts`（167 真照靜態 require map + `resolveExerciseMedia(key)`）
3. `/tmp/i18n_*_block.txt`（splice 進 strings.ts 的 zh/en exercise map）

下載：`curl` FE-DB `…/main/exercises/<id>/<n>.jpg` → 內建 **`sips -Z 600`** 縮圖（不裝工具）→ `assets/exercise-media/<id>/{0,1}.jpg`，xargs -P8 平行、retry。

**庫對齊（C 折衷，grill 2026-06-24）**＝策展 230 vs 既有 66 seed：24 同名沿用舊 id 補 `media_path`、206 新 INSERT（`exId(67..272)`）、39 既有-only 被細分版取代 `is_archived=1`、3 個策展真的沒有的保留 active → **淨 active 233**。`media_path` 存 **require-map key（=FE-DB folder id）非檔路徑**（翻 ADR-0017 Q8 的 Documents 模型）；schema 不動。卡 16:9（`library.tsx` thumbWrap），grid 只顯示 frame 0、詳情頁才 2 格 crossfade（`components/exercise/exercise-media-frames.tsx`，expo-image transition）。

### 打包階段必踩的 5 個坑（都驗過）
1. **i18n key 撞 TS1117**：新動作 DB `name` 一律存 **zh**（key 為中文＝不撞既有 66 英文 key）。
2. **i18n parity 測試**（`tests/i18n/strings.test.ts` 比 zh/en key 集合相等）：230 新動作要**兩 map 都加同一批 key**（zh→zh identity、en→英文）。63 個 placeholder **無 FE-DB 英文**→ build_seed.py 的 `PLACEHOLDER_EN` 手譯字典；漏掉 en→EN locale fallback 吐中文＝動作庫**中英混雜**（device 抓包過）。
3. **jest 不能 `require('.jpg')`**（node env 把二進位當 JS parse）：`package.json` jest 加 `moduleNameMapper` 把圖片副檔名→`tests/__mocks__/imageMock.js`（`module.exports=1`）。
4. **seed 長大打爆 count-canary**：庫 66→233 active／272 total，~15 個測試檔硬編 `toHaveLength(66)`／`const [bench]=await listExercises()`（首筆字母序變 Back Squat）／`COUNT is_builtin=1`／`user_version`／挑到被封存的動作。要逐一改（→233/272/find-by-name/挑 active 名）。
5. **Metro 認不到新資產**：新增幾百張圖後 `expo start -c` 的 `-c` 是**啟動時**清快取、graph 沒新檔→app 抓舊 bundle（卡片還圓圈、migration 沒跑）。要**重啟 Metro**（kill + `expo start --dev-client -c`）讓它重 crawl，再 relaunch app。

### 已知缺口（defer，已寫 ADR-0017）
206 新動作只有 muscle_group、**無細部 primary/secondary 肌肉連結**（詳情頁熱區只亮大肌群）；`load_type` best-effort 推導（equip=自重 / `（自重/輔助/負重）`後綴，少數無後綴自重動作可能誤標 loaded）。
