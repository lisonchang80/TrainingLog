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
      // App-wide ErrorBoundary fallback (components/error-boundary.tsx).
      errorTitle: '發生未預期的錯誤',
      errorBody: '畫面載入時出了點問題。請點下方按鈕重試；若仍無法恢復，請重新開啟 App。',
      retry: '重新嘗試',
      // i18n leak sweep (2026-06-04) — fallback when an exercise has no name
      // (template editor rows / reorder sheet). Distinct from unknownExercise.
      exercisePlaceholder: '(動作)',
    },

    /**
     * 頁面說明 overlay 的介面 chrome（ⓘ 按鈕 a11y / 視窗關閉 / 引導教學鈕）。
     * 各頁的「說明文案 / 引導步驟」內容不放這裡，放 components/help/content/<pageId>.ts。
     * coach 控制鈕（上一步/下一步/略過/完成）沿用 common.back/next/skip/done。
     */
    help: {
      button: '說明',
      gotIt: '了解',
      startTour: '操作教學',
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
      reps: '次數',
      weight: '重量',
      weightKg: '重量 (kg)',
      volume: '容量',
      strength: '力量',
      maxStrength: '最大力量',
      hypertrophy: '增肌',
      endurance: '耐力',
      muscularEndurance: '肌耐力',
      maxStrengthChip: '最大力量',
      strengthChip: '力量',
      hypertrophyChip: '增肌',
      muscleEnduranceChip: '肌耐力',
      enduranceChip: '耐力',
      bodyweight: '體重',
      warmupChip: '熱',
      supersetChip: '超',
      freestyle: '空白訓練',
      restDay: '休息日',
      rest: '休息',
      cycleLengthDays: '循環天數',
      cycleCount: '週期數',
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
      // Slice 13 Phase A (2026-05-25) — HR + kcal scaffold; see ADR-0019.
      heartRate: '心率',
      kcal: '大卡',
      bpm: 'BPM',
    },

    /** UI button / CTA / action label。包括 wizard nav、cluster ⚙️ 選單 item。 */
    button: {
      loadProgram: '↓ 載入計劃',
      combine: '組合',
      cues: '講解',
      replay: '↻ 再次訓練',
      replayDescription: '再次訓練 — 覆蓋目前卡片的 sets',
      listView: '表列',
      sideBySide: '並排',
      newTemplate: '＋',
      newTemplateFull: '新建模板',
      newCta: '新建',
      deleteProgramCta: '刪除計劃',
      deleteSubTagCta: '刪除強度',
      newProgramTemplate: '+ 建立新模板',
      addIntensity: '+ 新增強度',
      addIntensityPlain: '新增強度',
      addExercise: '+ 動作',
      addExercisePlain: '新增動作',
      addCustomExercise: '新增自訂動作',
      addRecord: '新增記錄',
      // ADR-0024 § 2.b — 訓練 tab 空白訓練 CTA + busy 狀態 + 計劃訓練 empty CTA。
      startFreestyle: '開始空白訓練',
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
      // top bar title. 2026-06-27 renamed 體重資料 → 身體數據 (covers 體重/PBF/SMM).
      bodyData: '身體數據',
      saveTemplate: '儲存模板',
      saveAsTemplate: '另存模板',
      castToWatch: '投影 Watch',
      saveAsIntensity: '另存強度',
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
      createSuperset: '建立超級組',
      applyTemplateToColumn: '套用 template 到此 column',
      applyIntensityToRow: '套用強度到此 row',
      restRowClear: '休息（清空此列）',
      shrinkAndDiscard: '砍掉並縮小',
      confirmCreate: '確認建立',
      overwrite: '覆蓋',
      manualRest: '手動休息',
      manualRestStart: '手動開始休息倒數',
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
      // 2026-06-02 a11y batch — accessibilityLabel for data-viz charts wrapped
      // as accessibilityRole="image". VoiceOver announces the chart type
      // instead of reading raw axis numbers / nothing.
      a11yHrZoneChart: '心率區間圖表',
      a11yBarChart: '長條圖',
      a11yBodyTrendChart: '身體組成趨勢圖',
      a11yBodyHeatmap: '訓練部位熱力圖',
      a11yExerciseTrendChart: '動作趨勢圖',
      // Phase 4.5 batch 2 — template editor / sheet CTAs.
      creating: '建立中…',
      addProgram: '新增計畫',
      editTemplate: '編輯模板',
      startSession: '開始訓練',
      backfill: '補訓練',
      createAndImport: '建立並導入',
      selectColorAction: '配色',
      deleteTemplate: '刪除模板',
      deleteAllSameName: '刪除',
      addNote: '新增備註',
      editNote: '編輯備註',
      moveExercise: '移動動作',
      setAsEvergreen: '設為常設運動',
      setAsGeneral: '設為一般運動',
      // Slice 13b (2026-05-25) — Settings 「Apple Health 整合」CTA.
      connectAppleHealth: '連結 Apple Health',
      openSystemSettings: '開啟系統設定',
      // Slice 15 C4 (2026-06-13) — restore engine entry points.
      restoreBackup: '還原備份',
      startFresh: '全新開始',
      recheckBackups: '重新檢查',
      retryRestore: '重試',
      // Slice 15 C3 (2026-06-13) — Settings backup section.
      backupNow: '立即備份',
      // Slice 15b C6 (2026-06-13) — JSON export (ADR-0011 §5).
      exportJson: '匯出資料 (JSON)',
      // Slice 17 / ADR-0027 — reset rep-bucket ranges to v1 defaults.
      resetBucketRanges: '恢復預設次數範圍',
      // 2026-06-04 a11y sweep — set-row-content (SetRowContent) interactive cells.
      // {label} = 目前組別 (熱 / 工作組序號 / D{N})。
      a11yCycleSetKind: '切換組別',
      a11yEditWeight: '編輯重量',
      a11yEditReps: '編輯次數',
      a11yAddDropset: '新增遞減組',
      a11yRemoveDropset: '移除遞減組',
      // 2026-06-04 a11y sweep — numeric-keypad (NumericKeypad) ⌫ key.
      a11yKeypadBackspace: '刪除',
      // 2026-06-20 a11y sweep — slice17 獎章 tier 進度條 + 桶範圍 stepper。
      a11yTierProgress: '進度',
      a11yDecrease: '減少',
      a11yIncrease: '增加',
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
      deleteProgramTitle: '選擇要刪除的計劃',
      deleteSubTagProgramTitle: '選擇計劃',
      deleteSubTagTitle: '選擇要刪除的強度',
      selectTemplate: '選擇 template',
      selectIntensity: '選擇強度',
      minimalTemplateHint: '選擇要編輯此模板，還是直接開始訓練。',
      selectCycleLength: '選擇循環天數',
      selectCycleCount: '選擇週期數',
      selectMonth: '選擇月份',
      selectStartDate: '選擇起始日',
      selectProgramToLoad: '選擇要載入的計劃',
      // placeholders
      enterSupersetName: '請輸入超級組名稱',
      enterSupersetNameShort: '輸入超級組名稱',
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
      // Slice 17 — 獎章系統 toggle + 訓練目的次數範圍 editor headers/hints.
      achievementsSection: '獎章系統',
      achievementsHint:
        '關閉後隱藏「獎章」分頁與練習中的 PR 提示；紀錄照常累積，開啟即還原。',
      bucketRangesSection: '訓練目的次數範圍',
      bucketRangesHint:
        '調整每個訓練目的對應的次數區間，套用到全 App 的 PR 判定與分類，並同步至 Apple Watch。',
      // ADR-0026 (slice 16) — App Mode section header + hint (計劃 / 極簡).
      appModeSection: '訓練模式',
      appModeHint: '極簡模式：只看模板名稱，隱藏計劃與強度，一律以「通用」開始訓練（iPhone 與 Apple Watch 皆同步）。',
      // Phase 5 — settings section headers + hints (sweep TODO(i18n))
      unitPreferenceSection: '顯示單位',
      unitPreferenceHint: '顯示單位切換（資料以 kg 儲存，僅影響顯示與輸入）。',
      autoPopupRestTimerHint:
        '打✓ 完成一組後自動跳出 60 秒倒數視窗（可手動關閉視窗或跳過）。',
      // Slice 15 C3 (2026-06-13) — Settings backup section.
      autoBackupHint: '訓練結束、App 進入背景時自動備份到 iCloud。',
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
      personalRecords: '個人紀錄',
      bodyOverview: '訓練部位概況',
      capacityByMg: '各部位容量 · 近 6 期',
      durationOverPeriod: '運動時長 · 近 6 期',
      templateNamePlaceholder: 'Template 名稱',
      nameFieldLabel: '名稱',
      templateNameFieldLabel: '模板名稱',
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
      // (freestyle / un-named session). 2026-05-26: 「自由訓練」→「空白訓練」
      // to avoid collision with「自由重量」(free weights) terminology.
      sessionTitlePlaceholder: '空白訓練',
      // Slice 13 Phase A (2026-05-25) — detail page HR zone section header.
      hrZoneSection: '心率區間',
      // Slice 13b (2026-05-25) — Settings Apple Health 整合 section header.
      appleHealthSection: 'Apple Health 整合',
      // Slice 15 C4 (2026-06-13) — first-launch RestoreGate.
      restoreGateTitle: '發現 iCloud 備份',
      // i18n leak sweep (2026-06-04) — Settings 體重 quick-capture block
      // (section header / row label / a11y label / mini-sheet heading).
      bodyweightSection: '體重',
      recordBodyweight: '紀錄身體數據',
      recordBodyData: '紀錄身體數據',
      recordDateLabel: '日期',
      recordBodyweightRow: '＋ 紀錄身體數據',
      // i18n leak sweep (2026-06-04) — root Stack.Screen nav titles (app/_layout).
      newProgramNavTitle: '新計畫',
      newExerciseNavTitle: '新動作',
      // i18n leak sweep (2026-06-04) — template-list-section empty state.
      noTemplatesEmpty: '沒有模板，點 [+ 新建模板] 開始建立。',
      // i18n regression recovery (2026-06-17, orig c23d198) — fatal DB-init
      // error boot screen (components/database-provider.tsx). Re-introduced as
      // a hardcoded literal by the slice-15 dark-mode boot rewrite.
      dbInitFailed: '資料庫初始化失敗',
    },

    /** Alert / 錯誤訊息 / 確認 dialog。多為 modal title + body 對。 */
    alert: {
      programNameExists: '計畫名稱已存在',
      programNameExistsMsg: '請換一個名稱再繼續。',
      deleteSupersetQ: '刪除超級組？',
      deleteExerciseQ: '刪除動作?',
      reorderFailed: '排序失敗',
      deleteFailed: '刪除失敗',
      saveFailed: '儲存失敗',
      backupFailed: '備份失敗',
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
      noSubTagsTitle: '沒有強度可刪',
      noSubTagsMsg: '此計劃尚未有任何強度。',
      cannotOpen: '無法開啟',
      cannotOpenEditor: '無法開啟編輯器',
      cannotStartSession: '無法開始訓練',
      cannotCreateTemplate: '無法建立模板',
      failed: '失敗',
      noActiveSession: '找不到進行中的訓練。請先回 Today 頁開始一次訓練後再試。',
      sessionAlreadyInProgress: '已有進行中的訓練',
      endActiveSessionFirst: '請先在「今日」分頁結束目前的訓練再開始新的。',
      templateInUseByActiveSession:
        '目前進行中的訓練是從這個模板開始的，無法刪除。請先在「今日」分頁結束或放棄該訓練再刪除。',
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
      duplicateSupersetPair: '已有同樣動作組合的超級組',
      openExistingSupersetQ: '是否前往編輯既有的超級組？',
      supersetNameMaxLen: '超級組名稱請少於 60 字元',
      pickTwoExercises: '請選 2 個動作',
      replaySessionQ: '再次訓練？',
      replaySessionSupersetQ: '再次訓練（超級組）？',
      noTemplatePickFirst: '先在格子點選 template，再回來套用強度。\n（強度只能掛在有 template 的格子上）',
      noTemplateOnRow: '此 row 沒有 template',
      shrinkProgramQ: '縮小計劃表？',
      overwriteProgramQ: '覆蓋計劃？',
      noTemplatesYet: '沒有 template。先建一個再回來。',
      noOptionsToSelect: '沒有可選項目。',
      noProgramsAvailable: '沒有可用的 Program。',
      noProgramsToLoad: '尚無計劃可載入',
      cannotBackfillPlan: '無法補計劃訓練',
      backfillNoActiveProgram: '目前沒有啟用的計劃。',
      backfillRestDay: '啟用的計劃在這天沒有排定訓練。',
      programHasNoSubTag: '此計畫沒有強度紀錄。',
      // Wave 18g (Phase 6) — same-name overwrite UX consequence banner.
      overwriteSheetBodyConsequence:
        '建立後將完全取代既有計劃設定（循環天數、週期數、起始日、每日內容、強度）。已結束的訓練紀錄會保留。',
      cannotUndoLong: '此操作不可復原 — 將刪除整個 session、所有動作及記錄。',
      discardChangesQ: '捨棄修改？',
      discardChangesLong: '離開將還原為進入編輯前的狀態，所有變更會消失。',
      discardSessionQ: '放棄此次訓練？',
      atLeastOneField: '至少輸入一個欄位且數值合理',
      atLeastOneBodyField: '至少輸入一個欄位（體重 / PBF / SMM）',
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
      notEnoughDataPoints: '此時段資料點不足，至少需 2 次訓練。',
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
      overwriteTemplateConfirm: '已有相同（名稱·計劃·強度）的模板。要用目前內容覆蓋它嗎？此操作無法復原。',
      templateNotFound: '找不到此 template',
      addExerciseFirst: '請先加入至少一個動作再開始訓練。',
      deleteTemplateQ: '刪除模板？',
      deleteAllSameNameTemplatesQ: '刪除所有同名模板？',
      confirmDeleteQ: '確認刪除？',
      saveAsTemplateStubBody: 'production 補齊三元組 UI（ADR-0014）。slice 9.5 暫不實作。',
      // Slice 15 C4 (2026-06-13) — restore flow.
      restoreDone: '還原完成',
      restoreDoneBody: '資料已還原。',
      restoreConfirmQ: '要還原這份備份嗎？目前的資料會被取代。',
      noBackupFound: '找不到 iCloud 備份',
      noBackupFoundBody: 'iCloud 可能尚未同步完成，請稍後重新檢查。',
      // Slice 15b C6 (2026-06-13) — JSON export (ADR-0011 §5).
      exportJsonDone: '已匯出 (JSON)',
      exportJsonDoneBody: '檔案已儲存至：',
      exportJsonFailed: '匯出失敗',
      // i18n leak sweep (2026-06-04) — Settings 體重 mini-sheet invalid-input title.
      invalidBodyweightTitle: '體重輸入無效',
      invalidBodyweightRange: '請輸入 0–500 之間的正數',
      // i18n leak sweep (2026-06-04) — program wizard step-advance blocked title.
      cannotContinue: '無法繼續',
    },

    /** 狀態 / empty state / 進行中 indicator / chart axis hint。 */
    status: {
      loading: '載入中…',
      ending: '結束中…',
      saved: '已儲存',
      saveComplete: '完成儲存',
      backfillComplete: '完成補訓練',
      savedAsNew: '已另存',
      castToWatchOk: '已投影至手錶',
      castToWatchQueued: '已送出，手錶開啟後同步',
      castToWatchFailed: '投影失敗',
      lockEditingOnWatch: '🔒 Apple Watch 編輯中',
      lockUnlock: '解除鎖定',
      lockRequesting: '取得編輯權中…',
      lockTimeoutTitle: '對方沒有回應',
      lockTimeoutBody: '強制取得可能遺失對方最新編輯',
      lockForceTake: '強制取得控制權',
      lockKeepLock: '保留鎖定',
      lockHolderHint: '編輯中 · 手錶唯讀',
      selected: '已選擇',
      noTrainingRecords: '還沒有訓練紀錄',
      noRecords: '尚無記錄',
      noExercisesAdded: '尚未加入動作',
      noSupersetsYet: '尚未建立超級組',
      noSupersetsHint: '點右上角「+」建立新的超級組',
      noExercisesMatch: '沒有符合條件的動作',
      noRecordsUnderFilter: '篩選條件下沒有紀錄。',
      freestyle: '空白訓練',
      restDay: '休息日',
      inProgress: '· 進行中',
      todayOutsideProgram: '今天不在 Program 範圍內',
      // ADR-0024 § 2.a — 訓練 tab 計劃訓練 區塊狀態文案。
      noActiveProgram: '沒有啟用的計劃',
      todayRest: '今天休息 💤',
      hideUnchecked: '隱藏未打勾',
      // Card 12R / Round G — force-kill recovery toast on session detail focus.
      editSnapshotRestored: '上次未完成編輯已還原',
      // D32 interim — iPhone set edits blocked while the session is Watch-led.
      watchLedReadOnly: '訓練由 Apple Watch 主控，請在手錶上編輯',
      // cluster A/B switcher disabled hints
      alreadyASide: '已是 A 側',
      alreadyBSide: '已是 B 側',
      // exercise-chart axis hints
      highestVolumePerSession: '（每次訓練 容量最大一組）',
      heaviestSetPerSession: '（每次訓練 最重一組）',
      maxEstimated1rmPerSession: '（每次訓練 預估 1RM 最大值）',
      firstTime: '（第一次）',
      // misc badges
      allTimeWeightPr: '★ 全紀錄重量 PR',
      allTimeVolumePr: '★ 全紀錄容量 PR',
      // settings placeholder
      autoShowRestCountdown: '自動跳出休息倒數',
      backupComingSlice15: '於 slice 15 加入。',
      // Slice 15 C3 (2026-06-13) — Settings backup section.
      autoBackupLabel: '自動備份',
      backupRunning: '備份中…',
      // Slice 15b C6 (2026-06-13) — JSON export (ADR-0011 §5).
      exporting: '匯出中…',
      // chart time-range chips
      thisYear: '今年',
      previousYear: '上一年',
      nextYear: '下一年',
      // exercise detail subtitle
      missingExercise: '動作遺失',
      // Phase 5 — settings Language toggle radio labels
      languageAuto: '自動偵測',
      languageZh: '中文（繁體）',
      languageEn: 'English',
      // ADR-0025 — settings Color Theme radio labels (system / light / dark).
      themeSystem: '自動（跟隨系統）',
      themeLight: '淺色',
      themeDark: '深色',
      // Slice 17 — 獎章 toggle label + reps unit for the rep-range editor.
      achievementsEnabledLabel: '顯示獎章與 PR',
      repsShort: '下',
      // ADR-0026 (slice 16) — App Mode radio labels.
      appModePlan: '計劃模式',
      appModeMinimal: '極簡模式',
      // Phase 4.5 batch 1 — Programs tab empty-state CTA.
      noProgramsYetHint: '還沒有計畫。按「新建」啟動 6 步建立精靈。',
      // Phase 4.5 batch 1 — Today program banner "today: {template}" prefix.
      todayPrefix: '今天：',
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
      restTimeFootnote: '訓練中對此動作 set ✓ 後自動跳此秒數倒數。',
      noHistoryYet: '還沒有此動作的歷史紀錄。完成第 1 次訓練後就會出現。',
      noTrainingThisPeriod: '本期間尚無訓練',
      noCapacityRecent: '近 6 期尚無訓練容量',
      achievementLocked: '未解鎖',
      defaultVariantHint: '(固定項)',
      lastUsedHint: '(最後使用)',
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
      // Slice 17 — tiered medal panel (ADR-0009 amendment).
      achievementWeightPr: '重量 PR',
      achievementVolumePr: '容量 PR',
      achievementSessionCount: '重訓次數',
      achievementEntryBadge: '入門',
      achievementMaxed: '滿級',
      achievementNoTouched: '完成第一次訓練後，這裡就會出現你的部位與訓練目的獎章。',
      editTrainingTimeA11y: '編輯訓練時間',
      heatmapSubtitle: '顏色 = 每次訓練 次數分位',
      capacityMgSubtitle: '顯示有訓練的部位 · 紅虛線 = 6 期平均',
      durationSubtitle: '每根長條 = 該期累計時長 · 紅虛線 = 6 期平均',
      // Phase 4.5 final sweep — chart / sheet / modal inline literals.
      avgPrefix: '平均',
      bodyMetricsEmptyHint: '在上方輸入體重 / PBF / SMM 開始記錄',
      reorderHint: '長按任一列拖曳重新排序，完成後按右上「完成」儲存。',
      restingHeader: '休息中',
      restFinished: '時間到 — 再來一組 💪',
      restRunning: '把握短暫的休息',
      bwSnapshotFrozenHint: '此次訓練的 bw_snapshot 不會被改寫。',
      muscleRolePrimary: '主要',
      muscleRoleSecondary: '次要',
      noSessionsYetHint: '尚無訓練 — 到 Today 分頁開始第一次訓練。',
      // Slice 13 Phase A (2026-05-25) — HR chart + kcal placeholder hints
      // shown when HealthKit / Apple Watch data is unavailable (pre-Phase B).
      hrChartEmptyHint: '需 Apple Watch 同步心率資料',
      hrZoneSummary: '本次訓練心率區間分佈',
      kcalEmpty: '需 Apple Watch 同步活動數據',
      // Slice 13b (2026-05-25) — Apple Health 整合 section copy.
      appleHealthIntro: 'TrainingLog 會讀取 Apple Watch 訓練期間的心率與消耗熱量；無 Apple Watch 紀錄時、會寫入訓練紀錄讓 Fitness App 顯示。',
      appleHealthConnected: '已連結 Apple Health',
      managePermissionHint: '權限管理請至「設定 → 隱私 → 健康 → TrainingLog」。',
      // Slice 15 C4 (2026-06-13) — RestoreGate + Settings restore entry.
      restoreChecking: '正在檢查 iCloud 備份…',
      restoreRestoring: '還原中…',
      restoreActiveSessionBlocked: '訓練進行中，結束後才能還原',
      restoreFreshLaterHint: '稍後可在「設定 → 備份 / 還原」還原備份。',
      restoreRolledBackNote: '已復原原本的資料。',
      // i18n leak sweep (2026-06-04) — template editor rest-time unit suffix.
      secondsUnit: '秒',
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
      'SSB分腿蹲': 'SSB分腿蹲',
      'SSB深蹲': 'SSB深蹲',
      'SSB箱蹲': 'SSB箱蹲',
      '俯臥腿彎舉（單腿）': '俯臥腿彎舉（單腿）',
      '六角槓划船': '六角槓划船',
      '六角槓深蹲': '六角槓深蹲',
      '六角槓箭步走': '六角槓箭步走',
      '半俯身側平舉': '半俯身側平舉',
      '史密斯分腿硬舉': '史密斯分腿硬舉',
      '史密斯單腿硬舉': '史密斯單腿硬舉',
      '史密斯弓箭步': '史密斯弓箭步',
      '史密斯澤奇深蹲': '史密斯澤奇深蹲',
      '史密斯硬舉': '史密斯硬舉',
      '史密斯羅馬尼亞硬舉': '史密斯羅馬尼亞硬舉',
      '啞鈴側弓箭步': '啞鈴側弓箭步',
      '啞鈴分腿硬舉': '啞鈴分腿硬舉',
      '啞鈴單側跪姿肩推': '啞鈴單側跪姿肩推',
      '啞鈴單腿硬舉': '啞鈴單腿硬舉',
      '啞鈴單腿臀推': '啞鈴單腿臀推',
      '啞鈴單邊後束肩旋': '啞鈴單邊後束肩旋',
      '啞鈴羅馬尼亞硬舉': '啞鈴羅馬尼亞硬舉',
      '啞鈴臀推': '啞鈴臀推',
      '啞鈴高腳杯深蹲': '啞鈴高腳杯深蹲',
      '單側三頭下壓': '單側三頭下壓',
      '單側繩索三頭下壓': '單側繩索三頭下壓',
      '單側繩索過頭臂屈伸': '單側繩索過頭臂屈伸',
      '單臂手提箱深蹲': '單臂手提箱深蹲',
      '單臂直臂下壓': '單臂直臂下壓',
      '地雷管分腿硬舉': '地雷管分腿硬舉',
      '地雷管單腿硬舉': '地雷管單腿硬舉',
      '地雷管硬舉': '地雷管硬舉',
      '地雷管羅馬尼亞硬舉': '地雷管羅馬尼亞硬舉',
      '坐姿划船（寬握）': '坐姿划船（寬握）',
      '坐姿啞鈴前平舉': '坐姿啞鈴前平舉',
      '坐姿槓片提踵': '坐姿槓片提踵',
      '坐姿腿彎舉（單腿）': '坐姿腿彎舉（單腿）',
      '對握滑輪下拉': '對握滑輪下拉',
      '懸掛抬腿（負重）': '懸掛抬腿（負重）',
      '暫停臥推': '暫停臥推',
      '架上深蹲': '架上深蹲',
      '槓片單側跪姿肩推': '槓片單側跪姿肩推',
      '槓鈴分腿硬舉': '槓鈴分腿硬舉',
      '槓鈴分腿蹲': '槓鈴分腿蹲',
      '槓鈴單腿硬舉': '槓鈴單腿硬舉',
      '槓鈴暫停肩推': '槓鈴暫停肩推',
      '槓鈴架上肩推': '槓鈴架上肩推',
      '機械側平舉': '機械側平舉',
      '機械側捲腹': '機械側捲腹',
      '機械側踢腿': '機械側踢腿',
      '機械單側划船': '機械單側划船',
      '機械單側高位划船': '機械單側高位划船',
      '機械單側高位划船（反握）': '機械單側高位划船（反握）',
      '機械後踢腿': '機械後踢腿',
      '機械高位划船（反握）': '機械高位划船（反握）',
      '滑輪側踢腿': '滑輪側踢腿',
      '滑輪單邊後束飛鳥': '滑輪單邊後束飛鳥',
      '潘德雷划船': '潘德雷划船',
      '站姿滑輪側平舉': '站姿滑輪側平舉',
      '腿推（單腿）': '腿推（單腿）',
      '蝴蝶機單側後束飛鳥': '蝴蝶機單側後束飛鳥',
      '蝴蝶機夾胸（上胸）': '蝴蝶機夾胸（上胸）',
      '雙槓臂屈伸（負重）': '雙槓臂屈伸（負重）',
      '雙槓臂屈伸（輔助）': '雙槓臂屈伸（輔助）',
      '槓鈴前蹲': '槓鈴前蹲',
      '槓鈴弓箭步': '槓鈴弓箭步',
      '槓鈴硬舉': '槓鈴硬舉',
      '槓鈴羅馬尼亞硬舉': '槓鈴羅馬尼亞硬舉',
      '槓鈴相撲硬舉': '槓鈴相撲硬舉',
      '槓鈴直腿硬舉': '槓鈴直腿硬舉',
      '早安式體前屈': '早安式體前屈',
      '窄握槓鈴臥推': '窄握槓鈴臥推',
      '站姿槓鈴肩推': '站姿槓鈴肩推',
      '坐姿槓鈴肩推': '坐姿槓鈴肩推',
      '站姿軍事推舉': '站姿軍事推舉',
      '借力推': '借力推',
      '槓鈴直立划船': '槓鈴直立划船',
      '反握划船': '反握划船',
      'T槓划船': 'T槓划船',
      '槓鈴仰臥拉舉': '槓鈴仰臥拉舉',
      '牧師彎舉': '牧師彎舉',
      '反握槓鈴彎舉': '反握槓鈴彎舉',
      '槓鈴顱骨粉碎': '槓鈴顱骨粉碎',
      '槓鈴臀推': '槓鈴臀推',
      '槓鈴臀橋': '槓鈴臀橋',
      '站姿槓鈴提踵': '站姿槓鈴提踵',
      '槓鈴滾輪捲腹': '槓鈴滾輪捲腹',
      '坐姿槓鈴腕彎舉': '坐姿槓鈴腕彎舉',
      '下斜啞鈴臥推': '下斜啞鈴臥推',
      '上斜啞鈴飛鳥': '上斜啞鈴飛鳥',
      '啞鈴仰臥拉舉': '啞鈴仰臥拉舉',
      '坐姿啞鈴肩推': '坐姿啞鈴肩推',
      '阿諾肩推': '阿諾肩推',
      '啞鈴側平舉': '啞鈴側平舉',
      '啞鈴前平舉': '啞鈴前平舉',
      '俯身後束飛鳥': '俯身後束飛鳥',
      '上斜啞鈴彎舉': '上斜啞鈴彎舉',
      '集中彎舉': '集中彎舉',
      'Zottman 彎舉': 'Zottman 彎舉',
      '臥姿啞鈴三頭伸展': '臥姿啞鈴三頭伸展',
      '站姿過頭啞鈴三頭伸展': '站姿過頭啞鈴三頭伸展',
      '啞鈴三頭後屈伸': '啞鈴三頭後屈伸',
      '坐姿啞鈴三頭推': '坐姿啞鈴三頭推',
      '啞鈴深蹲': '啞鈴深蹲',
      '啞鈴弓箭步': '啞鈴弓箭步',
      '啞鈴登階': '啞鈴登階',
      '啞鈴相撲深蹲': '啞鈴相撲深蹲',
      '啞鈴分腿蹲': '啞鈴分腿蹲',
      '單臂啞鈴划船': '單臂啞鈴划船',
      '啞鈴直腿硬舉': '啞鈴直腿硬舉',
      '站姿啞鈴提踵': '站姿啞鈴提踵',
      '啞鈴體側屈': '啞鈴體側屈',
      '史密斯臥推': '史密斯臥推',
      '史密斯上斜臥推': '史密斯上斜臥推',
      '史密斯窄握臥推': '史密斯窄握臥推',
      '史密斯深蹲': '史密斯深蹲',
      '史密斯肩推': '史密斯肩推',
      '史密斯直立划船': '史密斯直立划船',
      '史密斯划船': '史密斯划船',
      '史密斯提踵': '史密斯提踵',
      '寬握滑輪下拉': '寬握滑輪下拉',
      '窄握滑輪下拉': '窄握滑輪下拉',
      'V 把下拉': 'V 把下拉',
      '反握滑輪下拉': '反握滑輪下拉',
      '直臂下壓': '直臂下壓',
      '單臂坐姿滑輪划船': '單臂坐姿滑輪划船',
      '滑輪直立划船': '滑輪直立划船',
      '滑輪後束飛鳥': '滑輪後束飛鳥',
      '坐姿滑輪側平舉': '坐姿滑輪側平舉',
      '直桿三頭下壓': '直桿三頭下壓',
      '繩索三頭下壓': '繩索三頭下壓',
      '繩索過頭臂屈伸': '繩索過頭臂屈伸',
      '滑輪夾胸': '滑輪夾胸',
      '低位滑輪夾胸': '低位滑輪夾胸',
      '站姿滑輪推胸': '站姿滑輪推胸',
      '滑輪二頭彎舉': '滑輪二頭彎舉',
      '繩索錘式彎舉': '繩索錘式彎舉',
      '滑輪牧師彎舉': '滑輪牧師彎舉',
      '滑輪跪姿捲腹': '滑輪跪姿捲腹',
      '滑輪砍柴': '滑輪砍柴',
      '滑輪聳肩': '滑輪聳肩',
      '滑輪前後拉': '滑輪前後拉',
      '滑輪後踢腿': '滑輪後踢腿',
      '腿推': '腿推',
      '坐姿腿屈伸': '坐姿腿屈伸',
      '哈克深蹲': '哈克深蹲',
      '俯臥腿彎舉': '俯臥腿彎舉',
      '坐姿腿彎舉': '坐姿腿彎舉',
      '蝴蝶機夾胸': '蝴蝶機夾胸',
      '機械肩推': '機械肩推',
      '反向蝴蝶機後束': '反向蝴蝶機後束',
      '機械高位划船': '機械高位划船',
      '機械坐姿划船': '機械坐姿划船',
      '機械二頭彎舉': '機械二頭彎舉',
      '機械三頭伸展': '機械三頭伸展',
      '機械臂屈伸': '機械臂屈伸',
      '機械蹬式提踵': '機械蹬式提踵',
      '機械捲腹': '機械捲腹',
      '坐姿腿外展': '坐姿腿外展',
      '坐姿腿內收': '坐姿腿內收',
      '壺鈴擺盪': '壺鈴擺盪',
      '壺鈴高腳杯深蹲': '壺鈴高腳杯深蹲',
      '雙壺鈴前蹲': '雙壺鈴前蹲',
      '壺鈴單腿硬舉': '壺鈴單腿硬舉',
      '壺鈴肩推': '壺鈴肩推',
      '壺鈴上膊': '壺鈴上膊',
      '壺鈴抓舉': '壺鈴抓舉',
      '壺鈴推蹲': '壺鈴推蹲',
      '單臂壺鈴划船': '單臂壺鈴划船',
      '壺鈴地板臥推': '壺鈴地板臥推',
      '壺鈴風車': '壺鈴風車',
      '土耳其起立': '土耳其起立',
      '架上臥推': '架上臥推',
      '坐姿機械推胸（上胸）': '坐姿機械推胸（上胸）',
      '坐姿機械推胸（下胸）': '坐姿機械推胸（下胸）',
      '坐姿機械推胸（平胸）': '坐姿機械推胸（平胸）',
      '單側滑輪夾胸': '單側滑輪夾胸',
      '雙槓臂屈伸（自重）': '雙槓臂屈伸（自重）',
      '伏地挺身（上斜）': '伏地挺身（上斜）',
      '伏地挺身（下斜）': '伏地挺身（下斜）',
      '引體向上（自重）': '引體向上（自重）',
      '引體向上（輔助）': '引體向上（輔助）',
      '引體向上（負重）': '引體向上（負重）',
      '澤奇深蹲': '澤奇深蹲',
      '槓鈴箱蹲': '槓鈴箱蹲',
      '史密斯分腿蹲': '史密斯分腿蹲',
      '坐姿腿屈伸（單腿）': '坐姿腿屈伸（單腿）',
      '六角槓硬舉': '六角槓硬舉',
      '槓鈴抓舉': '槓鈴抓舉',
      '槓片前平舉': '槓片前平舉',
      '啞鈴單側坐姿肩推': '啞鈴單側坐姿肩推',
      '滑輪單側側平舉': '滑輪單側側平舉',
      '滑輪肩外旋': '滑輪肩外旋',
      '滑輪肩內旋': '滑輪肩內旋',
      '滑輪前平舉': '滑輪前平舉',
      '啞鈴後束肩旋': '啞鈴後束肩旋',
      'V-bar三頭下壓': 'V-bar三頭下壓',
      '反手直桿三頭下壓': '反手直桿三頭下壓',
      '單側反手三頭下壓': '單側反手三頭下壓',
      '單側平板啞鈴臂屈伸': '單側平板啞鈴臂屈伸',
      '坐姿槓鈴腕彎舉（反手）': '坐姿槓鈴腕彎舉（反手）',
      '捲腹（自重）': '捲腹（自重）',
      '捲腹（負重）': '捲腹（負重）',
      '懸掛抬腿（自重）': '懸掛抬腿（自重）',
      '平躺抬腿': '平躺抬腿',
      '空中單車': '空中單車',
      '平板支撐': '平板支撐',
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
      // App-wide ErrorBoundary fallback (components/error-boundary.tsx).
      errorTitle: 'Something went wrong',
      errorBody:
        'A problem occurred while loading the screen. Tap below to try again; if it keeps happening, please reopen the app.',
      retry: 'Try again',
      // i18n leak sweep (2026-06-04) — fallback when an exercise has no name.
      exercisePlaceholder: '(exercise)',
    },

    help: {
      button: 'Help',
      gotIt: 'Got it',
      startTour: 'Show me',
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
      reps: 'Reps',
      weight: 'Weight',
      weightKg: 'Weight (kg)',
      volume: 'Volume',
      strength: 'Strength',
      maxStrength: 'Max Strength',
      hypertrophy: 'Hypertrophy',
      endurance: 'Endurance',
      muscularEndurance: 'Muscular Endurance',
      maxStrengthChip: 'Max',
      strengthChip: 'Str',
      hypertrophyChip: 'Hyper',
      muscleEnduranceChip: 'M.End',
      enduranceChip: 'End',
      bodyweight: 'Bodyweight',
      warmupChip: 'W',
      supersetChip: 'SS',
      freestyle: 'Freestyle',
      restDay: 'Rest Day',
      rest: 'Rest',
      cycleLengthDays: 'Cycle Days',
      cycleCount: 'Cycle Count',
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
      // Slice 13 Phase A (2026-05-25) — HR + kcal scaffold; see ADR-0019.
      heartRate: 'Heart rate',
      kcal: 'kcal',
      bpm: 'BPM',
    },

    button: {
      loadProgram: '↓ Load Program',
      combine: 'Combine',
      cues: 'Cues',
      replay: '↻ Replay',
      replayDescription: 'Replay — overwrite current card sets',
      listView: 'List',
      sideBySide: 'Side by Side',
      newTemplate: '＋',
      newTemplateFull: 'New Template',
      newCta: 'New',
      deleteProgramCta: 'Delete Program',
      deleteSubTagCta: 'Delete Intensity',
      newProgramTemplate: '+ Create New Template',
      addIntensity: '+ Add Intensity',
      addIntensityPlain: 'Add Intensity',
      addExercise: '+ Exercise',
      addExercisePlain: 'Add Exercise',
      addCustomExercise: 'Add Custom Exercise',
      addRecord: 'Add Record',
      // ADR-0024 § 2.b — 訓練 tab freestyle CTA + busy state + planned empty CTA.
      startFreestyle: 'Start Freestyle',
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
      castToWatch: 'Cast to Watch',
      saveAsIntensity: 'Save as Intensity',
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
      createSuperset: 'Create Superset',
      applyTemplateToColumn: 'Apply template to this column',
      applyIntensityToRow: 'Apply intensity to this row',
      restRowClear: 'Rest (clear this row)',
      shrinkAndDiscard: 'Shrink and Discard',
      confirmCreate: 'Confirm Create',
      overwrite: 'Overwrite',
      manualRest: 'Manual Rest',
      manualRestStart: 'Start Rest Countdown Manually',
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
      // 2026-06-02 a11y batch — accessibilityLabel for data-viz charts.
      a11yHrZoneChart: 'Heart rate zone chart',
      a11yBarChart: 'Bar chart',
      a11yBodyTrendChart: 'Body composition trend chart',
      a11yBodyHeatmap: 'Trained muscle heatmap',
      a11yExerciseTrendChart: 'Exercise trend chart',
      // Phase 4.5 batch 2 — template editor / sheet CTAs.
      creating: 'Creating…',
      addProgram: 'Add Program',
      editTemplate: 'Edit Template',
      startSession: 'Start Session',
      backfill: 'Backfill',
      createAndImport: 'Create and Import',
      selectColorAction: 'Color',
      deleteTemplate: 'Delete Template',
      deleteAllSameName: 'Delete',
      addNote: 'Add Note',
      editNote: 'Edit Note',
      moveExercise: 'Move Exercise',
      setAsEvergreen: 'Set as Evergreen',
      setAsGeneral: 'Set as General',
      // Slice 13b (2026-05-25) — Settings Apple Health 整合 CTA.
      connectAppleHealth: 'Connect Apple Health',
      openSystemSettings: 'Open System Settings',
      // Slice 15 C4 (2026-06-13) — restore engine entry points.
      restoreBackup: 'Restore backup',
      startFresh: 'Start fresh',
      recheckBackups: 'Check again',
      retryRestore: 'Retry',
      // Slice 15 C3 (2026-06-13) — Settings backup section.
      backupNow: 'Back up now',
      // Slice 15b C6 (2026-06-13) — JSON export (ADR-0011 §5).
      exportJson: 'Export Data (JSON)',
      // Slice 17 / ADR-0027 — reset rep-bucket ranges to v1 defaults.
      resetBucketRanges: 'Reset rep ranges',
      // 2026-06-04 a11y sweep — set-row-content (SetRowContent) interactive cells.
      a11yCycleSetKind: 'Cycle set kind',
      a11yEditWeight: 'Edit weight',
      a11yEditReps: 'Edit reps',
      a11yAddDropset: 'Add drop set',
      a11yRemoveDropset: 'Remove drop set',
      // 2026-06-04 a11y sweep — numeric-keypad (NumericKeypad) ⌫ key.
      a11yKeypadBackspace: 'Delete',
      // 2026-06-20 a11y sweep — slice17 achievements tier progress + rep-range stepper.
      a11yTierProgress: 'Progress',
      a11yDecrease: 'Decrease',
      a11yIncrease: 'Increase',
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
      deleteProgramTitle: 'Select program to delete',
      deleteSubTagProgramTitle: 'Select program',
      deleteSubTagTitle: 'Select intensity to delete',
      selectTemplate: 'Select Template',
      selectIntensity: 'Select Intensity',
      minimalTemplateHint: 'Choose to edit this template, or start the workout now.',
      selectCycleLength: 'Select Cycle Length',
      selectCycleCount: 'Select Cycle Count',
      selectMonth: 'Select Month',
      selectStartDate: 'Select Start Date',
      selectProgramToLoad: 'Select Program to Load',
      enterSupersetName: 'Enter superset name',
      enterSupersetNameShort: 'Enter superset name',
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
      // Slice 17 — Achievements toggle + rep-range editor headers/hints.
      achievementsSection: 'Achievements',
      achievementsHint:
        'When off, hides the Achievements tab and the in-session PR banner. Records keep accruing; turning it back on restores everything.',
      bucketRangesSection: 'Rep Ranges',
      bucketRangesHint:
        'Adjust the rep range for each training purpose. Applies app-wide to PR detection and classification, and syncs to Apple Watch.',
      // ADR-0026 (slice 16) — App Mode section header + hint (plan / minimal).
      appModeSection: 'Training Mode',
      appModeHint:
        'Minimal mode: see only template names — programs and intensities are hidden, and every workout starts as 通用 (default). Applies to iPhone and Apple Watch.',
      // Phase 5 — settings section headers + hints (sweep TODO(i18n))
      unitPreferenceSection: 'Unit Preference',
      unitPreferenceHint:
        'Display unit toggle (data is stored in kg; this only affects display and input).',
      autoPopupRestTimerHint:
        'Auto-show a 60-second countdown after marking a set as complete (close manually or skip).',
      // Slice 15 C3 (2026-06-13) — Settings backup section.
      autoBackupHint: 'Backs up to iCloud when a session ends or the app goes to the background.',
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
      personalRecords: 'Personal Records',
      bodyOverview: 'Body Overview',
      capacityByMg: 'Capacity by Muscle Group · Last 6 Periods',
      durationOverPeriod: 'Workout Duration · Last 6 Periods',
      templateNamePlaceholder: 'Template Name',
      nameFieldLabel: 'Name',
      templateNameFieldLabel: 'Template Name',
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
      // Slice 13 Phase A (2026-05-25) — detail page HR zone section header.
      hrZoneSection: 'Heart rate zones',
      // Slice 13b (2026-05-25) — Settings Apple Health 整合 section header.
      appleHealthSection: 'Apple Health Integration',
      // Slice 15 C4 (2026-06-13) — first-launch RestoreGate.
      restoreGateTitle: 'iCloud Backup Found',
      // i18n leak sweep (2026-06-04) — Settings 體重 quick-capture block.
      bodyweightSection: 'Bodyweight',
      recordBodyweight: 'Record body data',
      recordBodyData: 'Record body data',
      recordDateLabel: 'Date',
      recordBodyweightRow: '＋ Record body data',
      // i18n leak sweep (2026-06-04) — root Stack.Screen nav titles (app/_layout).
      newProgramNavTitle: 'New Program',
      newExerciseNavTitle: 'New Exercise',
      // i18n leak sweep (2026-06-04) — template-list-section empty state.
      noTemplatesEmpty: 'No templates. Tap [+ New Template] to create one.',
      // i18n regression recovery (2026-06-17, orig c23d198) — fatal DB-init
      // error boot screen (components/database-provider.tsx). Re-introduced as
      // a hardcoded literal by the slice-15 dark-mode boot rewrite.
      dbInitFailed: 'Database initialization failed',
    },

    alert: {
      programNameExists: 'Program name already exists',
      programNameExistsMsg: 'Please pick a different name.',
      deleteSupersetQ: 'Delete this superset?',
      deleteExerciseQ: 'Delete exercise?',
      reorderFailed: 'Reorder failed',
      deleteFailed: 'Delete failed',
      saveFailed: 'Save failed',
      backupFailed: 'Backup failed',
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
      noSubTagsTitle: 'No intensities',
      noSubTagsMsg: 'This program has no intensities yet.',
      cannotOpen: 'Cannot open',
      cannotOpenEditor: 'Cannot open editor',
      cannotStartSession: 'Cannot start session',
      cannotCreateTemplate: 'Cannot create template',
      failed: 'Failed',
      noActiveSession: 'No active session found. Return to Today and start a session, then try again.',
      sessionAlreadyInProgress: 'A session is already in progress',
      endActiveSessionFirst: 'End the current session in the "Today" tab before starting a new one.',
      templateInUseByActiveSession:
        'The active session was started from this template, so it cannot be deleted. End or discard that session in the "Today" tab first.',
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
      duplicateSupersetPair: 'A superset with this exercise pair already exists',
      openExistingSupersetQ: 'Open the existing superset for editing?',
      supersetNameMaxLen: 'Superset name must be under 60 characters',
      pickTwoExercises: 'Please select 2 exercises',
      replaySessionQ: 'Replay session?',
      replaySessionSupersetQ: 'Replay session (superset)?',
      noTemplatePickFirst:
        'Pick a template in a cell first, then come back to apply intensity.\n(Intensity can only attach to cells that have a template.)',
      noTemplateOnRow: 'This row has no template',
      shrinkProgramQ: 'Shrink program schedule?',
      overwriteProgramQ: 'Overwrite program?',
      noTemplatesYet: 'No templates. Create one first, then come back.',
      noOptionsToSelect: 'No options to select.',
      noProgramsAvailable: 'No available Programs.',
      noProgramsToLoad: 'No programs available to load',
      cannotBackfillPlan: 'Cannot backfill planned training',
      backfillNoActiveProgram: 'No active program.',
      backfillRestDay: 'The active program has no workout scheduled for this day.',
      programHasNoSubTag: 'This program has no intensity records.',
      // Wave 18g (Phase 6) — same-name overwrite UX consequence banner.
      overwriteSheetBodyConsequence:
        'Creating this will completely replace the existing program settings (cycle length, cycle count, start date, daily content, intensities). Finished session records are preserved.',
      cannotUndoLong: 'This cannot be undone — the entire session, exercises, and records will be deleted.',
      discardChangesQ: 'Discard changes?',
      discardChangesLong: 'Leaving will revert to the state before editing. All changes will be lost.',
      discardSessionQ: 'Discard this session?',
      atLeastOneField: 'Fill in at least one field with a reasonable value',
      atLeastOneBodyField: 'Fill in at least one field (Bodyweight / PBF / SMM)',
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
      overwriteTemplateConfirm: 'A template with the same (name · program · intensity) already exists. Overwrite it with the current content? This cannot be undone.',
      templateNotFound: 'Template not found',
      addExerciseFirst: 'Add at least one exercise before starting a session.',
      deleteTemplateQ: 'Delete template?',
      deleteAllSameNameTemplatesQ: 'Delete all same-name templates?',
      confirmDeleteQ: 'Confirm delete?',
      saveAsTemplateStubBody: 'Triple UI to be completed in production (ADR-0014). Not implemented in slice 9.5.',
      // Slice 15 C4 (2026-06-13) — restore flow.
      restoreDone: 'Restore complete',
      restoreDoneBody: 'Your data has been restored.',
      restoreConfirmQ: 'Restore this backup? Current data will be replaced.',
      noBackupFound: 'No iCloud backup found',
      noBackupFoundBody: 'iCloud may still be syncing — check again in a moment.',
      // Slice 15b C6 (2026-06-13) — JSON export (ADR-0011 §5).
      exportJsonDone: 'Exported (JSON)',
      exportJsonDoneBody: 'File saved to:',
      exportJsonFailed: 'Export failed',
      // i18n leak sweep (2026-06-04) — Settings 體重 mini-sheet invalid-input title.
      invalidBodyweightTitle: 'Invalid bodyweight',
      invalidBodyweightRange: 'Enter a positive number between 0 and 500.',
      // i18n leak sweep (2026-06-04) — program wizard step-advance blocked title.
      cannotContinue: 'Cannot continue',
    },

    status: {
      loading: 'Loading…',
      ending: 'Ending…',
      saved: 'Saved',
      saveComplete: 'Saved',
      backfillComplete: 'Backfill Complete',
      savedAsNew: 'Saved as new',
      castToWatchOk: 'Synced to Watch',
      castToWatchQueued: 'Sent — syncs when Watch opens',
      castToWatchFailed: 'Cast failed',
      lockEditingOnWatch: '🔒 Editing on Apple Watch',
      lockUnlock: 'Unlock',
      lockRequesting: 'Requesting control…',
      lockTimeoutTitle: 'No response',
      lockTimeoutBody: 'Taking over may lose the other device’s latest edits',
      lockForceTake: 'Take control anyway',
      lockKeepLock: 'Stay locked',
      lockHolderHint: 'Editing · Watch read-only',
      selected: 'Selected',
      noTrainingRecords: 'No training records yet',
      noRecords: 'No records yet',
      noExercisesAdded: 'No exercises added yet',
      noSupersetsYet: 'No supersets yet',
      noSupersetsHint: 'Tap the "+" in the top right to create a new superset',
      noExercisesMatch: 'No exercises match',
      noRecordsUnderFilter: 'No records under current filters.',
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
      // D32 interim — iPhone set edits blocked while the session is Watch-led.
      watchLedReadOnly: 'Workout is controlled by Apple Watch — edit on the Watch',
      alreadyASide: 'Already A side',
      alreadyBSide: 'Already B side',
      highestVolumePerSession: '(Highest-volume set per session)',
      heaviestSetPerSession: '(Heaviest set per session)',
      maxEstimated1rmPerSession: '(Max estimated 1RM per session)',
      firstTime: '(First time)',
      allTimeWeightPr: '★ All-time Weight PR',
      allTimeVolumePr: '★ All-time Volume PR',
      autoShowRestCountdown: 'Auto-show rest countdown',
      backupComingSlice15: 'Coming in slice 15.',
      // Slice 15 C3 (2026-06-13) — Settings backup section.
      autoBackupLabel: 'Automatic backup',
      backupRunning: 'Backing up…',
      // Slice 15b C6 (2026-06-13) — JSON export (ADR-0011 §5).
      exporting: 'Exporting…',
      thisYear: 'This Year',
      previousYear: 'Previous Year',
      nextYear: 'Next Year',
      missingExercise: 'Exercise Missing',
      // Phase 5 — settings Language toggle radio labels
      languageAuto: 'Auto-detect',
      languageZh: 'Traditional Chinese',
      languageEn: 'English',
      // ADR-0025 — settings Color Theme radio labels (system / light / dark).
      themeSystem: 'Auto (follow system)',
      themeLight: 'Light',
      themeDark: 'Dark',
      // Slice 17 — Achievements toggle label + reps unit.
      achievementsEnabledLabel: 'Show achievements & PRs',
      repsShort: 'reps',
      // ADR-0026 (slice 16) — App Mode radio labels.
      appModePlan: 'Plan Mode',
      appModeMinimal: 'Minimal Mode',
      // Phase 4.5 batch 1 — Programs tab empty-state CTA.
      noProgramsYetHint: 'No programs yet. Tap "New" to launch the 6-step wizard.',
      // Phase 4.5 batch 1 — Today program banner "today: {template}" prefix.
      todayPrefix: 'Today: ',
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
      // Slice 17 — tiered medal panel (ADR-0009 amendment).
      achievementWeightPr: 'Weight PR',
      achievementVolumePr: 'Volume PR',
      achievementSessionCount: 'Sessions',
      achievementEntryBadge: 'Entry',
      achievementMaxed: 'Maxed',
      achievementNoTouched: 'Your muscle-group and training-goal medals appear here after your first session.',
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
      noSessionsYetHint: 'No sessions yet — start one in the Today tab.',
      // Slice 13 Phase A (2026-05-25) — HR chart + kcal placeholder hints
      // shown when HealthKit / Apple Watch data is unavailable (pre-Phase B).
      hrChartEmptyHint: 'Apple Watch HR sync required',
      hrZoneSummary: 'Heart rate zone distribution',
      kcalEmpty: 'Apple Watch activity data required',
      // Slice 13b (2026-05-25) — Apple Health 整合 section copy.
      appleHealthIntro: 'TrainingLog reads heart rate and active energy from Apple Watch workouts; it writes a workout entry to the Fitness app for sessions without Apple Watch tracking.',
      appleHealthConnected: 'Connected to Apple Health',
      managePermissionHint: 'Manage permissions at Settings → Privacy → Health → TrainingLog.',
      // Slice 15 C4 (2026-06-13) — RestoreGate + Settings restore entry.
      restoreChecking: 'Checking iCloud for backups…',
      restoreRestoring: 'Restoring…',
      restoreActiveSessionBlocked: 'Finish the active session before restoring',
      restoreFreshLaterHint: 'You can restore later in Settings → Backup / Restore.',
      restoreRolledBackNote: 'Your previous data was put back.',
      // i18n leak sweep (2026-06-04) — template editor rest-time unit suffix.
      secondsUnit: 'sec',
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
      'SSB分腿蹲': 'Safety Bar Split Squat',
      'SSB深蹲': 'Safety Bar Squat',
      'SSB箱蹲': 'Safety Bar Box Squat',
      '俯臥腿彎舉（單腿）': 'Single-Leg Lying Leg Curl',
      '六角槓划船': 'Trap Bar Row',
      '六角槓深蹲': 'Trap Bar Squat',
      '六角槓箭步走': 'Trap Bar Walking Lunge',
      '半俯身側平舉': 'Leaning Dumbbell Lateral Raise',
      '史密斯分腿硬舉': 'Smith Machine Split-Stance Deadlift',
      '史密斯單腿硬舉': 'Smith Machine Single-Leg Deadlift',
      '史密斯弓箭步': 'Smith Machine Lunge',
      '史密斯澤奇深蹲': 'Smith Machine Zercher Squat',
      '史密斯硬舉': 'Smith Machine Deadlift',
      '史密斯羅馬尼亞硬舉': 'Smith Machine Romanian Deadlift',
      '啞鈴側弓箭步': 'Dumbbell Lateral Lunge',
      '啞鈴分腿硬舉': 'Dumbbell Split-Stance Deadlift',
      '啞鈴單側跪姿肩推': 'Half-Kneeling Single-Arm Dumbbell Press',
      '啞鈴單腿硬舉': 'Dumbbell Single-Leg Deadlift',
      '啞鈴單腿臀推': 'Dumbbell Single-Leg Hip Thrust',
      '啞鈴單邊後束肩旋': 'Single-Arm Dumbbell Rear Delt Raise',
      '啞鈴羅馬尼亞硬舉': 'Dumbbell Romanian Deadlift',
      '啞鈴臀推': 'Dumbbell Hip Thrust',
      '啞鈴高腳杯深蹲': 'Dumbbell Goblet Squat',
      '單側三頭下壓': 'Single-Arm Tricep Pushdown',
      '單側繩索三頭下壓': 'Single-Arm Cable Tricep Pushdown',
      '單側繩索過頭臂屈伸': 'Single-Arm Overhead Cable Tricep Extension',
      '單臂手提箱深蹲': 'Single-Arm Suitcase Squat',
      '單臂直臂下壓': 'Single-Arm Straight-Arm Pulldown',
      '地雷管分腿硬舉': 'Landmine Split-Stance Deadlift',
      '地雷管單腿硬舉': 'Landmine Single-Leg Deadlift',
      '地雷管硬舉': 'Landmine Deadlift',
      '地雷管羅馬尼亞硬舉': 'Landmine Romanian Deadlift',
      '坐姿划船（寬握）': 'Wide-Grip Seated Cable Row',
      '坐姿啞鈴前平舉': 'Seated Dumbbell Front Raise',
      '坐姿槓片提踵': 'Seated Plate Calf Raise',
      '坐姿腿彎舉（單腿）': 'Single-Leg Seated Leg Curl',
      '對握滑輪下拉': 'Neutral-Grip Lat Pulldown',
      '懸掛抬腿（負重）': 'Weighted Hanging Leg Raise',
      '暫停臥推': 'Paused Bench Press',
      '架上深蹲': 'Pin Squat',
      '槓片單側跪姿肩推': 'Half-Kneeling Single-Arm Plate Press',
      '槓鈴分腿硬舉': 'Barbell Split-Stance Deadlift',
      '槓鈴分腿蹲': 'Barbell Split Squat',
      '槓鈴單腿硬舉': 'Barbell Single-Leg Deadlift',
      '槓鈴暫停肩推': 'Paused Barbell Shoulder Press',
      '槓鈴架上肩推': 'Barbell Pin Press',
      '機械側平舉': 'Machine Lateral Raise',
      '機械側捲腹': 'Machine Oblique Crunch',
      '機械側踢腿': 'Machine Hip Abduction',
      '機械單側划船': 'Single-Arm Machine Row',
      '機械單側高位划船': 'Single-Arm Machine High Row',
      '機械單側高位划船（反握）': 'Underhand Single-Arm Machine High Row',
      '機械後踢腿': 'Machine Glute Kickback',
      '機械高位划船（反握）': 'Underhand Machine High Row',
      '滑輪側踢腿': 'Cable Hip Abduction',
      '滑輪單邊後束飛鳥': 'Single-Arm Cable Rear Delt Fly',
      '潘德雷划船': 'Pendlay Row',
      '站姿滑輪側平舉': 'Standing Cable Lateral Raise',
      '腿推（單腿）': 'Single-Leg Leg Press',
      '蝴蝶機單側後束飛鳥': 'Single-Arm Reverse Pec Deck Fly',
      '蝴蝶機夾胸（上胸）': 'Incline Pec Deck Fly',
      '雙槓臂屈伸（負重）': 'Weighted Chest Dip',
      '雙槓臂屈伸（輔助）': 'Assisted Chest Dip',
      '槓鈴前蹲': 'Front Barbell Squat',
      '槓鈴弓箭步': 'Barbell Lunge',
      '槓鈴硬舉': 'Barbell Deadlift',
      '槓鈴羅馬尼亞硬舉': 'Romanian Deadlift',
      '槓鈴相撲硬舉': 'Sumo Deadlift',
      '槓鈴直腿硬舉': 'Stiff-Legged Barbell Deadlift',
      '早安式體前屈': 'Good Morning',
      '窄握槓鈴臥推': 'Close-Grip Barbell Bench Press',
      '站姿槓鈴肩推': 'Barbell Shoulder Press',
      '坐姿槓鈴肩推': 'Seated Barbell Military Press',
      '站姿軍事推舉': 'Standing Military Press',
      '借力推': 'Push Press',
      '槓鈴直立划船': 'Upright Barbell Row',
      '反握划船': 'Reverse Grip Bent-Over Rows',
      'T槓划船': 'T-Bar Row with Handle',
      '槓鈴仰臥拉舉': 'Bent-Arm Barbell Pullover',
      '牧師彎舉': 'Preacher Curl',
      '反握槓鈴彎舉': 'Reverse Barbell Curl',
      '槓鈴顱骨粉碎': 'Lying Close-Grip Barbell Triceps Extension Behind The Head',
      '槓鈴臀推': 'Barbell Hip Thrust',
      '槓鈴臀橋': 'Barbell Glute Bridge',
      '站姿槓鈴提踵': 'Standing Barbell Calf Raise',
      '槓鈴滾輪捲腹': 'Barbell Ab Rollout',
      '坐姿槓鈴腕彎舉': 'Seated Palm-Up Barbell Wrist Curl',
      '下斜啞鈴臥推': 'Decline Dumbbell Bench Press',
      '上斜啞鈴飛鳥': 'Incline Dumbbell Flyes',
      '啞鈴仰臥拉舉': 'Bent-Arm Dumbbell Pullover',
      '坐姿啞鈴肩推': 'Seated Dumbbell Press',
      '阿諾肩推': 'Arnold Dumbbell Press',
      '啞鈴側平舉': 'Side Lateral Raise',
      '啞鈴前平舉': 'Front Dumbbell Raise',
      '俯身後束飛鳥': 'Reverse Flyes',
      '上斜啞鈴彎舉': 'Incline Dumbbell Curl',
      '集中彎舉': 'Concentration Curls',
      'Zottman 彎舉': 'Zottman Curl',
      '臥姿啞鈴三頭伸展': 'Lying Dumbbell Tricep Extension',
      '站姿過頭啞鈴三頭伸展': 'Standing Dumbbell Triceps Extension',
      '啞鈴三頭後屈伸': 'Tricep Dumbbell Kickback',
      '坐姿啞鈴三頭推': 'Seated Triceps Press',
      '啞鈴深蹲': 'Dumbbell Squat',
      '啞鈴弓箭步': 'Dumbbell Lunges',
      '啞鈴登階': 'Dumbbell Step Ups',
      '啞鈴相撲深蹲': 'Plie Dumbbell Squat',
      '啞鈴分腿蹲': 'Split Squat with Dumbbells',
      '單臂啞鈴划船': 'One-Arm Dumbbell Row',
      '啞鈴直腿硬舉': 'Stiff-Legged Dumbbell Deadlift',
      '站姿啞鈴提踵': 'Standing Dumbbell Calf Raise',
      '啞鈴體側屈': 'Dumbbell Side Bend',
      '史密斯臥推': 'Smith Machine Bench Press',
      '史密斯上斜臥推': 'Smith Machine Incline Bench Press',
      '史密斯窄握臥推': 'Smith Machine Close-Grip Bench Press',
      '史密斯深蹲': 'Smith Machine Squat',
      '史密斯肩推': 'Smith Machine Overhead Shoulder Press',
      '史密斯直立划船': 'Smith Machine Upright Row',
      '史密斯划船': 'Smith Machine Bent Over Row',
      '史密斯提踵': 'Smith Machine Calf Raise',
      '寬握滑輪下拉': 'Wide-Grip Lat Pulldown',
      '窄握滑輪下拉': 'Close-Grip Front Lat Pulldown',
      'V 把下拉': 'V-Bar Pulldown',
      '反握滑輪下拉': 'Underhand Cable Pulldowns',
      '直臂下壓': 'Straight-Arm Pulldown',
      '單臂坐姿滑輪划船': 'Seated One-arm Cable Pulley Rows',
      '滑輪直立划船': 'Upright Cable Row',
      '滑輪後束飛鳥': 'Cable Rear Delt Fly',
      '坐姿滑輪側平舉': 'Cable Seated Lateral Raise',
      '直桿三頭下壓': 'Triceps Pushdown',
      '繩索三頭下壓': 'Triceps Pushdown - Rope Attachment',
      '繩索過頭臂屈伸': 'Cable Rope Overhead Triceps Extension',
      '滑輪夾胸': 'Cable Crossover',
      '低位滑輪夾胸': 'Low Cable Crossover',
      '站姿滑輪推胸': 'Standing Cable Chest Press',
      '滑輪二頭彎舉': 'Standing Biceps Cable Curl',
      '繩索錘式彎舉': 'Cable Hammer Curls - Rope Attachment',
      '滑輪牧師彎舉': 'Cable Preacher Curl',
      '滑輪跪姿捲腹': 'Cable Crunch',
      '滑輪砍柴': 'Standing Cable Wood Chop',
      '滑輪聳肩': 'Cable Shrugs',
      '滑輪前後拉': 'Pull Through',
      '滑輪後踢腿': 'One-Legged Cable Kickback',
      '腿推': 'Leg Press',
      '坐姿腿屈伸': 'Leg Extensions',
      '哈克深蹲': 'Hack Squat',
      '俯臥腿彎舉': 'Lying Leg Curls',
      '坐姿腿彎舉': 'Seated Leg Curl',
      '蝴蝶機夾胸': 'Butterfly',
      '機械肩推': 'Machine Shoulder (Military) Press',
      '反向蝴蝶機後束': 'Reverse Machine Flyes',
      '機械高位划船': 'Leverage High Row',
      '機械坐姿划船': 'Leverage Iso Row',
      '機械二頭彎舉': 'Machine Bicep Curl',
      '機械三頭伸展': 'Machine Triceps Extension',
      '機械臂屈伸': 'Dip Machine',
      '機械蹬式提踵': 'Calf Press',
      '機械捲腹': 'Ab Crunch Machine',
      '坐姿腿外展': 'Thigh Abductor',
      '坐姿腿內收': 'Thigh Adductor',
      '壺鈴擺盪': 'One-Arm Kettlebell Swings',
      '壺鈴高腳杯深蹲': 'Goblet Squat',
      '雙壺鈴前蹲': 'Front Squats With Two Kettlebells',
      '壺鈴單腿硬舉': 'Kettlebell One-Legged Deadlift',
      '壺鈴肩推': 'Two-Arm Kettlebell Military Press',
      '壺鈴上膊': 'One-Arm Kettlebell Clean',
      '壺鈴抓舉': 'One-Arm Kettlebell Snatch',
      '壺鈴推蹲': 'Kettlebell Thruster',
      '單臂壺鈴划船': 'One-Arm Kettlebell Row',
      '壺鈴地板臥推': 'One-Arm Kettlebell Floor Press',
      '壺鈴風車': 'Kettlebell Windmill',
      '土耳其起立': 'Kettlebell Turkish Get-Up (Squat style)',
      '架上臥推': 'Pin Presses',
      '坐姿機械推胸（上胸）': 'Leverage Incline Chest Press',
      '坐姿機械推胸（下胸）': 'Leverage Decline Chest Press',
      '坐姿機械推胸（平胸）': 'Leverage Chest Press',
      '單側滑輪夾胸': 'Single-Arm Cable Crossover',
      '雙槓臂屈伸（自重）': 'Dips - Chest Version',
      '伏地挺身（上斜）': 'Incline Push-Up',
      '伏地挺身（下斜）': 'Decline Push-Up',
      '引體向上（自重）': 'Pullups',
      '引體向上（輔助）': 'Band Assisted Pull-Up',
      '引體向上（負重）': 'Weighted Pull Ups',
      '澤奇深蹲': 'Zercher Squats',
      '槓鈴箱蹲': 'Box Squat',
      '史密斯分腿蹲': 'Smith Single-Leg Split Squat',
      '坐姿腿屈伸（單腿）': 'Single-Leg Leg Extension',
      '六角槓硬舉': 'Trap Bar Deadlift',
      '槓鈴抓舉': 'Snatch',
      '槓片前平舉': 'Front Plate Raise',
      '啞鈴單側坐姿肩推': 'Dumbbell One-Arm Shoulder Press',
      '滑輪單側側平舉': 'Standing Low-Pulley Deltoid Raise',
      '滑輪肩外旋': 'External Rotation with Cable',
      '滑輪肩內旋': 'Cable Internal Rotation',
      '滑輪前平舉': 'Front Cable Raise',
      '啞鈴後束肩旋': 'Reverse Flyes With External Rotation',
      'V-bar三頭下壓': 'Triceps Pushdown - V-Bar Attachment',
      '反手直桿三頭下壓': 'Reverse Grip Triceps Pushdown',
      '單側反手三頭下壓': 'Cable One Arm Tricep Extension',
      '單側平板啞鈴臂屈伸': 'One Arm Pronated Dumbbell Triceps Extension',
      '坐姿槓鈴腕彎舉（反手）': 'Seated Palms-Down Barbell Wrist Curl',
      '捲腹（自重）': 'Crunches',
      '捲腹（負重）': 'Weighted Crunches',
      '懸掛抬腿（自重）': 'Hanging Leg Raise',
      '平躺抬腿': 'Flat Bench Lying Leg Raise',
      '空中單車': 'Air Bike',
      '平板支撐': 'Plank',
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

/**
 * Locale "version" — a monotonically increasing counter bumped on every
 * effective `setLocale()` change. React components subscribe to it (via
 * `useLocale()` in `./useLocale`) so a language switch can force an app-wide
 * re-render WITHOUT an app restart.
 *
 * Why a counter + subscription instead of a React Context for the locale?
 * `t()` / `tExercise()` / the `dynamic.ts` helpers are plain functions read at
 * hundreds of callsites — not hooks — so a Context value alone would never
 * reach them. Keeping the locale as a module singleton and exposing a tiny
 * subscribe/snapshot pair lets `useSyncExternalStore` drive a single root-level
 * remount (re-key the navigator) that re-runs every `t(...)` with the new
 * locale. See `app/_layout.tsx` for the consumer.
 */
let localeVersion = 0;
const localeListeners = new Set<() => void>();

export function getLocale(): Locale {
  return currentLocale;
}

/**
 * Switch the active locale. No-op (and no version bump / notify) when the
 * locale is unchanged, so a redundant pick never triggers a remount.
 */
export function setLocale(locale: Locale): void {
  if (locale === currentLocale) return;
  currentLocale = locale;
  localeVersion += 1;
  // Snapshot before notifying so a listener that (un)subscribes during the
  // callback can't mutate the set mid-iteration.
  for (const listener of Array.from(localeListeners)) listener();
}

/**
 * Snapshot of the current locale version. Pairs with `subscribeLocale` for
 * `useSyncExternalStore`. The value itself is opaque — consumers only care
 * that it changes when the locale changes.
 */
export function getLocaleVersion(): number {
  return localeVersion;
}

/**
 * Subscribe to locale changes. Returns an unsubscribe function. Used by the
 * `useLocale()` hook; not intended for direct component use.
 */
export function subscribeLocale(listener: () => void): () => void {
  localeListeners.add(listener);
  return () => {
    localeListeners.delete(listener);
  };
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
