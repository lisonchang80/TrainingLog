/**
 * Slice 13d / D24 partial — pure formatter for the Settings 開發者
 * 「Watch 整合 last sync」debug readout.
 *
 * ADR-0019 Q11 拍板 Branch A: 當 iPhone 無 Watch 配對時走 silent skip，
 * 並在 Settings 開發者區塊加一個 readout 取代退役的
 * `dev_simulate_watch_tracked` toggle。讓用戶（也就是我自己）能查看
 * 最後一次 WC 嘗試的時間 + 結果碼，用於 debug Watch 整合問題。
 *
 * 本檔只 ship D24 的 **純** formatter — 把 (lastAttemptedAt, result) +
 * now 轉成可顯示的字串。Wire-in（從 SQLite 讀 readout state、由
 * connectivity.ts 寫入、Settings UI 渲染 row）等 D24 full commit 處理，
 * gated on D3 bridge + D0 spike outcome。
 *
 * 為什麼拆：
 *   - Pure formatter 可在 `testEnvironment: node` 下測，無需 SQLite seed
 *     或 WC native bridge。
 *   - Wire-in 一旦 D3 + D0 落地，Settings UI row 只是把 reader 結果丟給
 *     `formatWatchSyncReadout(state, Date.now())` — 不需要重新設計協定。
 *
 * See `.claude/skills/ship-partial-pure-logic/SKILL.md` for the
 * pattern this commit follows.
 */

/**
 * 最後一次 WC 嘗試的結果代碼。涵蓋 Q11 silent-skip + Q5/Q7 sendMessage
 * 失敗 fallback 的所有 outcome。
 *
 * - `success`              — sendMessage 成功 + 收到 WC ACK / reply
 * - `no-watch-paired`      — Q11 path：iPhone 端 `isPaired === false`
 *                             silent skip，無 attempt 真的送出
 * - `watch-not-reachable`  — 配對但 `isReachable === false`（Watch off /
 *                             out of range / lock screen 無 unlock）
 * - `send-failed`          — sendMessage 直接被 native bridge reject
 *                             （app 未 install 在 Watch、payload encode 失敗）
 * - `timeout`              — sendMessage 送出但無 reply（Q7 TUI fallback
 *                             仍在 retry 中、或 dedupe-key 已收過）
 * - `never-attempted`      — 該 readout 從未被寫入過（fresh install or
 *                             app_settings 該 key 不存在）
 */
export type WatchSyncResult =
  | 'success'
  | 'no-watch-paired'
  | 'watch-not-reachable'
  | 'send-failed'
  | 'timeout'
  | 'never-attempted';

/**
 * Readout state 持久化 shape。Wire-in commit 會把這個存進 app_settings
 * key `watch_sync_last_readout`（v025 + 後續 schema row）。
 *
 * `lastAttemptedAt` 為 epoch ms — 即使是 `no-watch-paired` 我們也記錄
 * 「最後一次檢查的時間」，這樣讀 readout 才能看出系統有在 active
 * 監測（vs `never-attempted` 表示連檢查邏輯都沒跑過）。
 */
export interface WatchSyncReadoutState {
  lastAttemptedAt: number | null;
  result: WatchSyncResult;
}

/**
 * Formatter 輸出 — 兩行字串。`line2` 預留給未來擴充（e.g. 顯示
 * sendMessage 失敗的 native error code），目前一律空字串。
 *
 * 採 two-line shape 是因為 Settings row 通常 title + subtitle 兩行渲染，
 * future-proof avoid 之後改一行併兩行造成的型別變動。
 */
export interface WatchSyncReadoutDisplay {
  line1: string;
  line2: string;
}

/**
 * 把 result code map 成中文顯示字串。台灣 traditional Chinese — 跟
 * 專案 i18n primary locale 一致（見 user memory `feedback_language.md`）。
 */
function resultLabel(result: WatchSyncResult): string {
  switch (result) {
    case 'success':
      return '成功';
    case 'no-watch-paired':
      return '未配對 Watch';
    case 'watch-not-reachable':
      return 'Watch 無法連線';
    case 'send-failed':
      return '送出失敗';
    case 'timeout':
      return 'Timeout';
    case 'never-attempted':
      return '尚未嘗試';
  }
}

/**
 * 相對時間 formatter — 純函式，無 `Date.now()` 隱性依賴（caller 傳 now）。
 *
 * Buckets:
 *   - < 60s            → "剛剛"
 *   - 60s ≤ Δ < 60min  → "N 分鐘前"
 *   - 60min ≤ Δ < 24h  → "N 小時前"
 *   - ≥ 24h            → "MM-DD HH:mm" 絕對時間（同年）
 *
 * 用 `Math.floor` 而非 `Math.round` — UI 慣例「剛過 5 分鐘」顯示
 * "5 分鐘前" 而不是 "6 分鐘前"（4m59s 顯 "4 分鐘前" 一致）。
 *
 * Negative delta（lastAt 在未來、clock drift / 測試）：fallback 到
 * "剛剛"，不顯負時間。
 */
function formatRelativeTime(lastAt: number, now: number): string {
  const delta = now - lastAt;
  if (delta < 60_000) return '剛剛';
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes} 分鐘前`;
  const hours = Math.floor(delta / 3_600_000);
  if (hours < 24) return `${hours} 小時前`;
  // ≥ 24h → 絕對時間。用 ISO-ish "MM-DD HH:mm" — locale-agnostic、
  // 也避開 toLocaleString 在不同 RN runtime 行為不一致的坑。
  const d = new Date(lastAt);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
}

/**
 * Format the Watch sync readout state for Settings 開發者 row display.
 *
 * Pure — caller provides:
 *   - `state` — 從 app_settings 讀出來的 readout state（wire-in 階段才有）
 *   - `now`   — 通常是 `Date.now()`，注入式以便測試 / 時區一致
 *
 * Output rule:
 *   - `result === 'never-attempted'` 一律顯 "尚未嘗試"（忽略 lastAttemptedAt）
 *   - 否則：`"<相對時間> · <result label>"`
 *
 * 為什麼 `never-attempted` 即使有 ts 也忽略：state 不變式上
 * `result === 'never-attempted'` 應蘊含 `lastAttemptedAt === null`。
 * 但若 wire-in bug 寫入了一個不一致 state，UI 顯 "尚未嘗試" 比顯
 * "5 分鐘前 · 尚未嘗試" 更不誤導。
 */
export function formatWatchSyncReadout(
  state: WatchSyncReadoutState,
  now: number,
): WatchSyncReadoutDisplay {
  if (state.result === 'never-attempted' || state.lastAttemptedAt === null) {
    return { line1: '尚未嘗試', line2: '' };
  }
  const when = formatRelativeTime(state.lastAttemptedAt, now);
  const label = resultLabel(state.result);
  return { line1: `${when} · ${label}`, line2: '' };
}
