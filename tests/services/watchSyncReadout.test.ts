import {
  formatWatchSyncReadout,
  type WatchSyncReadoutState,
} from '../../src/services/watchSyncReadout';

describe('formatWatchSyncReadout (pure formatter, D24 partial)', () => {
  // 固定 now = 2026-05-27 20:00:00 +0800 對應 epoch ms。所有 lastAt 都
  // 相對於這個錨點推算，避免測試在不同時區跑出非預期 buckets。
  const NOW = new Date('2026-05-27T12:00:00Z').getTime();

  describe('never-attempted variant', () => {
    it('顯示 "尚未嘗試" + 空 line2 當 result 為 never-attempted (lastAt null)', () => {
      const state: WatchSyncReadoutState = {
        lastAttemptedAt: null,
        result: 'never-attempted',
      };
      expect(formatWatchSyncReadout(state, NOW)).toEqual({
        line1: '尚未嘗試',
        line2: '',
      });
    });

    it('容忍不一致 state — 即使 lastAt 有值但 result=never-attempted 仍顯 "尚未嘗試"', () => {
      // wire-in bug 寫出不一致 state 時、UI 顯 "尚未嘗試" 比 "5 分鐘前 · 尚未嘗試" 不誤導
      const state: WatchSyncReadoutState = {
        lastAttemptedAt: NOW - 5 * 60_000,
        result: 'never-attempted',
      };
      expect(formatWatchSyncReadout(state, NOW).line1).toBe('尚未嘗試');
    });

    it('lastAt=null + result 非 never-attempted → 仍顯 "尚未嘗試" (defensive fallback)', () => {
      const state: WatchSyncReadoutState = {
        lastAttemptedAt: null,
        result: 'success',
      };
      expect(formatWatchSyncReadout(state, NOW).line1).toBe('尚未嘗試');
    });
  });

  describe('relative time buckets', () => {
    it('< 60 秒 → "剛剛"', () => {
      const state: WatchSyncReadoutState = {
        lastAttemptedAt: NOW - 30_000,
        result: 'success',
      };
      expect(formatWatchSyncReadout(state, NOW).line1).toBe('剛剛 · 成功');
    });

    it('剛好 60 秒 → "1 分鐘前" (boundary)', () => {
      const state: WatchSyncReadoutState = {
        lastAttemptedAt: NOW - 60_000,
        result: 'success',
      };
      expect(formatWatchSyncReadout(state, NOW).line1).toBe('1 分鐘前 · 成功');
    });

    it('5 分鐘前 (典型 in-session 範圍)', () => {
      const state: WatchSyncReadoutState = {
        lastAttemptedAt: NOW - 5 * 60_000,
        result: 'watch-not-reachable',
      };
      expect(formatWatchSyncReadout(state, NOW).line1).toBe(
        '5 分鐘前 · Watch 無法連線',
      );
    });

    it('59 分鐘前 (上限 minutes bucket)', () => {
      const state: WatchSyncReadoutState = {
        lastAttemptedAt: NOW - 59 * 60_000,
        result: 'timeout',
      };
      expect(formatWatchSyncReadout(state, NOW).line1).toBe(
        '59 分鐘前 · Timeout',
      );
    });

    it('剛好 60 分鐘 → "1 小時前" (boundary)', () => {
      const state: WatchSyncReadoutState = {
        lastAttemptedAt: NOW - 60 * 60_000,
        result: 'success',
      };
      expect(formatWatchSyncReadout(state, NOW).line1).toBe('1 小時前 · 成功');
    });

    it('2 小時前 (典型 reopen-after-pause 範圍)', () => {
      const state: WatchSyncReadoutState = {
        lastAttemptedAt: NOW - 2 * 3_600_000,
        result: 'send-failed',
      };
      expect(formatWatchSyncReadout(state, NOW).line1).toBe(
        '2 小時前 · 送出失敗',
      );
    });

    it('23 小時前 (上限 hours bucket)', () => {
      const state: WatchSyncReadoutState = {
        lastAttemptedAt: NOW - 23 * 3_600_000,
        result: 'success',
      };
      expect(formatWatchSyncReadout(state, NOW).line1).toBe('23 小時前 · 成功');
    });

    it('≥ 24 小時 → 絕對時間 MM-DD HH:mm', () => {
      // 24h 前 = 2026-05-26 12:00 UTC = 2026-05-26 20:00 +0800
      const state: WatchSyncReadoutState = {
        lastAttemptedAt: NOW - 24 * 3_600_000,
        result: 'success',
      };
      const out = formatWatchSyncReadout(state, NOW).line1;
      // 用 regex 是因為測試環境時區會影響 HH:mm — 但格式 shape 不變
      expect(out).toMatch(/^\d{2}-\d{2} \d{2}:\d{2} · 成功$/);
    });

    it('Negative delta (lastAt 在未來、clock drift) → fallback 到 "剛剛"', () => {
      const state: WatchSyncReadoutState = {
        lastAttemptedAt: NOW + 10_000,
        result: 'success',
      };
      expect(formatWatchSyncReadout(state, NOW).line1).toBe('剛剛 · 成功');
    });
  });

  describe('result code labels', () => {
    it.each([
      ['success', '成功'],
      ['no-watch-paired', '未配對 Watch'],
      ['watch-not-reachable', 'Watch 無法連線'],
      ['send-failed', '送出失敗'],
      ['timeout', 'Timeout'],
    ] as const)('%s → "%s"', (result, label) => {
      const state: WatchSyncReadoutState = {
        lastAttemptedAt: NOW - 5 * 60_000,
        result,
      };
      expect(formatWatchSyncReadout(state, NOW).line1).toBe(
        `5 分鐘前 · ${label}`,
      );
    });
  });

  describe('output shape invariants', () => {
    it('line2 一律空字串 (預留欄位)', () => {
      const state: WatchSyncReadoutState = {
        lastAttemptedAt: NOW - 60_000,
        result: 'success',
      };
      expect(formatWatchSyncReadout(state, NOW).line2).toBe('');
    });

    it('pure — 相同 input 多次呼叫結果一致', () => {
      const state: WatchSyncReadoutState = {
        lastAttemptedAt: NOW - 5 * 60_000,
        result: 'timeout',
      };
      const a = formatWatchSyncReadout(state, NOW);
      const b = formatWatchSyncReadout(state, NOW);
      expect(a).toEqual(b);
    });
  });
});
