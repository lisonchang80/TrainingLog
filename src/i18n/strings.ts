/**
 * i18n strings — single source of truth for static (non-dynamic) UI text.
 *
 * Phase 3 of the i18n migration (see `/tmp/i18n-phase3-structure-proposal.md`).
 *
 * Design:
 *   - Single file, namespaced (`common` / `domain` / `button` / `page` / `alert` /
 *     `status` / `equipment` / `muscleGroup` / `loadType`).
 *   - Locale defaults to `'zh'` and is module-level; Phase 5 wires
 *     `expo-localization` + user toggle through `setLocale()`.
 *   - `t('ns', 'key')` is type-safe — TypeScript locks namespace and key.
 *   - Dynamic / interpolated strings live in `dynamic.ts` as functions, since
 *     ES template literals don't fit the static `strings` tree shape.
 *   - DB-stored zh strings (equipment / muscle / load_type) round-trip through
 *     `tEquipment` / `tMuscleGroup` / `tLoadType` so the DB schema stays untouched.
 *
 * User translation decisions locked 2026-05-22:
 *   強度 → Intensity, 通用 → Default, 熱 chip → W, 超 chip → SS,
 *   講解 → Cues, 再次訓練 → Replay, 砍掉 → Discard, 徒手 → Unloaded.
 *   Achievement strings (7 entries in `v008Achievements.ts`) are intentionally
 *   deferred — they live in DB rows, require schema migration to translate.
 */

export type Locale = 'zh' | 'en';

export const strings = {
  zh: {
    /** 跨頁面共用按鈕 / 選項 label。最高頻字串（取消 27 處、刪除 13 處等）。 */
    common: {
      cancel: '取消',
      confirm: '確認',
      done: '完成',
      create: '建立',
      delete: '刪除',
      edit: '編輯',
      save: '儲存',
      saving: '儲存中…',
      add: '新增',
      back: '上一步',
      next: '下一步',
      apply: '套用',
      select: '選擇',
      all: '全部',
      none: '無',
      default: '通用',
      yes: '是',
      no: '否',
      close: '關閉',
      skip: '略過',
      backArrow: '‹ 返回',
      backPlain: '返回',
      go: '前往',
      open: '開啟',
      ok: '確定',
      noneParen: '(無)',
      notSelected: '— 尚未選擇 —',
      empty: '(未填)',
      unknownExercise: '(未知動作)',
      custom: '· 自訂',
      inactive: '· 未啟用',
      inProgress: '· 進行中',
      // Phase 4.5 batch 1 — plain "自訂" (no dot prefix) for wizard intensity chip.
      customPlain: '自訂',
    },

    /** 領域核心術語 — 計畫 / 模板 / 週期 / 強度 / chip 縮寫等。鎖定 ADR-0004/0021。 */
    domain: {
      program: '計畫',
      template: '模板',
      session: 'Session',
      exercise: '動作',
      cluster: '群組',
      superset: '超級組',
      cycle: '週期',
      day: '天',
      week: '週',
      intensity: '強度',
      warmup: '熱身',
      workingSet: '正式組',
      dropSet: 'Drop Set',
      reps: '次數',
      weight: '重量',
      weightKg: '重量 (kg)',
      volume: '容量',
      strength: '力量',
      maxStrength: '最大力量',
      hypertrophy: '增肌',
      endurance: '耐力',
      muscularEndurance: '肌耐力',
      bodyweight: '體重',
      warmupChip: '熱',
      supersetChip: '超',
      freestyle: '自由訓練',
      restDay: '休息日',
      rest: '休息',
      programSchedule: '計劃表',
      cycleSetup: '週期設定',
      cycleLengthDays: '循環天數',
      cycleCount: '週期數',
      programNameMain: 'Program 主',
      mainTagPrefix: '主標籤',
      history: '歷史',
      chart: '圖表',
      stats: '統計',
      data: '數據',
      calendar: '月曆',
      achievements: '獎章',
      trend: '趨勢',
      maxWeight: '最大重量',
      maxVolume: '最大容量',
      oneRepMaxEstimate: '1RM 預測',
      trainingVolume: '訓練容量',
      trainingPreferences: '訓練偏好',
      newTemplate: '新模板',
      supersetName: '超級組名稱',
      note: '備註',
      startDate: '起始日',
      // weekday short labels (CalendarGrid + program day cycle headers)
      weekdaySun: '日',
      weekdayMon: '一',
      weekdayTue: '二',
      weekdayWed: '三',
      weekdayThu: '四',
      weekdayFri: '五',
      weekdaySat: '六',
      // Phase 4.5 audit (2026-05-24) — Stats panel period selector chips.
      year: '年',
      month: '月',
    },

    /** UI button / CTA / action label。包括 wizard nav、cluster ⚙️ 選單 item。 */
    button: {
      loadProgram: '↓ 載入計劃',
      combine: '組合',
      cues: '講解',
      replay: '↻ 再次訓練',
      replayDescription: '再次訓練 — 覆蓋目前卡片的 sets',
      useLatestTemplate: '啟用最新模板',
      listView: '表列',
      sideBySide: '並排',
      newTemplate: '＋ 新建',
      newCta: '新建',
      newProgramTemplate: '+ 建立新模板',
      addIntensity: '+ 新增強度',
      addIntensityPlain: '新增強度',
      addExercise: '+ 動作',
      addExercisePlain: '新增動作',
      addCustomExercise: '新增自訂動作',
      addRecord: '新增記錄',
      // ADR-0024 § 2.b — 訓練 tab 空白訓練 CTA + busy 狀態 + 計劃訓練 empty CTA。
      startFreestyle: '+ 開始空白訓練',
      starting: '開始中…',
      gotoPrograms: '前往 Programs',
      createOrActivateProgram: '建立 / 啟用計劃',
      editExercise: '編輯動作',
      editSession: '編輯訓練',
      editSuperset: '編輯超級組',
      editKeep: '繼續編輯',
      discardChanges: '捨棄修改',
      discardSession: '🚫 放棄訓練',
      discardSimple: '放棄',
      // Smoke F3 patch — in-session header ⋯ menu option + BodyDataSheet
      // top bar title.
      bodyData: '體重資料',
      saveTemplate: '儲存模板',
      saveAsTemplate: '另存模板',
      deleteExercise: '刪除動作',
      deleteSession: '刪除本訓練',
      deleteSuperset: '刪除超級組',
      uncheck: '取消完成',
      clearFilter: '取消篩選',
      markAsDone: '標為完成',
      switchToChart: '轉圖表',
      viewHistory: '看歷史',
      viewCues: '查看動作要點',
      viewExerciseDetails: '查看動作詳情',
      viewSupersetDetails: '查看超級組詳情',
      sendToWatch: '傳至手錶 ⌚',
      createSuperset: '建立超級組',
      applyTemplateToColumn: '套用 template 到此 column',
      applyIntensityToRow: '套用強度到此 row',
      restRowClear: '休息（清空此列）',
      shrinkAndDiscard: '砍掉並縮小',
      confirmCreate: '確認建立',
      overwrite: '覆蓋',
      manualRest: '手動休息',
      manualRestStart: '手動開始休息倒數',
      noteCta: '備註',
      previous: '上一步',
      next: '下一步',
      // cluster action-sheet items (with emoji prefix preserved)
      clusterRestSeconds: '⏱️ 休息秒數',
      clusterEditNote: '📝 編輯備註',
      clusterReorderExercises: '🔃 排序動作',
      clusterDeleteExercise: '🗑️ 刪除動作',
      clusterHistoryA: '📖 動作歷史 (A)',
      clusterHistoryB: '📖 動作歷史 (B)',
      // Phase 4.5 batch 1 — solo + cluster card "+ 新增 1 組" primary CTA.
      addOneSet: '新增 1 組',
      // Phase 4.5 batch 1 — swipe-delete label on cluster cycle row.
      swipeDelete: '刪',
      // Phase 4.5 final — swipe-add (clone) label on template editor row.
      swipeAdd: '加',
      // Phase 4.5 final — swipe-note label on template editor row.
      swipeNote: '備註',
      // Phase 4.5 batch 1 — Today bottom-bar "⏱ 手動計時" button.
      manualTimer: '⏱ 手動計時',
      // Phase 4.5 batch 1 — accessibilityLabel: ⚙️ on exercise card.
      a11yExerciseSettings: '動作設定',
      // Phase 4.5 batch 1 — accessibilityLabel: ⚙️ on cluster card.
      a11yClusterSettings: '超級組設定',
      // Phase 4.5 batch 1 — accessibilityLabel: 📝 indicator on cluster cycle row.
      a11yOpenNote: '開啟備註',
      // Phase 4.5 batch 1 — accessibilityLabel: ✓/○ button toggling set logged state.
      a11yMarkSetDone: '標記這組完成',
      a11yUncheckSetDone: '取消完成這組',
      // Card 11 / ADR-0014 — accessibilityLabel: in-session header tap-to-edit
      // session title.
      a11yTapEditTitle: '點擊編輯訓練標題',
      // 2026-05-25 wave 2 i18n sweep — accessibilityLabel: in-session header
      // ⋯ menu (Today screen `onHeaderMenuPress`).
      a11ySessionMenu: '訓練選單',
      // 2026-05-25 wave 2 i18n sweep — accessibilityLabel: detail-page edit
      // mode toggle button (session/[id].tsx sticky bar).
      a11yEditMode: '編輯模式',
      // Phase 4.5 batch 2 — template editor / sheet CTAs.
      creating: '建立中…',
      addProgram: '新增計畫',
      editTemplate: '編輯模板',
      startSession: '開始訓練',
      createAndImport: '建立並導入',
      selectColorAction: '配色',
      deleteTemplate: '刪除模板',
      newWithPlus: '+ New',
      addNote: '新增備註',
      editNote: '編輯備註',
      moveExercise: '移動動作',
      setAsEvergreen: '設為常設運動',
      setAsGeneral: '設為一般運動',
    },

    /** 頁面標題 / step / section header / placeholder text。 */
    page: {
      programs: '計劃表',
      session: 'Session',
      library: '動作庫',
      history: '訓練紀錄',
      // ADR-0024 § 2 — 訓練 tab idle 三區塊 section headers.
      plannedTraining: '計劃訓練',
      freestyleTraining: '空白訓練',
      templateTraining: '模板訓練',
      // Smoke F1 patch — in-session plan-list label above today's exercise
      // cards (app/(tabs)/index.tsx ~line 2161). Distinct from
      // plannedTraining (idle section header).
      todayPlan: '今日計畫',
      exerciseDetail: '動作詳情',
      exerciseHistory: '動作歷史',
      exerciseChart: '動作圖表',
      exerciseList: '動作清單',
      exerciseSettings: '動作設定',
      bodyMetrics: '身體數據',
      settings: '設定',
      backupRestore: '備份 / 還原',
      supersetDetails: '超級組詳情',
      // wizard step titles (program-wizard/new.tsx)
      wizardStep1: '計劃名稱 + 強度',
      wizardStep2: '週期設定',
      wizardStep3: '週期 1 每日內容',
      wizardStep4: '各週期強度調整',
      wizardStep5: '預覽日曆',
      wizardStep6: '檢查無誤後按下方建立。',
      wizardStep5Hint: '展開後的日曆 — 確認看起來對。',
      // pickers / titles
      selectProgram: '選擇 Program',
      selectProgramAlt: '選擇計畫',
      selectTemplate: '選擇 template',
      selectIntensity: '選擇強度',
      selectCycleLength: '選擇循環天數',
      selectCycleCount: '選擇週期數',
      selectMonth: '選擇月份',
      selectStartDate: '選擇起始日',
      selectProgramToLoad: '選擇要載入的計劃',
      // placeholders
      enterSupersetName: '請輸入超級組名稱',
      enterSupersetNameShort: '輸入超級組名稱',
      enterExerciseName: '請輸入動作名稱',
      searchExercises: '輸入動作名字搜索',
      programNamePlaceholder: '計劃名稱',
      newIntensityName: '新強度名稱',
      intensityPlaceholder: '強度（例：10-12RM）',
      intensityOptionalMulti: '強度（可空，可多筆）',
      cycleLengthInput: '循環天數（3-14 天）',
      startDateInput: '起始日期 (yyyy-mm-dd)',
      notePlaceholder: '例：握距、發力重點、易犯錯誤...',
      intensityExample: '例：10-12RM、II-1',
      programNameExample: '例：增肌-Q1',
      // Phase 5 — settings Language section header
      languageSection: '語言',
      // ADR-0025 — settings Color Theme section header (placed above languageSection).
      colorThemeSection: '色彩主題',
      // Phase 5 — settings section headers + hints (sweep TODO(i18n))
      unitPreferenceSection: '顯示單位',
      unitPreferenceHint: '顯示單位切換（資料以 kg 儲存，僅影響顯示與輸入）。',
      autoPopupRestTimerHint:
        '打✓ 完成一組後自動跳出 60 秒倒數視窗（可手動關閉視窗或跳過）。',
      bodyMetricsHint: '體重 / PBF / SMM 趨勢與歷史記錄。快速輸入仍可從 Today 頁進入。',
      // Phase 4.5 batch 1 — wizard Step 3 / Step 4 hint paragraphs.
      wizardStep3Hint:
        '每天選擇一個模板（可留白為休息日）。週期 1 的選擇會 fan-out 到每個週期；強度在下一步逐週期選擇。',
      wizardStep4Hint:
        '每個週期選一個強度（套用到此週期內所有有模板的日子）。留「通用」即不套用。',
      // Phase 4.5 batch 1 — wizard Step 6 summary line prefixes.
      summaryName: '名稱：',
      summaryIntensity: '強度：',
      summaryCycle: '週期：',
      summaryStart: '起始：',
      summaryConfiguredDays: '已配置 Day：',
      summaryIntensityOverride: '強度覆寫：',
      summarySuffixDays: ' 天',
      summarySuffixCount: ' 項',
      // Wizard intensity list 「、」separator between sub_tags.
      summarySeparator: '、',
      // Programs tab meta line: "{count} × {length} days · 起始 {start_date}".
      metaStartPrefix: '起始',
      // Session detail / Today section header above exercise list.
      exerciseListSection: '動作清單',
      // SessionTimeEditorSheet labels.
      editSessionTime: '編輯訓練時間',
      startTimeLabel: '開始時間',
      endTimeLabel: '結束時間',
      durationLabel: '訓練時長',
      // Phase 4.5 batch 2 — pages / sheets / placeholders.
      templates: 'Templates',
      selectColor: '選擇配色',
      selectExercise: '選擇動作',
      selectCategory: '選擇大分類',
      selectEquipment: '選擇用具',
      restTime: '休息時間',
      saveTemplateSheet: '儲存模板',
      createAndImportSheet: '建立並導入',
      advancedFilter: '進階篩選',
      bodyOverview: '訓練部位概況',
      capacityByMg: '各部位容量 · 近 6 期',
      durationOverPeriod: '運動時長 · 近 6 期',
      templateNamePlaceholder: 'Template 名稱',
      nameFieldLabel: '名稱',
      categoryLabel: '大分類',
      equipmentLabel: '用具',
      muscleGroupOptionalLabel: '訓練部位（選填）',
      exerciseNameA11y: '動作名稱',
      exerciseNameExamplePlaceholder: '例：吊環划船',
      pickCategoryPlaceholder: '請選擇大分類',
      templateProgramLabel: '歸屬計畫',
      templateIntensityLabel: '強度標籤',
      newProgramNamePlaceholder: '輸入新計畫名稱（≤ 60 字）',
      newIntensityWithExamplePlaceholder: '輸入新強度標籤（如 5x5、最大力量）',
      noteEditorPlaceholder: '提示、cue、注意事項…',
      muscleTagHelper: '點標籤切換：未選 → 主要(橘) → 次要(藍) → 取消。空白時動作詳情頁不顯示解剖圖。',
      // Body heatmap M-layer view column headers.
      bodyFront: '正面',
      bodyBack: '背面',
      // Phase 4.5 final sweep — set-note sheet placeholder.
      setNotePlaceholder: '這組想留下什麼？（例：RPE 8、左肘有點緊）',
      // Card 11 / ADR-0014 — in-session header tap-to-edit title placeholder
      // (freestyle / un-named session).
      sessionTitlePlaceholder: '自由訓練',
    },

    /** Alert / 錯誤訊息 / 確認 dialog。多為 modal title + body 對。 */
    alert: {
      programNameExists: '計畫名稱已存在',
      programNameExistsWarning: '⚠️ 計劃名稱已存在',
      programNameExistsMsg: '請換一個名稱再繼續。',
      deleteSupersetQ: '刪除超級組？',
      deleteExerciseQ: '刪除動作?',
      templateNotCreated: '尚未建立模板',
      reorderFailed: '排序失敗',
      deleteFailed: '刪除失敗',
      saveFailed: '儲存失敗',
      readFailed: '讀取失敗',
      loadFailed: '載入失敗',
      restoreFailed: '還原失敗',
      overwriteFailed: '覆蓋失敗',
      importFailed: '導入失敗',
      addDropsetFailed: '新增 dropset 失敗',
      addExerciseFailed: '加入動作失敗',
      editFailed: '編輯失敗',
      cannotDelete: '無法刪除',
      cannotSwap: '無法交換',
      cannotOverwrite: '無法覆蓋',
      cannotReadTemplate: '無法讀取模板',
      cannotOpen: '無法開啟',
      cannotOpenEditor: '無法開啟編輯器',
      cannotStartSession: '無法開始訓練',
      cannotCreateTemplate: '無法建立模板',
      failed: '失敗',
      noActiveSession: '找不到進行中的訓練 session。請先回 Today 頁開始一次訓練後再試。',
      sessionAlreadyInProgress: '已有進行中的訓練',
      endActiveSessionFirst: '請先在「今日」分頁結束目前的訓練再開始新的。',
      exerciseNotFound: '找不到此動作。',
      exerciseNotFoundOrArchived: '動作不存在或已封存。',
      sourceCardNotFound: '找不到該動作來源卡。',
      sourceCardASideNotFound: '找不到該超級組 A 側來源卡。',
      sourceCardBSideNotFound: '找不到該超級組 B 側來源卡。',
      originalTemplateNotFound: '找不到原模板',
      sessionTemplateMissing: '此 session 沒有連結的模板，或原模板已被刪除。請改用「另存模板」建立新的。',
      supersetNotFound: '超級組不存在或已刪除。',
      builtinExerciseNoEdit: '內建動作目前無可編輯內容。',
      builtinExerciseNoDelete: '內建動作無法刪除。',
      dropsetMinimum: 'Dropset 至少需要 2 組（head + 1 follower）。如要整組刪除，請左滑 head 那一列。',
      duplicateExerciseName: '已有同名動作，請改個名字',
      duplicateSupersetPair: '已有同樣動作組合的超級組',
      openExistingSupersetQ: '是否前往編輯既有的超級組？',
      supersetExactlyTwo: '超級組需要剛好 2 個動作',
      supersetNoDuplicates: '超級組的兩個動作不可重複',
      supersetNameMaxLen: '超級組名稱請少於 60 字元',
      exerciseNameMaxLen: '動作名稱請少於 60 字元',
      colorHexFormat: 'color_hex 必須是 #rrggbb 6 位 hex 或 null',
      exerciseIdsNoEmpty: 'exercise_ids 不可有空值',
      muscleGroupOverlap: '肌群不可同時為主要與次要',
      pickCategoryFirst: '請選擇大分類',
      pickEquipmentFirst: '請選擇用具分類',
      pickTwoExercises: '請選 2 個動作',
      replaySessionQ: '再次訓練？',
      replaySessionSupersetQ: '再次訓練（超級組）？',
      noTemplatePickFirst: '先在格子點選 template，再回來套用強度。\n（強度只能掛在有 template 的格子上）',
      noTemplateOnRow: '此 row 沒有 template',
      shrinkProgramQ: '縮小計劃表？',
      noTemplatesYet: '沒有 template。先建一個再回來。',
      noOptionsToSelect: '沒有可選項目。',
      noProgramsAvailable: '沒有可用的 Program。',
      noProgramsToLoad: '尚無計劃可載入',
      programHasNoSubTag: '此 Program 無 sub_tag 紀錄。',
      // Wave 18g (Phase 6) — same-name overwrite UX consequence banner.
      overwriteSheetBodyConsequence:
        '建立後將完全取代既有計劃設定（循環天數、週期數、起始日、每日內容、強度）。已結束的訓練紀錄會保留。',
      cannotUndo: '此操作無法復原。',
      cannotUndoLong: '此操作不可復原 — 將刪除整個 session、所有動作及記錄。',
      historyUnaffected: '歷史 session 紀錄不受影響。',
      allLoggedSetsDeleted: '已記錄的 set 將全部刪除，無法復原。',
      discardChangesQ: '捨棄修改？',
      discardChangesLong: '離開將還原為進入編輯前的狀態，所有變更會消失。',
      discardSessionQ: '放棄此次訓練？',
      enterPositiveOrSkip: '請輸入正數，或選擇略過',
      atLeastOneField: '至少輸入一個欄位且數值合理',
      atLeastOneBodyField: '至少輸入一個欄位（體重 / PBF / SMM）',
      mustBeWithin500Kg: '應為 0–500 kg 區間',
      invalidBodyweight: '體重輸入無效',
      invalidBodyweightLong: '體重數值不合理（應為 0–500 kg）',
      invalidPbf: 'PBF 應為 0–100 %',
      invalidSmm: 'SMM 數值不合理（應為 0–200 kg）',
      invalidInput: '輸入無效',
      // 2026-05-25 wave 2 i18n sweep — Alert.alert titles previously hardcoded
      // in app/(tabs)/index.tsx + app/session/[id].tsx error paths.
      cloneFailed: '複製失敗',
      addCycleFailed: '新增週期失敗',
      endSessionFailed: '無法結束訓練',
      variantExists: '變體已存在',
      notEnoughDataPoints: '此時段資料點不足，至少需 2 次 Session。',
      defaultVariantUndeletable:
        '此模板有「通用」變體（計畫或強度未指定），是歷史 prefill 的兜底層、不可刪。\n\n若需刪除個別非通用變體，請點該 row 進入編輯器、從 ⋯ 選單刪除。',
      // Phase 4.5 batch 1 — SessionTimeEditorSheet end-must-be-after-start warning.
      endMustBeAfterStart: '⚠️ 結束時間必須晚於開始時間',
      // Phase 4.5 batch 1 — Programs row picker preview hint (split for dynamic name).
      intensityWillBeSetPrefix: '強度將設為「',
      intensityWillBeSetSuffix: '」（旁邊就近 cell）',
      // Phase 4.5 batch 1 — Today "Send to Watch" placeholder body.
      watchComingSlice13:
        'Coming in slice 13 — WatchConnectivity transferUserInfo + Watch SwiftUI app。',
      // Phase 4.5 batch 2 — template editor / start-template-sheet / forms.
      cannotSave: '無法儲存',
      intensityNameExists: '強度名稱已存在，請改用別的名稱。',
      pickProgramFirst: '請先選擇一個計畫。',
      duplicateTemplateTripleBody: '已有相同名稱 + 計畫 + 強度的 template，請改用別的強度名稱。',
      duplicateTemplateTripleEditorBody: '已有「相同名稱 + 計畫 + 強度」的模板，請換個強度或計畫。',
      templateNotFound: '找不到此 template',
      addExerciseFirst: '請先加入至少一個動作再開始訓練。',
      deleteTemplateQ: '刪除模板？',
      confirmDeleteQ: '確認刪除？',
      saveAsTemplateStubBody: 'production 補齊三元組 UI（ADR-0014）。slice 9.5 暫不實作。',
    },

    /** 狀態 / empty state / 進行中 indicator / chart axis hint。 */
    status: {
      loading: '載入中…',
      ending: '結束中…',
      saved: '已儲存',
      savedAsNew: '已另存',
      selected: '已選擇',
      noTrainingRecords: '還沒有訓練紀錄',
      noRecords: '尚無記錄',
      noExercisesAdded: '尚未加入動作',
      noSupersetsYet: '尚未建立超級組',
      noSupersetsHint: '點右上角「+」建立新的超級組',
      noExercisesMatch: '沒有符合條件的動作',
      noRecordsUnderFilter: '篩選條件下沒有紀錄。',
      noIntensity: '無強度',
      freestyle: '自由訓練',
      restDay: '休息日',
      inProgress: '· 進行中',
      todayOutsideProgram: '今天不在 Program 範圍內',
      // ADR-0024 § 2.a — 訓練 tab 計劃訓練 區塊狀態文案。
      noActiveProgram: '沒有啟用的計劃',
      todayRest: '今天休息 💤',
      hideUnchecked: '隱藏未打勾',
      // Card 12R / Round G — force-kill recovery toast on session detail focus.
      editSnapshotRestored: '上次未完成編輯已還原',
      // cluster A/B switcher disabled hints
      alreadyASide: '已是 A 側',
      alreadyBSide: '已是 B 側',
      // history filter chips (clusterFilter.ts)
      excludeSupersets: '不含超級組',
      includeSupersets: '包含超級組',
      supersetsOnly: '只含超級組',
      // exercise-chart axis hints
      highestVolumePerSession: '（每次 Session 容量最大一組）',
      heaviestSetPerSession: '（每次 Session 最重一組）',
      maxEstimated1rmPerSession: '（每次 Session 預估 1RM 最大值）',
      firstTime: '（第一次）',
      // misc badges
      allTimeWeightPr: '★ 全紀錄重量 PR',
      allTimeVolumePr: '★ 全紀錄容量 PR',
      // settings placeholder
      autoShowRestCountdown: '自動跳出休息倒數',
      backupComingSlice15: '於 slice 15 加入。',
      // chart time-range chips
      thisYear: '今年',
      previousYear: '上一年',
      nextYear: '下一年',
      // exercise detail subtitle
      missingExercise: '動作遺失',
      // chart panel header
      previousYearArrow: '上一年',
      // Phase 5 — settings Language toggle radio labels
      languageAuto: '自動偵測',
      languageZh: '中文（繁體）',
      languageEn: 'English',
      // ADR-0025 — settings Color Theme radio labels (system / light / dark).
      themeSystem: '自動（跟隨系統）',
      themeLight: '淺色',
      themeDark: '深色',
      // Phase 4.5 batch 1 — Programs tab empty-state CTA.
      noProgramsYetHint: '還沒有計畫。按「新建」啟動 6 步建立精靈。',
      // Phase 4.5 batch 1 — Today program banner "today: {template}" prefix.
      todayPrefix: '今天：',
      // Phase 4.5 batch 1 — Today pre-prompt bodyweight confirmation hint.
      prePromptBwHint: '確認當下體重（鎖入此 Session）。',
      // Phase 4.5 batch 1 — Today / Session detail empty-plan body.
      emptyPlanBody: '點下方「+ 動作」開始記錄這次訓練。',
      // Phase 4.5 batch 1 — solo exercise card empty-state hint.
      soloEmptyHint: '還沒有 set — 按下方「+ 新增 1 組」開始記錄',
      // Phase 4.5 batch 1 — cluster card empty-state hint.
      clusterEmptyHint: '還沒有組 — 按下方「+ 新增 1 組」開始記錄',
      // Phase 4.5 batch 2 — template editor / forms / sheets.
      noGeneralExercises: '（無一般動作）',
      noEvergreenExercises: '（無常設動作）',
      colorPickerFootnote: '選色後會 group-wide 連動所有同 name sibling templates。',
      exercisePickerFootnote: '點選動作即加入「一般動作區」；用 ⚙「設為常設」改類別。',
      noteEditorFootnote: '備註用於記錄動作 cue / 注意事項。',
      restTimeFootnote: 'Session 對此動作 set ✓ 後自動跳此秒數倒數。',
      noHistoryYet: '還沒有此動作的歷史紀錄。完成第 1 次 Session 後就會出現。',
      noTrainingThisPeriod: '本期間尚無 Session',
      noCapacityRecent: '近 6 期尚無訓練容量',
      achievementLocked: '未解鎖',
      defaultVariantHint: '(固定項)',
      lastUsedHint: '(最後使用)',
      noTemplatesYetHint: '尚無模板 — 點右上「+ New」建立第一個。',
      sessionDuration: '訓練時間',
      exerciseCountLabel: '動作數',
      anchor: '錨點',
      today: '今天',
      loadTypeLabel: '類型：',
      topSetLabel: '頂組：',
      bodyweightLabel: '當天體重：',
      filterMuscleGroup: '部位',
      filterTrainingGoal: '訓練目的',
      filterMilestone: '里程碑',
      editTrainingTimeA11y: '編輯訓練時間',
      heatmapSubtitle: '顏色 = per-Session 次數分位',
      capacityMgSubtitle: '顯示有訓練的部位 · 紅虛線 = 6 期平均',
      durationSubtitle: '每根長條 = 該期累計時長 · 紅虛線 = 6 期平均',
      // Phase 4.5 final sweep — chart / sheet / modal inline literals.
      avgPrefix: '平均',
      bodyMetricsEmptyHint: '在上方輸入體重 / PBF / SMM 開始記錄',
      reorderHint: '長按任一列拖曳重新排序，完成後按右上「完成」儲存。',
      restingHeader: '休息中',
      restFinished: '時間到 — 再來一組 💪',
      restRunning: '把握短暫的休息',
      bwSnapshotFrozenHint: '此 Session 的 bw_snapshot 不會被改寫。',
      muscleRolePrimary: '主要',
      muscleRoleSecondary: '次要',
      muscleRoleInactive: '未活化',
      noSessionsYetHint: '尚無 Session — 到 Today 分頁開始第一次訓練。',
    },

    /**
     * Equipment enum 8 個值。DB 用 zh literal 當 CHECK constraint value
     * (見 v010_exercise_library_v2.ts:48)，UI 顯示走這層 mapping、DB 不動。
     */
    equipment: {
      槓鈴: '槓鈴',
      啞鈴: '啞鈴',
      史密斯機: '史密斯機',
      滑輪: '滑輪',
      固定機械: '固定機械',
      自重: '自重',
      壺鈴: '壺鈴',
      其他: '其他',
    },

    /**
     * Exercise display name — built-in seed (v006) DB names are EN; this
     * mapper produces zh display labels for the 66 built-in exercises.
     * Unknown keys (user-created exercises) pass through unchanged via
     * `tExercise()`'s fallback.
     *
     * Naming convention: equipment-prefixed when ambiguous (槓鈴臥推 /
     * 啞鈴臥推), bench-angle prefixed when relevant (上斜 / 下斜),
     * gym-floor 慣用 terms when domain-standard (引體向上 / 硬舉 / 臀推).
     */
    exercise: {
      'Bench Press': '槓鈴臥推',
      'Push-up': '伏地挺身',
      'Incline Bench Press': '上斜槓鈴臥推',
      'Decline Bench Press': '下斜槓鈴臥推',
      'Dumbbell Bench Press': '啞鈴臥推',
      'Incline Dumbbell Press': '上斜啞鈴臥推',
      'Cable Crossover': '繩索夾胸',
      'Dumbbell Fly': '啞鈴飛鳥',
      'Chest Dip': '雙槓臂屈伸',
      'Machine Chest Press': '機械臥推',
      'Assisted Dip': '輔助雙槓臂屈伸',
      'Deadlift': '硬舉',
      'Barbell Row': '槓鈴划船',
      'Pull-up': '引體向上',
      'Lat Pulldown': '滑輪下拉',
      'Seated Cable Row': '坐姿划船',
      'T-bar Row': 'T 槓划船',
      'Dumbbell Row': '啞鈴划船',
      'Chin-up': '反握引體向上',
      'Rack Pull': '架上拉',
      'Hyperextension': '山羊挺身',
      'Assisted Pull-up': '輔助引體向上',
      'Back Squat': '槓鈴深蹲',
      'Front Squat': '前蹲',
      'Bulgarian Split Squat': '保加利亞分腿蹲',
      'Leg Press': '腿推機',
      'Leg Extension': '腿伸展',
      'Leg Curl': '腿彎舉',
      'Lunge': '弓箭步',
      'Goblet Squat': '高腳杯深蹲',
      'Hip Thrust': '臀推',
      'Glute Bridge': '臀橋',
      'Cable Kickback': '繩索後踢腿',
      'Sumo Deadlift': '相撲硬舉',
      'Romanian Deadlift': '羅馬尼亞硬舉',
      'Overhead Press': '肩推',
      'Dumbbell Shoulder Press': '啞鈴肩推',
      'Lateral Raise': '側平舉',
      'Front Raise': '前平舉',
      'Rear Delt Fly': '後束飛鳥',
      'Arnold Press': '阿諾推舉',
      'Upright Row': '直立划船',
      'Barbell Shrug': '槓鈴聳肩',
      'Dumbbell Shrug': '啞鈴聳肩',
      'Face Pull': '面拉',
      'Barbell Curl': '槓鈴彎舉',
      'Dumbbell Curl': '啞鈴彎舉',
      'Hammer Curl': '錘式彎舉',
      'Preacher Curl': '牧師椅彎舉',
      'Cable Curl': '繩索彎舉',
      'Tricep Pushdown': '三頭下壓',
      'Skull Crusher': '仰卧臂屈伸',
      'Overhead Tricep Extension': '過頭三頭伸展',
      'Close-grip Bench Press': '窄握臥推',
      'Bench Dip': '板凳撐體',
      'Standing Calf Raise': '站姿提踵',
      'Seated Calf Raise': '坐姿提踵',
      'Donkey Calf Raise': '驢式提踵',
      'Wrist Curl': '腕屈',
      'Reverse Wrist Curl': '反向腕屈',
      'Plank': '棒式',
      'Crunch': '捲腹',
      'Hanging Leg Raise': '懸吊舉腿',
      'Russian Twist': '俄羅斯轉體',
      'Cable Wood Chop': '繩索斜砍',
      'Pallof Press': '帕洛夫推',
    },

    /**
     * Muscle group + muscle name display label。
     * 32 筆從 v010 schema (post-rename) + v006 seed legacy 名稱合併。
     * Legacy 名稱 (前臂 / 二頭長頭 / 二頭短頭) 也保留 mapping，因為 v006 之前的
     * DB 用戶 muscle 表還是舊字串，切英文時需要對到新版翻譯。
     */
    muscleGroup: {
      // 13 主要肌群（v006 seed 順序）
      胸: '胸',
      背: '背',
      腿: '腿',
      臀: '臀',
      肩: '肩',
      斜方肌: '斜方肌',
      二頭: '二頭',
      三頭: '三頭',
      小腿: '小腿',
      小臂: '小臂',
      核心: '核心',
      手臂: '手臂',
      側腹: '側腹',
      // legacy aliases
      前臂: '前臂',
      // 19 細部位
      上胸: '上胸',
      中下胸: '中下胸',
      背部: '背部',
      下背: '下背',
      股四: '股四',
      膕繩: '膕繩',
      上臀部: '上臀部',
      下臀部: '下臀部',
      前束: '前束',
      中束: '中束',
      後束: '後束',
      內側二頭: '內側二頭',
      外側二頭: '外側二頭',
      // legacy aliases (pre-v010 names — kept so older DBs still resolve)
      二頭長頭: '二頭長頭',
      二頭短頭: '二頭短頭',
      腹肌: '腹肌',
    },

    /**
     * load_type label (NOT equipment) — paired with PR weight modifier.
     * 「徒手」zh literal 保留、en 用 Unloaded（與 equipment 自重→Bodyweight 不撞）。
     */
    loadType: {
      bodyweight: '徒手',
      weighted: '加重',
      assisted: '助力',
    },

    /** Tab bar titles. ADR-0024 § 1 — 訓練 tab rename (was 'Today'). */
    tabs: {
      training: '訓練',
      // Smoke F1 patch — 4 tab bar titles previously hard-coded in
      // app/(tabs)/_layout.tsx; mirror page.* labels for cross-screen
      // consistency.
      programs: '計畫',
      library: '動作庫',
      history: '歷史',
      settings: '設定',
    },
  },

  en: {
    common: {
      cancel: 'Cancel',
      confirm: 'Confirm',
      done: 'Done',
      create: 'Create',
      delete: 'Delete',
      edit: 'Edit',
      save: 'Save',
      saving: 'Saving…',
      add: 'Add',
      back: 'Back',
      next: 'Next',
      apply: 'Apply',
      select: 'Select',
      all: 'All',
      none: 'None',
      default: 'Default',
      yes: 'Yes',
      no: 'No',
      close: 'Close',
      skip: 'Skip',
      backArrow: '‹ Back',
      backPlain: 'Back',
      go: 'Go',
      open: 'Open',
      ok: 'OK',
      noneParen: '(None)',
      notSelected: '— Not selected —',
      empty: '(empty)',
      unknownExercise: '(unknown exercise)',
      custom: '· Custom',
      inactive: '· Inactive',
      inProgress: '· In progress',
      // Phase 4.5 batch 1 — plain "Custom" (no dot prefix) for wizard intensity chip.
      customPlain: 'Custom',
    },

    domain: {
      program: 'Program',
      template: 'Template',
      session: 'Session',
      exercise: 'Exercise',
      cluster: 'Cluster',
      superset: 'Superset',
      cycle: 'Cycle',
      day: 'Day',
      week: 'Week',
      intensity: 'Intensity',
      warmup: 'Warm-up',
      workingSet: 'Working Set',
      dropSet: 'Drop Set',
      reps: 'Reps',
      weight: 'Weight',
      weightKg: 'Weight (kg)',
      volume: 'Volume',
      strength: 'Strength',
      maxStrength: 'Max Strength',
      hypertrophy: 'Hypertrophy',
      endurance: 'Endurance',
      muscularEndurance: 'Muscular Endurance',
      bodyweight: 'Bodyweight',
      warmupChip: 'W',
      supersetChip: 'SS',
      freestyle: 'Freestyle',
      restDay: 'Rest Day',
      rest: 'Rest',
      programSchedule: 'Programs',
      cycleSetup: 'Cycle Setup',
      cycleLengthDays: 'Cycle Length (days)',
      cycleCount: 'Cycle Count',
      programNameMain: 'Program',
      mainTagPrefix: 'Main tag',
      history: 'History',
      chart: 'Chart',
      stats: 'Stats',
      data: 'Data',
      calendar: 'Calendar',
      achievements: 'Achievements',
      trend: 'Trend',
      maxWeight: 'Max Weight',
      maxVolume: 'Max Volume',
      oneRepMaxEstimate: '1RM Estimate',
      trainingVolume: 'Training Volume',
      trainingPreferences: 'Training Preferences',
      newTemplate: 'New Template',
      supersetName: 'Superset Name',
      note: 'Note',
      startDate: 'Start Date',
      weekdaySun: 'Sun',
      weekdayMon: 'Mon',
      weekdayTue: 'Tue',
      weekdayWed: 'Wed',
      weekdayThu: 'Thu',
      weekdayFri: 'Fri',
      weekdaySat: 'Sat',
      // Phase 4.5 audit (2026-05-24) — Stats panel period selector chips.
      year: 'Year',
      month: 'Month',
    },

    button: {
      loadProgram: '↓ Load Program',
      combine: 'Combine',
      cues: 'Cues',
      replay: '↻ Replay',
      replayDescription: 'Replay — overwrite current card sets',
      useLatestTemplate: 'Use Latest Template',
      listView: 'List',
      sideBySide: 'Side by Side',
      newTemplate: '+ New',
      newCta: 'New',
      newProgramTemplate: '+ Create New Template',
      addIntensity: '+ Add Intensity',
      addIntensityPlain: 'Add Intensity',
      addExercise: '+ Exercise',
      addExercisePlain: 'Add Exercise',
      addCustomExercise: 'Add Custom Exercise',
      addRecord: 'Add Record',
      // ADR-0024 § 2.b — 訓練 tab freestyle CTA + busy state + planned empty CTA.
      startFreestyle: '+ Start Freestyle',
      starting: 'Starting…',
      gotoPrograms: 'Go to Programs',
      createOrActivateProgram: 'Create / activate program',
      editExercise: 'Edit Exercise',
      editSession: 'Edit Session',
      editSuperset: 'Edit Superset',
      editKeep: 'Keep Editing',
      discardChanges: 'Discard Changes',
      discardSession: '🚫 Discard Session',
      discardSimple: 'Discard',
      // Smoke F3 patch — see zh-side note.
      bodyData: 'Body data',
      saveTemplate: 'Save Template',
      saveAsTemplate: 'Save as Template',
      deleteExercise: 'Delete Exercise',
      deleteSession: 'Delete This Session',
      deleteSuperset: 'Delete Superset',
      uncheck: 'Uncheck',
      clearFilter: 'Clear Filter',
      markAsDone: 'Mark as Done',
      switchToChart: 'Switch to Chart',
      viewHistory: 'View History',
      viewCues: 'View Coaching Cues',
      viewExerciseDetails: 'View Exercise Details',
      viewSupersetDetails: 'View Superset Details',
      sendToWatch: 'Send to Watch ⌚',
      createSuperset: 'Create Superset',
      applyTemplateToColumn: 'Apply template to this column',
      applyIntensityToRow: 'Apply intensity to this row',
      restRowClear: 'Rest (clear this row)',
      shrinkAndDiscard: 'Shrink and Discard',
      confirmCreate: 'Confirm Create',
      overwrite: 'Overwrite',
      manualRest: 'Manual Rest',
      manualRestStart: 'Start Rest Countdown Manually',
      noteCta: 'Note',
      previous: 'Previous',
      next: 'Next',
      clusterRestSeconds: '⏱️ Rest Seconds',
      clusterEditNote: '📝 Edit Note',
      clusterReorderExercises: '🔃 Reorder Exercises',
      clusterDeleteExercise: '🗑️ Delete Exercise',
      clusterHistoryA: '📖 Exercise History (A)',
      clusterHistoryB: '📖 Exercise History (B)',
      // Phase 4.5 batch 1 — solo + cluster card "+ 新增 1 組" primary CTA.
      addOneSet: 'Add 1 Set',
      // Phase 4.5 batch 1 — swipe-delete label on cluster cycle row.
      swipeDelete: 'Del',
      // Phase 4.5 final — swipe-add (clone) label on template editor row.
      swipeAdd: 'Add',
      // Phase 4.5 final — swipe-note label on template editor row.
      swipeNote: 'Note',
      // Phase 4.5 batch 1 — Today bottom-bar manual rest-timer button.
      manualTimer: '⏱ Manual Timer',
      // Phase 4.5 batch 1 — accessibilityLabel: ⚙️ on exercise card.
      a11yExerciseSettings: 'Exercise settings',
      // Phase 4.5 batch 1 — accessibilityLabel: ⚙️ on cluster card.
      a11yClusterSettings: 'Superset settings',
      // Phase 4.5 batch 1 — accessibilityLabel: 📝 indicator on cluster cycle row.
      a11yOpenNote: 'Open note',
      // Phase 4.5 batch 1 — accessibilityLabel: ✓/○ button toggling set logged state.
      a11yMarkSetDone: 'Mark this set done',
      a11yUncheckSetDone: 'Uncheck this set',
      // Card 11 / ADR-0014 — accessibilityLabel: in-session header tap-to-edit
      // session title.
      a11yTapEditTitle: 'Tap to edit session title',
      // 2026-05-25 wave 2 i18n sweep — accessibilityLabel: in-session header
      // ⋯ menu (Today screen `onHeaderMenuPress`).
      a11ySessionMenu: 'Session menu',
      // 2026-05-25 wave 2 i18n sweep — accessibilityLabel: detail-page edit
      // mode toggle button (session/[id].tsx sticky bar).
      a11yEditMode: 'Edit mode',
      // Phase 4.5 batch 2 — template editor / sheet CTAs.
      creating: 'Creating…',
      addProgram: 'Add Program',
      editTemplate: 'Edit Template',
      startSession: 'Start Session',
      createAndImport: 'Create and Import',
      selectColorAction: 'Color',
      deleteTemplate: 'Delete Template',
      newWithPlus: '+ New',
      addNote: 'Add Note',
      editNote: 'Edit Note',
      moveExercise: 'Move Exercise',
      setAsEvergreen: 'Set as Evergreen',
      setAsGeneral: 'Set as General',
    },

    page: {
      programs: 'Programs',
      session: 'Session',
      library: 'Library',
      history: 'History',
      // ADR-0024 § 2 — Training tab idle 3-section headers.
      plannedTraining: 'Planned Training',
      freestyleTraining: 'Freestyle Training',
      templateTraining: 'Templates',
      // Smoke F1 patch — see zh-side note.
      todayPlan: "Today's plan",
      exerciseDetail: 'Exercise Details',
      exerciseHistory: 'Exercise History',
      exerciseChart: 'Exercise Chart',
      exerciseList: 'Exercise List',
      exerciseSettings: 'Exercise Settings',
      bodyMetrics: 'Body Metrics',
      settings: 'Settings',
      backupRestore: 'Backup / Restore',
      supersetDetails: 'Superset Details',
      wizardStep1: 'Program Name + Intensity',
      wizardStep2: 'Cycle Setup',
      wizardStep3: 'Cycle 1 Daily Content',
      wizardStep4: 'Per-Cycle Intensity',
      wizardStep5: 'Calendar Preview',
      wizardStep6: 'Review and tap Create below.',
      wizardStep5Hint: 'Expanded calendar — verify it looks right.',
      selectProgram: 'Select Program',
      selectProgramAlt: 'Select Program',
      selectTemplate: 'Select Template',
      selectIntensity: 'Select Intensity',
      selectCycleLength: 'Select Cycle Length',
      selectCycleCount: 'Select Cycle Count',
      selectMonth: 'Select Month',
      selectStartDate: 'Select Start Date',
      selectProgramToLoad: 'Select Program to Load',
      enterSupersetName: 'Enter superset name',
      enterSupersetNameShort: 'Enter superset name',
      enterExerciseName: 'Enter exercise name',
      searchExercises: 'Type to search exercises',
      programNamePlaceholder: 'Program Name',
      newIntensityName: 'New intensity name',
      intensityPlaceholder: 'Intensity (e.g. 10-12RM)',
      intensityOptionalMulti: 'Intensity (optional, multiple)',
      cycleLengthInput: 'Cycle Length (3–14 days)',
      startDateInput: 'Start Date (yyyy-mm-dd)',
      notePlaceholder: 'e.g. grip width, force focus, common mistakes...',
      intensityExample: 'e.g. 10-12RM, II-1',
      programNameExample: 'e.g. Hypertrophy-Q1',
      // Phase 5 — settings Language section header
      languageSection: 'Language',
      // ADR-0025 — settings Color Theme section header (placed above languageSection).
      colorThemeSection: 'Color Theme',
      // Phase 5 — settings section headers + hints (sweep TODO(i18n))
      unitPreferenceSection: 'Unit Preference',
      unitPreferenceHint:
        'Display unit toggle (data is stored in kg; this only affects display and input).',
      autoPopupRestTimerHint:
        'Auto-show a 60-second countdown after marking a set as complete (close manually or skip).',
      bodyMetricsHint:
        'Bodyweight / PBF / SMM trends and history. Quick input is still available from the Today tab.',
      // Phase 4.5 batch 1 — wizard Step 3 / Step 4 hint paragraphs.
      wizardStep3Hint:
        'Pick a template for each day (leave blank for a rest day). Cycle 1 picks fan out to every cycle; per-cycle intensities come next.',
      wizardStep4Hint:
        'Pick one intensity per cycle (applied to all days-with-templates in the cycle). Leave on "Default" to skip.',
      // Phase 4.5 batch 1 — wizard Step 6 summary line prefixes.
      summaryName: 'Name: ',
      summaryIntensity: 'Intensity: ',
      summaryCycle: 'Cycle: ',
      summaryStart: 'Start: ',
      summaryConfiguredDays: 'Configured Days: ',
      summaryIntensityOverride: 'Intensity Overrides: ',
      summarySuffixDays: ' days',
      summarySuffixCount: ' items',
      summarySeparator: ', ',
      // Programs tab meta line: "{count} × {length} days · Starts {start_date}".
      metaStartPrefix: 'Starts',
      // Session detail / Today section header above exercise list.
      exerciseListSection: 'Exercise List',
      // SessionTimeEditorSheet labels.
      editSessionTime: 'Edit Session Time',
      startTimeLabel: 'Start Time',
      endTimeLabel: 'End Time',
      durationLabel: 'Duration',
      // Phase 4.5 batch 2 — pages / sheets / placeholders.
      templates: 'Templates',
      selectColor: 'Select Color',
      selectExercise: 'Select Exercise',
      selectCategory: 'Select Category',
      selectEquipment: 'Select Equipment',
      restTime: 'Rest Time',
      saveTemplateSheet: 'Save Template',
      createAndImportSheet: 'Create and Import',
      advancedFilter: 'Advanced Filter',
      bodyOverview: 'Body Overview',
      capacityByMg: 'Capacity by Muscle Group · Last 6 Periods',
      durationOverPeriod: 'Workout Duration · Last 6 Periods',
      templateNamePlaceholder: 'Template Name',
      nameFieldLabel: 'Name',
      categoryLabel: 'Category',
      equipmentLabel: 'Equipment',
      muscleGroupOptionalLabel: 'Muscle Groups (optional)',
      exerciseNameA11y: 'Exercise Name',
      exerciseNameExamplePlaceholder: 'e.g. Ring Row',
      pickCategoryPlaceholder: 'Please select a category',
      templateProgramLabel: 'Program',
      templateIntensityLabel: 'Intensity Tag',
      newProgramNamePlaceholder: 'Enter new program name (≤ 60 chars)',
      newIntensityWithExamplePlaceholder: 'Enter new intensity tag (e.g. 5x5, Max Strength)',
      noteEditorPlaceholder: 'Tips, cues, reminders...',
      muscleTagHelper: 'Tap tags to cycle: unselected → primary (orange) → secondary (blue) → cleared. When empty, the anatomy diagram is hidden on the exercise detail page.',
      // Body heatmap M-layer view column headers.
      bodyFront: 'Front',
      bodyBack: 'Back',
      // Phase 4.5 final sweep — set-note sheet placeholder.
      setNotePlaceholder: 'What to remember about this set? (e.g. RPE 8, left elbow tight)',
      // Card 11 / ADR-0014 — in-session header tap-to-edit title placeholder
      // (freestyle / un-named session).
      sessionTitlePlaceholder: 'Freestyle session',
    },

    alert: {
      programNameExists: 'Program name already exists',
      programNameExistsWarning: '⚠️ Program name already exists',
      programNameExistsMsg: 'Please pick a different name.',
      deleteSupersetQ: 'Delete this superset?',
      deleteExerciseQ: 'Delete exercise?',
      templateNotCreated: 'Template not yet created',
      reorderFailed: 'Reorder failed',
      deleteFailed: 'Delete failed',
      saveFailed: 'Save failed',
      readFailed: 'Read failed',
      loadFailed: 'Load failed',
      restoreFailed: 'Restore failed',
      overwriteFailed: 'Overwrite failed',
      importFailed: 'Import failed',
      addDropsetFailed: 'Failed to add dropset',
      addExerciseFailed: 'Failed to add exercise',
      editFailed: 'Edit failed',
      cannotDelete: 'Cannot delete',
      cannotSwap: 'Cannot swap',
      cannotOverwrite: 'Cannot overwrite',
      cannotReadTemplate: 'Cannot read template',
      cannotOpen: 'Cannot open',
      cannotOpenEditor: 'Cannot open editor',
      cannotStartSession: 'Cannot start session',
      cannotCreateTemplate: 'Cannot create template',
      failed: 'Failed',
      noActiveSession: 'No active session found. Return to Today and start a session, then try again.',
      sessionAlreadyInProgress: 'A session is already in progress',
      endActiveSessionFirst: 'End the current session in the "Today" tab before starting a new one.',
      exerciseNotFound: 'Exercise not found.',
      exerciseNotFoundOrArchived: 'Exercise does not exist or has been archived.',
      sourceCardNotFound: 'Source card for this exercise not found.',
      sourceCardASideNotFound: 'Source card for superset A side not found.',
      sourceCardBSideNotFound: 'Source card for superset B side not found.',
      originalTemplateNotFound: 'Original template not found',
      sessionTemplateMissing:
        'This session has no linked template, or the original was deleted. Use "Save as Template" to create a new one.',
      supersetNotFound: 'Superset does not exist or has been deleted.',
      builtinExerciseNoEdit: 'Built-in exercises have no editable fields right now.',
      builtinExerciseNoDelete: 'Built-in exercises cannot be deleted.',
      dropsetMinimum: 'Dropset needs at least 2 sets (head + 1 follower). To delete the whole chain, swipe the head row.',
      duplicateExerciseName: 'An exercise with this name already exists. Please rename.',
      duplicateSupersetPair: 'A superset with this exercise pair already exists',
      openExistingSupersetQ: 'Open the existing superset for editing?',
      supersetExactlyTwo: 'Superset must contain exactly 2 exercises',
      supersetNoDuplicates: 'Superset cannot have duplicate exercises',
      supersetNameMaxLen: 'Superset name must be under 60 characters',
      exerciseNameMaxLen: 'Exercise name must be under 60 characters',
      colorHexFormat: 'color_hex must be 6-digit hex (#rrggbb) or null',
      exerciseIdsNoEmpty: 'exercise_ids must not contain empty values',
      muscleGroupOverlap: 'A muscle group cannot be both primary and secondary',
      pickCategoryFirst: 'Please select a category',
      pickEquipmentFirst: 'Please select an equipment type',
      pickTwoExercises: 'Please select 2 exercises',
      replaySessionQ: 'Replay session?',
      replaySessionSupersetQ: 'Replay session (superset)?',
      noTemplatePickFirst:
        'Pick a template in a cell first, then come back to apply intensity.\n(Intensity can only attach to cells that have a template.)',
      noTemplateOnRow: 'This row has no template',
      shrinkProgramQ: 'Shrink program schedule?',
      noTemplatesYet: 'No templates. Create one first, then come back.',
      noOptionsToSelect: 'No options to select.',
      noProgramsAvailable: 'No available Programs.',
      noProgramsToLoad: 'No programs available to load',
      programHasNoSubTag: 'This Program has no intensity history.',
      // Wave 18g (Phase 6) — same-name overwrite UX consequence banner.
      overwriteSheetBodyConsequence:
        'Creating this will completely replace the existing program settings (cycle length, cycle count, start date, daily content, intensities). Finished session records are preserved.',
      cannotUndo: 'This cannot be undone.',
      cannotUndoLong: 'This cannot be undone — the entire session, exercises, and records will be deleted.',
      historyUnaffected: 'Historical session records are unaffected.',
      allLoggedSetsDeleted: 'All logged sets will be deleted. This cannot be undone.',
      discardChangesQ: 'Discard changes?',
      discardChangesLong: 'Leaving will revert to the state before editing. All changes will be lost.',
      discardSessionQ: 'Discard this session?',
      enterPositiveOrSkip: 'Enter a positive number or tap Skip',
      atLeastOneField: 'Fill in at least one field with a reasonable value',
      atLeastOneBodyField: 'Fill in at least one field (Bodyweight / PBF / SMM)',
      mustBeWithin500Kg: 'Must be within 0–500 kg',
      invalidBodyweight: 'Invalid bodyweight',
      invalidBodyweightLong: 'Invalid bodyweight (must be 0–500 kg)',
      invalidPbf: 'PBF must be 0–100 %',
      invalidSmm: 'Invalid SMM (must be 0–200 kg)',
      invalidInput: 'Invalid input',
      // 2026-05-25 wave 2 i18n sweep — Alert.alert titles previously hardcoded
      // in app/(tabs)/index.tsx + app/session/[id].tsx error paths.
      cloneFailed: 'Clone failed',
      addCycleFailed: 'Add cycle failed',
      endSessionFailed: 'Could not end session',
      variantExists: 'Variant already exists',
      notEnoughDataPoints: 'Not enough data points for this period. At least 2 sessions are required.',
      defaultVariantUndeletable:
        'This template has a "Default" variant (no program or intensity specified). It serves as a fallback for history prefill and cannot be deleted.\n\nTo delete a non-default variant, tap that row to open the editor and delete from the ⋯ menu.',
      // Phase 4.5 batch 1 — SessionTimeEditorSheet end-must-be-after-start warning.
      endMustBeAfterStart: '⚠️ End time must be later than start time',
      // Phase 4.5 batch 1 — Programs row picker preview hint (split for dynamic name).
      intensityWillBeSetPrefix: 'Intensity will be set to "',
      intensityWillBeSetSuffix: '" (from the nearest cell)',
      // Phase 4.5 batch 1 — Today "Send to Watch" placeholder body.
      watchComingSlice13:
        'Coming in slice 13 — WatchConnectivity transferUserInfo + Watch SwiftUI app.',
      // Phase 4.5 batch 2 — template editor / start-template-sheet / forms.
      cannotSave: 'Cannot save',
      intensityNameExists: 'Intensity name already exists, please use a different one.',
      pickProgramFirst: 'Please select a program first.',
      duplicateTemplateTripleBody: 'A template with the same name + program + intensity already exists. Please use a different intensity name.',
      duplicateTemplateTripleEditorBody: 'A template with the same "name + program + intensity" already exists. Please change the intensity or program.',
      templateNotFound: 'Template not found',
      addExerciseFirst: 'Add at least one exercise before starting a session.',
      deleteTemplateQ: 'Delete template?',
      confirmDeleteQ: 'Confirm delete?',
      saveAsTemplateStubBody: 'Triple UI to be completed in production (ADR-0014). Not implemented in slice 9.5.',
    },

    status: {
      loading: 'Loading…',
      ending: 'Ending…',
      saved: 'Saved',
      savedAsNew: 'Saved as new',
      selected: 'Selected',
      noTrainingRecords: 'No training records yet',
      noRecords: 'No records yet',
      noExercisesAdded: 'No exercises added yet',
      noSupersetsYet: 'No supersets yet',
      noSupersetsHint: 'Tap the "+" in the top right to create a new superset',
      noExercisesMatch: 'No exercises match',
      noRecordsUnderFilter: 'No records under current filters.',
      noIntensity: 'No intensity',
      freestyle: 'Freestyle',
      restDay: 'Rest Day',
      inProgress: '· In progress',
      todayOutsideProgram: 'Today is outside the Program range',
      // ADR-0024 § 2.a — Training tab planned-training section state copy.
      noActiveProgram: 'No active program',
      todayRest: 'Rest day 💤',
      hideUnchecked: 'Hide unchecked',
      // Card 12R / Round G — force-kill recovery toast on session detail focus.
      editSnapshotRestored: 'Restored your unfinished edits',
      alreadyASide: 'Already A side',
      alreadyBSide: 'Already B side',
      excludeSupersets: 'Exclude supersets',
      includeSupersets: 'Include supersets',
      supersetsOnly: 'Supersets only',
      highestVolumePerSession: '(Highest-volume set per session)',
      heaviestSetPerSession: '(Heaviest set per session)',
      maxEstimated1rmPerSession: '(Max estimated 1RM per session)',
      firstTime: '(First time)',
      allTimeWeightPr: '★ All-time Weight PR',
      allTimeVolumePr: '★ All-time Volume PR',
      autoShowRestCountdown: 'Auto-show rest countdown',
      backupComingSlice15: 'Coming in slice 15.',
      thisYear: 'This Year',
      previousYear: 'Previous Year',
      nextYear: 'Next Year',
      missingExercise: 'Exercise Missing',
      previousYearArrow: 'Previous Year',
      // Phase 5 — settings Language toggle radio labels
      languageAuto: 'Auto-detect',
      languageZh: 'Traditional Chinese',
      languageEn: 'English',
      // ADR-0025 — settings Color Theme radio labels (system / light / dark).
      themeSystem: 'Auto (follow system)',
      themeLight: 'Light',
      themeDark: 'Dark',
      // Phase 4.5 batch 1 — Programs tab empty-state CTA.
      noProgramsYetHint: 'No programs yet. Tap "New" to launch the 6-step wizard.',
      // Phase 4.5 batch 1 — Today program banner "today: {template}" prefix.
      todayPrefix: 'Today: ',
      // Phase 4.5 batch 1 — Today pre-prompt bodyweight confirmation hint.
      prePromptBwHint: 'Confirm current bodyweight (locked to this session).',
      // Phase 4.5 batch 1 — Today / Session detail empty-plan body.
      emptyPlanBody: 'Tap "+ Exercise" below to start logging this session.',
      // Phase 4.5 batch 1 — solo exercise card empty-state hint.
      soloEmptyHint: 'No sets yet — tap "+ Add 1 Set" below to start logging',
      // Phase 4.5 batch 1 — cluster card empty-state hint.
      clusterEmptyHint: 'No cycles yet — tap "+ Add 1 Set" below to start logging',
      // Phase 4.5 batch 2 — template editor / forms / sheets.
      noGeneralExercises: '(No general exercises)',
      noEvergreenExercises: '(No evergreen exercises)',
      colorPickerFootnote: 'Color is shared group-wide across all templates with the same name.',
      exercisePickerFootnote: 'Tapping an exercise adds it to "General"; use ⚙ "Set as Evergreen" to change category.',
      noteEditorFootnote: 'Notes record cues and reminders for the exercise.',
      restTimeFootnote: 'After ticking a set, the session auto-starts a countdown of this length.',
      noHistoryYet: 'No history yet for this exercise. It will appear after your first session.',
      noTrainingThisPeriod: 'No sessions in this period',
      noCapacityRecent: 'No training capacity in the last 6 periods',
      achievementLocked: 'Locked',
      defaultVariantHint: '(Fixed)',
      lastUsedHint: '(Last used)',
      noTemplatesYetHint: 'No templates yet — tap "+ New" to create your first one.',
      sessionDuration: 'Training Duration',
      exerciseCountLabel: 'Exercises',
      anchor: 'Anchor',
      today: 'Today',
      loadTypeLabel: 'Type: ',
      topSetLabel: 'Top set: ',
      bodyweightLabel: 'Bodyweight: ',
      filterMuscleGroup: 'Muscle Group',
      filterTrainingGoal: 'Training Goal',
      filterMilestone: 'Milestone',
      editTrainingTimeA11y: 'Edit Training Time',
      heatmapSubtitle: 'Color = per-Session frequency quintile',
      capacityMgSubtitle: 'Trained muscle groups only · Red dashed line = 6-period average',
      durationSubtitle: 'Each bar = period total duration · Red dashed line = 6-period average',
      // Phase 4.5 final sweep — chart / sheet / modal inline literals.
      avgPrefix: 'Avg',
      bodyMetricsEmptyHint: 'Enter bodyweight / PBF / SMM above to start tracking.',
      reorderHint: 'Long-press any row to drag and reorder. Tap "Done" at top-right to save.',
      restingHeader: 'Resting',
      restFinished: "Time's up — go again 💪",
      restRunning: 'Make the most of the rest.',
      bwSnapshotFrozenHint: "This session's bw_snapshot will not be overwritten.",
      muscleRolePrimary: 'Primary',
      muscleRoleSecondary: 'Secondary',
      muscleRoleInactive: 'Inactive',
      noSessionsYetHint: 'No sessions yet — start one in the Today tab.',
    },

    equipment: {
      槓鈴: 'Barbell',
      啞鈴: 'Dumbbell',
      史密斯機: 'Smith Machine',
      滑輪: 'Cable',
      固定機械: 'Machine',
      自重: 'Bodyweight',
      壺鈴: 'Kettlebell',
      其他: 'Other',
    },

    /**
     * Exercise display name — EN locale is identity (DB names ARE EN).
     * Kept parallel to zh.exercise so the shape-invariant test passes;
     * `tExercise()` returns the value either way.
     */
    exercise: {
      'Bench Press': 'Bench Press',
      'Push-up': 'Push-up',
      'Incline Bench Press': 'Incline Bench Press',
      'Decline Bench Press': 'Decline Bench Press',
      'Dumbbell Bench Press': 'Dumbbell Bench Press',
      'Incline Dumbbell Press': 'Incline Dumbbell Press',
      'Cable Crossover': 'Cable Crossover',
      'Dumbbell Fly': 'Dumbbell Fly',
      'Chest Dip': 'Chest Dip',
      'Machine Chest Press': 'Machine Chest Press',
      'Assisted Dip': 'Assisted Dip',
      'Deadlift': 'Deadlift',
      'Barbell Row': 'Barbell Row',
      'Pull-up': 'Pull-up',
      'Lat Pulldown': 'Lat Pulldown',
      'Seated Cable Row': 'Seated Cable Row',
      'T-bar Row': 'T-bar Row',
      'Dumbbell Row': 'Dumbbell Row',
      'Chin-up': 'Chin-up',
      'Rack Pull': 'Rack Pull',
      'Hyperextension': 'Hyperextension',
      'Assisted Pull-up': 'Assisted Pull-up',
      'Back Squat': 'Back Squat',
      'Front Squat': 'Front Squat',
      'Bulgarian Split Squat': 'Bulgarian Split Squat',
      'Leg Press': 'Leg Press',
      'Leg Extension': 'Leg Extension',
      'Leg Curl': 'Leg Curl',
      'Lunge': 'Lunge',
      'Goblet Squat': 'Goblet Squat',
      'Hip Thrust': 'Hip Thrust',
      'Glute Bridge': 'Glute Bridge',
      'Cable Kickback': 'Cable Kickback',
      'Sumo Deadlift': 'Sumo Deadlift',
      'Romanian Deadlift': 'Romanian Deadlift',
      'Overhead Press': 'Overhead Press',
      'Dumbbell Shoulder Press': 'Dumbbell Shoulder Press',
      'Lateral Raise': 'Lateral Raise',
      'Front Raise': 'Front Raise',
      'Rear Delt Fly': 'Rear Delt Fly',
      'Arnold Press': 'Arnold Press',
      'Upright Row': 'Upright Row',
      'Barbell Shrug': 'Barbell Shrug',
      'Dumbbell Shrug': 'Dumbbell Shrug',
      'Face Pull': 'Face Pull',
      'Barbell Curl': 'Barbell Curl',
      'Dumbbell Curl': 'Dumbbell Curl',
      'Hammer Curl': 'Hammer Curl',
      'Preacher Curl': 'Preacher Curl',
      'Cable Curl': 'Cable Curl',
      'Tricep Pushdown': 'Tricep Pushdown',
      'Skull Crusher': 'Skull Crusher',
      'Overhead Tricep Extension': 'Overhead Tricep Extension',
      'Close-grip Bench Press': 'Close-grip Bench Press',
      'Bench Dip': 'Bench Dip',
      'Standing Calf Raise': 'Standing Calf Raise',
      'Seated Calf Raise': 'Seated Calf Raise',
      'Donkey Calf Raise': 'Donkey Calf Raise',
      'Wrist Curl': 'Wrist Curl',
      'Reverse Wrist Curl': 'Reverse Wrist Curl',
      'Plank': 'Plank',
      'Crunch': 'Crunch',
      'Hanging Leg Raise': 'Hanging Leg Raise',
      'Russian Twist': 'Russian Twist',
      'Cable Wood Chop': 'Cable Wood Chop',
      'Pallof Press': 'Pallof Press',
    },

    muscleGroup: {
      胸: 'Chest',
      背: 'Back',
      腿: 'Legs',
      臀: 'Glutes',
      肩: 'Shoulders',
      斜方肌: 'Traps',
      二頭: 'Biceps',
      三頭: 'Triceps',
      小腿: 'Calves',
      小臂: 'Forearms',
      核心: 'Core',
      手臂: 'Arms',
      側腹: 'Obliques',
      // legacy: 前臂 was renamed to 小臂 in v010 → both map to Forearms
      前臂: 'Forearms',
      上胸: 'Upper Chest',
      中下胸: 'Lower Chest',
      背部: 'Back',
      下背: 'Lower Back',
      股四: 'Quads',
      膕繩: 'Hamstrings',
      上臀部: 'Upper Glutes',
      下臀部: 'Lower Glutes',
      前束: 'Front Delt',
      中束: 'Mid Delt',
      後束: 'Rear Delt',
      內側二頭: 'Inner Biceps',
      外側二頭: 'Outer Biceps',
      // legacy: 二頭長頭/短頭 were renamed to 外側/內側二頭 in v010
      二頭長頭: 'Outer Biceps',
      二頭短頭: 'Inner Biceps',
      腹肌: 'Abs',
    },

    loadType: {
      bodyweight: 'Unloaded',
      weighted: 'Weighted',
      assisted: 'Assisted',
    },

    /** Tab bar titles. ADR-0024 § 1 — 訓練 tab rename (was 'Today'). */
    tabs: {
      training: 'Training',
      // Smoke F1 patch — see zh-side note.
      programs: 'Programs',
      library: 'Library',
      history: 'History',
      settings: 'Settings',
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Type machinery
// ---------------------------------------------------------------------------

export type StringsTree = typeof strings.zh;
export type Namespace = keyof StringsTree;
export type StringKey<NS extends Namespace> = keyof StringsTree[NS];

// ---------------------------------------------------------------------------
// Locale state (module-level singleton; Phase 5 wraps this in a Context)
// ---------------------------------------------------------------------------

let currentLocale: Locale = 'zh';

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/**
 * Type-safe namespaced lookup.
 *
 * Falls back to zh if the current locale's namespace/key is missing
 * (shouldn't happen because the shape invariant is enforced by tests).
 *
 * @example
 *   t('common', 'cancel') // 'Cancel' if locale==='en', '取消' otherwise
 */
export function t<NS extends Namespace, K extends StringKey<NS>>(ns: NS, key: K): string {
  const localeTree = strings[currentLocale] as StringsTree;
  const fromLocale = localeTree[ns][key] as string | undefined;
  if (fromLocale !== undefined) return fromLocale;
  // defensive fallback to zh (shape-invariant test should keep this dead in practice)
  return strings.zh[ns][key] as unknown as string;
}

/**
 * Equipment enum DB value (zh literal) → display label.
 * Unknown DB values pass through unchanged so we never crash on legacy rows.
 */
export function tEquipment(dbValue: string): string {
  const tree = strings[currentLocale].equipment as Record<string, string>;
  return tree[dbValue] ?? dbValue;
}

/**
 * Muscle group / muscle name DB value → display label.
 * Legacy zh names (前臂 / 二頭長頭 / 二頭短頭) round-trip via aliases so older
 * DBs still resolve to the post-v010 English label.
 */
export function tMuscleGroup(dbValue: string): string {
  const tree = strings[currentLocale].muscleGroup as Record<string, string>;
  return tree[dbValue] ?? dbValue;
}

/**
 * Exercise name DB value (EN literal for v006 seed) → display label.
 * User-created exercise names (not in the seed) pass through unchanged
 * via the fallback, so custom exercises stay verbatim in whatever
 * language the user typed them in.
 */
export function tExercise(dbValue: string): string {
  const tree = strings[currentLocale].exercise as Record<string, string>;
  return tree[dbValue] ?? dbValue;
}

/**
 * Load-type label (NOT equipment) — paired with PR weight modifier display.
 * Distinct from `tEquipment('自重')`: 自重 (equipment) → 'Bodyweight', but
 * load_type bodyweight → 'Unloaded' to avoid collision in PR readout.
 */
export function tLoadType(loadType: 'bodyweight' | 'weighted' | 'assisted'): string {
  return strings[currentLocale].loadType[loadType];
}
